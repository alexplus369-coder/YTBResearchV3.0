"""Provider secrets stay in the server environment, never in exported jobs."""
from dataclasses import dataclass, field
from pathlib import Path
import os
import secrets
from urllib.parse import urlsplit


def allowed_origins():
    origins = [v.strip() for v in os.getenv('YT_RENDER_ORIGINS', 'http://127.0.0.1:8787,http://localhost:8787').split(',') if v.strip()]
    external = os.getenv('RENDER_EXTERNAL_URL', '').strip()
    if external:
        url = urlsplit(external)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {'', '/'}:
            raise ValueError('RENDER_EXTERNAL_URL debe ser el origen HTTPS del servicio, sin credenciales ni rutas.')
        origins.append('https://' + url.netloc)
    return list(dict.fromkeys(origins))


@dataclass
class Settings:
    root: Path = field(default_factory=lambda: Path(os.getenv('YT_RENDER_DIR', 'render-data')).resolve())
    token: str = field(default_factory=lambda: os.getenv('YT_RENDER_TOKEN') or secrets.token_urlsafe(32))
    ffmpeg: str = field(default_factory=lambda: os.getenv('YT_FFMPEG', 'ffmpeg'))
    ffprobe: str = field(default_factory=lambda: os.getenv('YT_FFPROBE', 'ffprobe'))
    encoder: str = field(default_factory=lambda: os.getenv('YT_ENCODER', 'libx264'))
    host: str = field(default_factory=lambda: os.getenv('YT_RENDER_HOST') or ('0.0.0.0' if os.getenv('RENDER_EXTERNAL_URL') else '127.0.0.1'))
    port: int = field(default_factory=lambda: int(os.getenv('PORT') or os.getenv('YT_RENDER_PORT') or '8787'))
    private_site: bool = field(default_factory=lambda: os.getenv('YT_SITE_PRIVATE', '').lower().strip() in {'true', '1', 'yes'})
    site_user: str = field(default_factory=lambda: os.getenv('YT_SITE_USER', 'alejandro'))
    pixabay_key: str = field(default_factory=lambda: os.getenv('PIXABAY_API_KEY', ''))
    replicate_token: str = field(default_factory=lambda: os.getenv('REPLICATE_API_TOKEN', ''))
    replicate_version: str = field(default_factory=lambda: os.getenv('REPLICATE_MODEL_VERSION', ''))
    replicate_input: str = field(default_factory=lambda: os.getenv('REPLICATE_INPUT_JSON') or '{}')
    whisper_cli: str = field(default_factory=lambda: os.getenv('WHISPER_CPP_BINARY', ''))
    whisper_model: str = field(default_factory=lambda: os.getenv('WHISPER_CPP_MODEL', ''))
    telegram_token: str = field(default_factory=lambda: os.getenv('TELEGRAM_BOT_TOKEN', ''))
    telegram_chat: str = field(default_factory=lambda: os.getenv('TELEGRAM_CHAT_ID', ''))
    origins: list[str] = field(default_factory=allowed_origins)
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
        if not 1 <= self.port <= 65535:
            raise ValueError('El puerto debe estar entre 1 y 65535.')
        if not self.site_user or len(self.site_user) > 80 or ':' in self.site_user or any(ord(c) < 32 for c in self.site_user):
            raise ValueError('YT_SITE_USER debe ser un usuario de 1 a 80 caracteres sin dos puntos ni caracteres de control.')
        if self.encoder not in {'libx264', 'h264_nvenc', 'h264_videotoolbox'}:
            raise ValueError('YT_ENCODER debe ser libx264, h264_nvenc o h264_videotoolbox.')

    def public(self):
        return {'pixabay': bool(self.pixabay_key), 'replicate': bool(self.replicate_token), 'replicateCatalog': True,
                'replicateLegacy': bool(self.replicate_token and self.replicate_version),
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
