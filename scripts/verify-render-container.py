"""Exercise the private Render image with generated audio and no paid providers."""
import base64
import io
import json
import math
import struct
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import wave

BASE = 'http://127.0.0.1:18787'
HOST = 'ytb-personal.onrender.com'
TOKEN = 'ci-render-smoke-code-not-real-secret'


def request(path, data=None, method='GET', auth='api', expected=200, content_type='application/json'):
    headers = {'Host': HOST, 'Origin': 'https://' + HOST}
    if auth == 'api':
        headers['Authorization'] = 'Bearer ' + TOKEN
    elif auth == 'site':
        headers['Authorization'] = 'Basic ' + base64.b64encode(('alejandro:' + TOKEN).encode()).decode()
    if isinstance(data, dict):
        data = json.dumps(data).encode()
    if data is not None:
        headers['Content-Type'] = content_type
    try:
        response = urlopen(Request(BASE + path, data=data, headers=headers, method=method), timeout=15)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        assert response.status == expected, f'{method} {path}: HTTP {response.status}, expected {expected}: {body[:500]!r}'
        if response.headers.get('Content-Type', '').startswith('application/json'):
            return json.loads(body)
        return body


deadline = time.monotonic() + 60
while True:
    try:
        if request('/healthz', auth=None) == {'status': 'ok'}:
            break
    except (OSError, AssertionError):
        if time.monotonic() >= deadline:
            raise
        time.sleep(.25)

request('/', auth=None, expected=401)
request('/replicate-catalog.js', auth=None, expected=401)
assert b'id="video-factory"' in request('/', auth='site')
request('/api/video/health', auth='site', expected=401)
health = request('/api/video/health')
assert health['worker'] and health['ready'] and health['providers']['encoder'] == 'libx264'
assert not health['providers']['replicate'] and not health['providers']['pixabay']

audio = io.BytesIO()
with wave.open(audio, 'wb') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(24000)
    wav.writeframes(b''.join(struct.pack('<h', round(1600 * math.sin(2 * math.pi * 220 * i / 24000))) for i in range(6 * 24000)))
boundary = 'ytb-container-test-boundary'
multipart = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="own-audio.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode()
             + audio.getvalue() + f'\r\n--{boundary}--\r\n'.encode())
asset = request('/api/video/assets', multipart, 'POST', content_type='multipart/form-data; boundary=' + boundary)
production = {'format': 'yt-creator-production', 'version': 1, 'topic': 'Render personal',
              'packaging': {'title': 'Prueba de producción personal'}, 'blocks': [
                  {'index': 0, 'label': 'Demostración', 'narration': 'Este ejemplo comprueba el video con recursos propios en un servidor privado.',
                   'scenes': [{'visual': 'Producción personal en el servidor'}]}]}
job = request('/api/video/jobs', {'production': production, 'audio_id': asset['id'],
                                'options': {'materials': 'cards', 'tts': 'uploaded', 'resolution': 720}}, 'POST', expected=202)
deadline = time.monotonic() + 120
while job['state'] in {'queued', 'running'}:
    assert time.monotonic() < deadline, 'Container render timed out'
    time.sleep(.25)
    job = request('/api/video/jobs/' + job['id'])
assert job['state'] == 'completed', job.get('error')
mp4 = request('/api/video/jobs/' + job['id'] + '/files/video.mp4')
assert len(mp4) > 1000 and mp4[4:8] == b'ftyp'
metadata = json.loads(subprocess.check_output(['docker', 'exec', 'ytb-render-smoke', 'ffprobe', '-v', 'error',
                                             '-show_streams', '-show_format', '-of', 'json', '/data/jobs/' + job['id'] + '/video.mp4']))
assert any(s['codec_name'] == 'h264' and s['width'] == 1280 and s['height'] == 720 for s in metadata['streams'])
assert any(s['codec_type'] == 'audio' for s in metadata['streams'])
assert abs(float(metadata['format']['duration']) - 6) < .2
request('/api/video/jobs/' + job['id'], method='DELETE')
request('/api/video/assets/' + asset['id'], method='DELETE')
assert request('/api/video/jobs') == [] and request('/api/video/assets') == []
request('/api/video/jobs/' + job['id'] + '/files/video.mp4', expected=404)
print('Render image passed: private access, cloud port/origin, 720p H.264/AAC download and deletion with 1 CPU / 2 GB RAM; no paid generation.')
