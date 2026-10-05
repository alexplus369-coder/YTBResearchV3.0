"""Opt-in online providers with bounded downloads and explicit provenance."""
import asyncio
from dataclasses import asdict
import ipaddress
import json
from pathlib import Path
import socket
import time
from urllib.parse import urlparse

import httpx

from .captions import Word
from .process import Cancelled


def atomic_json(path, value):
    temporary = path.with_suffix('.json.part')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)


def checked_url(url, domains):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('URL de recurso no permitida.')
    host = parsed.hostname or ''
    if not any(host == domain or host.endswith('.' + domain) for domain in domains):
        raise ValueError('El proveedor devolvió un host de descarga no autorizado.')
    if any(not ipaddress.ip_address(address[4][0]).is_global for address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)):
        raise ValueError('No se permiten direcciones de red privadas.')
    return url


def download(url, destination, settings, domains, cancelled):
    temporary = destination.with_suffix(destination.suffix + '.part')
    try:
        with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
            for _ in range(4):
                checked_url(url, domains)
                with client.stream('GET', url) as response:
                    if response.is_redirect:
                        url = str(response.url.join(response.headers['location'])); continue
                    if response.status_code != 200:
                        raise RuntimeError('No se pudo descargar el recurso (HTTP ' + str(response.status_code) + ').')
                    size = 0
                    with temporary.open('wb') as output:
                        for chunk in response.iter_bytes(1024 * 128):
                            if cancelled():
                                raise Cancelled()
                            size += len(chunk)
                            if size > settings.max_download:
                                raise ValueError('El recurso del proveedor supera el límite de descarga.')
                            output.write(chunk)
                    temporary.replace(destination)
                    return
            raise ValueError('Demasiadas redirecciones al descargar el recurso.')
    finally:
        temporary.unlink(missing_ok=True)


async def edge_voice(text, voice, destination, cancelled):
    import edge_tts
    output = []
    communicate = edge_tts.Communicate(text, voice, boundary='WordBoundary', connect_timeout=10, receive_timeout=30)
    with destination.open('wb') as audio:
        async for item in communicate.stream():
            if cancelled():
                raise Cancelled()
            if item['type'] == 'audio':
                audio.write(item['data'])
            elif item['type'] == 'WordBoundary':
                output.append(Word(item['text'], item['offset'] / 10000000, (item['offset'] + item['duration']) / 10000000))
    if not destination.stat().st_size:
        raise RuntimeError('Edge TTS no devolvió audio.')
    return output


def synthesize(text, voice, destination, cancelled):
    try:
        return asyncio.run(asyncio.wait_for(edge_voice(text, voice, destination, cancelled), timeout=180))
    except Cancelled:
        raise
    except Exception:
        destination.unlink(missing_ok=True)
        raise RuntimeError('No se pudo conectar con Edge TTS. Reintenta o utiliza tu propio audio.') from None


def pexels(query, folder, index, settings, aspect, cancelled):
    if not settings.pexels_key:
        raise ValueError('Configura PEXELS_API_KEY en el servidor.')
    with httpx.Client(timeout=30, trust_env=False) as client:
        response = client.get('https://api.pexels.com/v1/videos/search', headers={'Authorization': settings.pexels_key},
                              params={'query': query[:120], 'orientation': 'portrait' if aspect == 'portrait' else 'landscape', 'per_page': 5})
    if response.status_code != 200:
        raise RuntimeError('Pexels no respondió a la búsqueda (HTTP ' + str(response.status_code) + ').')
    videos = response.json().get('videos', [])
    for video in videos:
        candidates = [f for f in video.get('video_files', []) if f.get('file_type') == 'video/mp4' and f.get('width', 0) <= 1920 and f.get('height', 0) <= 1920]
        if not candidates:
            continue
        candidate = min(candidates, key=lambda f: abs(max(f.get('width', 0), f.get('height', 0)) - 1280))
        path = folder / f'material-{index}.mp4'
        download(candidate['link'], path, settings, ['pexels.com', 'player.vimeo.com'], cancelled)
        return path, {'provider': 'Pexels', 'query': query, 'creator': video.get('user', {}).get('name', ''),
                      'source': video.get('url', ''), 'license': 'https://www.pexels.com/license/', 'id': str(video.get('id', ''))}
    raise ValueError('Pexels no encontró clips adecuados para: ' + query[:120] + '. Usa recursos propios o ajusta la escena.')


def replicate(prompt, folder, index, settings, cancelled):
    if not settings.replicate_token or len(settings.replicate_version) != 64:
        raise ValueError('Configura REPLICATE_API_TOKEN y la versión exacta de un modelo (64 caracteres).')
    record = folder / f'prediction-{index}.json'
    state = json.loads(record.read_text()) if record.exists() else None
    headers = {'Authorization': 'Bearer ' + settings.replicate_token}
    with httpx.Client(timeout=30, trust_env=False) as client:
        if state and not state.get('id'):
            raise RuntimeError('La solicitud de Replicate pudo haberse enviado sin confirmar. Revisa tu cuenta antes de crear otro trabajo; no se repetirá el cobro automáticamente.')
        if not state:
            try:
                inputs = json.loads(settings.replicate_input)
                if not isinstance(inputs, dict):
                    raise ValueError()
            except ValueError:
                raise ValueError('REPLICATE_INPUT_JSON debe ser un objeto JSON válido.') from None
            inputs['prompt'] = prompt[:3000]
            atomic_json(record, {'submission': 'pending', 'version': settings.replicate_version})
            response = client.post('https://api.replicate.com/v1/predictions', headers=headers,
                                   json={'version': settings.replicate_version, 'input': inputs})
            if response.status_code not in (200, 201, 202):
                if response.status_code < 500:
                    record.unlink(missing_ok=True)
                raise RuntimeError('Replicate rechazó la generación (HTTP ' + str(response.status_code) + ').')
            state = response.json()
            if not isinstance(state.get('id'), str) or not state['id'].isalnum():
                raise RuntimeError('Respuesta de Replicate no válida; revisa la solicitud en tu cuenta.')
            atomic_json(record, {'id': state['id'], 'version': settings.replicate_version})
        ident, started = state['id'], time.monotonic()
        while True:
            if cancelled():
                try:
                    client.post(f'https://api.replicate.com/v1/predictions/{ident}/cancel', headers=headers)
                finally:
                    raise Cancelled()
            response = client.get(f'https://api.replicate.com/v1/predictions/{ident}', headers=headers)
            if response.status_code != 200:
                raise RuntimeError('No se pudo consultar Replicate; reintenta este trabajo para seguir la misma predicción.')
            state = response.json()
            if state.get('status') == 'succeeded':
                break
            if state.get('status') in {'failed', 'canceled'}:
                raise RuntimeError('La predicción de Replicate falló o se canceló. No se crea otra automáticamente.')
            if time.monotonic() - started > 1200:
                raise RuntimeError('Replicate sigue procesando; reintenta este trabajo para consultar la misma predicción.')
            for _ in range(10):
                if cancelled():
                    break
                time.sleep(.2)
        output = state.get('output')
        url = output[0] if isinstance(output, list) and output else output
        if not isinstance(url, str):
            raise ValueError('El modelo debe devolver una URL de imagen/video o una lista de URLs.')
        path = folder / f'material-{index}.media'
        download(url, path, settings, ['replicate.delivery'], cancelled)
        return path, {'provider': 'Replicate', 'predictionId': ident, 'modelVersion': settings.replicate_version,
                      'license': 'Verificar la licencia del modelo y sus recursos; no se presupone permiso comercial.'}


def notify(settings, job_id, state):
    if not settings.telegram_token or not settings.telegram_chat:
        return False
    try:
        with httpx.Client(timeout=10, trust_env=False) as client:
            response = client.post('https://api.telegram.org/bot' + settings.telegram_token + '/sendMessage',
                                   json={'chat_id': settings.telegram_chat, 'text': f'YT Research · {job_id[:8]} · {state}'})
        return response.status_code == 200
    except httpx.HTTPError:
        return False
