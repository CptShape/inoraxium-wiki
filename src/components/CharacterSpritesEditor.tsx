import { useEffect, useRef, useState } from 'react';
import { Check, Play, Trash2, Upload } from 'lucide-react';
import type { CharacterSprites, SpriteAnimation, SpriteSheet } from '../types/sprites';
import { defaultSpriteSheet, loadSpriteImage, resolveSpriteUrl, SPRITE_ANIMATIONS, SPRITE_LIMITS, verifySpriteSheet } from '../lib/characterSprites';
import { uploadImageToPixhost } from '../lib/pixhost';
import CharacterSprite from './demoGame/CharacterSprite';
import './characterSprites.css';

export default function CharacterSpritesEditor({ value, disabled, onChange }: { value?: CharacterSprites; disabled: boolean; onChange: (value: CharacterSprites) => void }) {
  const profile = value || { version: 1, preset: 'knight', clips: {} };
  const [animation, setAnimation] = useState<SpriteAnimation>('idle');
  const [drafts, setDrafts] = useState<Partial<Record<SpriteAnimation, SpriteSheet>>>({});
  const [preview, setPreview] = useState<CharacterSprites>();
  const [replay, setReplay] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      generation.current++;
      setDrafts({}); setPreview(undefined); setError(''); setNotice('');
    }
    emitted.current = value;
  }, [value]);
  const change = (next: CharacterSprites) => { emitted.current = next; onChange(next); };
  const sheet = drafts[animation] || profile.clips[animation] || defaultSpriteSheet();
  const update = (patch: Partial<SpriteSheet>) => { generation.current++; setDrafts(d => ({ ...d, [animation]: { ...sheet, ...patch } })); setError(''); setNotice(''); };
  const choose = (clip: SpriteAnimation) => { generation.current++; setAnimation(clip); setPreview(undefined); setError(''); setNotice(''); setReplay(n => n + 1); };
  const apply = async (save: boolean) => {
    const request = ++generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const normalized = { ...sheet, url: resolveSpriteUrl(sheet.url) };
      await verifySpriteSheet(normalized);
      if (generation.current !== request) return;
      const next = { ...profile, clips: { ...profile.clips, [animation]: normalized } };
      setPreview(next); setReplay(n => n + 1);
      if (save && !disabled) { change(next); setDrafts(d => ({ ...d, [animation]: normalized })); setNotice('Animation applied.'); }
    } catch (e) { if (generation.current === request) setError(e instanceof Error ? e.message : 'Sprite validation failed.'); }
    finally { setBusy(false); }
  };
  const upload = async (file: File) => {
    const request = ++generation.current;
    setBusy(true); setError('');
    try {
      if (!['image/png', 'image/webp'].includes(file.type) || file.size > SPRITE_LIMITS.uploadBytes) throw new Error('Choose a PNG/WebP file up to 8 MB.');
      const localUrl = URL.createObjectURL(file);
      try {
        const size = await loadSpriteImage(localUrl);
        if (size.width > 4096 || size.height > 4096) throw new Error('The sheet must not exceed 4096 x 4096 pixels.');
      } finally { URL.revokeObjectURL(localUrl); }
      const result = await uploadImageToPixhost(file, { preserveOriginal: true });
      if (generation.current === request) update({ url: resolveSpriteUrl(result.showUrl) });
    } catch (e) { if (generation.current === request) setError(e instanceof Error ? e.message : 'Upload failed.'); }
    finally { setBusy(false); }
  };
  const numeric = (label: string, key: Exclude<keyof SpriteSheet, 'url'>, min: number, max: number, step = 1) => <label>{label}<input type="number" min={min} max={max} step={step} value={sheet[key]} disabled={disabled || busy} onChange={e => update({ [key]: Number(e.target.value) })} /></label>;
  const shown = preview || profile;
  return <section className="character-sprites"><h3>Sprites</h3>
    <div className="cs-tabs" role="tablist" aria-label="Sprite animations">{SPRITE_ANIMATIONS.map(clip => <button type="button" role="tab" key={clip} aria-selected={animation === clip} aria-pressed={animation === clip} disabled={busy} onClick={() => choose(clip)}>{clip[0].toUpperCase() + clip.slice(1)}{profile.clips[clip] && <Check size={14} />}</button>)}</div>
    <div className="cs-layout"><div><svg className="cs-preview" viewBox="-100 -170 200 200" aria-label={`${animation} sprite preview`}><path d="M-85 6H85M0 -5V17" stroke="#526976" /><CharacterSprite key={`${animation}-${replay}`} preset={profile.preset} profile={shown} animation={animation} /></svg><div className="cs-actions"><button type="button" disabled={busy} onClick={() => setReplay(n => n + 1)} title="Replay animation" aria-label="Replay animation"><Play size={16} /></button><label>Default sprite<select disabled={disabled || busy} value={profile.preset} onChange={e => change({ ...profile, preset: e.target.value as CharacterSprites['preset'] })}><option value="knight">Knight</option><option value="mage">Mage</option><option value="monster">Monster</option></select></label></div></div>
      <div className="cs-fields"><label className="cs-url">Sprite sheet URL / Pixhost BBCode<input disabled={disabled || busy} value={sheet.url} onChange={e => update({ url: e.target.value })} placeholder="https://i.imgur.com/example.png" /></label>
        {numeric('Frame width (px)', 'frameWidth', 1, 256)}{numeric('Frame height (px)', 'frameHeight', 1, 256)}{numeric('Columns', 'columns', 1, 64)}{numeric('Frames', 'frames', 1, 64)}{numeric('FPS', 'fps', 1, 30)}{numeric('Anchor X', 'anchorX', 0, 1, .01)}{numeric('Anchor Y', 'anchorY', 0, 1, .01)}{numeric('Display height', 'displayHeight', 32, 160)}
        <div className="cs-actions cs-url"><button type="button" disabled={disabled || busy} onClick={() => fileInput.current?.click()}><Upload size={16} />Upload to Pixhost</button><button type="button" disabled={busy || !sheet.url} onClick={() => void apply(false)}><Play size={16} />Preview</button><button type="button" disabled={disabled || busy || !sheet.url} onClick={() => void apply(true)}><Check size={16} />Apply animation</button><button type="button" title="Use default animation" aria-label="Use default animation" disabled={disabled || busy || !profile.clips[animation]} onClick={() => { const clips = { ...profile.clips }; delete clips[animation]; const draftsCopy = { ...drafts }; delete draftsCopy[animation]; setDrafts(draftsCopy); setPreview(undefined); change({ ...profile, clips }); setNotice('Default animation selected.'); }}><Trash2 size={16} /></button></div>
        <input ref={fileInput} type="file" accept="image/png,image/webp" hidden disabled={disabled || busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
        {busy && <p className="cs-url" role="status">Checking sprite sheet...</p>}{error && <p className="cs-error cs-url" role="alert">{error}</p>}{notice && <p className="cs-success cs-url" role="status">{notice}</p>}
      </div></div>
    <div className="cs-specs"><strong>Sprite sheet standard</strong><p>Transparent PNG or lossless WebP. Recommended: 128 x 128 pixels per frame at 12 FPS. Maximum: 256 x 256 per frame, 4096 x 4096 per sheet, 64 frames, 30 FPS. File upload: up to 8 MB.</p><p>Frames run left to right, then top to bottom, without padding. All cells have equal dimensions. Anchor X/Y use 0-1 coordinates; 0.5 / 1 aligns the bottom center to the tile. Idle and Move loop; other clips play once. Downed holds its last frame.</p><p>Apply animation, then save the Character Sheet. Missing or unavailable clips use the default animation. Use the full-size image, not a thumbnail. Imgur album links are not supported here.</p></div>
  </section>;
}
