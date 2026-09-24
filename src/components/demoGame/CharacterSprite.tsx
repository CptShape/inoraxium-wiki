import { useEffect, useState } from 'react';
import { SPRITES, spriteFrame } from '../../lib/demoGame/sprites';
import type { SpritePreset } from '../../lib/demoGame/types';
import type { CharacterSprites, SpriteAnimation } from '../../types/sprites';
import { verifySpriteSheet } from '../../lib/characterSprites';
import '../characterSprites.css';

export default function CharacterSprite({ preset, moving = false, facing = 1, inactive = false, profile, animation }: { preset: SpritePreset; moving?: boolean; facing?: number; inactive?: boolean; profile?: CharacterSprites; animation?: SpriteAnimation }) {
  const state: SpriteAnimation = animation || (inactive ? 'downed' : moving ? 'move' : 'idle');
  const clip = profile?.clips?.[state];
  const signature = clip ? JSON.stringify(clip) : '';
  const [verified, setVerified] = useState('');
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setVerified('');
    if (clip) void verifySpriteSheet(clip).then(() => { if (!cancelled) setVerified(signature); }).catch(() => { /* Fall back to the preset without hiding the character. */ });
    return () => { cancelled = true; };
  }, [signature]);
  useEffect(() => {
    setFrame(0);
    if (!clip || verified !== signature || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const looping = state === 'idle' || state === 'move';
    const started = performance.now();
    const timer = window.setInterval(() => {
      const index = Math.floor((performance.now() - started) * clip.fps / 1000);
      setFrame(looping ? index % clip.frames : Math.min(clip.frames - 1, index));
      if (!looping && index >= clip.frames - 1) clearInterval(timer);
    }, 1000 / clip.fps);
    return () => clearInterval(timer);
  }, [verified, signature, state]);
  useEffect(() => {
    for (const animation of ['idle', 'run'] as const) for (let frame = 0; frame < 4; frame++) {
      const image = new Image(); image.src = spriteFrame(preset, animation, frame);
    }
  }, [preset]);
  const sprite = SPRITES[preset], scale = preset === 'monster' ? 2.5 : 3;
  const width = sprite.width * scale, height = sprite.height * scale;
  if (clip && verified === signature) {
    const scale = Math.min(clip.displayHeight / clip.frameHeight, 160 / clip.frameWidth);
    const w = clip.frameWidth * scale, h = clip.frameHeight * scale;
    const index = Math.min(frame, clip.frames - 1);
    return <g className="dg-sprite character-sprite is-custom" data-sprite="custom" data-animation={state === 'move' ? 'run' : state} data-frame={index} transform={`scale(${facing} 1)`} pointerEvents="none">
      <svg x={-w * clip.anchorX} y={5 - h * clip.anchorY} width={w} height={h} viewBox={`${index % clip.columns * clip.frameWidth} ${Math.floor(index / clip.columns) * clip.frameHeight} ${clip.frameWidth} ${clip.frameHeight}`} overflow="hidden">
        <image href={clip.url} width={clip.columns * clip.frameWidth} height={Math.ceil(clip.frames / clip.columns) * clip.frameHeight} onError={() => setVerified('')} />
      </svg>
    </g>;
  }
  return <g className={`dg-sprite character-sprite ${moving ? 'is-moving' : 'is-idle'} ${inactive ? 'is-inactive' : ''}`} data-sprite={preset} data-animation={state === 'move' ? 'run' : state} transform={`scale(${facing} 1)`} pointerEvents="none"><g className="sprite-pose" key={state}>
    {[0, 1, 2, 3].map(frame => <image key={`${moving}-${frame}`} className={`dg-sprite-frame dg-frame-${frame}`} href={spriteFrame(preset, moving ? 'run' : 'idle', frame)}
      x={-width / 2} y={-height + 5} width={width} height={height} preserveAspectRatio="xMidYMax meet" />)}
    {state === 'attack' && <path className="sprite-strike" d="M12 -76 Q75 -57 16 -18" fill="none" stroke="#fff1a8" strokeWidth="4" />}
    {state === 'cast' && <path className="sprite-strike" d="M-25 -72 L-33 -85 M24 -66 L35 -78 M0 -80 L0 -95" fill="none" stroke="#a2e7ef" strokeWidth="3" />}
  </g></g>;
}
