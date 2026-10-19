import { Box, RefreshCw } from 'lucide-react';
import { characterModelUrl, useCharacterModels } from '../lib/characterModels';
import CharacterModelViewer from './CharacterModelViewer';

export default function CharacterModelEditor({ value, disabled, name, onChange }: {
  value: string;
  disabled: boolean;
  name: string;
  onChange: (path: string) => void;
}) {
  const { models, loading, error, reload } = useCharacterModels();
  const selected = models.find(model => model.path === value);
  return <section className="rounded-2xl border border-amber-800/40 bg-stone-950/40 p-4 sm:p-6">
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-xl text-amber-200"><Box size={22} />3D Model</h3><p className="mt-2 text-sm text-stone-400">Choose a model for {name}. Save the character to apply your selection to Homebrew Overview.</p></div>
      <button type="button" onClick={reload} disabled={loading} className="flex items-center gap-2 rounded-lg border border-stone-600 px-3 py-2 text-sm text-stone-300 disabled:opacity-40"><RefreshCw size={14} />Refresh models</button>
    </div>
    <label className="block text-sm text-amber-100">Character 3D model
      <select aria-label="Character 3D model" value={value} disabled={disabled || loading || !!error} onChange={event => onChange(event.target.value)} className="mt-2 block w-full min-w-0 rounded-xl border border-amber-800/40 bg-stone-900 p-3 text-stone-100 disabled:opacity-50">
        <option value="">No 3D model</option>
        {value && !selected && <option value={value}>{value} (unavailable)</option>}
        {models.map(model => <option key={model.path} value={model.path}>{model.path} · {(model.bytes / 1024 / 1024).toFixed(1)} MB</option>)}
      </select>
    </label>
    {disabled && <p className="mt-2 text-sm text-stone-400">Only the character owner can change the model.</p>}
    {loading && <p className="mt-3 text-sm text-stone-400" role="status">Loading model library…</p>}
    {error && <p className="mt-3 text-sm text-rose-300" role="alert">{error}</p>}
    {!loading && !error && models.length === 0 && <div className="mt-4 rounded-xl border border-dashed border-amber-800/40 p-5 text-sm leading-6 text-stone-400">No models yet. Add GLB or FBX files such as <code className="text-amber-200">ayrton.glb</code> or <code className="text-amber-200">ayrton.fbx</code> to the repository’s <code className="text-amber-200">public/models/</code> folder. They appear here automatically after rebuilding the site.</div>}
    {/\.fbx$/i.test(value) && <p className="mt-3 text-sm text-stone-400">FBX models are prepared on first opening. Referenced textures must be embedded or placed beside the FBX file.</p>}
    {!loading && !error && value && !selected && <p className="mt-3 text-sm text-rose-300" role="alert">The selected file is no longer in the model library. Choose another model or clear the selection.</p>}
    {selected && !loading && !error && <div className="mt-5 overflow-hidden rounded-xl border border-amber-800/40"><CharacterModelViewer key={selected.path} src={characterModelUrl(selected.path)} name={name} /></div>}
  </section>;
}
