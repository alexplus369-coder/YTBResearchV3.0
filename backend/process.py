"""Cancellable local commands. User data never becomes shell syntax."""
import json
from pathlib import Path
import subprocess
import time


class Cancelled(Exception):
    pass


def run(args, cwd: Path, cancelled=lambda: False, timeout=1800):
    log = cwd / 'process.log'
    with log.open('wb') as output:
        proc = subprocess.Popen([str(a) for a in args], cwd=cwd, stdin=subprocess.DEVNULL, stdout=output, stderr=output)
        started = time.monotonic()
        try:
            while proc.poll() is None:
                if cancelled():
                    raise Cancelled()
                if time.monotonic() - started > timeout:
                    raise RuntimeError('El proceso superó el límite de tiempo; reduce resolución o duración.')
                time.sleep(.2)
            if proc.returncode:
                raise RuntimeError('FFmpeg/Whisper no pudo procesar el recurso. ' + log.read_text(errors='replace')[-900:])
        finally:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill(); proc.wait()


def probe(path: Path, settings):
    result = subprocess.run([settings.ffprobe, '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', str(path)],
                            capture_output=True, timeout=20, check=False)
    if result.returncode:
        raise ValueError('El archivo no es un recurso de audio, imagen o video válido.')
    data = json.loads(result.stdout)
    streams = data.get('streams', [])
    useful = [s for s in streams if (s.get('codec_type') == 'video' and int(s.get('width', 0)) > 0 and int(s.get('height', 0)) > 0)
              or (s.get('codec_type') == 'audio' and int(s.get('sample_rate', 0)) > 0)]
    if not useful or any(int(s.get('width', 0)) * int(s.get('height', 0)) > 17000000 for s in streams):
        raise ValueError('El recurso está vacío o supera 17 megapíxeles.')
    return data


def duration(path: Path, settings):
    data = probe(path, settings)
    value = float(data.get('format', {}).get('duration') or next((s['duration'] for s in data.get('streams', []) if s.get('duration')), 0))
    if not 0 < value <= settings.max_duration:
        raise ValueError('El audio/video debe durar como máximo ' + str(settings.max_duration // 60) + ' minutos.')
    return value
