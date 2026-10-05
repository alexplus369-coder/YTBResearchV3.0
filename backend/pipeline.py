"""Streaming FFmpeg composition: bounded clips, actual audio timing, no giant RAM timelines."""
from dataclasses import asdict
import json
from pathlib import Path
import shutil
import textwrap
import zipfile

from PIL import Image, ImageDraw, ImageFont

from . import captions, providers
from .models import JobRequest, ClipRequest
from .process import run, probe, duration, Cancelled

FPS = 24
ENGINE_VERSION = '1.0.0'
ARTIFACTS = {'video.mp4', 'subtitles.srt', 'subtitles.ass', 'words.json', 'manifest.json', 'timeline.json', 'publication.json', 'project.zip'}


def dimensions(aspect, resolution):
    return (resolution, round(resolution * 16 / 9) // 2 * 2) if aspect == 'portrait' else (resolution, resolution) if aspect == 'square' else (round(resolution * 16 / 9) // 2 * 2, resolution)


def encoder(settings):
    if settings.encoder == 'h264_nvenc':
        return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '23']
    if settings.encoder == 'h264_videotoolbox':
        return ['-c:v', 'h264_videotoolbox', '-b:v', '6M']
    return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']


def base(settings):
    return [settings.ffmpeg, '-y', '-v', 'error', '-nostdin', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe']


def card(path, title, visual, width, height):
    image = Image.new('RGB', (width, height), '#101827')
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((width * .07, height * .18, width * .93, height * .82), radius=32, fill='#18283d', outline='#355875', width=3)
    draw.rectangle((width * .1, height * .24, width * .22, height * .255), fill='#fb7185')
    size = max(22, round(width / 26))
    try:
        font = ImageFont.truetype('DejaVuSans.ttf', size)
        small = ImageFont.truetype('DejaVuSans.ttf', max(18, round(size * .7)))
    except OSError:
        font = ImageFont.load_default(size=size)
        small = ImageFont.load_default(size=max(18, round(size * .7)))
    heading = '\n'.join(textwrap.wrap(title, max(15, int(width / size * 1.5)))[:3])
    body = '\n'.join(textwrap.wrap(visual, max(18, int(width / (size * .7) * 1.5)))[:5])
    draw.multiline_text((width * .1, height * .3), heading, font=font, fill='white', spacing=12)
    draw.multiline_text((width * .1, height * .53), body, font=small, fill='#bcd3ed', spacing=10)
    image.save(path)


class Pipeline:
    def __init__(self, settings, store, stopping=lambda: False):
        self.settings, self.store, self.stopping = settings, store, stopping

    def cancelled(self, ident):
        return self.stopping() or bool(self.store.get(ident, private=True)['cancel'])

    def step(self, ident, label, progress):
        if self.cancelled(ident):
            raise Cancelled()
        if self.settings.storage_used() > self.settings.max_storage:
            raise ValueError('El almacenamiento alcanzó el límite. Elimina trabajos terminados o recursos que ya no necesites.')
        self.store.update(ident, stage=label, progress=progress)

    def asset(self, ident, kind=None):
        asset = self.store.asset(ident)
        if kind and asset['kind'] not in kind:
            raise ValueError('El recurso seleccionado no es del tipo requerido.')
        return Path(asset['path']), asset

    def voice(self, request, folder, cancelled):
        record = folder / 'voice.json'
        if record.exists() and (folder / 'narration.wav').is_file():
            data = json.loads(record.read_text())
            duration(folder / 'narration.wav', self.settings)
            return data
        blocks = [b for b in request.production.blocks if not request.block_indexes or b.index in request.block_indexes]
        words, timings, offset = [], [], 0
        if request.options.tts == 'uploaded':
            audio, _ = self.asset(request.audio_id, {'audio', 'video'})
            run(base(self.settings) + ['-i', audio, '-vn', '-ac', '1', '-ar', '24000', 'narration.wav'], folder, cancelled)
            total = duration(folder / 'narration.wav', self.settings)
            weight = sum(len(b.narration.split()) for b in blocks)
            for b in blocks:
                length = total * len(b.narration.split()) / weight
                words.extend(asdict(w) for w in captions.estimate(b.narration, length, offset))
                timings.append({'index': b.index, 'start': offset, 'end': offset + length}); offset += length
            source = 'estimated-from-script'
        else:
            concat, estimated = [], False
            for b in blocks:
                voice_file, meta = folder / f'voice-{b.index}.wav', folder / f'voice-{b.index}.json'
                if voice_file.exists() and meta.exists():
                    local_words = [captions.Word(**w) for w in json.loads(meta.read_text())]
                else:
                    mp3 = folder / f'voice-{b.index}.mp3'
                    local_words = providers.synthesize(b.narration, request.options.voice, mp3, cancelled)
                    run(base(self.settings) + ['-i', mp3, '-ac', '1', '-ar', '24000', voice_file.name], folder, cancelled)
                    providers.atomic_json(meta, [asdict(w) for w in local_words]); mp3.unlink(missing_ok=True)
                length = duration(voice_file, self.settings)
                if not local_words:
                    local_words = captions.estimate(b.narration, length)
                    estimated = True
                words.extend({'text': w.text, 'start': offset + max(0, min(length, w.start)), 'end': offset + max(0, min(length, w.end))} for w in local_words)
                timings.append({'index': b.index, 'start': offset, 'end': offset + length}); offset += length
                if offset > self.settings.max_duration:
                    raise ValueError('La narración supera el límite de duración.')
                concat.append("file '" + voice_file.name + "'")
            (folder / 'voice-concat.txt').write_text('\n'.join(concat))
            run(base(self.settings) + ['-f', 'concat', '-safe', '1', '-i', 'voice-concat.txt', '-c', 'copy', 'narration.wav'], folder, cancelled)
            source = 'edge-with-estimated-blocks' if estimated else 'edge-word-boundaries'
        data = {'duration': duration(folder / 'narration.wav', self.settings), 'blocks': timings, 'words': words, 'source': source}
        providers.atomic_json(record, data)
        return data

    def materials(self, ident, request, folder, width, height, cancelled):
        record = folder / 'materials.json'
        saved = json.loads(record.read_text()) if record.exists() else {}
        selected = [b for b in request.production.blocks if not request.block_indexes or b.index in request.block_indexes]
        source_ids = request.asset_ids
        index, remote_count, result = 0, 0, []
        for b in request.production.blocks:
            for scene in b.scenes:
                if b not in selected:
                    index += 1; continue
                self.step(ident, 'materials', 20 + 20 * len(result) / max(1, sum(len(b.scenes) for b in selected)))
                asset_id = request.scene_assets.get(str(index))
                item = saved.get(str(index))
                remote_count = len({r['path'] for r in result if r['credit']['provider'] in {'Pexels', 'Replicate'}})
                if item and Path(item['path']).is_file():
                    result.append(item); index += 1; continue
                if asset_id or request.options.materials == 'own':
                    path, asset = self.asset(asset_id or source_ids[index % len(source_ids)], {'image', 'video'})
                    credit = {'provider': 'Creator upload', 'name': asset['name'], 'assetId': asset['id'], 'license': 'Verificar derechos del recurso aportado.'}
                elif request.options.materials == 'cards':
                    path = folder / f'card-{index}.png'; card(path, request.production.packaging.title, scene.visual, width, height)
                    credit = {'provider': 'Local graphics', 'license': 'Composición original generada a partir del proyecto.'}
                elif remote_count >= request.options.max_generated:
                    original = next((r for r in result if r['credit']['provider'] in {'Pexels', 'Replicate'}), None)
                    if not original:
                        raise ValueError('No hay recursos generados para reutilizar.')
                    path, credit = Path(original['path']), original['credit']
                else:
                    if request.options.materials == 'pexels':
                        path, credit = providers.pexels(scene.stockQuery or scene.visual[:100], folder, index, self.settings, request.options.aspect, cancelled)
                    else:
                        path, credit = providers.replicate(scene.imagePrompt or scene.videoPrompt or scene.visual, folder, index, self.settings, cancelled)
                metadata = probe(path, self.settings)
                has_video = next((s for s in metadata['streams'] if s.get('codec_type') == 'video'), None)
                if not has_video:
                    raise ValueError('La escena requiere una imagen o un video.')
                length = float(metadata.get('format', {}).get('duration', 0) or 0)
                kind = 'video' if length > 0 and path.suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp'} else 'image'
                item = {'index': index, 'block': b.index, 'visual': scene.visual, 'path': str(path), 'kind': kind,
                        'mediaDuration': length, 'credit': credit}
                saved[str(index)] = item; providers.atomic_json(record, saved)
                result.append(item); index += 1
        return result

    def render(self, ident, payload):
        request = JobRequest.model_validate(payload)
        folder = self.store.directory(ident); cancelled = lambda: self.cancelled(ident)
        width, height = dimensions(request.options.aspect, request.options.resolution)
        self.step(ident, 'voice', 5)
        voice = self.voice(request, folder, cancelled)
        self.step(ident, 'captions', 18)
        if request.options.subtitles == 'whisper':
            words = captions.whisper(folder / 'narration.wav', folder, self.settings, cancelled)
            timing_source = json.loads((folder / 'whisper-timing.json').read_text())['source']
        elif request.options.subtitles == 'estimated':
            words = captions.estimate(' '.join(b.narration for b in request.production.blocks if not request.block_indexes or b.index in request.block_indexes), voice['duration'])
            timing_source = 'estimated-from-script'
        else:
            words = [captions.Word(**w) for w in voice['words']]; timing_source = voice['source']
        captions.export(words, folder, width, height)
        media = self.materials(ident, request, folder, width, height, cancelled)
        timeline, segments, position = [], [], 0
        for block in voice['blocks']:
            scenes = [m for m in media if m['block'] == block['index']]
            start, end = round(block['start'] * FPS), round(block['end'] * FPS)
            for i, item in enumerate(scenes):
                first = start + round((end - start) * i / len(scenes))
                last = start + round((end - start) * (i + 1) / len(scenes))
                while first < last:
                    frames = min(round(request.options.clip_seconds * FPS), last - first)
                    clip_name = f'segment-{position:04}.mp4'; target = folder / clip_name
                    self.step(ident, f'rendering {position + 1}', 40 + 45 * first / max(1, voice['duration'] * FPS))
                    if not target.exists():
                        args = base(self.settings) + (['-loop', '1'] if item['kind'] == 'image' else ['-stream_loop', '-1'])
                        vf = f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,fps={FPS}'
                        if item['kind'] == 'image':
                            vf += f",zoompan=z='1+0.05*on/{frames}':d=1:s={width}x{height}:fps={FPS}"
                        if item['kind'] == 'video' and item['mediaDuration'] > frames / FPS:
                            args += ['-ss', str((first / FPS) % (item['mediaDuration'] - frames / FPS))]
                        run(args + ['-i', item['path'], '-an', '-vf', vf, '-frames:v', str(frames), *encoder(self.settings), '-pix_fmt', 'yuv420p', '-threads', '2', clip_name + '.part.mp4'], folder, cancelled, self.settings.process_timeout)
                        (folder / (clip_name + '.part.mp4')).replace(target)
                    segments.append("file '" + clip_name + "'")
                    timeline.append({'startFrame': first, 'durationInFrames': frames, 'scene': item['index'], 'kind': item['kind'],
                                     'visual': item['visual'], 'asset': Path(item['path']).name, 'mediaDuration': item['mediaDuration']})
                    first += frames; position += 1
        (folder / 'segments.txt').write_text('\n'.join(segments))
        self.step(ident, 'assembling', 87)
        run(base(self.settings) + ['-f', 'concat', '-safe', '1', '-i', 'segments.txt', '-c', 'copy', 'silent.part.mp4'], folder, cancelled)
        (folder / 'silent.part.mp4').replace(folder / 'silent.mp4')
        args = base(self.settings) + ['-i', 'silent.mp4', '-i', 'narration.wav']
        if request.music_id:
            music, _ = self.asset(request.music_id, {'audio', 'video'})
            args += ['-stream_loop', '-1', '-i', music, '-filter_complex', f'[1:a]volume=1[a];[2:a]volume={request.options.music_volume}[b];[a][b]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[out]', '-map', '0:v', '-map', '[out]']
        else:
            args += ['-map', '0:v', '-map', '1:a', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11']
        self.step(ident, 'encoding', 92)
        run(args + ['-vf', 'ass=subtitles.ass', *encoder(self.settings), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', '-threads', '2', 'video.part.mp4'], folder, cancelled, self.settings.process_timeout)
        (folder / 'video.part.mp4').replace(folder / 'video.mp4')
        actual = duration(folder / 'video.mp4', self.settings)
        self.step(ident, 'exports', 98)
        publication = {'title': request.production.packaging.title, 'description': request.production.description,
                       'pinnedComment': request.production.pinnedComment, 'checks': request.production.checks, 'privacyStatus': 'private'}
        manifest = {'engine': 'FFmpeg', 'engineVersion': ENGINE_VERSION, 'durationSeconds': actual, 'width': width, 'height': height, 'fps': FPS,
                    'captionTiming': timing_source, 'blocks': voice['blocks'], 'midRollDurationThresholdMet': actual >= 480,
                    'credits': [m['credit'] for m in media], 'originalProjectTopic': request.production.topic}
        providers.atomic_json(folder / 'timeline.json', timeline); providers.atomic_json(folder / 'publication.json', publication)
        providers.atomic_json(folder / 'manifest.json', manifest)
        self.bundle(folder, media, width, height, timeline, voice, words)
        for path in folder.glob('segment-*'):
            path.unlink(missing_ok=True)
        return {'durationSeconds': actual, 'width': width, 'height': height, 'captionTiming': timing_source,
                'artifacts': sorted(ARTIFACTS), 'midRollDurationThresholdMet': actual >= 480, 'canClip': True}

    def bundle(self, folder, media, width, height, timeline, voice, words):
        unique = {m['path']: m for m in media}
        # Prefix paths with scene index; identical upload basenames never collide in an editable project.
        names = {path: f'media/{m["index"]}-{Path(path).name}' for path, m in unique.items()}
        by_index = {m['index']: names[m['path']] for m in media}
        props = {'width': width, 'height': height, 'fps': FPS, 'durationInFrames': round(voice['duration'] * FPS), 'audio': 'narration.wav',
                 'scenes': [{**item, 'src': by_index[item['scene']]} for item in timeline], 'words': [asdict(w) for w in words]}
        with zipfile.ZipFile(folder / 'project.zip.part', 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            for filename in ['subtitles.srt', 'subtitles.ass', 'words.json', 'timeline.json', 'publication.json', 'manifest.json', 'narration.wav']:
                archive.write(folder / filename, filename)
            for path, name in names.items():
                archive.write(path, name)
            archive.writestr('remotion-input.json', json.dumps(props, ensure_ascii=False, indent=2))
            archive.writestr('README.txt', 'Proyecto editable: audio, recursos, subtitulos, tiempos reales y metadatos. Para Remotion, extrae en remotion/public y consulta docs/video-production.md. La musica opcional no se incluye en el proyecto Remotion; agregarla en el editor.\n')
        (folder / 'project.zip.part').replace(folder / 'project.zip')

    def clip(self, ident, parent_id, payload):
        request = ClipRequest.model_validate(payload)
        parent = self.store.get(parent_id)
        if parent['state'] != 'completed':
            raise ValueError('El video original todavía no está terminado.')
        source, folder = self.store.directory(parent_id), self.store.directory(ident)
        metadata = json.loads((source / 'manifest.json').read_text())
        if request.end > metadata['durationSeconds'] + .03:
            raise ValueError('El final del recorte supera la duración del video.')
        cancelled = lambda: self.cancelled(ident)
        width, height = dimensions(request.aspect, request.resolution)
        words = [captions.Word(w['text'], max(0, w['start'] - request.start), min(request.end, w['end']) - request.start)
                 for w in json.loads((source / 'words.json').read_text()) if w['end'] > request.start and w['start'] < request.end]
        captions.export(words, folder, width, height)
        self.step(ident, 'clip', 20)
        # Reframe the clean video and reuse final audio, then reburn correctly placed/rebased captions.
        run(base(self.settings) + ['-ss', str(request.start), '-i', source / 'silent.mp4', '-ss', str(request.start), '-i', source / 'video.mp4',
            '-t', str(request.end - request.start), '-map', '0:v', '-map', '1:a', '-vf', f'scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,ass=subtitles.ass',
            *encoder(self.settings), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-threads', '2', 'video.part.mp4'], folder, cancelled, self.settings.process_timeout)
        (folder / 'video.part.mp4').replace(folder / 'video.mp4')
        actual = duration(folder / 'video.mp4', self.settings)
        providers.atomic_json(folder / 'manifest.json', {**metadata, 'durationSeconds': actual, 'width': width, 'height': height, 'parentJob': parent_id, 'sourceStart': request.start, 'sourceEnd': request.end, 'midRollDurationThresholdMet': False})
        shutil.copyfile(source / 'publication.json', folder / 'publication.json')
        return {'durationSeconds': actual, 'width': width, 'height': height, 'captionTiming': metadata['captionTiming'],
                'artifacts': ['video.mp4', 'subtitles.srt', 'subtitles.ass', 'words.json', 'manifest.json', 'publication.json'], 'canClip': False}
