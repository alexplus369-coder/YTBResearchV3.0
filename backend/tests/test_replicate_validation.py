"""GPT Image routing and rejected inputs, using provider fixtures only."""
import io
import json
import shutil
import time

from fastapi.testclient import TestClient
import httpx
from PIL import Image
import pytest

from backend import replicate_studio as studio
from backend.api import create_app
from backend.models import ReplicateSelection
from backend.store import Store
from backend.tests.test_replicate_studio import metadata, mock_client

GPT_MODELS = ['openai/gpt-image-2', 'openai/gpt-image-1.5',
              'openai/gpt-image-2.5-flare', 'openai/gpt-image-2.5-sunburst']


def gpt_metadata(model):
    # Representative documented fields, not a claim to snapshot the live provider schema.
    properties = {
        'prompt': {'type': 'string', 'minLength': 1},
        'quality': {'allOf': [{'type': 'string', 'enum': ['low', 'medium', 'high', 'auto']}], 'default': 'auto'},
        'output_format': {'allOf': [{'type': 'string', 'enum': ['png', 'webp', 'jpeg']}], 'default': 'webp'},
        'background': {'type': 'string', 'enum': ['auto', 'transparent', 'opaque'], 'default': 'auto'},
        'number_of_images': {'type': 'integer', 'minimum': 1, 'maximum': 10, 'default': 1},
        'output_compression': {'type': 'integer', 'minimum': 0, 'maximum': 100, 'default': 90},
        'user_id': {'type': 'string', 'nullable': True, 'default': None},
        'input_images': {'type': 'array', 'nullable': True, 'default': None, 'items': {'type': 'string', 'format': 'uri'}},
        'openai_api_key': {'type': 'string', 'x-cog-secret': True, 'default': 'never-send-default'},
    }
    data = metadata(model, properties, ['prompt'])
    data['latest_version']['id'] = 'provider-managed'
    return data


@pytest.mark.parametrize('model', GPT_MODELS)
def test_gpt_image_uses_official_endpoint_and_omits_optional_nulls(settings, monkeypatch, model):
    if not shutil.which('ffprobe'):
        pytest.skip('Media verification requires FFprobe')
    settings.replicate_token = 'provider-only-test-token'
    image = io.BytesIO(); Image.new('RGB', (64, 64), 'blue').save(image, format='PNG')
    calls = []
    def handler(request):
        calls.append(request)
        if request.url.host == 'replicate.delivery':
            assert 'Authorization' not in request.headers
            return httpx.Response(200, content=image.getvalue())
        if request.method == 'GET' and request.url.path == '/v1/models/' + model:
            return httpx.Response(200, json=gpt_metadata(model))
        if request.method == 'POST':
            assert request.url.path == '/v1/models/' + model + '/predictions'
            payload = json.loads(request.content)
            assert set(payload) == {'input'}
            inputs = payload['input']
            assert inputs['quality'] == 'low' and inputs['output_format'] == 'png'
            assert inputs['user_id'] == '15' and inputs['number_of_images'] == 1
            assert 'input_images' not in inputs and 'openai_api_key' not in inputs
            return httpx.Response(201, json={'id': 'gptfixture'})
        return httpx.Response(200, json={'status': 'succeeded', 'output': ['https://replicate.delivery/fixture/image.png']})
    mock_client(monkeypatch, handler)
    selection = ReplicateSelection(model=model, kind='image', inputs={
        'prompt': 'An original architectural cutaway', 'quality': 'low', 'output_format': 'png', 'user_id': '15', 'input_images': None})
    with TestClient(create_app(settings)) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        payload = {'selection': selection.model_dump(), 'paid_generation_confirmed': True}
        response = client.post('/api/video/replicate/resources', json=payload)
        assert response.status_code == 202, response.text
        ident = response.json()['id']; deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            job = client.get('/api/video/jobs/' + ident).json()
            if job['state'] in {'completed', 'failed'}:
                break
            time.sleep(.02)
        assert job['state'] == 'completed', job
        asset = job['result']['assetId']
        assert client.get('/api/video/assets/' + asset + '/file').content == image.getvalue()
        assert client.post('/api/video/replicate/resources', json=payload).json()['id'] == ident
    assert len([call for call in calls if call.method == 'POST']) == 1


def test_optional_defaults_are_omitted_but_explicit_nulls_and_required_fields_are_preserved(settings, monkeypatch):
    settings.replicate_token = 'test-token'; model = GPT_MODELS[0]
    data = gpt_metadata(model)
    props = data['latest_version']['openapi_schema']['components']['schemas']['Input']['properties']
    props['explicit_nullable'] = {'type': 'string', 'nullable': True}
    props['required_nullable'] = {'type': 'string', 'nullable': True, 'default': None}
    data['latest_version']['openapi_schema']['components']['schemas']['Input']['required'].append('required_nullable')
    mock_client(monkeypatch, lambda r: httpx.Response(200, json=data))
    selection = ReplicateSelection(model=model, kind='image', inputs={
        'prompt': 'Original', 'user_id': None, 'input_images': None, 'explicit_nullable': None, 'required_nullable': None})
    inputs = studio.prepare(selection, settings, Store(settings.root))['inputs']
    assert 'user_id' not in inputs and 'input_images' not in inputs
    assert inputs['explicit_nullable'] is None and inputs['required_nullable'] is None


@pytest.mark.parametrize('detail', [
    {'detail': 'input.quality: Invalid value PRIVATE-PROMPT https://private.example/file?key=private-token'},
    {'detail': [{'loc': ['body', 'input', 'quality'], 'msg': 'PRIVATE-PROMPT private-token', 'input': 'PRIVATE-PROMPT'}]},
    {'detail': [{'path': 'input.quality', 'message': 'PRIVATE-PROMPT private-token'}]},
    {'errors': [{'loc': ['input', 'quality'], 'msg': 'PRIVATE-PROMPT private-token'}]},
])
def test_422_shows_allowlisted_field_constraints_and_never_reposts_rejection(settings, monkeypatch, detail):
    settings.replicate_token = 'private-token'; model = GPT_MODELS[0]; posts = []
    def handler(request):
        if request.method == 'GET':
            return httpx.Response(200, json=gpt_metadata(model))
        posts.append(request)
        return httpx.Response(422, json=detail)
    mock_client(monkeypatch, handler)
    store = Store(settings.root)
    plan = studio.prepare(ReplicateSelection(model=model, kind='image', inputs={'prompt': 'PRIVATE-PROMPT'}), settings, store)
    cache = studio.schema_record(model, settings)
    assert cache.exists()
    for _ in range(2):
        with pytest.raises(RuntimeError) as error:
            studio.generate(plan, settings.root, 'rejected', settings, store, lambda: False)
        message = str(error.value)
        assert 'HTTP 422' in message and 'Campo quality' in message and 'low, medium, high, auto' in message
        assert 'Recargar parámetros' in message
        assert all(secret not in message for secret in ['PRIVATE-PROMPT', 'private-token', 'private.example'])
    assert len(posts) == 1 and not cache.exists()
    state = json.loads((settings.root / 'rejected.json').read_text())
    assert state['submission'] == 'rejected' and 'id' not in state
    assert all(secret not in str(state) for secret in ['PRIVATE-PROMPT', 'private-token', 'private.example'])


@pytest.mark.parametrize('body', [
    {'detail': 'version: PRIVATE-VERSION is not valid'},
    {'detail': 'input.openai_api_key: private-token'},
    {'detail': [{'loc': ['input', 'unknown-field-private-token'], 'msg': 'PRIVATE-PROMPT'}]},
    {'detail': '<script>PRIVATE-PROMPT</script>'},
    ['PRIVATE-PROMPT'],
])
def test_422_unknown_and_secret_fields_use_safe_fallback(settings, monkeypatch, body):
    settings.replicate_token = 'private-token'
    mock_client(monkeypatch, lambda r: httpx.Response(422, json=body))
    with httpx.Client() as client, pytest.raises(studio.ReplicateHTTPError) as error:
        studio.call(client, 'POST', '/predictions', settings,
                    input_schema=gpt_metadata(GPT_MODELS[0])['latest_version']['openapi_schema']['components']['schemas']['Input'])
    message = str(error.value)
    assert all(secret not in message for secret in ['PRIVATE-PROMPT', 'PRIVATE-VERSION', 'private-token', 'openai_api_key'])
    assert 'Recargar parámetros' in message and 'Campo' not in message


def test_reload_bypasses_schema_cache_and_is_authenticated(settings, monkeypatch):
    settings.replicate_token = 'private-token'; model = GPT_MODELS[0]; gets = []
    def handler(request):
        assert request.method == 'GET'
        gets.append(request)
        data = gpt_metadata(model)
        if len(gets) > 1:
            props = data['latest_version']['openapi_schema']['components']['schemas']['Input']['properties']
            props['quality']['default'] = 'low'
        return httpx.Response(200, json=data)
    mock_client(monkeypatch, handler)
    with TestClient(create_app(settings, run_worker=False)) as client:
        url = '/api/video/replicate/models/' + model + '/schema'
        assert client.get(url + '?refresh=true').status_code == 401 and not gets
        client.headers['Authorization'] = 'Bearer ' + settings.token
        first = client.get(url).json()
        assert client.get(url).json() == first and len(gets) == 1
        second = client.get(url + '?refresh=true').json()
        assert len(gets) == 2 and first['version'] != second['version']
        assert second['input_schema']['properties']['quality']['default'] == 'low'
        assert client.get(url).json() == second and len(gets) == 2


def test_old_cached_version_route_is_not_reused(settings, monkeypatch):
    import hashlib
    settings.replicate_token = 'test-token'; model = GPT_MODELS[0]
    old = settings.root / 'provider-cache' / 'replicate' / (hashlib.sha256((settings.replicate_token + model).encode()).hexdigest() + '.json')
    old.parent.mkdir(parents=True); old.write_text(json.dumps({'savedAt': time.time(), 'schema': {'api_mode': 'version'}}))
    calls = []
    def handler(request):
        calls.append(request); return httpx.Response(200, json=gpt_metadata(model))
    mock_client(monkeypatch, handler)
    assert studio.schema(model, settings)['api_mode'] == 'official'
    assert len(calls) == 1
