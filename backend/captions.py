"""Caption exports and timing provenance; estimated timings are clearly labelled."""
from dataclasses import dataclass, asdict
import json
from pathlib import Path
import re

from .process import run


@dataclass
class Word:
    text: str
    start: float
    end: float


def estimate(text, length, offset=0):
    tokens = text.split()
    weights = [max(1, len(t)) for t in tokens]
    total, cursor = sum(weights), offset
    output = []
    for token, weight in zip(tokens, weights):
        end = cursor + length * weight / total
        output.append(Word(token, cursor, end)); cursor = end
    return output


def groups(words, maximum=5):
    group = []
    for word in words:
        if group and (len(group) >= maximum or word.start - group[-1].end > .6):
            yield group; group = []
        group.append(word)
    if group:
        yield group


def stamp(seconds, ass=False):
    milliseconds = max(0, round(seconds * 1000))
    hour, rem = divmod(milliseconds, 3600000)
    minute, rem = divmod(rem, 60000)
    second, ms = divmod(rem, 1000)
    return f'{hour}:{minute:02}:{second:02}.{ms // 10:02}' if ass else f'{hour:02}:{minute:02}:{second:02},{ms:03}'


def safe_text(text):
    return re.sub(r'<[^>]*>', '', text).replace('\\', '/').replace('{', '(').replace('}', ')').replace('\n', ' ').replace('\r', ' ')


def export(words, folder: Path, width, height):
    words = [w for w in words if w.end > w.start and w.text.strip()]
    if not words:
        raise ValueError('No se pudieron preparar subtítulos; revisa el audio y el texto.')
    srt, dialogues = [], []
    for index, group in enumerate(groups(words), 1):
        srt.append(f'{index}\n{stamp(group[0].start)} --> {stamp(group[-1].end)}\n' + ' '.join(safe_text(w.text) for w in group) + '\n')
        karaoke = ''.join('{\\k' + str(max(1, round(((group[i + 1].start if i + 1 < len(group) else w.end) - w.start) * 100))) + '}' + safe_text(w.text) + ' ' for i, w in enumerate(group))
        dialogues.append(f'Dialogue: 0,{stamp(group[0].start, True)},{stamp(group[-1].end, True)},Default,,0,0,0,,{karaoke}')
    (folder / 'subtitles.srt').write_text('\n'.join(srt), encoding='utf-8')
    size = 40 if width >= height else 46
    margin = round(height * (.12 if height > width else .06))
    header = f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,{size},&H0000FFFF,&H00FFFFFF,&H0010141F,&H90000000,-1,0,0,0,100,100,0,0,1,3,1,2,30,30,{margin},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    (folder / 'subtitles.ass').write_text(header + '\n'.join(dialogues), encoding='utf-8')
    (folder / 'words.json').write_text(json.dumps([asdict(w) for w in words], ensure_ascii=False), encoding='utf-8')


def whisper(audio, folder, settings, cancelled):
    if not settings.whisper_cli or not Path(settings.whisper_model).is_file():
        raise ValueError('Configura WHISPER_CPP_BINARY y WHISPER_CPP_MODEL para usar transcripción local.')
    wav = folder / 'whisper-input.wav'
    run([settings.ffmpeg, '-y', '-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', wav], folder, cancelled)
    run([settings.whisper_cli, '-m', settings.whisper_model, '-f', wav, '-l', 'es', '-ojf', '-of', 'aligned', '-ml', '1'], folder, cancelled, settings.process_timeout)
    data = json.loads((folder / 'aligned.json').read_text(encoding='utf-8'))
    output = []
    for segment in data.get('transcription', []):
        current = None
        for token in segment.get('tokens', []):
            offsets = token.get('offsets', {})
            raw = token.get('text', '')
            value = raw.strip()
            if not value or (value.startswith('[') and value.endswith(']')) or offsets.get('to', 0) <= offsets.get('from', 0):
                continue
            # Whisper tokens can be subwords; a leading space starts the next word.
            if current and not raw[0].isspace():
                current.text += value
                current.end = offsets['to'] / 1000
            else:
                current = Word(value, offsets['from'] / 1000, offsets['to'] / 1000)
                output.append(current)
    timing = 'whisper.cpp-token-alignment'
    if not output:
        timing = 'estimated-from-whisper-segments'
        for segment in data.get('transcription', []):
            offsets = segment.get('offsets', {})
            if offsets.get('to', 0) > offsets.get('from', 0):
                output.extend(estimate(segment.get('text', ''), (offsets['to'] - offsets['from']) / 1000, offsets['from'] / 1000))
    if not output:
        raise ValueError('Whisper no devolvió marcas de tiempo útiles.')
    (folder / 'whisper-timing.json').write_text(json.dumps({'source': timing}), encoding='utf-8')
    return output
