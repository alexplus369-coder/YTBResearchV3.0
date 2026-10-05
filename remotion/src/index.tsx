import React from 'react';
import { AbsoluteFill, Audio, Composition, Img, Loop, OffthreadVideo, Sequence, interpolate,
  registerRoot, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

type Word = {text: string; start: number; end: number};
type Scene = {startFrame: number; durationInFrames: number; kind: 'image' | 'video' | 'card'; src?: string; visual: string; mediaDuration?: number; sourceStartFrame?: number};
type Metric = {label: string; value: number; unit?: string};
type Music = {src: string; durationSeconds: number; volume: number};
type VideoProps = {width: number; height: number; fps: number; durationInFrames: number; audio?: string; music?: Music; scenes: Scene[]; words: Word[]; metrics?: Metric[]};

const localFile = (value: string) => {
  if (!value || /(^\/|\\|\.\.|:|[?#])/.test(value)) throw new Error('Usa rutas relativas dentro de public/.');
  return staticFile(value);
};

const validate = (props: VideoProps) => {
  for (const value of [props.width, props.height]) {
    if (!Number.isInteger(value) || value < 360 || value > 1920 || value % 2) throw new Error('Resolución inválida.');
  }
  if (![24, 25, 30, 60].includes(props.fps) || !Number.isInteger(props.durationInFrames) || props.durationInFrames < 1 || props.durationInFrames > props.fps * 1200) throw new Error('Duración o FPS inválidos.');
  if (!Array.isArray(props.scenes) || props.scenes.length < 1 || props.scenes.length > 800 || !Array.isArray(props.words) || props.words.length > 12000) throw new Error('Datos de escena/subtítulos inválidos.');
  if (props.audio) localFile(props.audio);
  if (props.music) {
    localFile(props.music.src);
    if (!Number.isFinite(props.music.durationSeconds) || props.music.durationSeconds <= 0 || props.music.durationSeconds > 1200 || !Number.isFinite(props.music.volume) || props.music.volume < 0 || props.music.volume > .3) throw new Error('Pista de música inválida.');
  }
  for (const scene of props.scenes) {
    if (!Number.isInteger(scene.startFrame) || !Number.isInteger(scene.durationInFrames) || scene.startFrame < 0 || scene.durationInFrames < 1 || scene.startFrame + scene.durationInFrames > props.durationInFrames || !['image', 'video', 'card'].includes(scene.kind)) throw new Error('Escena fuera de la línea de tiempo.');
    if (scene.kind !== 'card') localFile(scene.src || '');
    if (scene.kind === 'video' && (!Number.isFinite(scene.mediaDuration) || (scene.mediaDuration || 0) <= 0)) throw new Error('Falta la duración del recurso de video.');
    if (scene.sourceStartFrame !== undefined && (!Number.isInteger(scene.sourceStartFrame) || scene.sourceStartFrame < 0 || scene.sourceStartFrame >= (scene.mediaDuration || 0) * props.fps && scene.kind === 'video')) throw new Error('Inicio del recurso inválido.');
  }
  for (const word of props.words) if (typeof word.text !== 'string' || word.text.length > 400 || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start || word.end > props.durationInFrames / props.fps + .1) throw new Error('Marcas de tiempo inválidas.');
  if (props.metrics && (!Array.isArray(props.metrics) || props.metrics.length > 8 || props.metrics.some(m => typeof m.label !== 'string' || m.label.length > 100 || !Number.isFinite(m.value) || m.value < 0))) throw new Error('Métricas inválidas.');
  return props;
};

const SceneView: React.FC<{scene: Scene}> = ({scene}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  const cover: React.CSSProperties = {width: '100%', height: '100%', objectFit: 'cover'};
  if (scene.kind === 'video') return <Loop durationInFrames={Math.max(1, Math.floor((scene.mediaDuration || 1) * fps) - (scene.sourceStartFrame || 0))}><OffthreadVideo src={localFile(scene.src || '')} trimBefore={scene.sourceStartFrame || 0} muted style={cover}/></Loop>;
  if (scene.kind === 'image') return <Img src={localFile(scene.src || '')} style={{...cover, transform: `scale(${interpolate(frame, [0, scene.durationInFrames], [1, 1.05], {extrapolateRight: 'clamp'})})`}}/>;
  return <AbsoluteFill style={{justifyContent: 'center', padding: '10%', background: 'linear-gradient(145deg,#101827,#264660)', color: 'white', fontSize: 52, fontWeight: 800}}>{scene.visual}</AbsoluteFill>;
};

const Captions: React.FC<{words: Word[]}> = ({words}) => {
  const frame = useCurrentFrame(), {fps, height, width} = useVideoConfig();
  const time = frame / fps;
  // Match the backend's groups: five words or a pause longer than 0.6 seconds.
  const groups: Word[][] = [];
  for (const word of words) {
    const last = groups[groups.length - 1];
    if (!last || last.length >= 5 || word.start - last[last.length - 1].end > .6) groups.push([word]);
    else last.push(word);
  }
  const active = groups.find(g => time >= g[0].start && time < g[g.length - 1].end);
  if (!active) return null;
  return <div style={{position: 'absolute', bottom: height * (height > width ? .12 : .06), left: '5%', right: '5%', textAlign: 'center', fontSize: width > height ? 40 : 46, fontWeight: 800, textShadow: '0 2px 5px #000, 2px 0 3px #000', lineHeight: 1.3}}>
    {active.map((w, i) => <span key={i} style={{color: time >= w.start ? '#fde047' : 'white'}}>{w.text}{' '}</span>)}
  </div>;
};

const Metrics: React.FC<{metrics: Metric[]}> = ({metrics}) => {
  const frame = useCurrentFrame(), {fps} = useVideoConfig();
  if (!metrics.length) return null;
  const max = Math.max(1, ...metrics.map(m => m.value));
  const progress = interpolate(frame, [0, fps * 1.5], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return <div style={{position: 'absolute', top: '8%', left: '8%', right: '8%', background: '#101827ed', borderRadius: 24, padding: 32, color: 'white'}}>
    {metrics.map((m, i) => <div key={i} style={{marginBottom: 24}}><div style={{display: 'flex', justifyContent: 'space-between', fontSize: 28}}><span>{m.label}</span><strong>{m.value}{m.unit || ''}</strong></div><div style={{height: 14, background: '#334155', borderRadius: 8, marginTop: 10}}><div style={{height: '100%', width: `${m.value / max * progress * 100}%`, borderRadius: 8, background: '#34d399'}}/></div></div>)}
  </div>;
};

const Video: React.FC<VideoProps> = props => <AbsoluteFill style={{background: '#101827', fontFamily: 'DejaVu Sans, Arial, sans-serif'}}>
  {props.scenes.map((scene, i) => <Sequence key={i} from={scene.startFrame} durationInFrames={scene.durationInFrames}><SceneView scene={scene}/></Sequence>)}
  {props.audio ? <Audio src={localFile(props.audio)}/> : null}
  {props.music ? <Loop durationInFrames={Math.max(1, Math.floor(props.music.durationSeconds * props.fps))}><Audio src={localFile(props.music.src)} volume={props.music.volume}/></Loop> : null}
  <Metrics metrics={props.metrics || []}/><Captions words={props.words}/>
</AbsoluteFill>;

const defaults: VideoProps = {width: 720, height: 1280, fps: 24, durationInFrames: 240,
  scenes: [{startFrame: 0, durationInFrames: 240, kind: 'card', visual: 'Importa tu proyecto original desde la fábrica de videos.'}], words: []};
const Root: React.FC = () => <Composition id="StudioVideo" component={Video} defaultProps={defaults} width={defaults.width} height={defaults.height} fps={defaults.fps} durationInFrames={defaults.durationInFrames}
  calculateMetadata={({props}) => {const checked = validate(props); return {width: checked.width, height: checked.height, fps: checked.fps, durationInFrames: checked.durationInFrames, props: checked};}}/>;
registerRoot(Root);
