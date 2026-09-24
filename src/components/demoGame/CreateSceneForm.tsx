import { useState } from 'react';
import type { Command, Scene } from '../../lib/demoGame/types';

export default function CreateSceneForm({ scene, busy, onCreate }: { scene: Scene; busy: boolean; onCreate: (command: Command) => Promise<void> }) {
  const [copy, setCopy] = useState(false);
  return <form onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void onCreate({ type: 'scene-create', name: String(form.get('name') || ''), width: copy ? scene.width : Number(form.get('width')), height: copy ? scene.height : Number(form.get('height')), copyCurrent: copy });
  }}>
    <label>Name<input name="name" maxLength={80} autoFocus required /></label>
    <label>Layout<select aria-label="Layout" value={copy ? 'copy' : 'blank'} onChange={event => setCopy(event.target.value === 'copy')}><option value="blank">Empty map</option><option value="copy">Copy {scene.name}</option></select></label>
    <div className="dg-form-grid"><label>Initial floor columns<input name="width" type="number" min="6" max="100" step="1" required defaultValue={Math.min(100, scene.width)} disabled={copy} /></label><label>Initial floor rows<input name="height" type="number" min="6" max="100" step="1" required defaultValue={Math.min(100, scene.height)} disabled={copy} /></label></div>
    <div className="dg-dialog-actions"><button type="submit" className="dg-primary" disabled={busy}>Create scene</button></div>
  </form>;
}
