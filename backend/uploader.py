"""Manual, private-only, resumable YouTube uploads. OAuth tokens are never persisted."""
import json
from pathlib import Path
import re
import time
from urllib.parse import urlparse

import httpx

from .providers import atomic_json

CHUNK = 8 * 1024 * 1024


def session_url(value):
    url = urlparse(value)
    if url.scheme != 'https' or url.hostname not in {'www.googleapis.com', 'youtube.googleapis.com'} or url.port not in {None, 443} or url.path != '/upload/youtube/v3/videos' or url.username or url.password:
        raise ValueError('YouTube devolvió una URL de subida no autorizada.')
    return value


def upload(folder: Path, token, made_for_kids=False, synthetic=False):
    path, record = folder / 'video.mp4', folder / 'upload-session.json'
    size = path.stat().st_size
    previous = json.loads(record.read_text()) if record.exists() else {}
    if previous.get('videoId'):
        return {'videoId': previous['videoId'], 'url': 'https://www.youtube.com/watch?v=' + previous['videoId'], 'privacyStatus': 'private', 'reused': True}
    headers = {'Authorization': 'Bearer ' + token}
    with httpx.Client(timeout=60, follow_redirects=False, trust_env=False) as client:
        if previous.get('url'):
            url = session_url(previous['url'])
        else:
            metadata = json.loads((folder / 'publication.json').read_text())
            payload = {'snippet': {'title': metadata['title'][:100], 'description': metadata['description'][:5000], 'categoryId': '27'},
                       'status': {'privacyStatus': 'private', 'selfDeclaredMadeForKids': made_for_kids, 'containsSyntheticMedia': synthetic}}
            response = client.post('https://www.googleapis.com/upload/youtube/v3/videos', params={'uploadType': 'resumable', 'part': 'snippet,status'},
                                   headers={**headers, 'X-Upload-Content-Length': str(size), 'X-Upload-Content-Type': 'video/mp4'}, json=payload)
            if response.status_code not in (200, 201):
                raise ValueError('No se pudo iniciar la subida a YouTube (HTTP ' + str(response.status_code) + '). Revisa OAuth y permisos de subida.')
            url = session_url(response.headers.get('location', ''))
            atomic_json(record, {'url': url})
            try:
                record.chmod(0o600)
            except OSError:
                pass
        response = client.put(url, headers={**headers, 'Content-Range': f'bytes */{size}', 'Content-Length': '0'})
        if response.status_code in (200, 201):
            offset = size
        elif response.status_code == 308:
            match = re.search(r'bytes=0-(\d+)', response.headers.get('range', ''))
            offset = int(match.group(1)) + 1 if match else 0
        else:
            raise ValueError('La sesión de subida no está disponible (HTTP ' + str(response.status_code) + '). No se iniciará otra para evitar duplicados.')
        with path.open('rb') as source:
            while offset < size:
                source.seek(offset); data = source.read(CHUNK)
                for attempt in range(4):
                    try:
                        response = client.put(url, headers={**headers, 'Content-Type': 'video/mp4', 'Content-Length': str(len(data)),
                                              'Content-Range': f'bytes {offset}-{offset + len(data) - 1}/{size}'}, content=data)
                    except httpx.HTTPError:
                        # Query committed bytes before retrying; never replay an ambiguous completed chunk blindly.
                        response = client.put(url, headers={**headers, 'Content-Range': f'bytes */{size}', 'Content-Length': '0'})
                    if response.status_code in (200, 201, 308):
                        break
                    if response.status_code not in (429, 500, 502, 503, 504) or attempt == 3:
                        raise ValueError('Subida interrumpida (HTTP ' + str(response.status_code) + '). Reconecta y reintenta: se conserva el MP4 y la sesión.')
                    time.sleep(2 ** attempt)
                if response.status_code in (200, 201):
                    break
                match = re.search(r'bytes=0-(\d+)', response.headers.get('range', ''))
                committed = int(match.group(1)) + 1 if match else 0
                if committed <= offset:
                    raise ValueError('YouTube no confirmó nuevos datos. La sesión se conserva para un reintento manual.')
                offset = committed
        data = response.json()
        ident = data.get('id')
        if not isinstance(ident, str) or not re.fullmatch(r'[\w-]{11}', ident):
            raise ValueError('YouTube no confirmó el ID final. Revisa el canal antes de repetir la subida.')
        atomic_json(record, {'videoId': ident})
        return {'videoId': ident, 'url': 'https://www.youtube.com/watch?v=' + ident, 'privacyStatus': 'private', 'reused': False}
