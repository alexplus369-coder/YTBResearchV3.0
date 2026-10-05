"""Bounded render contracts accept only data, never commands or filesystem paths."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

AssetId = Annotated[str, Field(pattern=r'^[a-f0-9]{32}$')]
Text = Annotated[str, Field(min_length=1, max_length=40000)]


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Scene(BaseModel):
    model_config = ConfigDict(extra='ignore')
    visual: str = Field(max_length=1600)
    imagePrompt: str = Field(default='', max_length=3000)
    videoPrompt: str = Field(default='', max_length=3000)
    stockQuery: str = Field(default='', max_length=120)


class Block(BaseModel):
    model_config = ConfigDict(extra='ignore')
    index: int = Field(ge=0, le=5)
    label: str = Field(max_length=160)
    narration: Text
    scenes: list[Scene] = Field(min_length=1, max_length=8)

    @model_validator(mode='after')
    def spoken_text(self):
        if not self.narration.strip():
            raise ValueError('El bloque necesita texto de narración.')
        return self


class Packaging(BaseModel):
    model_config = ConfigDict(extra='ignore')
    title: str = Field(min_length=1, max_length=150)


class Production(BaseModel):
    model_config = ConfigDict(extra='ignore')
    format: Literal['yt-creator-production']
    version: Literal[1]
    topic: str = Field(min_length=1, max_length=200)
    packaging: Packaging
    blocks: list[Block] = Field(min_length=1, max_length=6)
    description: str = Field(default='', max_length=5000)
    pinnedComment: str = Field(default='', max_length=1500)
    checks: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode='after')
    def unique_blocks(self):
        if len({b.index for b in self.blocks}) != len(self.blocks):
            raise ValueError('Los índices de bloque deben ser únicos.')
        if sum(len(b.narration) for b in self.blocks) > 60000:
            raise ValueError('El guion supera el límite de 60.000 caracteres.')
        return self


class Options(Contract):
    aspect: Literal['landscape', 'portrait', 'square'] = 'landscape'
    resolution: Literal[720, 1080] = 720
    tts: Literal['edge', 'uploaded'] = 'edge'
    voice: str = Field(default='es-MX-DaliaNeural', pattern=r'^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+Neural$', max_length=80)
    subtitles: Literal['tts', 'estimated', 'whisper'] = 'tts'
    materials: Literal['own', 'cards', 'pexels', 'replicate'] = 'own'
    clip_seconds: float = Field(default=5, ge=3, le=8)
    max_generated: int = Field(default=4, ge=1, le=8)
    music_volume: float = Field(default=.08, ge=0, le=.3)
    notify: bool = False
    paid_generation_confirmed: bool = False


class JobRequest(Contract):
    production: Production
    options: Options = Field(default_factory=Options)
    asset_ids: list[AssetId] = Field(default_factory=list, max_length=60)
    scene_assets: dict[str, AssetId] = Field(default_factory=dict, max_length=48)
    audio_id: AssetId | None = None
    music_id: AssetId | None = None
    block_indexes: list[int] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def coherent(self):
        indexes = {b.index for b in self.production.blocks}
        if len(set(self.block_indexes)) != len(self.block_indexes) or any(i not in indexes for i in self.block_indexes):
            raise ValueError('Selección de bloques inválida.')
        count = sum(len(b.scenes) for b in self.production.blocks)
        if any(not k.isdigit() or not 0 <= int(k) < count for k in self.scene_assets):
            raise ValueError('Asignación de escena inválida.')
        if self.options.tts == 'uploaded' and not self.audio_id:
            raise ValueError('Selecciona un audio de narración.')
        if self.options.materials == 'own' and not (self.asset_ids or self.scene_assets):
            raise ValueError('Añade imágenes/videos propios o elige tarjetas gráficas.')
        if self.options.materials == 'own' and not self.asset_ids:
            offset = 0
            for block in self.production.blocks:
                if not self.block_indexes or block.index in self.block_indexes:
                    if any(str(i) not in self.scene_assets for i in range(offset, offset + len(block.scenes))):
                        raise ValueError('Asigna un recurso a cada escena o selecciona un conjunto de recursos propios.')
                offset += len(block.scenes)
        if self.options.materials == 'replicate' and not self.options.paid_generation_confirmed:
            raise ValueError('La generación de pago debe activarse explícitamente.')
        return self


class ClipRequest(Contract):
    start: float = Field(ge=0)
    end: float = Field(gt=0)
    aspect: Literal['portrait', 'landscape', 'square'] = 'portrait'
    resolution: Literal[720, 1080] = 720

    @model_validator(mode='after')
    def range(self):
        if not 1 <= self.end - self.start <= 180:
            raise ValueError('El recorte debe durar entre 1 y 180 segundos.')
        return self
