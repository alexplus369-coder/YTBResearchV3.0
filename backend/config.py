"""Provider secrets stay in the server environment, never in exported jobs."""
from dataclasses import dataclass, field
from pathlib import Path
import os
import secrets


@dataclass
class Settings:
    root: Path = field(default_factory=lambda: Path(os.getenv('YT_RENDER_DIR', 'render-data')).resolve())
    token: str = field(default_factory=lambda: os.getenv('YT_RENDER_TOKEN') or secrets.token_urlsafe(32))
    ffmpeg: str = field(default_factory=lambda: os.getenv('YT_FFMPEG', 'ffmpeg'))
    ffprobe: str = field(default_factory=lambda: os.getenv('YT_FFPROBE', 'ffprobe'))
    encoder: str = field(default_factory=lambda: os.getenv('YT_ENCODER', 'libx264'))
    pexels_key: str = field(default_factory=lambda: os.getenv('PEXELS_API_KEY', ''))
    replicate_token: str = field(default_factory=lambda: os.getenv('REPLICATE_API_TOKEN', ''))
    replicate_version: str = field(default_factory=lambda: os.getenv('REPLICATE_MODEL_VERSION', ''))
    replicate_input: str = field(default_factory=lambda: os.getenv('REPLICATE_INPUT_JSON') or '{}')
    whisper_cli: str = field(default_factory=lambda: os.getenv('WHISPER_CPP_BINARY', ''))
    whisper_model: str = field(default_factory=lambda: os.getenv('WHISPER_CPP_MODEL', ''))
    telegram_token: str = field(default_factory=lambda: os.getenv('TELEGRAM_BOT_TOKEN', ''))
    telegram_chat: str = field(default_factory=lambda: os.getenv('TELEGRAM_CHAT_ID', ''))
    origins: list[str] = field(default_factory=lambda: [v.strip() for v in os.getenv('YT_RENDER_ORIGINS', 'http://127.0.0.1:8787,http://localhost:8787').split(',') if v.strip()])
    max_upload: int = 200 * 1024 * 1024
    max_download: int = 150 * 1024 * 1024
    max_storage: int = 20 * 1024 * 1024 * 1024
    max_duration: int = 1200
    process_timeout: int = 1800

    def __post_init__(self):
        self.root = self.root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if len(self.token) < 24:
            raise ValueError('YT_RENDER_TOKEN debe tener al menos 24 caracteres.')
        if self.encoder not in {'libx264', 'h264_nvenc', 'h264_videotoolbox'}:
            raise ValueError('YT_ENCODER debe ser libx264, h264_nvenc o h264_videotoolbox.')

    def public(self):
        return {'pexels': bool(self.pexels_key), 'replicate': bool(self.replicate_token and self.replicate_version),
                'whisper': bool(self.whisper_cli and self.whisper_model), 'telegram': bool(self.telegram_token and self.telegram_chat),
                'encoder': self.encoder, 'maxUploadMB': self.max_upload // 1024 // 1024}

    def storage_used(self):
        size = 0
        for path in self.root.rglob('*'):
            try:
                if path.is_file():
                    size += path.stat().st_size
            except FileNotFoundError:
                pass  # Completed jobs can be deleted while another job renders.
        return size
