import base64

from fastapi.testclient import TestClient
import pytest

from backend.api import create_app
from backend.config import Settings
from backend.store import Store


def test_render_port_origin_and_host_work_with_private_same_origin_api(monkeypatch, tmp_path):
    monkeypatch.setenv('PORT', '10000')
    monkeypatch.setenv('YT_RENDER_PORT', '9000')
    monkeypatch.delenv('YT_RENDER_HOST', raising=False)
    monkeypatch.setenv('RENDER_EXTERNAL_URL', 'https://ytb-personal.onrender.com')
    monkeypatch.setenv('YT_RENDER_ORIGINS', 'https://creator.example.com')
    settings = Settings(root=tmp_path, token='personal-access-' + 'a' * 32)
    assert settings.host == '0.0.0.0' and settings.port == 10000
    with TestClient(create_app(settings, run_worker=False), base_url='https://ytb-personal.onrender.com') as client:
        assert client.get('/').status_code == 200
        assert client.get('/healthz').json() == {'status': 'ok'}
        assert client.get('/api/video/jobs').status_code == 401
        headers = {'Authorization': 'Bearer ' + settings.token, 'Origin': 'https://ytb-personal.onrender.com'}
        response = client.get('/api/video/jobs', headers=headers)
        assert response.status_code == 200 and response.json() == []
        assert response.headers['access-control-allow-origin'] == 'https://ytb-personal.onrender.com'
        assert client.get('/', headers={'Host': 'unrelated.example.com'}).status_code == 400
        assert client.options('/api/video/jobs', headers={'Origin': 'https://creator.example.com', 'Access-Control-Request-Method': 'POST'}).status_code == 200
        assert client.options('/api/video/jobs', headers={'Origin': 'https://attacker.example.com', 'Access-Control-Request-Method': 'POST'}).status_code == 400


def test_private_site_password_gate_protects_html_catalog_and_docs_without_unlocking_api(settings):
    settings.private_site = True
    credential = base64.b64encode((settings.site_user + ':' + settings.token).encode()).decode()
    headers = {'Authorization': 'Basic ' + credential}
    with TestClient(create_app(settings, run_worker=False)) as client:
        for path in ['/', '/replicate-catalog.js', '/docs/render-personal.md']:
            response = client.get(path)
            assert response.status_code == 401 and 'Basic realm=' in response.headers['www-authenticate']
            assert settings.token not in response.text
            assert client.get(path, headers=headers).status_code == 200
        assert client.get('/healthz').json() == {'status': 'ok'}
        assert client.get('/', headers={'Authorization': 'Basic !bad!'}).status_code == 401
        assert client.get('/api/video/jobs', headers=headers).status_code == 401
        assert client.get('/api/video/jobs', headers={**headers, 'X-YT-Render-Token': settings.token}).status_code == 200
        assert client.get('/api/video/jobs', headers={'Authorization': 'Bearer ' + settings.token}).status_code == 200
        assert client.get('/api/video/jobs', headers={'Authorization': 'Bearer ' + settings.token, 'X-YT-Render-Token': 'wrong-code'}).status_code == 401
        assert client.post('/api/video/jobs', headers=headers, content=b'not-json').status_code == 401


def test_public_probe_fails_when_ffmpeg_is_missing_and_exposes_no_provider_secrets(settings):
    settings.ffmpeg = 'missing-ffmpeg-for-probe'
    settings.pixabay_key = 'private-pixabay-test-key'
    with TestClient(create_app(settings, run_worker=False)) as client:
        response = client.get('/healthz')
        assert response.status_code == 503 and response.json() == {'status': 'unavailable'}
        assert settings.pixabay_key not in response.text and settings.token not in response.text


@pytest.mark.parametrize('external', ['http://ytb.onrender.com', 'https://user:password@ytb.onrender.com', 'https://ytb.onrender.com/path', 'https://ytb.onrender.com?token=private'])
def test_invalid_cloud_origins_do_not_widen_host_or_cors_access(monkeypatch, tmp_path, external):
    monkeypatch.setenv('RENDER_EXTERNAL_URL', external)
    with pytest.raises(ValueError, match='RENDER_EXTERNAL_URL'):
        Settings(root=tmp_path)


def test_local_port_defaults_remain_compatible_and_invalid_port_fails(monkeypatch, tmp_path):
    for variable in ['PORT', 'YT_RENDER_PORT', 'YT_RENDER_HOST', 'RENDER_EXTERNAL_URL']:
        monkeypatch.delenv(variable, raising=False)
    settings = Settings(root=tmp_path)
    assert settings.host == '127.0.0.1' and settings.port == 8787
    monkeypatch.setenv('PORT', '65536')
    with pytest.raises(ValueError, match='puerto'):
        Settings(root=tmp_path)


def test_older_active_job_stays_visible_after_fifty_newer_terminal_jobs(settings, request_payload):
    store = Store(settings.root)
    active = store.create({'kind': 'render', 'request': request_payload}, 'active')
    for index in range(51):
        job = store.create({'kind': 'render', 'request': request_payload}, str(index))
        store.update(job['id'], state='completed')
    visible = store.list()
    assert len(visible) == 51
    assert any(job['id'] == active['id'] and job['state'] == 'queued' for job in visible)
