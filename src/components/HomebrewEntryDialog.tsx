import { useEffect, useRef, useState } from 'react';
import { Package, Shield, Sparkles, SlidersHorizontal, Plus, Trash2 } from 'lucide-react';
import type { CharacterData, CharacterBar, CustomAttribute, SkillAttribute } from '../types/character';
import { saveHomebrewEntry } from '../lib/firestore';
import { canControlHomebrew, type HomebrewEntry, type HomebrewEntryField, type HomebrewObject, type HomebrewObjectKind } from '../lib/homebrewEntries';
import { publishHomebrewSave } from '../lib/homebrewSaveFeedback';
import AssetCreatorPage from './AssetCreatorPage';
import { HomebrewDialog } from './HomebrewDialog';

const attributeSections: Array<[HomebrewEntryField, string]> = [['mainAttributes', 'Main Attribute'], ['secondaryAttributes', 'Secondary Attribute'], ['otherAttributes', 'Other Attribute'], ['skills', 'Skill'], ['resistances', 'Resistance'], ['bars', 'Bar']];
interface Props { character: CharacterData; userId: string | null; original?: HomebrewObject; field?: HomebrewEntryField; onUpdated: (character: CharacterData) => void; onClose: () => void }

export function HomebrewEntryDialog({ character, userId, original, field: initialField, onUpdated, onClose }: Props) {
  const [base] = useState(() => original ? structuredClone(original) : undefined);
  const [kind, setKind] = useState<HomebrewObjectKind | 'attribute' | null>(base ? initialField === 'spells' ? 'spell' : initialField === 'statuses' ? 'status' : 'item' : null);
  const [field, setField] = useState<HomebrewEntryField>(initialField || 'inventory');
  const [folderId, setFolderId] = useState(base && 'folderId' in base ? base.folderId || '' : '');
  const [imageUrl, setImageUrl] = useState(base && 'homebrewImageUrl' in base ? base.homebrewImageUrl || '' : '');
  const [hidden, setHidden] = useState(base?.hidden || false);
  const [active, setActive] = useState(base && 'active' in base ? base.active !== false : true);
  const [school, setSchool] = useState(base && 'magicSchool' in base ? base.magicSchool : '');
  const [attribute, setAttribute] = useState<SkillAttribute>({ id: '', name: '', value: '0', calculationType: 'sum' });
  const [bar, setBar] = useState<CharacterBar>({ id: '', name: '', currentValue: '0', maxValue: '0', resetValue: '0', mode: 'default', resetTrigger: 'short-rest', color: '#248bb1', useDefaultOverflowColor: true, overflowColor: '#a673cf' });
  const [busy, setBusy] = useState(false), locked = useRef(false);
  const [error, setError] = useState(''), [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  const choose = (next: typeof kind) => { setKind(next); setField(next === 'spell' ? 'spells' : next === 'status' ? 'statuses' : next === 'attribute' ? 'otherAttributes' : 'inventory'); };
  const close = () => { if (!locked.current) dirty ? setDiscard(true) : onClose(); };
  const folders = field === 'inventory' ? character.inventoryFolders : field === 'spells' ? character.spellFolders : field === 'statuses' ? character.statusFolders : [];
  const save = async (draft: HomebrewEntry) => {
    if (locked.current) return;
    setError('');
    if (!canControlHomebrew(character, userId)) { setError('Control permission required.'); return; }
    let entry: HomebrewEntry = { ...draft, name: draft.name.trim() };
    if (kind === 'attribute') {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(entry.id)) { setError('Use an ID starting with a letter, followed by letters, numbers, underscores or hyphens.'); return; }
    } else {
      entry = { ...entry, hidden, ...(field !== 'generalItems' ? { folderId: folderId || null } : {}), ...(kind !== 'status' ? { homebrewImageUrl: imageUrl.trim(), homebrewImageThumbUrl: imageUrl.trim() !== (base && 'homebrewImageUrl' in base ? base.homebrewImageUrl || '' : '') ? '' : base && 'homebrewImageThumbUrl' in base ? base.homebrewImageThumbUrl : undefined } : { active }), ...(kind === 'spell' ? { magicSchool: school } : {}) };
    }
    if (!entry.name) { setError('Enter a name.'); return; }
    locked.current = true; setBusy(true);
    try {
      const next = await saveHomebrewEntry(character.id, userId, field, entry, base);
      publishHomebrewSave(next, onUpdated);
      onClose();
      if (!base) {
        const id = encodeURIComponent(character.id);
        window.location.hash = kind === 'attribute' ? `homebrew-character-sheet/${id}/attributes` : `homebrew-library/${field === 'spells' ? 'spells' : field === 'statuses' ? 'statuses' : 'inventory'}/${id}/${field === 'generalItems' ? 'general-item' : field === 'inventory' ? 'inventory-item' : kind}/${encodeURIComponent(entry.id)}`;
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed. Nothing was saved.'); }
    finally { locked.current = false; setBusy(false); }
  };
  const valueInput = (label: string, key: 'id' | 'name' | 'value') => <label>{label}<input value={attribute[key]} onChange={e => setAttribute({ ...attribute, [key]: e.target.value })} required /></label>;
  const barInput = (label: string, key: 'id' | 'name' | 'currentValue' | 'maxValue' | 'resetValue') => <label>{label}<input value={bar[key] || ''} onChange={e => setBar({ ...bar, [key]: e.target.value })} required /></label>;
  return <HomebrewDialog title={base ? `Edit ${base.name}` : kind ? `Add ${kind === 'attribute' ? 'Attribute' : kind[0].toUpperCase() + kind.slice(1)}` : 'Add'} onClose={close} busy={busy}>
    {error && <p ref={errorRef} role="alert" className="hb-error">{error}</p>}
    {discard && <div role="alert" className="mb-4"><p>Discard unsaved changes?</p><div className="flex flex-wrap gap-2 mt-3"><button className="hb-secondary" onClick={() => setDiscard(false)}>Keep editing</button><button className="hb-confirm" onClick={onClose}>Discard</button></div></div>}
    {!kind ? <div className="hb-kind-list">{([{ id: 'item', label: 'Item', icon: Package }, { id: 'spell', label: 'Spell', icon: Sparkles }, { id: 'status', label: 'Status', icon: Shield }, { id: 'attribute', label: 'Attribute', icon: SlidersHorizontal }] as const).map(option => <button type="button" key={option.id} onClick={() => choose(option.id)}><option.icon size={26} />{option.label}</button>)}</div> : <div onChangeCapture={() => setDirty(true)} onClickCapture={e => { if ((e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('.hb-confirm-row')) setDirty(true); }}>
      <fieldset disabled={busy} className="border-0 p-0 m-0"><div className="hb-form-grid">
        {kind === 'item' && <label>Item type<select disabled={Boolean(base)} value={field} onChange={e => { setField(e.target.value as HomebrewEntryField); setFolderId(''); }}><option value="inventory">Equipment</option><option value="generalItems">General Item</option></select></label>}
        {kind !== 'attribute' && field !== 'generalItems' && <label>Folder<select value={folderId} onChange={e => setFolderId(e.target.value)}><option value="">Unfoldered</option>{(folders || []).map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}{folderId && !folders?.some(f => f.id === folderId) && <option value={folderId}>Missing folder</option>}</select></label>}
        {kind !== 'attribute' && kind !== 'status' && <label>Image URL<input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://..." /></label>}
        {kind === 'spell' && <label>Magic School<input value={school} onChange={e => setSchool(e.target.value)} /></label>}
        {kind === 'status' && <label className="hb-checkbox"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />Active</label>}
        {kind !== 'attribute' && <label className="hb-checkbox"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} />Hidden</label>}
      </div></fieldset>
      {kind !== 'attribute' ? <AssetCreatorPage embedded={{ kind, initialEntry: base, character, busy, onConfirm: entry => void save(entry) }} /> : <form onSubmit={e => { e.preventDefault(); void save(field === 'bars' ? bar : attribute); }}><fieldset disabled={busy} className="border-0 p-0 m-0">
        <div className="hb-form-grid"><label>Attribute type<select value={field} onChange={e => { setField(e.target.value as HomebrewEntryField); setAttribute(a => ({ ...a, value: e.target.value === 'mainAttributes' ? '10' : '0' })); }}>{attributeSections.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
        {field === 'bars' ? <>{barInput('Name', 'name')}{barInput('ID', 'id')}<label>Mode<select value={bar.mode} onChange={e => setBar({ ...bar, mode: e.target.value as CharacterBar['mode'] })}><option value="default">Default</option><option value="resource">Resource</option></select></label>{barInput('Current value', 'currentValue')}{barInput(bar.mode === 'resource' ? 'Reset value' : 'Max value', bar.mode === 'resource' ? 'resetValue' : 'maxValue')}
          {bar.mode === 'resource' && <label>Replenish on<select value={bar.resetTrigger} onChange={e => setBar({ ...bar, resetTrigger: e.target.value as CharacterBar['resetTrigger'] })}><option value="short-rest">Short Rest</option><option value="long-rest">Long Rest</option><option value="turn-end">End Turn</option><option value="battle-end">End Battle</option></select></label>}
          <label>Color<input type="color" value={bar.color} onChange={e => setBar({ ...bar, color: e.target.value })} /></label><label className="hb-checkbox"><input type="checkbox" checked={bar.useDefaultOverflowColor} onChange={e => setBar({ ...bar, useDefaultOverflowColor: e.target.checked })} />Use default overflow color</label>{!bar.useDefaultOverflowColor && <label>Overflow color<input type="color" value={bar.overflowColor} onChange={e => setBar({ ...bar, overflowColor: e.target.value })} /></label>}</> : <>{valueInput('Name', 'name')}{valueInput('ID', 'id')}{valueInput('Value / formula', 'value')}<label>Calculation<select value={attribute.calculationType} onChange={e => setAttribute({ ...attribute, calculationType: e.target.value as CustomAttribute['calculationType'] })}><option value="sum">Sum</option><option value="override-highest">Highest override</option><option value="override-lowest">Lowest override</option></select></label>
          {field === 'skills' && <><label>Linked main attribute<select value={attribute.linkedMainAttributeId || ''} onChange={e => setAttribute({ ...attribute, linkedMainAttributeId: e.target.value })}><option value="">None</option>{(character.mainAttributes || []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Proficiency<select value={attribute.proficiencyMode || 'none'} onChange={e => setAttribute({ ...attribute, proficiencyMode: e.target.value as SkillAttribute['proficiencyMode'] })}>{['none', 'half', 'proficient', 'expertise'].map(mode => <option key={mode} value={mode}>{mode}</option>)}</select></label></>}
        </>}
        <label className="hb-checkbox"><input type="checkbox" checked={field === 'bars' ? bar.favorite || false : attribute.favorite || false} onChange={e => field === 'bars' ? setBar({ ...bar, favorite: e.target.checked }) : setAttribute({ ...attribute, favorite: e.target.checked })} />Favorite</label></div>
        {field !== 'bars' && <section><h3>Value options</h3>{(attribute.valueOptions || []).map((option, index) => <div className="hb-form-grid" key={index}><label>Value<input value={option.value} onChange={e => setAttribute({ ...attribute, valueOptions: attribute.valueOptions!.map((o, i) => i === index ? { ...o, value: e.target.value } : o) })} /></label><label>Label<input value={option.label} onChange={e => setAttribute({ ...attribute, valueOptions: attribute.valueOptions!.map((o, i) => i === index ? { ...o, label: e.target.value } : o) })} /></label><button type="button" className="hb-icon" title="Remove value option" aria-label="Remove value option" onClick={() => setAttribute({ ...attribute, valueOptions: attribute.valueOptions!.filter((_, i) => i !== index) })}><Trash2 size={16} /></button></div>)}<button type="button" className="hb-secondary" onClick={() => setAttribute({ ...attribute, valueOptions: [...attribute.valueOptions || [], { value: '', label: '' }] })}><Plus size={16} />Add option</button></section>}
        <div className="hb-confirm-row"><button className="hb-confirm" type="submit">{busy ? 'Saving...' : 'Confirm'}</button></div>
      </fieldset></form>}
    </div>}
  </HomebrewDialog>;
}
