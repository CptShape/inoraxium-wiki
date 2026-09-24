import type { Command, Scene } from '../../lib/demoGame/types';

export default function ExpandSceneForm({ scene, busy, onExpand }: { scene: Scene; busy: boolean; onExpand: (command: Command) => Promise<void> }) {
  return <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void onExpand({ type: 'scene-expand', left: Number(f.get('left')), right: Number(f.get('right')), top: Number(f.get('top')), bottom: Number(f.get('bottom')), fill: f.has('fill') }); }}>
    <strong>{scene.name} / {scene.width} x {scene.height}</strong>
    <div className="dg-form-grid">{(['left', 'right', 'top', 'bottom'] as const).map(edge => <label key={edge}>Extra tiles: {edge}<input name={edge} type="number" min="0" max="100" required defaultValue={edge === 'right' ? 4 : 0} /></label>)}</div>
    <label className="dg-checkbox"><input name="fill" type="checkbox" />Fill new cells with floor</label>
    <div className="dg-dialog-actions"><button className="dg-primary" type="submit" disabled={busy}>Expand grid</button></div>
  </form>;
}
