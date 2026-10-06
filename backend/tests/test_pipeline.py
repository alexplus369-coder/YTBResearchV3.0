import json
from pathlib import Path
import shutil
import time
import uuid
import zipfile
import socket
import httpx

from fastapi.testclient import TestClient
import pytest

from backend.api import create_app
from backend import captions, pipeline, providers
from backend.models import JobRequest
from backend.pipeline import Pipeline
from backend.process import probe
from backend.store import Store
from backend.tests.conftest import wav_bytes

pytestmark = pytest.mark.skipif(not shutil.which('ffmpeg') or not shutil.which('ffprobe'), reason='Install FFmpeg and FFprobe to run real media tests')


@pytest.mark.parametrize('images', [False, True])
def test_pixabay_real_render_and_credit_bundle(settings, request_payload, monkeypatch, images):
    settings.pixabay_key = 'mock-api-key-not-a-real-credential'
    source = settings.root / ('source.jpg' if images else 'source.mp4')
    if images:
        pipeline.card(source, 'Ejemplo original', 'Recurso de prueba local', 1280, 720)
    else:
        pipeline.run(['ffmpeg', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x720:r=24',
                      '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(source)], settings.root, lambda: False)
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if request.url.host == 'cdn.pixabay.com':
            assert 'key' not in request.url.params and 'Authorization' not in request.headers
            return httpx.Response(200, content=source.read_bytes())
        hit = {'id': 42, 'user': 'Fixture author', 'pageURL': 'https://pixabay.com/resource/42/'}
        if images:
            hit['largeImageURL'] = 'https://cdn.pixabay.com/fixture.jpg'
        else:
            hit['videos'] = {'small': {'url': 'https://cdn.pixabay.com/fixture.mp4', 'width': 1280, 'height': 720, 'size': source.stat().st_size}}
        return httpx.Response(200, json={'hits': [hit]})
    real_client = httpx.Client
    monkeypatch.setattr(providers.httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))])
    app = create_app(settings)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        asset = client.post('/api/video/assets', files={'file': ('narracion.wav', wav_bytes(3))}).json()
        request_payload['audio_id'] = asset['id']
        request_payload['options'].update(materials='pixabay_images' if images else 'pixabay', max_generated=1)
        created = client.post('/api/video/jobs', json=request_payload)
        assert created.status_code == 202, created.text
        ident = created.json()['id']; wait_job(client, ident)
        folder = app.state.store.directory(ident)
        assert abs(float(probe(folder / 'video.mp4', settings)['format']['duration']) - 3) < .15
        materials = json.loads((folder / 'materials.json').read_text())
        assert all(item['kind'] == ('image' if images else 'video') for item in materials.values())
        assert len({item['path'] for item in materials.values()}) == 1
        with zipfile.ZipFile(folder / 'project.zip') as bundle:
            manifest = json.loads(bundle.read('manifest.json'))
            assert 'Fixture author' in str(manifest) and 'Pixabay' in str(manifest)
            assert settings.pixabay_key not in str(manifest)
        assert len(calls) == 2  # One search and one download despite three scenes.


def wait_job(client, ident):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        job = client.get('/api/video/jobs/' + ident).json()
        if job['state'] in {'completed', 'failed', 'cancelled'}:
            assert job['state'] == 'completed', job
            return job
        time.sleep(.12)
    raise AssertionError('The media job did not finish within 45 seconds')


def test_real_queue_render_caption_bundle_and_portrait_clip(settings, request_payload):
    app = create_app(settings)
    with TestClient(app) as client:
        client.headers['Authorization'] = 'Bearer ' + settings.token
        asset = client.post('/api/video/assets', files={'file': ('narracion.wav', wav_bytes(6))}).json()
        request_payload['audio_id'] = asset['id']
        created = client.post('/api/video/jobs', json=request_payload)
        assert created.status_code == 202
        ident = created.json()['id']; job = wait_job(client, ident)
        folder = app.state.store.directory(ident)
        metadata = probe(folder / 'video.mp4', settings)
        video = next(s for s in metadata['streams'] if s['codec_type'] == 'video')
        assert (video['width'], video['height'], video['codec_name']) == (1280, 720, 'h264')
        assert any(s['codec_type'] == 'audio' for s in metadata['streams'])
        assert abs(float(metadata['format']['duration']) - 6) < .15
        assert job['result']['captionTiming'] == 'estimated-from-script'
        assert not job['result']['midRollDurationThresholdMet']
        words = client.get(f'/api/video/jobs/{ident}/files/words.json').json()
        assert words[0]['start'] == 0 and words[-1]['end'] == pytest.approx(6)
        assert '-->' in (folder / 'subtitles.srt').read_text()
        with zipfile.ZipFile(folder / 'project.zip') as bundle:
            assert {'narration.wav', 'remotion-input.json', 'manifest.json'} <= set(bundle.namelist())
            props = json.loads(bundle.read('remotion-input.json'))
            assert sum(s['durationInFrames'] for s in props['scenes']) == 144
            assert all(s['src'] in bundle.namelist() for s in props['scenes'])
            assert settings.token.encode() not in b''.join(bundle.read(n) for n in bundle.namelist() if n.endswith('.json'))
        assert client.get(f'/api/video/jobs/{ident}/files/voice.json').status_code == 404
        assert client.get(f'/api/video/jobs/{ident}/files/video.mp4').content[4:8] == b'ftyp'
        clipping = client.post(f'/api/video/jobs/{ident}/clips', json={'start': 1, 'end': 4, 'aspect': 'portrait'})
        assert clipping.status_code == 202
        assert client.delete('/api/video/jobs/' + ident).status_code == 400
        cut = wait_job(client, clipping.json()['id'])
        cut_folder = app.state.store.directory(cut['id'])
        cut_meta = probe(cut_folder / 'video.mp4', settings)
        cut_video = next(s for s in cut_meta['streams'] if s['codec_type'] == 'video')
        assert (cut_video['width'], cut_video['height']) == (720, 1280)
        assert abs(float(cut_meta['format']['duration']) - 3) < .15
        rebased = json.loads((cut_folder / 'words.json').read_text())
        assert all(0 <= w['start'] < w['end'] <= 3 for w in rebased)
        clip_manifest = json.loads((cut_folder / 'manifest.json').read_text())
        assert all(0 <= b['start'] < b['end'] <= 3 for b in clip_manifest['blocks'])
        assert clip_manifest['blockTiming'] == 'estimated-from-script'
        assert client.post(f'/api/video/jobs/{ident}/clips', json={'start': 0, 'end': 8}).status_code == 400
        assert client.post(f'/api/video/jobs/{cut["id"]}/clips', json={'start': 0, 'end': 2}).status_code == 400


def test_retry_keeps_generated_voice_and_materials(settings, production, monkeypatch):
    store = Store(settings.root)
    request = JobRequest.model_validate({'production': production, 'options': {'materials': 'replicate', 'tts': 'edge', 'max_generated': 1, 'paid_generation_confirmed': True}})
    created = store.create({'kind': 'render', 'request': request.model_dump()}); ident = created['id']
    engine = Pipeline(settings, store); calls = {'voice': 0, 'visual': 0}
    def voice(text, selected_voice, destination, cancelled):
        calls['voice'] += 1; destination.write_bytes(wav_bytes(1.8)); return captions.estimate(text, 1.8)
    def visual(prompt, folder, index, selected_settings, cancelled):
        calls['visual'] += 1; path = folder / f'material-{index}.png'
        pipeline.card(path, 'Proyecto original', prompt, 1280, 720)
        return path, {'provider': 'Replicate', 'predictionId': 'testprediction'}
    real_run = pipeline.run
    def fail_once(args, *values, **kw):
        if args[-1] == 'video.part.mp4':
            raise RuntimeError('Simulated encoding interruption')
        return real_run(args, *values, **kw)
    monkeypatch.setattr(providers, 'synthesize', voice); monkeypatch.setattr(providers, 'replicate', visual)
    monkeypatch.setattr(pipeline, 'run', fail_once)
    with pytest.raises(RuntimeError, match='Simulated'):
        engine.render(ident, request.model_dump())
    assert calls == {'voice': 2, 'visual': 1}
    monkeypatch.setattr(pipeline, 'run', real_run)
    result = engine.render(ident, request.model_dump())
    assert result['durationSeconds'] == pytest.approx(3.6, abs=.15)
    assert calls == {'voice': 2, 'visual': 1}


def test_own_scene_bindings_and_block_selection(settings, request_payload):
    store = Store(settings.root)
    audio = settings.root / 'assets' / (uuid.uuid4().hex + '.wav'); audio.write_bytes(wav_bytes(2))
    audio_id = store.add_asset(audio, 'voz.wav', 'audio')['id']
    picture = settings.root / 'assets' / (uuid.uuid4().hex + '.png'); pipeline.card(picture, 'Propio', 'Demostración original', 800, 800)
    picture_id = store.add_asset(picture, 'escena.png', 'image')['id']
    request_payload.update(audio_id=audio_id, block_indexes=[1], scene_assets={'1': picture_id, '2': picture_id})
    request_payload['options'].update(materials='own', aspect='square')
    request = JobRequest.model_validate(request_payload)
    ident = store.create({'kind': 'render', 'request': request.model_dump()})['id']
    result = Pipeline(settings, store).render(ident, request.model_dump())
    assert (result['width'], result['height']) == (720, 720)
    manifest = json.loads((store.directory(ident) / 'manifest.json').read_text())
    assert [b['index'] for b in manifest['blocks']] == [1]
    assert all(c['assetId'] == picture_id for c in manifest['credits'])
