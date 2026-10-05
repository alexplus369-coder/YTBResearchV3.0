import json
from pathlib import Path
import shutil

import pytest

from backend.tests.media_fixture import create


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='FFmpeg is required')
def test_editable_project_preserves_music_and_video_seek(tmp_path):
    project = create(tmp_path)
    props = json.loads((project / 'remotion-input.json').read_text())
    assert props['music']['volume'] == .12
    assert props['music']['durationSeconds'] == pytest.approx(2)
    assert (project / props['music']['src']).is_file()
    clips = [s for s in props['scenes'] if s['kind'] == 'video']
    assert clips and any(s['sourceStartFrame'] > 0 for s in clips)
    assert all(0 <= s['sourceStartFrame'] < s['mediaDuration'] * props['fps'] for s in clips)
    assert sum(s['durationInFrames'] for s in props['scenes']) == props['durationInFrames']
    assert all((project / s['src']).is_file() for s in props['scenes'])
    assert all(not Path(s['src']).is_absolute() for s in props['scenes'])
