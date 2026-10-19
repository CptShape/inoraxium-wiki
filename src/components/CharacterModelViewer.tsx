import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings, ZoomIn, ZoomOut } from 'lucide-react';
import type { ModelViewerElement } from '@google/model-viewer';
import './characterModelViewer.css';

interface Props {
  src: string;
  name: string;
}

const backgrounds = { studio: '#1c1917', parchment: '#d8c996', midnight: '#0c1526' };

export default function CharacterModelViewer({ src, name }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const viewer = useRef<ModelViewerElement | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [settings, setSettings] = useState(false);
  const [exposure, setExposure] = useState(1);
  const [shadow, setShadow] = useState(1);
  const [background, setBackground] = useState<keyof typeof backgrounds>('studio');
  const [environment, setEnvironment] = useState('neutral');
  const [animations, setAnimations] = useState<string[]>([]);
  const [animation, setAnimation] = useState('');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState('');

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const isFbx = /\.fbx(?:[?#]|$)/i.test(src);
    let preparedUrl: string | undefined;
    let element: ModelViewerElement | undefined;
    setStatus('loading');
    setLoadError('');
    setProgress(0);
    setAnimations([]);
    setAnimation('');
    setPlaying(false);
    const load = () => {
      if (disposed || !element) return;
      setAnimations([...element.availableAnimations]);
      setAnimation(element.availableAnimations[0] || '');
      setStatus('ready');
    };
    const error = () => { if (!disposed) setStatus('error'); };
    const updateProgress = (event: Event) => {
      const fraction = (event as CustomEvent<{ totalProgress: number }>).detail.totalProgress;
      if (!disposed) setProgress(Math.round(isFbx ? 75 + fraction * 25 : fraction * 100));
    };
    // Keep the WebGL renderer and its dependencies out of the initial page bundle.
    const requestSrc = attempt ? `${src}${src.includes('?') ? '&' : '?'}viewer-retry=${attempt}` : src;
    const prepareSource = async () => {
      if (!isFbx) return requestSrc;
      const { prepareFbxModel } = await import('../lib/fbxModel');
      controller.signal.throwIfAborted();
      const blob = await prepareFbxModel(requestSrc, controller.signal, value => { if (!disposed) setProgress(value); });
      controller.signal.throwIfAborted();
      preparedUrl = URL.createObjectURL(blob);
      return preparedUrl;
    };
    Promise.all([import('@google/model-viewer'), prepareSource()]).then(([, modelSrc]) => {
      if (disposed || !stage.current) return;
      element = document.createElement('model-viewer') as ModelViewerElement;
      element.setAttribute('alt', `Interactive 3D model of ${name}`);
      element.setAttribute('camera-controls', '');
      element.setAttribute('touch-action', 'pan-y');
      element.setAttribute('interaction-prompt', 'none');
      element.setAttribute('loading', 'eager');
      element.setAttribute('min-camera-orbit', 'auto 0deg 10%');
      element.setAttribute('max-camera-orbit', 'auto 180deg 300%');
      element.setAttribute('shadow-intensity', '1');
      element.setAttribute('shadow-softness', '0.8');
      element.setAttribute('environment-image', 'neutral');
      element.addEventListener('load', load);
      element.addEventListener('error', error);
      element.addEventListener('progress', updateProgress);
      viewer.current = element;
      stage.current.appendChild(element);
      // Failed loads are cached by model-viewer; a fresh URL makes Retry fetch again.
      element.src = modelSrc;
    }).catch(reason => {
      if (disposed) return;
      if (isFbx) setLoadError(reason instanceof Error && reason.message.startsWith('FBX textures') ? reason.message : 'This FBX could not be prepared. Use FBX 7.x or newer and include any referenced textures.');
      error();
    });
    return () => {
      disposed = true;
      controller.abort();
      if (element) {
        element.pause();
        element.removeEventListener('load', load);
        element.removeEventListener('error', error);
        element.removeEventListener('progress', updateProgress);
        element.remove();
      }
      viewer.current = null;
      if (preparedUrl) URL.revokeObjectURL(preparedUrl);
    };
  }, [src, name, attempt]);

  useEffect(() => {
    const element = viewer.current;
    if (!element || status !== 'ready') return;
    element.autoRotate = autoRotate;
    element.exposure = exposure;
    element.shadowIntensity = shadow;
    element.environmentImage = environment;
    element.animationName = animation || undefined;
    element.timeScale = speed;
    if (playing) element.play();
    else element.pause();
  }, [status, autoRotate, exposure, shadow, environment, animation, playing, speed]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const resetCamera = () => {
    const element = viewer.current;
    if (!element) return;
    setAutoRotate(false);
    element.resetTurntableRotation();
    element.cameraTarget = 'auto auto auto';
    element.cameraOrbit = '0deg 75deg 105%';
    element.fieldOfView = 'auto';
  };
  const preset = (angle: string) => {
    resetCamera();
    if (viewer.current) viewer.current.cameraOrbit = `${angle} 105%`;
  };
  const toggleFullscreen = async () => {
    setFullscreenError('');
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen();
      else await container.current?.requestFullscreen();
    } catch { setFullscreenError('Fullscreen is unavailable in this browser.'); }
  };
  const ready = status === 'ready';

  return (
    <div ref={container} className="character-model-viewer" style={{ backgroundColor: backgrounds[background] }} aria-label={`${name} 3D viewer`}>
      <div className="cmv-toolbar">
        <div className="cmv-title"><span className="cmv-live" />3D VIEWER</div>
        <div className="cmv-tools">
          <button type="button" disabled={!ready} onClick={() => viewer.current?.zoom(1)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={18} /></button>
          <button type="button" disabled={!ready} onClick={() => viewer.current?.zoom(-1)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={18} /></button>
          <button type="button" disabled={!ready} onClick={resetCamera} aria-label="Reset camera" title="Reset camera"><RotateCcw size={18} /></button>
          <button type="button" disabled={!ready} onClick={() => setAutoRotate(value => !value)} aria-label="Auto rotate" aria-pressed={autoRotate} title="Auto rotate"><RotateCw size={18} /></button>
          <button type="button" disabled={!ready} onClick={() => setSettings(value => !value)} aria-label="Viewer settings" aria-expanded={settings} title="Viewer settings"><Settings size={18} /></button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>{fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
        </div>
      </div>
      <div className="cmv-stage" ref={stage} aria-busy={status === 'loading'} />
      {status === 'loading' && <div className="cmv-message" role="status"><div className="cmv-spinner" /><strong>Loading 3D model… {progress}%</strong><span>{/\.fbx(?:[?#]|$)/i.test(src) ? 'Preparing FBX geometry, textures and animations' : 'Preparing geometry, textures and lighting'}</span></div>}
      {status === 'error' && <div className="cmv-message" role="alert"><strong>The 3D model could not be loaded.</strong><span>{loadError || 'The file may be missing or invalid, or WebGL may be unavailable.'}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
      {ready && <div className="cmv-presets" role="group" aria-label="Camera views">{[
        ['Front', '0deg 90deg'], ['Back', '180deg 90deg'], ['Left', '-90deg 90deg'], ['Right', '90deg 90deg'], ['Top', '0deg 0deg'],
      ].map(([label, angle]) => <button type="button" key={label} onClick={() => preset(angle)}>{label}</button>)}</div>}
      {settings && ready && <div className="cmv-settings">
        <label>Lighting<select aria-label="Lighting" value={environment} onChange={event => setEnvironment(event.target.value)}><option value="neutral">Neutral studio</option><option value="legacy">Warm studio</option></select></label>
        <label>Exposure <output>{exposure.toFixed(1)}</output><input aria-label="Exposure" type="range" min="0.2" max="2.5" step="0.1" value={exposure} onChange={event => setExposure(Number(event.target.value))} /></label>
        <label>Shadow <output>{shadow.toFixed(1)}</output><input aria-label="Shadow" type="range" min="0" max="2" step="0.1" value={shadow} onChange={event => setShadow(Number(event.target.value))} /></label>
        <label>Background<select aria-label="Background" value={background} onChange={event => setBackground(event.target.value as keyof typeof backgrounds)}><option value="studio">Studio</option><option value="parchment">Parchment</option><option value="midnight">Midnight</option></select></label>
      </div>}
      {ready && animations.length > 0 && <div className="cmv-animation">
        <button type="button" aria-label={playing ? 'Pause animation' : 'Play animation'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <label className="cmv-animation-select">Animation<select aria-label="Animation" value={animation} onChange={event => { setAnimation(event.target.value); if (viewer.current) viewer.current.currentTime = 0; }}>{animations.map(clip => <option key={clip} value={clip}>{clip}</option>)}</select></label>
        <label>Speed<select aria-label="Speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[0.25, 0.5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
      </div>}
      <div className="cmv-footer"><span>Drag to orbit · Scroll / pinch to zoom · Right-drag / two fingers to pan · Arrow keys to rotate</span>{fullscreenError && <span role="status">{fullscreenError}</span>}</div>
    </div>
  );
}
