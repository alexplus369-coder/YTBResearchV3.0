import json
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient
import httpx
from PIL import Image
import pytest

from backend import replicate_studio as studio, svg_media
from backend.api import create_app
from backend.models import ReplicateSelection, JobRequest
from backend.pipeline import Pipeline
from backend.store import Store
from backend.tests.test_replicate_studio import metadata, mock_client
from backend.tests.conftest import wav_bytes

SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="g"><stop stop-color="#111"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/></svg>'


@pytest.mark.parametrize('model', studio.CATALOG['requested_models'])
def test_requested_official_models_use_owner_model_endpoint_and_hidden_schema_id(model, settings, monkeypatch, tmp_path):
    settings.replicate_token = 'fixture-token'; calls = []
    entry = studio.model_entry(model)
    def handler(request):
        calls.append(request)
        if request.method == 'GET' and '/models/' in request.url.path:
            doc = metadata(model); doc['latest_version']['id'] = 'hidden'
            return httpx.Response(200, json=doc)
        if request.method == 'POST':
            assert request.url.path == '/v1/models/' + model + '/predictions'
            assert 'version' not in json.loads(request.content)
            return httpx.Response(201, json={'id': 'officialfixture'})
        return httpx.Response(200, json={'status': 'failed'})
    mock_client(monkeypatch, handler)
    store = Store(settings.root)
    selection = ReplicateSelection(model=model, kind=entry['kind'], inputs={'prompt': 'An original fixture'})
    plan = studio.prepare(selection, settings, store)
    assert len(plan['version']) == 64 and plan['api_mode'] == 'official'
    # A terminal fixture lets us verify submission routing without spending credits or downloading media.
    with pytest.raises(RuntimeError, match='falló'):
        studio.generate(plan, tmp_path, 'resource', settings, store, lambda: False)
    with pytest.raises(RuntimeError, match='falló'):
        studio.generate(plan, tmp_path, 'resource', settings, store, lambda: False)
    assert len([r for r in calls if r.method == 'POST']) == 1


def test_seedance_reference_bounds_allow_thirty_images_but_still_enforce_live_schema(settings, monkeypatch):
    settings.replicate_token = 'fixture-token'; model = 'bytedance/seedance-2.5'
    props = {'prompt': {'type': 'string'}, 'reference_images': {'type': 'array', 'maxItems': 30, 'items': {'type': 'string', 'format': 'uri'}}}
    mock_client(monkeypatch, lambda r: httpx.Response(200, json=metadata(model, props, ['prompt'])))
    store = Store(settings.root)
    path = settings.root / 'assets' / ('a' * 32 + '.png'); Image.new('RGB', (8, 8)).save(path)
    ident = store.add_asset(path, 'Reference', 'image')['id']
    selection = ReplicateSelection(model=model, kind='video', inputs={'prompt': 'Original fixture'}, file_inputs={'reference_images': [ident] * 30})
    assert len(studio.prepare(selection, settings, store)['inputs']['reference_images']) == 30
    with pytest.raises(ValueError):
        ReplicateSelection(model=model, kind='video', file_inputs={'reference_images': [ident] * 31})
    with pytest.raises(ValueError):
        ReplicateSelection(model=model, kind='video', file_inputs={str(i): [ident] * 30 for i in range(3)})
    # Other models can still impose their own, smaller maxItems in checked_inputs.
    props['reference_images']['maxItems'] = 10
    with pytest.raises(ValueError, match='Parámetro inválido'):
        studio.checked_inputs({'prompt': 'Original', 'reference_images': ['https://example.test/i.png'] * 30}, {'properties': props, 'required': ['prompt']})


def test_svg_generation_creates_reusable_png_and_authenticated_vector_download(settings, monkeypatch, production):
    settings.replicate_token = 'fixture-token'; model = 'recraft-ai/recraft-v4-styles-pro-svg'; posts = []
    def handler(request):
        if request.url.host == 'replicate.delivery':
            assert 'authorization' not in request.headers
            return httpx.Response(200, content=SVG.encode(), headers={'content-type': 'image/svg+xml'})
        if '/models/' in request.url.path and request.method == 'GET':
            return httpx.Response(200, json=metadata(model))
        if request.method == 'POST':
            posts.append(request)
            return httpx.Response(201, json={'id': 'svgfixture'})
        return httpx.Response(200, json={'status': 'succeeded', 'output': {'svg': 'https://replicate.delivery/fixture/output.svg'}})
    mock_client(monkeypatch, handler)
    store = Store(settings.root)
    selection = ReplicateSelection(model=model, kind='image', inputs={'prompt': 'An original vector illustration'})
    plan = studio.prepare(selection, settings, store)
    job = store.create({'kind': 'resource', 'request': {'selection': selection.model_dump()}, 'replicate_plans': {'resource': plan}})
    result = Pipeline(settings, store).resource(job['id'], plan)
    asset = store.asset(result['assetId'])
    assert result['vectorOriginal'] and Path(asset['path']).suffix == '.png'
    with Image.open(asset['path']) as image:
        assert image.size == (2048, 1152) and image.format == 'PNG'
    assert Path(asset['path']).with_suffix('.svg').read_text() == SVG
    assert Pipeline(settings, store).resource(job['id'], plan) == result
    assert len(posts) == 1
    assert result['credit']['modelVersion'] == 'provider-managed'
    # Render the converted vector as an ordinary scene and retain its original in the editable project.
    voice = settings.root / 'assets' / ('c' * 32 + '.wav'); voice.write_bytes(wav_bytes(seconds=2))
    store.add_asset(voice, 'Fixture voice', 'audio')
    request = JobRequest(production=production, options={'materials': 'own', 'tts': 'uploaded', 'subtitles': 'estimated'},
                         asset_ids=[asset['id']], audio_id='c' * 32)
    render_job = store.create({'kind': 'render', 'request': request.model_dump()})
    rendered = Pipeline(settings, store).render(render_job['id'], request.model_dump())
    store.update(render_job['id'], state='completed', result=rendered)
    with zipfile.ZipFile(store.directory(render_job['id']) / 'project.zip') as archive:
        vectors = [name for name in archive.namelist() if name.endswith('.svg')]
        assert len(vectors) == 1 and archive.read(vectors[0]).decode() == SVG
    assert len(posts) == 1
    with TestClient(create_app(settings, run_worker=False)) as client:
        url = '/api/video/assets/' + asset['id'] + '/original'
        assert client.get(url).status_code == 401
        client.headers['Authorization'] = 'Bearer ' + settings.token
        response = client.get(url)
        assert response.content.decode() == SVG
        assert response.headers['content-type'] == 'application/octet-stream'
        assert response.headers['x-content-type-options'] == 'nosniff'
        assert 'attachment' in response.headers['content-disposition']
        assert client.delete('/api/video/assets/' + asset['id']).status_code == 200
        assert not Path(asset['path']).with_suffix('.svg').exists()


@pytest.mark.parametrize('content', [
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///secret"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.test/external.svg"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.test/style.css";</style></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(//example.test/a)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 inf 900"/>',
])
def test_svg_external_or_active_content_never_reaches_renderer(content, tmp_path, monkeypatch):
    source = tmp_path / 'input.svg'; source.write_text(content)
    monkeypatch.setattr(svg_media.resvg_py, 'svg_to_bytes', lambda **kwargs: pytest.fail('Unsafe vector reached renderer'))
    with pytest.raises(ValueError, match='SVG no compatible'):
        svg_media.rasterize(source, tmp_path / 'output.png')


def test_public_catalog_assets_are_local_and_do_not_expose_tokens(settings):
    with TestClient(create_app(settings, run_worker=False)) as client:
        for name in ['replicate-catalog.js', 'replicate-value.js']:
            response = client.get('/' + name)
            assert response.status_code == 200 and settings.token not in response.text
        assert client.get('/backend/replicate_catalog.json').status_code == 404
