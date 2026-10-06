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
    assert providers.checked_url('https://cdn.pixabay.com/clip.mp4', ['pixabay.com'])
    for url in ['https://pixabay.com.evil.test/clip.mp4', 'http://pixabay.com/clip.mp4', 'https://user:pw@pixabay.com/clip.mp4', 'https://pixabay.com:1234/a']:
        with pytest.raises(ValueError):
            providers.checked_url(url, ['pixabay.com'])
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', 443))])
    with pytest.raises(ValueError, match='privadas'):
        providers.checked_url('https://cdn.pixabay.com/clip.mp4', ['pixabay.com'])


def test_pixabay_uses_official_endpoint_caches_search_and_reuses_download(settings, monkeypatch):
    settings.pixabay_key = 'server-only-pixabay-secret'
    calls, downloads = [], []
    def handler(request):
        calls.append(request)
        assert request.url.path == '/api/videos/'
        assert request.url.params['key'] == settings.pixabay_key
        assert 'Authorization' not in request.headers and 'orientation' not in request.url.params
        assert request.url.params['safesearch'] == 'true'
        return httpx.Response(200, json={'hits': [{'id': 42, 'pageURL': 'https://pixabay.com/videos/42/', 'user': 'Author',
            'videos': {'small': {'width': 1280, 'height': 720, 'size': 100, 'url': 'https://cdn.pixabay.com/42.mp4'},
                       'large': {'width': 3840, 'height': 2160, 'url': 'https://cdn.pixabay.com/4k.mp4'}}}]})
    mocked_client(monkeypatch, providers, handler)
    monkeypatch.setattr(providers, 'checked_url', lambda url, domains: url)
    def download(url, destination, *args):
        downloads.append(url); destination.write_bytes(b'mocked-video')
    monkeypatch.setattr(providers, 'download', download)
    path, credit = providers.pixabay('workspace', settings.root, 0, settings, 'landscape', lambda: False)
    other, _ = providers.pixabay('workspace', settings.root, 1, settings, 'landscape', lambda: False)
    assert path.exists() and credit['creator'] == 'Author' and credit['id'] == '42'
    assert path == other and len(calls) == 1 and downloads == ['https://cdn.pixabay.com/42.mp4']
    assert credit['provider'] == 'Pixabay' and credit['type'] == 'video'
    assert settings.pixabay_key not in str(credit)
    record = next((settings.root / 'provider-cache' / 'pixabay').glob('*.json'))
    assert settings.pixabay_key not in record.read_text()
    value = json.loads(record.read_text()); value['savedAt'] -= providers.PIXABAY_CACHE_SECONDS + 1
    providers.atomic_json(record, value)
    providers.pixabay('workspace', settings.root, 2, settings, 'landscape', lambda: False)
    assert len(calls) == 2 and len(downloads) == 1


@pytest.mark.parametrize('images_only', [False, True])
def test_pixabay_image_fallback_and_explicit_images(settings, monkeypatch, images_only):
    settings.pixabay_key = 'test-key'
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if request.url.path == '/api/videos/':
            return httpx.Response(200, json={'hits': []})
        assert request.url.params['orientation'] == 'vertical'
        assert request.url.params['image_type'] == 'photo'
        return httpx.Response(200, json={'hits': [{'id': 5, 'user': 'Photographer', 'pageURL': 'https://pixabay.com/photos/5/',
                                                 'largeImageURL': 'https://cdn.pixabay.com/photo.jpg'}]})
    mocked_client(monkeypatch, providers, handler)
    monkeypatch.setattr(providers, 'checked_url', lambda url, domains: url)
    monkeypatch.setattr(providers, 'download', lambda url, destination, *args: destination.write_bytes(b'image'))
    path, credit = providers.pixabay('office', settings.root, 0, settings, 'portrait', lambda: False, images_only=images_only)
    assert path.suffix == '.jpg' and credit['type'] == 'image'
    assert calls == (['/api/'] if images_only else ['/api/videos/', '/api/'])


@pytest.mark.parametrize('status', [400, 401, 429, 500])
def test_pixabay_errors_are_not_cached_or_hidden_by_fallback(settings, monkeypatch, status):
    settings.pixabay_key = 'never-expose-this-secret'
    calls = []
    def handler(request):
        calls.append(request.url.path)
        return httpx.Response(status, text=settings.pixabay_key)
    mocked_client(monkeypatch, providers, handler)
    with pytest.raises(RuntimeError, match='HTTP ' + str(status)) as error:
        providers.pixabay('office', settings.root, 0, settings, 'landscape', lambda: False)
    assert settings.pixabay_key not in str(error.value)
    assert calls == ['/api/videos/']
    assert not list((settings.root / 'provider-cache' / 'pixabay').glob('*.json'))


def test_pixabay_cancelled_search_and_old_jobs(settings):
    from backend.models import Options
    from backend.process import Cancelled
    assert Options(materials='pexels').materials == 'pixabay'
    assert Options(materials='pixabay_images').materials == 'pixabay_images'
    assert 'pixabay' in settings.public() and 'pexels' not in settings.public()
    with pytest.raises(Cancelled):
        providers.pixabay('office', settings.root, 0, settings, 'landscape', lambda: True)


def test_pixabay_network_errors_hide_query_credentials(settings, monkeypatch):
    settings.pixabay_key = 'secret-in-url'
    def handler(request):
        raise httpx.ConnectError(str(request.url), request=request)
    mocked_client(monkeypatch, providers, handler)
    with pytest.raises(RuntimeError, match='conectar') as error:
        providers.pixabay('office', settings.root, 0, settings, 'landscape', lambda: False)
    assert settings.pixabay_key not in str(error.value)


def test_pixabay_cache_is_separated_by_credentials_and_query_is_bounded(settings, monkeypatch):
    settings.pixabay_key = 'first-key'
    calls = []
    def handler(request):
        calls.append(request)
        assert len(request.url.params['q']) == 100
        return httpx.Response(200, json={'hits': []})
    mocked_client(monkeypatch, providers, handler)
    providers.pixabay_search('x' * 120, settings, 'landscape', False, lambda: False)
    providers.pixabay_search('x' * 120, settings, 'landscape', False, lambda: False)
    settings.pixabay_key = 'second-key'
    providers.pixabay_search('x' * 120, settings, 'landscape', False, lambda: False)
    assert len(calls) == 2


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
