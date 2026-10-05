import json
import socket

import httpx
import pytest

from backend import captions, providers, uploader


def mocked_client(monkeypatch, module, handler):
    real_client = httpx.Client
    monkeypatch.setattr(module.httpx, 'Client', lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))


def test_download_never_forwards_credentials_or_reaches_private_networks(settings, monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))])
    assert providers.checked_url('https://videos.pexels.com/clip.mp4', ['pexels.com'])
    for url in ['https://pexels.com.evil.test/clip.mp4', 'http://pexels.com/clip.mp4', 'https://user:pw@pexels.com/clip.mp4', 'https://pexels.com:1234/a']:
        with pytest.raises(ValueError):
            providers.checked_url(url, ['pexels.com'])
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError, match='privadas'):
        providers.checked_url('https://videos.pexels.com/clip.mp4', ['pexels.com'])


def test_pexels_uses_official_endpoint_and_preserves_credit(settings, monkeypatch):
    settings.pexels_key = 'server-only-pexels-secret'
    def handler(request):
        assert request.url.path == '/v1/videos/search'
        assert request.headers['Authorization'] == settings.pexels_key
        return httpx.Response(200, json={'videos': [{'id': 42, 'url': 'https://www.pexels.com/video/42', 'user': {'name': 'Author'},
            'video_files': [{'file_type': 'video/mp4', 'width': 1280, 'height': 720, 'link': 'https://videos.pexels.com/42.mp4'}]}]})
    mocked_client(monkeypatch, providers, handler)
    monkeypatch.setattr(providers, 'download', lambda url, destination, *args: destination.write_bytes(b'mocked-video'))
    path, credit = providers.pexels('workspace', settings.root, 0, settings, 'landscape', lambda: False)
    assert path.exists() and credit['creator'] == 'Author' and credit['id'] == '42'
    assert settings.pexels_key not in str(credit)


def test_replicate_reuses_prediction_and_refuses_ambiguous_billing(settings, monkeypatch):
    settings.replicate_token = 'private-replicate-token'; settings.replicate_version = 'a' * 64
    calls = []
    def handler(request):
        calls.append(request.method)
        if request.method == 'POST':
            return httpx.Response(201, json={'id': 'existingprediction'})
        return httpx.Response(200, json={'status': 'succeeded', 'output': ['https://replicate.delivery/image.png']})
    mocked_client(monkeypatch, providers, handler)
    monkeypatch.setattr(providers, 'download', lambda url, destination, *args: destination.write_bytes(b'mocked-image'))
    providers.replicate('Original image', settings.root, 0, settings, lambda: False)
    providers.replicate('Original image', settings.root, 0, settings, lambda: False)
    assert calls == ['POST', 'GET', 'GET']
    assert settings.replicate_token not in (settings.root / 'prediction-0.json').read_text()
    providers.atomic_json(settings.root / 'prediction-1.json', {'submission': 'pending'})
    with pytest.raises(RuntimeError, match='no se repetirá el cobro'):
        providers.replicate('Original image', settings.root, 1, settings, lambda: False)
    assert calls == ['POST', 'GET', 'GET']


def test_captions_escape_overrides_and_whisper_merges_subwords(settings, monkeypatch):
    captions.export([captions.Word('<b>Texto</b>{\\pos(0,0)}', 0, 1)], settings.root, 720, 1280)
    srt = (settings.root / 'subtitles.srt').read_text()
    assert '<b>' not in srt and '\\pos' not in srt
    settings.whisper_cli = 'test-whisper'; settings.whisper_model = str(settings.root / 'model.bin')
    (settings.root / 'model.bin').write_bytes(b'test')
    def run(args, *a, **kw):
        if args[0] == 'test-whisper':
            providers.atomic_json(settings.root / 'aligned.json', {'transcription': [{'tokens': [
                {'text': ' auto', 'offsets': {'from': 100, 'to': 200}}, {'text': 'matización', 'offsets': {'from': 200, 'to': 800}},
                {'text': ' clara', 'offsets': {'from': 900, 'to': 1200}}, {'text': '.', 'offsets': {'from': 1200, 'to': 1250}}]}]})
    monkeypatch.setattr(captions, 'run', run)
    words = captions.whisper(settings.root / 'audio.wav', settings.root, settings, lambda: False)
    assert [w.text for w in words] == ['automatización', 'clara.']
    assert words[0].start == .1 and words[0].end == .8


def test_private_youtube_upload_recovers_position_without_duplicate(settings, monkeypatch):
    folder = settings.root; (folder / 'video.mp4').write_bytes(b'video')
    providers.atomic_json(folder / 'publication.json', {'title': 'Original', 'description': 'Demostración'})
    session = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=example'
    calls = []
    def handler(request):
        calls.append(request)
        assert request.headers['Authorization'] == 'Bearer ephemeral-oauth-token'
        if request.method == 'POST':
            payload = json.loads(request.content)
            assert payload['status'] == {'privacyStatus': 'private', 'selfDeclaredMadeForKids': False, 'containsSyntheticMedia': True}
            return httpx.Response(200, headers={'Location': session})
        if request.headers['Content-Range'].startswith('bytes */'):
            return httpx.Response(308, headers={'Range': 'bytes=0-1'})
        assert request.content == b'deo' and request.headers['Content-Range'] == 'bytes 2-4/5'
        return httpx.Response(200, json={'id': 'abcdefghijk'})
    mocked_client(monkeypatch, uploader, handler)
    result = uploader.upload(folder, 'ephemeral-oauth-token', synthetic=True)
    assert result['videoId'] == 'abcdefghijk'
    assert uploader.upload(folder, 'ephemeral-oauth-token')['reused'] is True and len(calls) == 3
    assert 'ephemeral' not in (folder / 'upload-session.json').read_text()
    assert 'upload_id' not in (folder / 'upload-session.json').read_text()


def test_youtube_expired_session_is_preserved_and_not_restarted(settings, monkeypatch):
    (settings.root / 'video.mp4').write_bytes(b'video')
    providers.atomic_json(settings.root / 'upload-session.json', {'url': 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=expired'})
    calls = []
    def handler(request):
        calls.append(request.method); return httpx.Response(404)
    mocked_client(monkeypatch, uploader, handler)
    with pytest.raises(ValueError, match='evitar duplicados'):
        uploader.upload(settings.root, 'ephemeral-oauth-token')
    assert calls == ['PUT']
    with pytest.raises(ValueError):
        uploader.session_url('https://www.googleapis.com:8443/upload/youtube/v3/videos')
