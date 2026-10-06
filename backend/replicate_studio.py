"""Allowlisted FrameShift catalog, live schemas and durable, opt-in predictions."""
from copy import deepcopy
import hashlib
import json
import mimetypes
from pathlib import Path
import re
import time
from urllib.parse import urlparse

import httpx
from jsonschema import Draft7Validator, SchemaError

from . import providers, svg_media
from .process import Cancelled, probe, duration

CATALOG = json.loads(Path(__file__).with_name('replicate_catalog.json').read_text(encoding='utf-8'))
MODELS = {m['id']: m for m in CATALOG['models']}
API = 'https://api.replicate.com/v1'
CACHE_SECONDS = 86400


def model_entry(model):
    entry = MODELS.get(model)
    if not entry or not entry['kind']:
        raise ValueError('El modelo no está habilitado para imágenes, videos, música o voz en este catálogo.')
    return entry


def call(client, method, path, settings, **kwargs):
    if not settings.replicate_token:
        raise ValueError('Configura REPLICATE_API_TOKEN en el servidor.')
    try:
        response = client.request(method, API + path, headers={'Authorization': 'Bearer ' + settings.replicate_token}, **kwargs)
    except httpx.HTTPError:
        raise RuntimeError('No se pudo conectar con Replicate. No se repiten solicitudes de pago automáticamente.') from None
    if response.status_code not in {200, 201, 202}:
        message = {401: 'Revisa REPLICATE_API_TOKEN.', 402: 'Revisa el saldo de Replicate.', 404: 'El modelo o versión no está disponible.',
                   422: 'Replicate rechazó los parámetros.', 429: 'Se alcanzó la cuota. Espera antes de reintentar.'}
        raise RuntimeError('Replicate respondió HTTP ' + str(response.status_code) + '. ' + message.get(response.status_code, 'Revisa el trabajo antes de reintentar.'))
    try:
        if len(response.content) > 2 * 1024 * 1024:
            raise ValueError()
        value = response.json()
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except ValueError:
        raise RuntimeError('Replicate devolvió una respuesta no válida.') from None


def expand(document, value, depth=0):
    if depth > 20:
        raise ValueError('El esquema del modelo es demasiado complejo.')
    if isinstance(value, list):
        return [expand(document, v, depth + 1) for v in value]
    if not isinstance(value, dict):
        return value
    if '$ref' in value:
        ref = value['$ref']
        if not isinstance(ref, str) or not ref.startswith('#/components/schemas/'):
            raise ValueError('No se permiten referencias externas en el esquema del modelo.')
        target = document
        try:
            for part in ref[2:].split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        except (KeyError, TypeError):
            raise ValueError('Referencia de esquema no válida.') from None
        return expand(document, {**target, **{k: v for k, v in value.items() if k != '$ref'}}, depth + 1)
    result = {k: expand(document, v, depth + 1) for k, v in value.items()}
    # OpenAPI nullable is not a JSON Schema keyword.
    if result.get('nullable'):
        if isinstance(result.get('type'), str):
            result['type'] = [result['type'], 'null']
        if 'enum' in result and None not in result['enum']:
            result['enum'].append(None)
        if 'allOf' in result:
            result['allOf'] = [expand(document, {**part, 'nullable': True}, depth + 1) for part in result['allOf']]
        for union in ('anyOf', 'oneOf'):
            if union in result and not any(part.get('type') == 'null' for part in result[union]):
                result[union].append({'type': 'null'})
    # OpenAPI 3.0 uses boolean exclusive limits; Draft 7 uses numeric limits.
    for bound in ('Minimum', 'Maximum'):
        keyword, inclusive = 'exclusive' + bound, bound.lower()
        if isinstance(result.get(keyword), bool):
            exclusive = result.pop(keyword)
            if exclusive and inclusive in result:
                result[keyword] = result.pop(inclusive)
    return result


def schema(model, settings):
    model_entry(model)
    if not settings.replicate_token:
        raise ValueError('Configura REPLICATE_API_TOKEN en el servidor.')
    cache = settings.root / 'provider-cache' / 'replicate'
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = hashlib.sha256((settings.replicate_token + model).encode()).hexdigest()
    record = cache / (key + '.json')
    try:
        saved = json.loads(record.read_text(encoding='utf-8'))
        if 0 <= time.time() - saved['savedAt'] < CACHE_SECONDS:
            return saved['schema']
    except (OSError, ValueError, KeyError, TypeError):
        pass
    with httpx.Client(timeout=30, trust_env=False, follow_redirects=False) as client:
        data = call(client, 'GET', '/models/' + model, settings)
    version = data.get('latest_version') or {}
    ident = version.get('id', '')
    ident = ident if isinstance(ident, str) else ''
    document = version.get('openapi_schema') or {}
    official = model_entry(model).get('prediction_api') == 'official'
    if not re.fullmatch(r'[a-f0-9]{64}', ident) and not official:
        raise ValueError('El modelo no publica un esquema/version identificable. No se habilita la generación a ciegas.')
    input_schema = expand(document, document.get('components', {}).get('schemas', {}).get('Input', {}))
    if not input_schema.get('properties') or len(json.dumps(input_schema)) > 500000:
        raise ValueError('No se pudo obtener un esquema de entradas utilizable.')
    try:
        Draft7Validator.check_schema(input_schema)
    except SchemaError:
        raise ValueError('El modelo publicó un esquema no compatible. No se permite generar sin validación.') from None
    # Secret fields are never accepted or populated from model defaults.
    for field in input_schema['properties'].values():
        if field_shape(field).get('x-cog-secret'):
            field.pop('default', None)
            for part in field.get('allOf', []):
                part.pop('default', None)
    # Official models can hide their version ID. A schema digest still detects form changes.
    if not re.fullmatch(r'[a-f0-9]{64}', ident):
        ident = hashlib.sha256(json.dumps(input_schema, sort_keys=True).encode()).hexdigest()
    result = {'model': model, 'version': ident, 'api_mode': 'official' if official else 'version', 'input_schema': input_schema, 'kind': model_entry(model)['kind'],
              'model_url': 'https://replicate.com/' + model}
    providers.atomic_json(record, {'savedAt': time.time(), 'schema': result})
    return result


def field_shape(field):
    result = {}
    for item in field.get('allOf', []):
        result.update(field_shape(item))
    return {**result, **field}


def file_field(field):
    field = field_shape(field)
    return field.get('format') in {'uri', 'url'} or field.get('x-cog-file') or (field_type(field) == 'array' and file_field(field.get('items', {})))


def field_type(field):
    value = field_shape(field).get('type')
    return next((v for v in value if v != 'null'), None) if isinstance(value, list) else value


def checked_inputs(inputs, input_schema):
    properties = input_schema['properties']
    if set(inputs) - set(properties):
        raise ValueError('Hay parámetros que este modelo no admite.')
    for key, value in inputs.items():
        field = properties[key]
        if field_shape(field).get('x-cog-secret'):
            raise ValueError('No se aceptan credenciales como parámetros de un modelo.')
        if file_field(field):
            for url in value if isinstance(value, list) else [value]:
                if url is None:
                    continue
                try:
                    parsed = urlparse(url) if isinstance(url, str) else None
                    valid = parsed and parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password and parsed.port in (None, 443)
                except ValueError:
                    valid = False
                if not valid:
                    raise ValueError('Las referencias deben ser recursos locales subidos o URLs HTTPS sin credenciales.')
    error = next(Draft7Validator(input_schema).iter_errors(inputs), None)
    if error:
        # Never echo input values, URIs or remote error bodies.
        name = '.'.join(str(p) for p in error.absolute_path) or 'campos requeridos'
        raise ValueError('Parámetro inválido: ' + name[:100] + ' (' + str(error.validator) + '). Revisa el formulario del modelo.')


def prepare(selection, settings, store, texts=None):
    entry = model_entry(selection.model)
    if selection.kind != entry['kind']:
        raise ValueError('El tipo de recurso no corresponde al modelo seleccionado.')
    meta = schema(selection.model, settings)
    if selection.version and selection.version != meta['version']:
        raise ValueError('La versión del modelo cambió. Vuelve a cargar sus parámetros antes de generar.')
    fields = {name: field_shape(field) for name, field in meta['input_schema']['properties'].items()}
    inputs = {k: deepcopy(v['default']) for k, v in fields.items() if 'default' in v and not v.get('x-cog-secret')}
    inputs.update(selection.inputs)
    for name, ids in selection.file_inputs.items():
        field = fields.get(name, {})
        if not file_field(field) or field.get('x-cog-secret'):
            raise ValueError('Referencia de archivo no admitida por el modelo.')
        if field_type(field) != 'array' and len(ids) != 1:
            raise ValueError('Este campo acepta un solo recurso.')
        for ident in ids:
            store.asset(ident)
        placeholders = ['https://replicate.delivery/local-reference'] * len(ids)
        inputs[name] = placeholders if field_type(field) == 'array' else placeholders[0]
    text_field = next((name for name in (['text', 'prompt', 'transcript'] if selection.kind == 'voice' else ['prompt']) if name in fields), None)
    if texts is not None:
        if not text_field or fields[text_field].get('x-cog-secret'):
            raise ValueError('Este modelo no admite el texto automático del guion. Genera el recurso por separado y asígnalo como recurso propio.')
        for text in texts:
            checked_inputs({**inputs, text_field: text}, meta['input_schema'])
    else:
        checked_inputs(inputs, meta['input_schema'])
    # Placeholder URLs are replaced only with uploaded assets inside the worker.
    return {'model': selection.model, 'kind': selection.kind, 'version': meta['version'], 'api_mode': meta.get('api_mode', 'version'), 'input_schema': meta['input_schema'],
            'inputs': inputs, 'file_inputs': selection.file_inputs, 'text_field': text_field}


def upload_reference(client, ident, folder, settings, store, cancelled):
    if cancelled():
        raise Cancelled()
    asset = store.asset(ident)
    path = Path(asset['path'])
    record = folder / ('replicate-file-' + ident + '.json')
    try:
        saved = json.loads(record.read_text())
        if 0 <= time.time() - saved['savedAt'] < 3600:
            return saved['url']
    except (OSError, ValueError, KeyError, TypeError):
        pass
    with path.open('rb') as file:
        value = call(client, 'POST', '/files', settings, files={'content': (path.name, file, mimetypes.guess_type(path.name)[0] or 'application/octet-stream')})
    url = value.get('urls', {}).get('get')
    if not isinstance(url, str) or urlparse(url).scheme != 'https':
        raise RuntimeError('Replicate no devolvió la URL del archivo de referencia.')
    providers.atomic_json(record, {'savedAt': time.time(), 'url': url})
    return url


def generate(plan, folder, name, settings, store, cancelled, text=None):
    record, path = folder / (name + '.json'), folder / (name + '.media')
    state = json.loads(record.read_text()) if record.exists() else None
    if state and not state.get('id'):
        raise RuntimeError('La solicitud pudo haberse enviado sin confirmar. Revisa Replicate; no se repetirá el cobro automáticamente.')
    with httpx.Client(timeout=30, trust_env=False, follow_redirects=False) as client:
        if not state:
            if cancelled():
                raise Cancelled()
            inputs = deepcopy(plan['inputs'])
            if text is not None:
                inputs[plan['text_field']] = text
            for field, ids in plan['file_inputs'].items():
                urls = [upload_reference(client, ident, folder, settings, store, cancelled) for ident in ids]
                inputs[field] = urls if field_type(plan['input_schema']['properties'][field]) == 'array' else urls[0]
            checked_inputs(inputs, plan['input_schema'])
            if cancelled():
                raise Cancelled()
            providers.atomic_json(record, {'submission': 'pending', 'model': plan['model'], 'version': plan['version']})
            if plan.get('api_mode') == 'official':
                value = call(client, 'POST', '/models/' + plan['model'] + '/predictions', settings, json={'input': inputs})
            else:
                value = call(client, 'POST', '/predictions', settings, json={'version': plan['version'], 'input': inputs})
            ident = value.get('id', '')
            if not re.fullmatch(r'[a-zA-Z0-9]+', ident):
                raise RuntimeError('Predicción sin ID válido. Revisa Replicate antes de crear otra solicitud.')
            state = {'id': ident, 'model': plan['model'], 'version': plan['version']}
            providers.atomic_json(record, state)
        if not path.is_file():
            state['completed'] = False  # Refresh an expired output URL via the same prediction, never a new POST.
        started = time.monotonic()
        while not state.get('completed'):
            if cancelled():
                try:
                    call(client, 'POST', '/predictions/' + state['id'] + '/cancel', settings)
                finally:
                    raise Cancelled()
            value = call(client, 'GET', '/predictions/' + state['id'], settings)
            if value.get('status') == 'succeeded':
                output = value.get('output')
                # Only URL outputs are supported; text, archives and 3D stay out of the video pipeline.
                urls = [output] if isinstance(output, str) else output if isinstance(output, list) else [output.get(k) for k in ('image', 'svg', 'video', 'audio', 'url')] if isinstance(output, dict) else []
                url = next((u for u in urls if isinstance(u, str) and u.startswith('https://')), None)
                if not url:
                    raise ValueError('El modelo no devolvió una URL de imagen, video o audio compatible.')
                state.update(completed=True, output_url=url)
                providers.atomic_json(record, state)
                break
            if value.get('status') in {'failed', 'canceled'}:
                raise RuntimeError('La predicción falló o se canceló. No se crea otra automáticamente.')
            if time.monotonic() - started > 1200:
                raise RuntimeError('Replicate sigue procesando. Reintenta este mismo trabajo para consultar su predicción.')
            for _ in range(10):
                if cancelled():
                    break
                time.sleep(.2)
    if cancelled():
        raise Cancelled()
    if not path.is_file():
        if settings.storage_used() + settings.max_download > settings.max_storage:
            raise ValueError('No hay espacio para descargar el recurso generado.')
        providers.download(state['output_url'], path, settings, ['replicate.delivery'], cancelled)
    vector = model_entry(plan['model']).get('output_format') == 'svg'
    if vector:
        png = folder / (name + '.png')
        if not png.is_file():
            svg_media.rasterize(path, png)
        path = png
    metadata = probe(path, settings)
    streams = metadata['streams']
    video = next((s for s in streams if s.get('codec_type') == 'video'), None)
    audio = any(s.get('codec_type') == 'audio' for s in streams)
    is_image = bool(video and video.get('codec_name') in {'png', 'mjpeg', 'webp', 'gif', 'bmp'})
    actual = 'image' if is_image else 'video' if video else 'audio' if audio else ''
    expected = 'audio' if plan['kind'] in {'music', 'voice'} else plan['kind']
    if actual != expected:
        raise ValueError('El recurso devuelto no corresponde al tipo seleccionado. Conservamos la predicción; no se genera otra al reintentar.')
    if actual != 'image':
        duration(path, settings)
    return path, {'provider': 'Replicate', 'model': plan['model'],
                  'modelVersion': 'provider-managed' if plan.get('api_mode') == 'official' else plan['version'],
                  'schemaVersion': plan['version'], 'predictionApi': plan.get('api_mode', 'version'), 'predictionId': state['id'],
                  'type': plan['kind'], 'source': 'https://replicate.com/' + plan['model'], 'vectorOriginal': vector,
                  'license': model_entry(plan['model']).get('license_warning') or 'Revisar licencia y permisos comerciales del modelo y de los recursos de referencia.'}
