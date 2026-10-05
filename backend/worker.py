"""One durable worker per data directory; compatible with Windows and Unix."""
import os
import threading

from .pipeline import Pipeline
from .process import Cancelled
from .providers import notify


class Worker:
    def __init__(self, settings, store):
        self.settings, self.store = settings, store
        self.stop_event = threading.Event(); self.wake = threading.Event()
        self.thread = None; self.lockfile = None

    def start(self):
        self.lockfile = (self.settings.root / 'worker.lock').open('a+b')
        self.lockfile.seek(0); self.lockfile.write(b'1'); self.lockfile.flush(); self.lockfile.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(self.lockfile.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            self.lockfile.close()
            raise RuntimeError('Ya hay un worker usando este directorio. Ejecuta una sola instancia, sin --workers ni --reload.') from None
        self.store.recover()
        self.thread = threading.Thread(target=self.loop, daemon=True, name='yt-video-worker'); self.thread.start()

    def loop(self):
        engine = Pipeline(self.settings, self.store, self.stop_event.is_set)
        while not self.stop_event.is_set():
            job = self.store.claim()
            if not job:
                self.wake.wait(.5); self.wake.clear(); continue
            payload, ident = job['payload'], job['id']
            try:
                if payload['kind'] == 'clip':
                    result = engine.clip(ident, payload['parent'], payload['request'])
                else:
                    result = engine.render(ident, payload['request'])
                self.store.update(ident, state='completed', stage='completed', progress=100, result=result, error='')
                if payload.get('request', {}).get('options', {}).get('notify'):
                    notified = notify(self.settings, ident, 'Video terminado')
                    if not notified:
                        self.store.update(ident, result={**result, 'notificationWarning': 'No se pudo entregar la notificación; el video está terminado.'})
            except Cancelled:
                requested = self.store.get(ident, private=True)['cancel']
                self.store.update(ident, state='cancelled' if requested else 'queued', stage='cancelled' if requested else 'interrupted')
            except Exception as error:
                # Redact credentials defensively; provider errors never include response bodies.
                message = str(error)[:1600]
                for value in [self.settings.token, self.settings.pexels_key, self.settings.replicate_token, self.settings.telegram_token]:
                    if value:
                        message = message.replace(value, '[redactado]')
                self.store.update(ident, state='failed', stage='failed', error=message)
                if payload.get('request', {}).get('options', {}).get('notify'):
                    notify(self.settings, ident, 'Error; revisar el panel')

    def stop(self):
        self.stop_event.set(); self.wake.set()
        if self.thread:
            self.thread.join(timeout=35)
        if self.lockfile and (not self.thread or not self.thread.is_alive()):
            self.lockfile.close()
