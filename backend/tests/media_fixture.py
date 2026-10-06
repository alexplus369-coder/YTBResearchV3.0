"""Original, offline fixture for native FFmpeg and Remotion integration checks."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import uuid
import zipfile

from backend.config import Settings
from backend.models import JobRequest
from backend.pipeline import Pipeline, card
from backend.store import Store
from backend.tests.conftest import wav_bytes


def create(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    settings = Settings(root=output / 'data', token='offline-test-fixture-access-code', pixabay_key='', replicate_token='',
                        replicate_version='', whisper_cli='', whisper_model='', telegram_token='', telegram_chat='')
    store = Store(settings.root)
    def asset(name, data=None):
        path = settings.root / 'assets' / (uuid.uuid4().hex + Path(name).suffix)
        if data is not None:
            path.write_bytes(data)
        return path
    voice = asset('voice.wav', wav_bytes(6)); music = asset('music.wav', wav_bytes(2, frequency=880))
    picture = asset('image.png'); card(picture, 'Un proyecto original', 'Una acción concreta y comprobable', 1280, 720)
    video = asset('clip.mp4')
    subprocess.run([settings.ffmpeg, '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=8',
                    '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '2', str(video)], check=True)
    ids = {name: store.add_asset(path, name, kind)['id'] for name, path, kind in [('voice.wav', voice, 'audio'), ('music.wav', music, 'audio'), ('image.png', picture, 'image'), ('clip.mp4', video, 'video')]}
    production = {'format': 'yt-creator-production', 'version': 1, 'topic': 'Organizar un proyecto', 'packaging': {'title': 'Una acción concreta para empezar'},
                  'description': 'Fixture original de prueba, con tonos de audio y patrones de color.', 'blocks': [
                      {'index': 0, 'label': 'Gancho', 'narration': 'Compara el resultado de organizar estas tareas en un solo lugar.', 'scenes': [{'visual': 'Un método claro con tres pasos'}]},
                      {'index': 1, 'label': 'Método', 'narration': 'Primero define la tarea principal y comprueba la siguiente acción que puedes ejecutar hoy.',
                       'scenes': [{'visual': 'El clip empieza en su punto seleccionado'}, {'visual': 'Comprueba una acción concreta'}]}]}
    request = JobRequest.model_validate({'production': production, 'options': {'materials': 'own', 'tts': 'uploaded', 'music_volume': .12},
                                        'audio_id': ids['voice.wav'], 'music_id': ids['music.wav'],
                                        'scene_assets': {'0': ids['image.png'], '1': ids['clip.mp4'], '2': ids['image.png']}})
    ident = store.create({'kind': 'render', 'request': request.model_dump()})['id']
    result = Pipeline(settings, store).render(ident, request.model_dump())
    store.update(ident, state='completed', result=result)
    source = store.directory(ident)
    with zipfile.ZipFile(source / 'project.zip') as bundle:
        bundle.extractall(output / 'project')
    shutil.copy2(source / 'video.mp4', output / 'ffmpeg.mp4')
    (output / 'fixture.json').write_text(json.dumps({'production': production, 'durationSeconds': result['durationSeconds'],
                                                   'assets': {'voice': voice.name, 'music': music.name, 'image': picture.name, 'video': video.name}}), encoding='utf-8')
    return output / 'project'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, default=Path('test-results/media-fixture'))
    args = parser.parse_args(); create(args.output)
    print('Original six-second fixture rendered and exported; no external providers were used.')
