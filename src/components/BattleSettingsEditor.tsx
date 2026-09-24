import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ClipboardPaste, Copy, Dices, Plus, Shield, Swords, Trash2 } from 'lucide-react';
import type { CharacterAction, CharacterBar, StatusEffect } from '../types/character';
import type { BattleOperation, BattleSettings } from '../types/battle';
import { battleCosts, defaultBattleSettings, newBattleCheck, newBattleCost, newBattleOperation } from '../lib/battleSettings';
import { importBattleStatus } from '../lib/battleStatusImport';
import './battleSettings.css';

interface Props { action: CharacterAction; bars?: CharacterBar[]; disabled?: boolean; expanded?: boolean; onChange: (settings: BattleSettings, effects?: StatusEffect[]) => void; onImportStatus?: (onAdd: (effect: StatusEffect) => void) => Promise<void> }
export default function BattleSettingsEditor({ action, bars, disabled = false, expanded, onChange, onImportStatus = importBattleStatus }: Props) {
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const s = { ...(action.battleSettings || { ...defaultBattleSettings(), enabled: false }), afterChecks: action.battleSettings?.afterChecks || [] };
  const costs = battleCosts(s);
  const patch = (value: Partial<BattleSettings>) => onChange({ ...s, ...value });
  const barPicker = (id: string, update: (id: string) => void) => bars ? <select value={id} onChange={e => update(e.target.value)}><option value="">Select a bar</option>{bars.map(bar => <option key={bar.id} value={bar.id}>{bar.name} ({bar.id})</option>)}{id && !bars.some(b => b.id === id) && <option value={id}>Missing bar ({id})</option>}</select> : <input value={id} onChange={e => update(e.target.value)} placeholder="bar_mana" />;
  const importStatus = async (branch: 'landed' | 'resisted' | 'afterChecks', operationId: string) => {
    setImportError(''); setImporting(true);
    try {
      await onImportStatus(effect => onChange({ ...s, [branch]: s[branch].map(op => op.id === operationId ? { ...op, effectId: effect.id! } : op) }, [...action.effects || [], effect]));
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Status import failed.'); }
    finally { setImporting(false); }
  };
  const field = (label: string, key: 'range' | 'actorFormula' | 'targetFormula' | 'amountFormula' | 'maxTargets' | 'availability' | 'unavailableReason', placeholder: string, title?: string) => <label>{label}<input value={s[key] ?? ''} onChange={e => patch({ [key]: e.target.value })} placeholder={placeholder} title={title} spellCheck={false} /></label>;
  const reorder = <T,>(list: T[], index: number, delta: number) => {
    const next = [...list]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next;
  };
  const outcome = (branch: 'landed' | 'resisted' | 'afterChecks', title: string) => {
    const update = (id: string, value: Partial<BattleOperation>) => patch({ [branch]: s[branch].map(op => op.id === id ? { ...op, ...value } : op) });
    return <section className="bs-outcome"><header><h4>{title}</h4><button type="button" title={`Add ${title.toLowerCase()} step`} onClick={() => patch({ [branch]: [...s[branch], newBattleOperation()] })} disabled={s[branch].length >= 24}><Plus size={15} />Add step</button></header>
      {s[branch].length === 0 && <span className="bs-empty">No effect</span>}
      {s[branch].map((op, index) => <div className="bs-step" key={op.id}>
        <span className="bs-step-number">{index + 1}</span>
        <label>Operation<select value={op.kind} onChange={e => update(op.id, { kind: e.target.value as BattleOperation['kind'], ...(['push', 'pull', 'teleport'].includes(e.target.value) ? { formula: '2', frequency: 'per-target' as const } : {}) })}><option value="damage">Damage HP</option><option value="healing">Restore HP</option><option value="bar">Bar update</option><option value="effect">Attached effect</option><option value="push">Push</option><option value="pull">Pull</option><option value="teleport">Teleport</option></select></label>
        <label>Recipient<select value={op.recipient} title="Choose who receives this step." onChange={e => update(op.id, { recipient: e.target.value as BattleOperation['recipient'], frequency: 'per-target' })}><option value="target">Affected target</option><option value="actor">Acting character</option></select></label>
        {op.recipient === 'actor' && <label>Frequency<select value={op.frequency || 'per-target'} onChange={e => update(op.id, { frequency: e.target.value as BattleOperation['frequency'] })}><option value="per-target">Per target</option><option value="once" disabled={op.kind === 'push' || op.kind === 'pull'}>Once per action</option></select></label>}
        <label>Step condition<input value={op.condition || ''} placeholder="1" onChange={e => update(op.id, { condition: e.target.value })} title="0 skips this step. Once-per-action steps use caster values and final counters, without a target context." /></label>
        {op.kind === 'effect' ? <div className="bs-effect-picker bs-grow"><label className="bs-grow">Action effect<select value={op.effectId} onChange={e => update(op.id, { effectId: e.target.value })}><option value="">Select an action effect</option>{(action.effects || []).filter(e => e.effectType && e.effectType !== 'attribute').map(e => <option key={e.id} value={e.id}>{e.effectType === 'status' ? `Status: ${e.statusName || e.statusEntry?.name || e.id}` : `${e.effectType}: ${e.targetLabel || e.targetId}`}</option>)}{op.effectId && !action.effects?.some(e => e.id === op.effectId) && <option value={op.effectId}>Missing effect ({op.effectId})</option>}</select></label><button type="button" onClick={() => void importStatus(branch, op.id)} title="Import status JSON from clipboard or file"><ClipboardPaste size={15} />Import Status</button></div> : <>
          {op.kind === 'bar' && <label>Bar{barPicker(op.barId, barId => update(op.id, { barId }))}</label>}
          <label className="bs-grow">{['push', 'pull', 'teleport'].includes(op.kind) ? 'Distance (tiles)' : op.kind === 'bar' ? 'Delta formula' : 'Amount formula'}<input value={op.formula} onChange={e => update(op.id, { formula: e.target.value })} title="@roll.amount, @roll.actor, @roll.target, @roll.margin; @actor.id, @target.id; @@local_id" placeholder="rounddown(@roll.amount / 2)" spellCheck={false} /></label>
          {['bar', 'healing'].includes(op.kind) && <label className="bs-check"><input type="checkbox" checked={op.canOverflow} onChange={e => update(op.id, { canOverflow: e.target.checked })} />Can overflow</label>}
        </>}
        <button type="button" className="bs-icon" title="Move step up" aria-label="Move step up" disabled={!index} onClick={() => patch({ [branch]: reorder(s[branch], index, -1) })}><ArrowUp size={16} /></button>
        <button type="button" className="bs-icon" title="Move step down" aria-label="Move step down" disabled={index === s[branch].length - 1} onClick={() => patch({ [branch]: reorder(s[branch], index, 1) })}><ArrowDown size={16} /></button>
        <button type="button" className="bs-icon" title="Duplicate step" aria-label="Duplicate step" disabled={s[branch].length >= 24} onClick={() => patch({ [branch]: [...s[branch].slice(0, index + 1), { ...op, id: crypto.randomUUID() }, ...s[branch].slice(index + 1)] })}><Copy size={16} /></button>
        <button type="button" className="bs-icon bs-remove" title="Remove outcome step" aria-label="Remove outcome step" onClick={() => patch({ [branch]: s[branch].filter(v => v.id !== op.id) })}><Trash2 size={16} /></button>
      </div>)}
    </section>;
  };
  return <details className="bs-editor" open={expanded || undefined}><summary><Swords size={16} />Battle Settings<span>{s.enabled ? 'Enabled' : 'Not configured'}</span></summary>
    <fieldset disabled={disabled || importing}>
      {importError && <p role="alert" className="bs-error">{importError}</p>}
      <label className="bs-check bs-enable"><input type="checkbox" checked={s.enabled} onChange={e => onChange(action.battleSettings ? { ...s, enabled: e.target.checked } : { ...defaultBattleSettings(), enabled: e.target.checked, landed: (action.effects || []).filter(effect => effect.id && effect.active !== false && effect.effectType && effect.effectType !== 'attribute').map(effect => ({ ...newBattleOperation('effect'), effectId: effect.id! })) })} />Use battle settings</label>
      {s.enabled && <>
        <section><h4>Target & Area</h4><div className="bs-fields">
          <label>Aim at<select value={s.target} onChange={e => patch({ target: e.target.value as BattleSettings['target'], shape: e.target.value === 'point' ? 'burst' : 'single' })}><option value="self">Self</option><option value="single">Character</option><option value="point">Map position</option><option value="multiple">Selected characters</option></select></label>
          <label>Affected characters<select value={s.faction} onChange={e => patch({ faction: e.target.value as BattleSettings['faction'] })}><option value="all">Everyone</option><option value="allies">Allies</option><option value="enemies">Enemies</option></select></label>
          {field('Range (tiles)', 'range', '6 + @dex_mod')}{s.target === 'multiple' && field('Maximum targets', 'maxTargets', '1', 'Integer 1-100, using caster attributes. No dice or input variables.')}
          <label>Pattern<select disabled={s.target === 'multiple'} value={s.shape} onChange={e => patch({ shape: e.target.value as BattleSettings['shape'], ...(s.target === 'self' && ['line', 'cone'].includes(e.target.value) ? { target: 'point' as const } : {}) })}><option value="single">Single cell</option><option value="burst">Circle</option><option value="square">Square</option><option value="line">Line from actor</option><option value="cone">Cone from actor</option><option value="custom">Custom pattern</option></select></label>
          {(s.shape === 'burst' || s.shape === 'square') && <label>Radius<input type="number" min="0" max="50" value={s.radius} onChange={e => patch({ radius: Number(e.target.value) })} /></label>}
          {(s.shape === 'line' || s.shape === 'cone') && <label>Length<input type="number" min="1" max="50" value={s.length} onChange={e => patch({ length: Number(e.target.value) })} /></label>}
          {s.shape === 'line' && <label>Width<input type="number" min="1" max="50" value={s.width} onChange={e => patch({ width: Number(e.target.value) })} /></label>}
          {s.shape === 'cone' && <label>Angle<select value={s.angle} onChange={e => patch({ angle: Number(e.target.value) as BattleSettings['angle'] })}>{[45, 90, 180].map(a => <option key={a} value={a}>{a} degrees</option>)}</select></label>}
        </div><div className="bs-checks"><label className="bs-check"><input type="checkbox" checked={s.includeSelf} onChange={e => patch({ includeSelf: e.target.checked })} />Include actor in area</label><label className="bs-check"><input type="checkbox" checked={s.requiresLOS} onChange={e => patch({ requiresLOS: e.target.checked })} />Require line of sight</label></div>
          {s.shape === 'custom' && <div className="bs-pattern" aria-label="Custom area pattern">{Array.from({ length: 81 }, (_, i) => { const x = i % 9 - 4, y = Math.floor(i / 9) - 4, enabled = s.cells.some(p => p.x === x && p.y === y); return <button type="button" key={i} aria-label={`Pattern ${x}, ${y}`} title={`${x}, ${y}${x === 0 && y === 0 ? ' / Aim point' : ''}`} aria-pressed={enabled} className={x === 0 && y === 0 ? 'is-origin' : ''} onClick={() => patch({ cells: enabled ? s.cells.filter(p => p.x !== x || p.y !== y) : [...s.cells, { x, y }] })}>{x === 0 && y === 0 ? '+' : ''}</button>; })}</div>}
        </section>
        <section><header className="bs-section-heading"><h4>Costs</h4><button type="button" disabled={costs.length >= 24} onClick={() => patch({ costs: [...costs, newBattleCost()] })}><Plus size={15} />Add cost</button></header>
          {costs.map(cost => <div className="bs-step" key={cost.id}><label>Resource<select value={cost.resource} onChange={e => patch({ costs: costs.map(c => c.id === cost.id ? { ...c, resource: e.target.value as typeof c.resource } : c) })}><option value="combat">Combat AP</option><option value="movement">Movement AP</option><option value="reaction">Reaction AP</option><option value="bar">Custom bar</option></select></label>
            {cost.resource === 'bar' && <label>Bar{barPicker(cost.barId, barId => patch({ costs: costs.map(c => c.id === cost.id ? { ...c, barId } : c) }))}</label>}
            <label className="bs-grow">Cost formula<input value={cost.formula} title="Non-negative amount spent once per action. Target counters and source local inputs are supported." onChange={e => patch({ costs: costs.map(c => c.id === cost.id ? { ...c, formula: e.target.value } : c) })} /></label>
            <button type="button" className="bs-icon bs-remove" aria-label="Remove cost" title="Remove cost" onClick={() => patch({ costs: costs.filter(c => c.id !== cost.id) })}><Trash2 size={16} /></button>
          </div>)}
          {!costs.length && <span className="bs-empty">No resource cost</span>}
        </section>
        <section><h4>Requirements & Presentation</h4><div className="bs-fields">
          {field('Availability formula', 'availability', '1', '0 blocks the action. Caster attributes and source inputs are supported.')}
          {field('Unavailable reason', 'unavailableReason', 'Requires an active stance')}
          <label>Action animation<select value={s.animation || ''} onChange={e => patch({ animation: (e.target.value || undefined) as BattleSettings['animation'] })}><option value="">Automatic</option><option value="attack">Attack</option><option value="cast">Cast</option></select></label>
        </div></section>
        <section><h4>Shared Amount</h4><div className="bs-fields">{field('Shared amount formula', 'amountFormula', '8d6 + @int_mod', 'Rolled once per action. @roll.amount in outcomes. @action.target.quantity is the target count; .affected and .resisted are available after saves.')}</div></section>
        <section><h4>Resolution</h4><div className="bs-modes">{([{ id: 'none', name: 'Automatic', icon: Check }, { id: 'attack', name: 'Attack', icon: Swords }, { id: 'save', name: 'Saving throw', icon: Shield }, { id: 'opposed', name: 'Opposed roll', icon: Dices }] as const).map(mode => <button type="button" key={mode.id} aria-pressed={s.check === mode.id} onClick={() => patch({ check: mode.id, actorFormula: mode.id === 'save' ? '12' : '1d20 + @cha_mod', targetFormula: mode.id === 'attack' ? '@ac' : '1d20 + @wis_mod', ties: mode.id === 'attack' ? 'actor' : 'target' })}><mode.icon size={15} />{mode.name}</button>)}</div>
          {s.check !== 'none' && <div className="bs-fields">
            {field(s.check === 'save' ? 'Difficulty formula' : 'Actor roll formula', 'actorFormula', '1d20 + @cha_mod', 'Unqualified @values belong to the acting character. @@values belong to this item/spell/status.')}
            {field(s.check === 'attack' ? 'Target defense formula' : 'Target roll formula', 'targetFormula', '2d20kh1 + @wis_mod', 'Unqualified @values belong to each target. 2d20kh1 = advantage; 2d20kl1 = disadvantage.')}
            <label>Actor roll frequency<select value={s.actorRoll} onChange={e => patch({ actorRoll: e.target.value as BattleSettings['actorRoll'] })}><option value="once">Once per action</option><option value="per-target">Once per target</option></select></label>
            <label>Tie winner<select value={s.ties} onChange={e => patch({ ties: e.target.value as BattleSettings['ties'] })}><option value="target">Target (resisted)</option><option value="actor">Actor (landed)</option></select></label>
          </div>}
        </section>
        <section><header className="bs-section-heading"><h4>Follow-up Checks</h4><button type="button" disabled={(s.checks?.length || 0) >= 8} onClick={() => patch({ checks: [...s.checks || [], newBattleCheck()] })}><Plus size={15} />Add check</button></header>
          {(s.checks || []).map((check, index) => {
            const update = (value: Partial<typeof check>) => patch({ checks: s.checks!.map(c => c.id === check.id ? { ...c, ...value } : c) });
            return <div className="bs-step" key={check.id}>
              <label>Check name<input value={check.name} onChange={e => update({ name: e.target.value })} /></label>
              <label>Run when<select value={check.when} onChange={e => update({ when: e.target.value as typeof check.when })}><option value="landed">Previous check lands</option><option value="resisted">Previous check resisted</option><option value="always">Always</option></select></label>
              <label>Actor formula<input value={check.actorFormula} onChange={e => update({ actorFormula: e.target.value })} /></label>
              <label>Target formula<input value={check.targetFormula} onChange={e => update({ targetFormula: e.target.value })} /></label>
              <label>Tie winner<select value={check.ties} onChange={e => update({ ties: e.target.value as typeof check.ties })}><option value="target">Target</option><option value="actor">Actor</option></select></label>
              <button type="button" className="bs-icon" title="Copy check reference" aria-label="Copy check reference" onClick={() => void navigator.clipboard.writeText(`@check.${check.id}.landed`).catch(() => setImportError('Clipboard is unavailable.'))}><Copy size={16} /></button>
              <button type="button" className="bs-icon" title="Move check up" aria-label="Move check up" disabled={!index} onClick={() => patch({ checks: reorder(s.checks!, index, -1) })}><ArrowUp size={16} /></button>
              <button type="button" className="bs-icon" title="Move check down" aria-label="Move check down" disabled={index === s.checks!.length - 1} onClick={() => patch({ checks: reorder(s.checks!, index, 1) })}><ArrowDown size={16} /></button>
              <button type="button" className="bs-icon bs-remove" title="Remove check" aria-label="Remove check" onClick={() => patch({ checks: s.checks!.filter(c => c.id !== check.id) })}><Trash2 size={16} /></button>
            </div>;
          })}
        </section>
        {outcome('landed', s.check === 'none' && !s.checks?.length ? 'On application' : 'Effect lands')}
        {(s.check !== 'none' || Boolean(s.checks?.length)) && outcome('resisted', 'Effect resisted')}
        {outcome('afterChecks', 'After all checks')}
      </>}
    </fieldset>
  </details>;
}
