"""Opt-in online providers with bounded downloads and explicit provenance."""
import asyncio
from dataclasses import asdict
import ipaddress
import hashlib
import json
from pathlib import Path
import socket
import time
from urllib.parse import urlparse

import httpx

from .captions import Word
from .process import Cancelled


def atomic_json(path, value):
    temporary = path.with_suffix('.json.part')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def checked_url(url, domains):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('URL de recurso no permitida.')
    host = parsed.hostname or ''
    if not any(host == domain or host.endswith('.' + domain) for domain in domains):
        raise ValueError('El proveedor devolvió un host de descarga no autorizado.')
    if any(not ipaddress.ip_address(address[4][0]).is_global for address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)):
        raise ValueError('No se permiten direcciones de red privadas.')
    return url


def download(url, destination, settings, domains, cancelled):
    temporary = destination.with_suffix(destination.suffix + '.part')
    try:
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
            for _ in range(4):
                checked_url(url, domains)
                with client.stream('GET', url) as response:
                    if response.is_redirect:
                        url = str(response.url.join(response.headers['location'])); continue
                    if response.status_code != 200:
                        raise RuntimeError('No se pudo descargar el recurso (HTTP ' + str(response.status_code) + ').')
                    size = 0
                    with temporary.open('wb') as output:
                        for chunk in response.iter_bytes(1024 * 128):
                            if cancelled():
                                raise Cancelled()
                            size += len(chunk)
                            if size > settings.max_download:
                                raise ValueError('El recurso del proveedor supera el límite de descarga.')
                            output.write(chunk)
                    temporary.replace(destination)
                    return
            raise ValueError('Demasiadas redirecciones al descargar el recurso.')
    finally:
        temporary.unlink(missing_ok=True)


async def edge_voice(text, voice, destination, cancelled):
    import edge_tts
    output = []
    communicate = edge_tts.Communicate(text, voice, boundary='WordBoundary', connect_timeout=10, receive_timeout=30)
    with destination.open('wb') as audio:
        async for item in communicate.stream():
            if cancelled():
                raise Cancelled()
            if item['type'] == 'audio':
                audio.write(item['data'])
            elif item['type'] == 'WordBoundary':
                output.append(Word(item['text'], item['offset'] / 10000000, (item['offset'] + item['duration']) / 10000000))
    if not destination.stat().st_size:
        raise RuntimeError('Edge TTS no devolvió audio.')
    return output


def synthesize(text, voice, destination, cancelled):
    try:
        return asyncio.run(asyncio.wait_for(edge_voice(text, voice, destination, cancelled), timeout=180))
    except Cancelled:
        raise
    except Exception:
        destination.unlink(missing_ok=True)
        raise RuntimeError('No se pudo conectar con Edge TTS. Reintenta o utiliza tu propio audio.') from None


PIXABAY_CACHE_SECONDS = 24 * 60 * 60


def pixabay_search(query, settings, aspect, images, cancelled):
    if cancelled():
        raise Cancelled()
    if not settings.pixabay_key:
        raise ValueError('Configura PIXABAY_API_KEY en el servidor.')
    params = {'q': query.strip()[:100], 'per_page': 5, 'safesearch': 'true'}
    if not params['q']:
        raise ValueError('La escena necesita una consulta de búsqueda para Pixabay.')
    endpoint = 'https://pixabay.com/api/' if images else 'https://pixabay.com/api/videos/'
    if images:
        params.update(image_type='photo', orientation={'portrait': 'vertical', 'landscape': 'horizontal'}.get(aspect, 'all'))
    # Cache namespace includes a key fingerprint, never the credential itself.
    fingerprint = hashlib.sha256(settings.pixabay_key.encode()).hexdigest()
    digest = hashlib.sha256(json.dumps([endpoint, params, fingerprint], sort_keys=True).encode()).hexdigest()
    cache = settings.root / 'provider-cache' / 'pixabay'
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    record = cache / (digest + '.json')
    try:
        saved = json.loads(record.read_text(encoding='utf-8'))
        age = time.time() - saved['savedAt']
        if 0 <= age < PIXABAY_CACHE_SECONDS and isinstance(saved['hits'], list):
            return saved['hits']
    except (OSError, ValueError, KeyError, TypeError):
        pass
    try:
        with httpx.Client(timeout=30, trust_env=False, follow_redirects=False) as client:
            response = client.get(endpoint, params={**params, 'key': settings.pixabay_key})
    except httpx.HTTPError:
        # HTTPX errors can include URLs containing the key: never propagate them.
        raise RuntimeError('No se pudo conectar con Pixabay. Reintenta más tarde.') from None
    if response.status_code != 200:
        detail = {400: 'Revisa PIXABAY_API_KEY y la consulta.', 401: 'Revisa PIXABAY_API_KEY.',
                  403: 'Revisa el acceso de tu cuenta.', 429: 'Se alcanzó el límite de solicitudes; espera antes de reintentar.'}
        raise RuntimeError('Pixabay rechazó la búsqueda (HTTP ' + str(response.status_code) + '). ' + detail.get(response.status_code, 'Reintenta más tarde.'))
    try:
        hits = response.json()['hits']
        if not isinstance(hits, list):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise RuntimeError('Pixabay devolvió una respuesta no válida.') from None
    if cancelled():
        raise Cancelled()
    atomic_json(record, {'savedAt': time.time(), 'hits': hits})
    return hits


def pixabay(query, folder, index, settings, aspect, cancelled, images_only=False):
    target_ratio = {'portrait': 9 / 16, 'landscape': 16 / 9, 'square': 1}[aspect]
    for images in ([True] if images_only else [False, True]):
        hits = pixabay_search(query, settings, aspect, images, cancelled)
        choices = []
        for hit in hits:
            if images:
                url = hit.get('largeImageURL')
                if url:
                    choices.append((hit, url, '.jpg'))
            else:
                candidates = [v for v in hit.get('videos', {}).values() if v.get('url') and
                              0 < v.get('width', 0) <= 1920 and 0 < v.get('height', 0) <= 1920 and
                              0 <= v.get('size', 0) <= settings.max_download]
                if candidates:
                    candidate = min(candidates, key=lambda v: (abs(v['width'] / v['height'] - target_ratio),
                                                              abs(max(v['width'], v['height']) - 1280)))
                    choices.append((hit, candidate['url'], '.mp4'))
        if not choices:
            continue
        hit, url, suffix = choices[index % len(choices)]
        if cancelled():
            raise Cancelled()
        checked_url(url, ['pixabay.com'])
        # One download per public resource per job; retries retain completed media.
        path = folder / ('pixabay-' + hashlib.sha256(url.encode()).hexdigest() + suffix)
        if not path.is_file() or not path.stat().st_size:
            if settings.storage_used() + settings.max_download > settings.max_storage:
                raise ValueError('No hay espacio disponible para descargar el recurso.')
            download(url, path, settings, ['pixabay.com'], cancelled)
        return path, {'provider': 'Pixabay', 'query': query[:100], 'creator': hit.get('user', ''),
                      'source': hit.get('pageURL', ''), 'license': 'https://pixabay.com/service/license-summary/',
                      'id': str(hit.get('id', '')), 'type': 'image' if images else 'video'}
    raise ValueError('Pixabay no encontró recursos adecuados para: ' + query[:100] + '. Usa recursos propios o ajusta la escena.')


def replicate(prompt, folder, index, settings, cancelled):
    if not settings.replicate_token or len(settings.replicate_version) != 64:
        raise ValueError('Configura REPLICATE_API_TOKEN y la versión exacta de un modelo (64 caracteres).')
    record = folder / f'prediction-{index}.json'
    state = json.loads(record.read_text()) if record.exists() else None
    headers = {'Authorization': 'Bearer ' + settings.replicate_token}
    with httpx.Client(timeout=30, trust_env=False) as client:
        if state and not state.get('id'):
            raise RuntimeError('La solicitud de Replicate pudo haberse enviado sin confirmar. Revisa tu cuenta antes de crear otro trabajo; no se repetirá el cobro automáticamente.')
        if not state:
            try:
                inputs = json.loads(settings.replicate_input)
                if not isinstance(inputs, dict):
                    raise ValueError()
            except ValueError:
                raise ValueError('REPLICATE_INPUT_JSON debe ser un objeto JSON válido.') from None
            inputs['prompt'] = prompt[:3000]
            atomic_json(record, {'submission': 'pending', 'version': settings.replicate_version})
            response = client.post('https://api.replicate.com/v1/predictions', headers=headers,
                                   json={'version': settings.replicate_version, 'input': inputs})
            if response.status_code not in (200, 201, 202):
                if response.status_code < 500:
                    record.unlink(missing_ok=True)
                raise RuntimeError('Replicate rechazó la generación (HTTP ' + str(response.status_code) + ').')
            state = response.json()
            if not isinstance(state.get('id'), str) or not state['id'].isalnum():
                raise RuntimeError('Respuesta de Replicate no válida; revisa la solicitud en tu cuenta.')
            atomic_json(record, {'id': state['id'], 'version': settings.replicate_version})
        ident, started = state['id'], time.monotonic()
        while True:
            if cancelled():
                try:
                    client.post(f'https://api.replicate.com/v1/predictions/{ident}/cancel', headers=headers)
                finally:
                    raise Cancelled()
            response = client.get(f'https://api.replicate.com/v1/predictions/{ident}', headers=headers)
            if response.status_code != 200:
                raise RuntimeError('No se pudo consultar Replicate; reintenta este trabajo para seguir la misma predicción.')
            state = response.json()
            if state.get('status') == 'succeeded':
                break
            if state.get('status') in {'failed', 'canceled'}:
                raise RuntimeError('La predicción de Replicate falló o se canceló. No se crea otra automáticamente.')
            if time.monotonic() - started > 1200:
                raise RuntimeError('Replicate sigue procesando; reintenta este trabajo para consultar la misma predicción.')
            for _ in range(10):
                if cancelled():
                    break
                time.sleep(.2)
        output = state.get('output')
        url = output[0] if isinstance(output, list) and output else output
        if not isinstance(url, str):
            raise ValueError('El modelo debe devolver una URL de imagen/video o una lista de URLs.')
        path = folder / f'material-{index}.media'
        download(url, path, settings, ['replicate.delivery'], cancelled)
        return path, {'provider': 'Replicate', 'predictionId': ident, 'modelVersion': settings.replicate_version,
                      'license': 'Verificar la licencia del modelo y sus recursos; no se presupone permiso comercial.'}


def notify(settings, job_id, state):
    if not settings.telegram_token or not settings.telegram_chat:
        return False
    try:
        with httpx.Client(timeout=10, trust_env=False) as client:
            response = client.post('https://api.telegram.org/bot' + settings.telegram_token + '/sendMessage',
                                   json={'chat_id': settings.telegram_chat, 'text': f'YT Research · {job_id[:8]} · {state}'})
        return response.status_code == 200
    except httpx.HTTPError:
        return False
