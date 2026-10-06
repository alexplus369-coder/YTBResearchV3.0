import io
import math
import struct
import wave

import pytest

from backend.config import Settings


def wav_bytes(seconds=6, frequency=220):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)
        audio.writeframes(b''.join(struct.pack('<h', round(1600 * math.sin(2 * math.pi * frequency * i / 24000))) for i in range(round(seconds * 24000))))
    return output.getvalue()


@pytest.fixture
def settings(tmp_path):
    return Settings(root=tmp_path, token='local-test-access-code-32-characters', pixabay_key='', replicate_token='', replicate_version='',
                    whisper_cli='', whisper_model='', telegram_token='', telegram_chat='')


@pytest.fixture
def production():
    return {'format': 'yt-creator-production', 'version': 1, 'topic': 'Método propio', 'packaging': {'title': 'Organiza tu siguiente proyecto'},
            'description': 'Demostración original.', 'blocks': [
                {'index': 0, 'label': 'Gancho', 'narration': 'Compara el resultado de organizar estas tareas en un solo lugar.',
                 'scenes': [{'visual': 'Un método claro con tres pasos', 'stockQuery': 'workspace planning'}]},
                {'index': 1, 'label': 'Victoria rápida', 'narration': 'Primero define la tarea principal y comprueba la siguiente acción que puedes ejecutar hoy.',
                 'scenes': [{'visual': 'Define una acción concreta'}, {'visual': 'Comprueba el resultado con tu proyecto'}]}]}


@pytest.fixture
def request_payload(production):
    return {'production': production, 'options': {'materials': 'cards', 'tts': 'uploaded'}, 'audio_id': 'a' * 32}
