import hashlib
import json
from pathlib import Path
import shutil
import socket
import time
import zipfile

from fastapi.testclient import TestClient
import httpx
import pytest

from backend import pipeline, providers, replicate_studio as studio
from backend.api import create_app
from backend.models import ReplicateSelection
from backend.process import Cancelled
from backend.store import Store
from backend.tests.conftest import wav_bytes

IDS = {'image': 'google/imagen-4-ultra', 'video': 'wavespeedai/wan-2.1-i2v-480p',
       'music': 'meta/musicgen', 'voice': 'minimax/speech-02-turbo'}


def metadata(model, properties=None, required=None):
    props = properties or {'text' if model == IDS['voice'] else 'prompt': {'type': 'string', 'minLength': 1}}
    return {'latest_version': {'id': hashlib.sha256(model.encode()).hexdigest(), 'openapi_schema': {
        'components': {'schemas': {'Input': {'type': 'object', 'properties': props, 'required': required or list(props)}}}}}}


def mock_client(monkeypatch, handler):
    real = httpx.Client
    monkeypatch.setattr(studio.httpx, 'Client', lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))])


def choice(kind, **extra):
    return ReplicateSelection(model=IDS[kind], kind=kind, inputs={'text' if kind == 'voice' else 'prompt': 'Original fixture'}, **extra)


def test_catalog_is_authenticated_and_requires_no_provider_calls(settings):
    with TestClient(create_app(settings, run_worker=False)) as client:
        assert client.get('/api/video/replicate/models').status_code == 401
        client.headers['Authorization'] = 'Bearer ' + settings.token
        result = client.get('/api/video/replicate/models').json()
        assert len(result['models']) == 96 and len({m['id'] for m in result['models']}) == 96
        assert {m['kind'] for m in result['models']} >= {'image', 'video', 'music', 'voice', None}
        assert settings.token not in str(result)
        assert client.get('/api/video/replicate/models/not-an-owner/not-a-model/schema').status_code == 400


def test_live_schema_is_cached_redacted_and_isolated_by_token(settings, monkeypatch):
    settings.replicate_token = 'server-only-test-secret'
    calls = []
    def handler(request):
        calls.append(request)
        assert request.method == 'GET' and request.url.host == 'api.replicate.com'
        assert request.headers['Authorization'] == 'Bearer ' + settings.replicate_token
        assert settings.replicate_token not in str(request.url)
        return httpx.Response(200, json=metadata(IDS['image'], {'prompt': {'type': 'string'}, 'private': {'type': 'string', 'x-cog-secret': True, 'default': 'never-share'}}, ['prompt']))
    mock_client(monkeypatch, handler)
    first = studio.schema(IDS['image'], settings)
    assert 'default' not in first['input_schema']['properties']['private']
    assert studio.schema(IDS['image'], settings) == first and len(calls) == 1
    record = next((settings.root / 'provider-cache' / 'replicate').glob('*.json'))
    assert settings.replicate_token not in record.read_text()
    data = json.loads(record.read_text()); data['savedAt'] -= studio.CACHE_SECONDS + 1
    providers.atomic_json(record, data); studio.schema(IDS['image'], settings)
    assert len(calls) == 2
    settings.replicate_token = 'different-token'; studio.schema(IDS['image'], settings)
    assert len(calls) == 3


def test_inputs_are_schema_checked_before_any_paid_post(settings, monkeypatch):
    settings.replicate_token = 'test-token'; calls = []
    props = {'prompt': {'type': 'string', 'minLength': 1}, 'format': {'type': 'string', 'enum': ['png', 'jpeg']},
             'steps': {'type': 'integer', 'minimum': 1, 'maximum': 10, 'default': 4},
             'image': {'type': 'string', 'format': 'uri'}, 'secret': {'type': 'string', 'x-cog-secret': True}}
    def handler(request):
        calls.append(request.method); return httpx.Response(200, json=metadata(IDS['image'], props, ['prompt']))
    mock_client(monkeypatch, handler)
    store = Store(settings.root)
    for values in [{'steps': 100}, {'format': 'SECRET-BAD-VALUE'}, {'extra': 1}, {'secret': 'credential'},
                   {'image': 'file:///etc/passwd'}, {'image': 'https://user:password@example.test/file.jpg'}]:
        selected = choice('image'); selected.inputs.update(values)
        with pytest.raises(ValueError) as error:
            studio.prepare(selected, settings, store)
        assert 'SECRET-BAD-VALUE' not in str(error.value) and 'password' not in str(error.value)
    assert calls == ['GET']
    plan = studio.prepare(choice('image'), settings, store, ['scene-specific original prompt'])
    assert plan['inputs']['steps'] == 4 and plan['text_field'] == 'prompt'
    with pytest.raises(ValueError, match='versión'):
        selected = choice('image', version='a' * 64); studio.prepare(selected, settings, store)
    with pytest.raises(ValueError, match='tipo'):
        selected = choice('image'); selected.kind = 'music'; studio.prepare(selected, settings, store)
    with pytest.raises(ValueError, match='referencias externas'):
        studio.expand({}, {'$ref': 'https://evil.test/schema.json'})


def test_paid_opt_in_is_required_before_catalog_or_generation(settings, monkeypatch):
    settings.replicate_token = 'test-token'
    mock_client(monkeypatch, lambda request: pytest.fail('No provider request should occur without payment opt-in'))
    with TestClient(create_app(settings, run_worker=False)) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        result = client.post('/api/video/replicate/resources', json={'selection': choice('image').model_dump()})
        assert result.status_code == 422 and client.get('/api/video/jobs').json() == []


@pytest.mark.parametrize('http_status', [401, 402, 404, 429, 500])
def test_schema_provider_errors_hide_secrets_and_bodies(settings, monkeypatch, http_status):
    settings.replicate_token = 'private-token'
    mock_client(monkeypatch, lambda request: httpx.Response(http_status, text=settings.replicate_token + ' private-response-body'))
    with TestClient(create_app(settings, run_worker=False)) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        response = client.get('/api/video/replicate/models/google/imagen-4-ultra/schema')
        assert response.status_code == 502
        assert settings.replicate_token not in response.text and 'private-response-body' not in response.text


@pytest.fixture
def media_sources(settings):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('Real media tests require FFmpeg')
    image, video, audio = settings.root / 'source.png', settings.root / 'source.mp4', settings.root / 'source.wav'
    pipeline.card(image, 'Prueba original', 'Tres pasos', 1280, 720)
    pipeline.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=24', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(video)], settings.root)
    audio.write_bytes(wav_bytes(1.8))
    return {'image': image, 'video': video, 'music': audio, 'voice': audio}


def provider_fixture(monkeypatch, settings, media_sources, reference=False):
    calls, predictions = [], {}
    by_version = {metadata(model)['latest_version']['id']: kind for kind, model in IDS.items()}
    def handler(request):
        calls.append(request)
        if request.url.host == 'replicate.delivery':
            assert 'Authorization' not in request.headers
            kind = request.url.path.split('/')[1]
            return httpx.Response(200, content=media_sources[kind].read_bytes())
        assert request.headers['Authorization'] == 'Bearer ' + settings.replicate_token
        if request.url.path.startswith('/v1/models/'):
            model = request.url.path.removeprefix('/v1/models/')
            data = metadata(model)
            if reference:
                data['latest_version']['openapi_schema']['components']['schemas']['Input']['properties']['image'] = {'type': 'string', 'format': 'uri'}
            return httpx.Response(200, json=data)
        if request.url.path == '/v1/files':
            assert request.method == 'POST' and b'content' in request.content
            return httpx.Response(201, json={'urls': {'get': 'https://api.replicate.com/v1/files/uploaded-fixture'}})
        if request.url.path == '/v1/predictions':
            inputs = json.loads(request.content)
            ident = 'prediction' + str(len(predictions))
            predictions[ident] = (by_version[inputs['version']], inputs['input'])
            return httpx.Response(201, json={'id': ident})
        ident = request.url.path.rsplit('/', 1)[1]
        kind, inputs = predictions[ident]
        suffix = media_sources[kind].suffix
        return httpx.Response(200, json={'status': 'succeeded', 'output': 'https://replicate.delivery/' + kind + '/fixture' + suffix})
    mock_client(monkeypatch, handler)
    return calls, predictions


def wait(client, ident):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        result = client.get('/api/video/jobs/' + ident).json()
        if result['state'] in {'completed', 'failed', 'cancelled'}:
            assert result['state'] == 'completed', result
            return result
        time.sleep(.05)
    pytest.fail('Timed out waiting for Replicate fixture job')


@pytest.mark.parametrize('kind', ['image', 'video', 'music', 'voice'])
def test_queued_generation_produces_reusable_asset_with_credit(settings, monkeypatch, media_sources, kind):
    settings.replicate_token = 'test-token'
    calls, predictions = provider_fixture(monkeypatch, settings, media_sources)
    app = create_app(settings)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        payload = {'selection': choice(kind).model_dump(), 'paid_generation_confirmed': True}
        response = client.post('/api/video/replicate/resources', json=payload)
        assert response.status_code == 202, response.text
        ident = response.json()['id']; job = wait(client, ident)
        assert job['kind'] == 'resource' and job['result']['resourceKind'] == kind
        asset = app.state.store.asset(job['result']['assetId'])
        assert asset['kind'] == ('audio' if kind in {'voice', 'music'} else kind)
        assert asset['credit']['model'] == IDS[kind]
        assert client.get('/api/video/assets/' + asset['id'] + '/file').content == media_sources[kind].read_bytes()
        # Repeated identical submissions reuse the completed job, not another paid prediction.
        assert client.post('/api/video/replicate/resources', json=payload).json()['id'] == ident
        assert len(predictions) == 1
        assert client.get('/api/video/jobs/' + ident + '/files/video.mp4').status_code == 404
        assert client.post('/api/video/jobs/' + ident + '/youtube', json={'access_token': 'x' * 30}).status_code == 400
        assert client.delete('/api/video/jobs/' + ident).status_code == 200
        assert app.state.store.asset(asset['id'])['credit']['predictionId']


def test_uploaded_references_and_completed_predictions_are_reused(settings, monkeypatch, media_sources):
    settings.replicate_token = 'test-token'; store = Store(settings.root)
    calls, predictions = provider_fixture(monkeypatch, settings, media_sources, reference=True)
    path = settings.root / 'assets' / ('a' * 32 + '.png'); shutil.copyfile(media_sources['image'], path)
    asset = store.add_asset(path, 'Owned reference', 'image')
    selected = choice('image'); selected.file_inputs = {'image': [asset['id']]}
    plan = studio.prepare(selected, settings, store)
    first, credit = studio.generate(plan, settings.root, 'test', settings, store, lambda: False)
    second, _ = studio.generate(plan, settings.root, 'test', settings, store, lambda: False)
    assert first == second and len(predictions) == 1
    assert list(predictions.values())[0][1]['image'].startswith('https://api.replicate.com/v1/files/')
    assert len([r for r in calls if r.url.path == '/v1/files']) == 1
    assert settings.replicate_token not in (settings.root / 'test.json').read_text()
    providers.atomic_json(settings.root / 'uncertain.json', {'submission': 'pending'})
    with pytest.raises(RuntimeError, match='no se repetirá el cobro'):
        studio.generate(plan, settings.root, 'uncertain', settings, store, lambda: False)
    assert len(predictions) == 1
    with pytest.raises(Cancelled):
        studio.generate(plan, settings.root, 'cancelled', settings, store, lambda: True)
    assert len(predictions) == 1


def test_openapi_nullable_enums_limits_and_allof_files_are_validated(settings, monkeypatch, media_sources):
    settings.replicate_token = 'test-token'; store = Store(settings.root)
    props = {'prompt': {'type': 'string'},
             'style': {'allOf': [{'type': 'string', 'enum': ['cinematic']}], 'nullable': True, 'default': None},
             'strength': {'type': 'number', 'minimum': 0, 'maximum': 1, 'exclusiveMinimum': True, 'default': .5},
             'images': {'allOf': [{'type': 'array', 'items': {'type': 'string', 'format': 'uri'}}]},
             'optional': {'type': 'string', 'enum': ['value'], 'nullable': True, 'default': None},
             'secret': {'allOf': [{'type': 'string', 'x-cog-secret': True, 'default': 'private'}]}}
    mock_client(monkeypatch, lambda request: httpx.Response(200, json=metadata(IDS['image'], props, ['prompt'])))
    path = settings.root / 'assets' / ('e' * 32 + '.png'); shutil.copyfile(media_sources['image'], path)
    asset = store.add_asset(path, 'Own image', 'image')
    selected = choice('image'); selected.file_inputs = {'images': [asset['id']]}
    plan = studio.prepare(selected, settings, store)
    assert isinstance(plan['inputs']['images'], list) and plan['inputs']['strength'] == .5
    assert plan['inputs']['optional'] is None and plan['inputs']['style'] is None and 'secret' not in plan['inputs']
    selected.inputs['strength'] = 0
    with pytest.raises(ValueError, match='exclusiveMinimum'):
        studio.prepare(selected, settings, store)
    selected.inputs.pop('strength'); selected.inputs['images'] = ['https://example.test:private-code/image.png']; selected.file_inputs = {}
    with pytest.raises(ValueError) as error:
        studio.prepare(selected, settings, store)
    assert 'private-code' not in str(error.value)


def test_uncertain_post_timeout_never_submits_a_second_prediction(settings, monkeypatch):
    settings.replicate_token = 'private-token'; calls = []
    def handler(request):
        calls.append(request.method)
        if request.method == 'GET':
            return httpx.Response(200, json=metadata(IDS['image']))
        raise httpx.ReadTimeout(settings.replicate_token + ' should not leak', request=request)
    mock_client(monkeypatch, handler)
    store = Store(settings.root); plan = studio.prepare(choice('image'), settings, store)
    with pytest.raises(RuntimeError) as error:
        studio.generate(plan, settings.root, 'uncertain', settings, store, lambda: False)
    assert settings.replicate_token not in str(error.value)
    with pytest.raises(RuntimeError, match='no se repetirá el cobro'):
        studio.generate(plan, settings.root, 'uncertain', settings, store, lambda: False)
    assert calls == ['GET', 'POST']


def test_missing_download_refreshes_same_prediction_without_extra_charge(settings, monkeypatch, media_sources):
    settings.replicate_token = 'test-token'; store = Store(settings.root)
    calls, predictions = provider_fixture(monkeypatch, settings, media_sources)
    plan = studio.prepare(choice('image'), settings, store)
    path, first_credit = studio.generate(plan, settings.root, 'refresh', settings, store, lambda: False)
    path.unlink()
    restored, second_credit = studio.generate(plan, settings.root, 'refresh', settings, store, lambda: False)
    assert restored.is_file() and second_credit == first_credit and len(predictions) == 1
    assert len([r for r in calls if r.url.path.startswith('/v1/predictions/')]) == 2


def test_wrong_output_kind_is_rejected_without_regenerating(settings, monkeypatch, media_sources):
    settings.replicate_token = 'test-token'; store = Store(settings.root)
    media_sources['image'] = media_sources['video']
    calls, predictions = provider_fixture(monkeypatch, settings, media_sources)
    plan = studio.prepare(choice('image'), settings, store)
    for _ in range(2):
        with pytest.raises(ValueError, match='tipo seleccionado'):
            studio.generate(plan, settings.root, 'wrong-type', settings, store, lambda: False)
    assert len(predictions) == 1


def test_cancellation_keeps_the_paid_prediction_id(settings, monkeypatch):
    settings.replicate_token = 'test-token'; calls = []; stop = False
    def handler(request):
        nonlocal stop
        calls.append(request)
        if request.url.path.startswith('/v1/models/'):
            return httpx.Response(200, json=metadata(IDS['image']))
        if request.url.path == '/v1/predictions':
            stop = True; return httpx.Response(201, json={'id': 'paidprediction'})
        return httpx.Response(200, json={'status': 'canceled'})
    mock_client(monkeypatch, handler)
    store = Store(settings.root); plan = studio.prepare(choice('image'), settings, store)
    with pytest.raises(Cancelled):
        studio.generate(plan, settings.root, 'cancel', settings, store, lambda: stop)
    stop = False
    with pytest.raises(RuntimeError, match='no se crea otra|No se crea otra'):
        studio.generate(plan, settings.root, 'cancel', settings, store, lambda: stop)
    assert len([r for r in calls if r.url.path == '/v1/predictions']) == 1
    assert any(r.url.path == '/v1/predictions/paidprediction/cancel' for r in calls)


def test_failed_and_cancelled_paid_jobs_are_reused_on_identical_submission(settings, monkeypatch):
    settings.replicate_token = 'test-token'
    mock_client(monkeypatch, lambda request: httpx.Response(200, json=metadata(IDS['image'])))
    app = create_app(settings, run_worker=False)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        payload = {'selection': choice('image').model_dump(), 'paid_generation_confirmed': True}
        ident = client.post('/api/video/replicate/resources', json=payload).json()['id']
        for state in ['failed', 'cancelled']:
            app.state.store.update(ident, state=state)
            same = client.post('/api/video/replicate/resources', json=payload).json()
            assert same['id'] == ident and same['state'] == state
            assert client.post('/api/video/jobs/' + ident + '/retry').json()['state'] == 'queued'


def test_render_provider_error_is_a_safe_502_before_queuing(settings, production, monkeypatch):
    settings.replicate_token = 'private-token'
    mock_client(monkeypatch, lambda request: httpx.Response(402, text='private-token and response'))
    with TestClient(create_app(settings, run_worker=False)) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        response = client.post('/api/video/jobs', json={'production': production, 'options': {
            'materials': 'replicate', 'paid_generation_confirmed': True, 'replicate_visual': choice('image').model_dump()}})
        assert response.status_code == 502 and settings.replicate_token not in response.text
        assert client.get('/api/video/jobs').json() == []


@pytest.mark.parametrize('visual_kind', ['image', 'video'])
def test_automatic_render_uses_correct_prompts_voice_blocks_and_one_music_track(settings, production, monkeypatch, media_sources, visual_kind):
    settings.replicate_token = 'test-token'
    calls, predictions = provider_fixture(monkeypatch, settings, media_sources)
    production['blocks'][0]['scenes'][0].update(imagePrompt='Specific IMAGE prompt', videoPrompt='Specific VIDEO prompt')
    payload = {'production': production, 'options': {'materials': 'replicate', 'tts': 'replicate', 'music_source': 'replicate',
               'paid_generation_confirmed': True, 'max_generated': 1, 'replicate_visual': choice(visual_kind).model_dump(),
               'replicate_voice': choice('voice').model_dump(), 'replicate_music': choice('music').model_dump()}}
    app = create_app(settings)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        response = client.post('/api/video/jobs', json=payload)
        assert response.status_code == 202, response.text
        ident = response.json()['id']; job = wait(client, ident)
        assert job['result']['captionTiming'] == 'estimated-from-replicate-voice'
        values = list(predictions.values())
        assert len(values) == 4  # Two voice blocks, one visual resource, one music track.
        assert [v[1]['text'] for v in values if v[0] == 'voice'] == [b['narration'] for b in production['blocks']]
        assert next(v[1]['prompt'] for v in values if v[0] == visual_kind) == 'Specific ' + visual_kind.upper() + ' prompt'
        folder = app.state.store.directory(ident)
        manifest = json.loads((folder / 'manifest.json').read_text())
        assert manifest['blockTiming'] == 'measured-per-block'
        assert {c.get('type') for c in manifest['credits']} == {visual_kind, 'voice', 'music'}
        with zipfile.ZipFile(folder / 'project.zip') as bundle:
            props = json.loads(bundle.read('remotion-input.json'))
            assert props['music']['src'] in bundle.namelist()
            assert settings.replicate_token not in bundle.read('manifest.json').decode()
        # A re-render with the same saved plan keeps voice/material/music predictions.
        saved = app.state.store.get(ident, private=True)['payload']
        engine = pipeline.Pipeline(settings, app.state.store)
        engine.render(ident, saved['request'], saved['replicate_plans'])
        assert len(predictions) == 4
