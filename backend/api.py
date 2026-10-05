"""Authenticated local render API and allowlisted static frontend."""
import asyncio
from contextlib import asynccontextmanager
import json
from pathlib import Path
import secrets
import shutil
import threading
import uuid
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import SecretStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .models import Contract, JobRequest, ClipRequest
from .pipeline import ARTIFACTS, ENGINE_VERSION
from .process import probe
from .store import Store
from .uploader import upload
from .worker import Worker

ROOT = Path(__file__).resolve().parent.parent
STATIC = {'index.html', 'research-core.js', 'research-workspace.js', 'creator-core.js', 'creator-studio.js', 'video-production.js'}
EXTENSIONS = {'.mp4', '.mov', '.webm', '.m4a', '.wav', '.mp3', '.png', '.jpg', '.jpeg', '.webp'}


class UploadRequest(Contract):
    access_token: SecretStr
    made_for_kids: bool = False
    synthetic: bool = False


class AccessAndBodyLimit:
    """Reject unauthenticated/oversized requests before multipart spooling."""
    def __init__(self, app, settings):
        self.app, self.settings = app, settings

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or not scope['path'].startswith('/api/video/') or scope['method'] == 'OPTIONS':
            return await self.app(scope, receive, send)
        headers = dict(scope.get('headers', []))
        if not secrets.compare_digest(headers.get(b'authorization', b''), ('Bearer ' + self.settings.token).encode()):
            return await JSONResponse({'detail': 'Código de acceso inválido.'}, status_code=401)(scope, receive, send)
        limit = self.settings.max_upload + 1024 * 1024 if scope['path'] == '/api/video/assets' else 2 * 1024 * 1024
        try:
            declared = int(headers.get(b'content-length', b'0'))
        except ValueError:
            return await JSONResponse({'detail': 'Tamaño de solicitud inválido.'}, status_code=400)(scope, receive, send)
        if declared > limit:
            return await JSONResponse({'detail': 'La solicitud supera el tamaño permitido.'}, status_code=413)(scope, receive, send)
        received = 0

        async def bounded_receive():
            nonlocal received
            message = await receive()
            received += len(message.get('body', b''))
            if received > limit:
                raise HTTPException(413, 'La solicitud supera el tamaño permitido.')
            return message

        await self.app(scope, bounded_receive, send)


def create_app(settings=None, run_worker=True):
    settings = settings or Settings()
    store, worker = Store(settings.root), None
    if run_worker:
        worker = Worker(settings, store)
    locks = {}

    @asynccontextmanager
    async def lifespan(app):
        if worker:
            worker.start()
        try:
            yield
        finally:
            if worker:
                await asyncio.to_thread(worker.stop)

    app = FastAPI(title='YT Research Video Production', version=ENGINE_VERSION, lifespan=lifespan)
    app.state.store, app.state.settings, app.state.worker = store, settings, worker
    app.add_middleware(AccessAndBodyLimit, settings=settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=['GET', 'POST', 'DELETE'], allow_headers=['Authorization', 'Content-Type'])
    # Prevent browser DNS rebinding into a loopback service. Configure a reverse proxy explicitly for remote hosting.
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', 'testserver'] + [urlparse(o).hostname for o in settings.origins if urlparse(o).hostname])

    @app.exception_handler(RequestValidationError)
    async def validation(request, error):
        return JSONResponse(status_code=422, content={'detail': [{'loc': e['loc'], 'msg': e['msg']} for e in error.errors()]})

    @app.exception_handler(ValueError)
    async def bad_request(request, error):
        return JSONResponse(status_code=400, content={'detail': str(error)[:1600]})

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse(status_code=404, content={'detail': 'Trabajo o recurso no encontrado.'})

    def authorized(request: Request):
        received = request.headers.get('authorization', '')
        if not secrets.compare_digest(received.encode(), ('Bearer ' + settings.token).encode()):
            raise HTTPException(401, 'Código de acceso inválido.')

    auth = [Depends(authorized)]

    def available():
        if len(store.active()) >= 10:
            raise HTTPException(429, 'La cola tiene 10 trabajos activos. Espera o cancela alguno.')

    def enqueue(request):
        available()
        if request.options.materials == 'pexels' and not settings.pexels_key:
            raise ValueError('Pexels no está configurado en el servidor.')
        if request.options.materials == 'replicate' and not (settings.replicate_token and settings.replicate_version):
            raise ValueError('Replicate no está configurado en el servidor.')
        if request.options.subtitles == 'whisper' and not (settings.whisper_cli and settings.whisper_model):
            raise ValueError('Whisper.cpp no está configurado en el servidor.')
        for ident in [*request.asset_ids, *request.scene_assets.values(), *([request.audio_id] if request.audio_id else []), *([request.music_id] if request.music_id else [])]:
            asset = store.asset(ident)
            if ident in [*request.asset_ids, *request.scene_assets.values()] and asset['kind'] not in {'image', 'video'}:
                raise ValueError('Los recursos de escena deben ser imágenes o videos.')
            if ident in {request.audio_id, request.music_id} and asset['kind'] not in {'audio', 'video'}:
                raise ValueError('La narración y la música deben contener audio.')
        signature = ENGINE_VERSION + settings.encoder + settings.replicate_version + settings.replicate_input + settings.whisper_model
        job = store.create({'kind': 'render', 'request': request.model_dump()}, signature)
        if worker:
            worker.wake.set()
        return job

    @app.get('/api/video/health', dependencies=auth)
    def health():
        return {'ready': bool(shutil.which(settings.ffmpeg) and shutil.which(settings.ffprobe)), 'version': ENGINE_VERSION, 'providers': settings.public(), 'worker': bool(worker)}

    @app.get('/api/video/assets', dependencies=auth)
    def assets():
        return store.assets()

    @app.post('/api/video/assets', dependencies=auth)
    async def add_asset(file: UploadFile):
        suffix = Path(file.filename or '').suffix.lower()
        if suffix not in EXTENSIONS:
            raise ValueError('Formato permitido: MP4/MOV/WebM, WAV/MP3/M4A, PNG/JPG/WebP.')
        ident = uuid.uuid4().hex
        path = settings.root / 'assets' / (ident + suffix)
        size = 0
        storage = settings.storage_used()
        try:
            with path.open('wb') as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > settings.max_upload:
                        raise ValueError('El recurso supera el límite de subida de ' + str(settings.max_upload // 1024 // 1024) + ' MB.')
                    if storage + size > settings.max_storage:
                        raise ValueError('El almacenamiento alcanzó el límite. Elimina recursos o trabajos terminados.')
                    output.write(chunk)
            metadata = await asyncio.to_thread(probe, path, settings)
            if float(metadata.get('format', {}).get('duration', 0) or 0) > settings.max_duration:
                raise ValueError('El recurso no puede durar más de 20 minutos.')
            kind = 'image' if suffix in {'.png', '.jpg', '.jpeg', '.webp'} else 'video' if any(s['codec_type'] == 'video' for s in metadata['streams']) else 'audio'
            asset = store.add_asset(path, Path(file.filename or 'recurso').name, kind)
            return {k: asset[k] for k in ['id', 'name', 'kind', 'size', 'created']}
        except Exception:
            path.unlink(missing_ok=True)
            raise
        finally:
            await file.close()

    @app.delete('/api/video/assets/{ident}', dependencies=auth)
    def delete_asset(ident: str):
        asset = store.asset(ident)
        for job in store.active():
            if ident in json.dumps(job['payload']):
                raise ValueError('Un trabajo activo utiliza este recurso.')
        Path(asset['path']).unlink(missing_ok=True)
        with store.connect() as con:
            con.execute('DELETE FROM assets WHERE id=?', (ident,))
        return {'deleted': True}

    @app.post('/api/video/jobs', dependencies=auth, status_code=202)
    def jobs(request: JobRequest):
        return enqueue(request)

    @app.get('/api/video/jobs', dependencies=auth)
    def list_jobs():
        return store.list()

    @app.get('/api/video/jobs/{ident}', dependencies=auth)
    def job(ident: str):
        return store.get(ident)

    @app.post('/api/video/jobs/{ident}/cancel', dependencies=auth)
    def cancel(ident: str):
        store.cancel(ident)
        return store.get(ident)

    @app.post('/api/video/jobs/{ident}/retry', dependencies=auth, status_code=202)
    def retry(ident: str):
        available(); result = store.retry(ident)
        if worker:
            worker.wake.set()
        return result

    @app.post('/api/video/jobs/{ident}/clips', dependencies=auth, status_code=202)
    def clip(ident: str, request: ClipRequest):
        available(); parent = store.get(ident, private=True)
        if parent['state'] != 'completed' or parent['payload']['kind'] != 'render':
            raise ValueError('Elige un render original terminado para extraer clips.')
        if request.end > parent['result']['durationSeconds'] + .03:
            raise ValueError('El final supera la duración del video.')
        result = store.create({'kind': 'clip', 'parent': ident, 'request': request.model_dump()}, ENGINE_VERSION + settings.encoder)
        if worker:
            worker.wake.set()
        return result

    @app.get('/api/video/jobs/{ident}/files/{filename}', dependencies=auth)
    def output(ident: str, filename: str):
        item = store.get(ident)
        if item['state'] != 'completed' or filename not in ARTIFACTS:
            raise HTTPException(404, 'Archivo no disponible.')
        path = store.directory(ident) / filename
        if not path.is_file():
            raise HTTPException(404, 'Archivo no disponible.')
        return FileResponse(path, filename=filename)

    @app.delete('/api/video/jobs/{ident}', dependencies=auth)
    def delete_job(ident: str):
        item = store.get(ident)
        if item['state'] in {'queued', 'running'}:
            raise ValueError('Cancela y espera a que termine el trabajo antes de eliminarlo.')
        for other in store.active():
            if other['payload'].get('parent') == ident:
                raise ValueError('Un recorte activo utiliza este video.')
        shutil.rmtree(store.directory(ident))
        with store.connect() as con:
            con.execute('DELETE FROM jobs WHERE id=?', (ident,))
        return {'deleted': True}

    @app.post('/api/video/jobs/{ident}/youtube', dependencies=auth)
    async def youtube(ident: str, request: UploadRequest):
        item = store.get(ident)
        if item['state'] != 'completed':
            raise ValueError('El MP4 debe estar terminado antes de subirlo.')
        token = request.access_token.get_secret_value()
        if not 20 <= len(token) <= 4096:
            raise ValueError('Token OAuth inválido.')
        lock = locks.setdefault(ident, threading.Lock())
        if not lock.acquire(blocking=False):
            raise HTTPException(409, 'Ya hay una subida en curso para este video.')
        try:
            return await asyncio.to_thread(upload, store.directory(ident), token, request.made_for_kids, request.synthetic)
        finally:
            lock.release()

    @app.get('/')
    def index():
        return FileResponse(ROOT / 'index.html')

    @app.get('/{filename}')
    def static(filename: str):
        if filename not in STATIC:
            raise HTTPException(404, 'No encontrado.')
        return FileResponse(ROOT / filename)

    return app
