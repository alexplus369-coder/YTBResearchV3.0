"""python -m backend: serves both frontend and the local render worker."""
import os
import uvicorn
from .api import create_app
from .config import Settings

if __name__ == '__main__':
    settings = Settings()
    if not os.getenv('YT_RENDER_TOKEN'):
        print('Código de acceso para el panel de producción: ' + settings.token, flush=True)
    address = os.getenv('RENDER_EXTERNAL_URL') or 'http://127.0.0.1:' + str(settings.port)
    print('Abre ' + address + ' · FFmpeg y FFprobe deben estar en PATH.', flush=True)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, access_log=False)
