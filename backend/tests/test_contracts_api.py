import io
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
import pytest

from backend.api import create_app
from backend.models import ClipRequest, JobRequest
from backend.store import Store
from backend.worker import Worker
from backend.tests.conftest import wav_bytes


def test_contracts_limit_costs_paths_and_incoherent_inputs(request_payload):
    for change in [{'options': {'materials': 'replicate'}}, {'options': {'voice': '../secret'}}, {'options': {'command': 'rm -rf /'}},
                   {'scene_assets': {'999': 'a' * 32}}, {'block_indexes': [1, 1]}, {'audio_id': '../secret'},
                   {'options': {'tts': 'uploaded', 'materials': 'cards'}, 'audio_id': None}]:
        with pytest.raises(ValidationError):
            JobRequest.model_validate({**request_payload, **change})
    paid = JobRequest.model_validate({**request_payload, 'options': {'materials': 'replicate', 'paid_generation_confirmed': True, 'max_generated': 2}})
    assert paid.options.max_generated == 2
    with pytest.raises(ValidationError):
        ClipRequest(start=8, end=9.5, resolution=500)
    with pytest.raises(ValidationError):
        ClipRequest(start=8, end=7)


def test_queue_is_idempotent_under_concurrency_and_restart(settings, request_payload):
    store = Store(settings.root)
    payload = {'kind': 'render', 'request': request_payload}
    with ThreadPoolExecutor(6) as pool:
        jobs = list(pool.map(lambda _: store.create(payload, 'engine-v1'), range(12)))
    assert len({j['id'] for j in jobs}) == 1
    first = store.claim()
    assert first['attempts'] == 1 and store.claim() is None
    store.recover(); assert store.get(first['id'])['state'] == 'queued'
    assert store.claim()['attempts'] == 2
    store.cancel(first['id']); store.recover()
    assert store.get(first['id'])['state'] == 'cancelled'
    store.retry(first['id']); assert store.get(first['id'])['state'] == 'queued'
    assert 'payload' not in store.get(first['id'])
    assert 'fingerprint' not in store.get(first['id'])


def test_one_worker_per_directory(settings):
    one, two = Worker(settings, Store(settings.root)), Worker(settings, Store(settings.root))
    one.start()
    try:
        with pytest.raises(RuntimeError, match='Ya hay un worker'):
            two.start()
    finally:
        one.stop()
    three = Worker(settings, Store(settings.root)); three.start(); three.stop()


def test_api_auth_precedes_parsing_and_static_cannot_leak_data(settings, request_payload):
    with TestClient(create_app(settings, run_worker=False)) as client:
        headers = {'Authorization': 'Bearer ' + settings.token}
        assert client.post('/api/video/jobs', content=b'not-json').status_code == 401
        assert client.post('/api/video/assets', content=b'bad multipart').status_code == 401
        assert client.get('/queue.sqlite3').status_code == 404
        assert client.get('/backend/config.py').status_code == 404
        assert client.get('/docs/video-production.md').status_code == 200
        assert 'Fábrica de videos' in client.get('/docs/video-production.md').text
        assert client.get('/docs/config.py').status_code == 404
        health = client.get('/api/video/health', headers=headers).json()
        assert settings.token not in str(health) and health['worker'] is False
        assert client.get('/', headers={'Host': 'evil.example'}).status_code == 400
        assert client.post('/api/video/jobs', headers={**headers, 'Content-Length': str(3 * 1024 * 1024)}, content='{}').status_code == 413
        malformed = client.post('/api/video/jobs', headers=headers, json={'access_token': 'DO-NOT-ECHO'})
        assert malformed.status_code == 422 and 'DO-NOT-ECHO' not in malformed.text
        request_payload['options']['materials'] = 'pexels'
        assert client.post('/api/video/jobs', headers=headers, json=request_payload).status_code == 400
        assert client.get('/api/video/jobs', headers=headers).json() == []


def test_assets_validate_media_types_limits_and_active_references(settings, request_payload):
    settings.max_upload = 200000
    with TestClient(create_app(settings, run_worker=False)) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        assert client.post('/api/video/assets', files={'file': ('bad.png', b'garbage')}).status_code == 400
        assert not list((settings.root / 'assets').iterdir())
        assert client.post('/api/video/assets', files={'file': ('too-big.wav', wav_bytes(6))}).status_code == 400
        audio = client.post('/api/video/assets', files={'file': ('narracion.wav', wav_bytes(2))}).json()
        request_payload['audio_id'] = audio['id']
        request_payload['options']['materials'] = 'own'
        request_payload['asset_ids'] = [audio['id']]
        assert client.post('/api/video/jobs', json=request_payload).status_code == 400
        image = io.BytesIO(); Image.new('RGB', (80, 80), 'blue').save(image, 'PNG')
        picture = client.post('/api/video/assets', files={'file': ('<img>.png', image.getvalue())}).json()
        assert picture['kind'] == 'image' and 'path' not in picture
        request_payload['asset_ids'] = [picture['id']]
        queued = client.post('/api/video/jobs', json=request_payload)
        assert queued.status_code == 202
        assert client.post('/api/video/jobs', json=request_payload).json()['id'] == queued.json()['id']
        assert client.delete('/api/video/assets/' + picture['id']).status_code == 400
        client.post('/api/video/jobs/' + queued.json()['id'] + '/cancel')
        assert client.delete('/api/video/assets/' + picture['id']).status_code == 200
        settings.max_storage = 1
        assert client.post('/api/video/assets', files={'file': ('new.png', image.getvalue())}).status_code == 400
