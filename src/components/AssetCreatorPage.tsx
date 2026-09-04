import React, { useState } from 'react';
import { Dices, Download, Package, Plus, ShieldCheck, Sparkles, Trash2, Upload } from 'lucide-react';
import type {
  CharacterAction,
  CharacterDiceMacro,
  CharacterInventoryItem,
  CharacterLocalVariable,
  CharacterReplenishTrigger,
  CharacterSpell,
  CharacterStatusDurationEndBehavior,
  CharacterStatus,
  CharacterStatusDurationType,
  StatusEffect,
} from '../types/character';
import { exportJsonWithChoice, importJsonTextWithChoice } from '../lib/jsonTransfer';

type AssetKind = 'item' | 'spell' | 'status' | 'macro';

interface CharacterEntryExportPayload {
  schema: 'inoraxium-character-entry';
  version: 1;
  kind: AssetKind;
  exportedAt: string;
  sourceCharacterName?: string;
  folderName?: string | null;
  entry: CharacterInventoryItem | CharacterSpell | CharacterStatus | CharacterDiceMacro;
}

type Rarity = NonNullable<CharacterInventoryItem['rarity']>;

const rarityOptions: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical', 'unique'];
const statusDurationOptions: Array<{ value: CharacterStatusDurationType; label: string }> = [
  { value: 'custom', label: 'Custom' },
  { value: 'round', label: 'Round' },
  { value: 'battle', label: 'Battle' },
  { value: 'short-rest', label: 'Short Rest' },
  { value: 'long-rest', label: 'Long Rest' },
  { value: 'minute', label: 'Minute' },
];
const statusDurationEndBehaviorOptions: Array<{ value: CharacterStatusDurationEndBehavior; label: string }> = [
  { value: 'delete', label: 'Delete at 0' },
  { value: 'deactivate', label: 'Deactivate at 0' },
];
const replenishTriggerOptions: Array<{ value: CharacterReplenishTrigger; label: string }> = [
  { value: 'custom', label: 'Custom' },
  { value: 'short-rest', label: 'Short Rest' },
  { value: 'long-rest', label: 'Long Rest' },
  { value: 'battle', label: 'Battle' },
  { value: 'round', label: 'Round' },
];

const uid = () => (
  globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
);

const titleCase = (value: string) => value.replace(/(^|\s|-)\S/g, letter => letter.toUpperCase());

const sanitizeWholeNumberInput = (value: string): string => value.replace(/\D/g, '');

const parseWholeNumberInput = (value: string): number => Number.parseInt(sanitizeWholeNumberInput(value) || '0', 10);

const safeExportFileName = (name: string, suffix: string) => (
  `${(name || 'asset').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'asset'}-${suffix}.json`
);

const createEffect = (): StatusEffect => ({
  id: `eff_${uid()}`,
  effectType: 'attribute',
  targetId: '',
  value: '0',
  active: true,
  useTargetPicker: true,
});

const createStatusApplyEffect = (statusEntry: Partial<CharacterStatus>): StatusEffect => ({
  id: `eff_${uid()}`,
  effectType: 'status',
  targetId: '',
  value: '',
  active: true,
  statusName: statusEntry.name || 'Imported Status',
  statusEntry,
  statusFolderId: null,
});

const createBarUpdateEffect = (): StatusEffect => ({
  id: `eff_${uid()}`,
  effectType: 'bar-update',
  targetId: '',
  value: '0',
  active: true,
  barUpdateDescription: 'Choose which bar this asset should update when imported.',
});

const createMacro = (): CharacterDiceMacro => ({
  id: `macro_${uid()}`,
  name: 'New Macro',
  formula: '1d20',
});

const createLocalVariable = (kind: CharacterLocalVariable['kind'] = 'variable'): CharacterLocalVariable => ({
  id: `local_${uid()}`,
  description: '',
  value: '0',
  kind,
});

const createAction = (): CharacterAction => ({
  id: `act_${uid()}`,
  name: 'New Action',
  description: '',
  cost: '',
  usageRemaining: '',
  maxUsage: '',
  replenishTrigger: 'custom',
  replenishAmount: '',
  macros: [],
  effects: [],
});

const createItem = (): CharacterInventoryItem => ({
  id: `inv_${uid()}`,
  name: 'New Item',
  description: '',
  quantity: 1,
  status: 'unequipped',
  rarity: 'common',
  equipped: false,
  macros: [],
  effects: [],
  actions: [],
  localVariables: [],
  hidden: false,
  folderId: null,
});

const createSpell = (): CharacterSpell => ({
  id: `sp_${uid()}`,
  name: 'New Spell',
  description: '',
  level: '1',
  resourceCost: '',
  usageRemaining: '',
  totalUsage: '',
  replenishTrigger: 'custom',
  replenishAmount: '',
  magicSchool: '',
  color: '#38bdf8',
  macros: [],
  actions: [],
  localVariables: [],
  hidden: false,
  folderId: null,
});

const createStatus = (): CharacterStatus => ({
  id: `st_${uid()}`,
  name: 'New Status',
  duration: '1 round',
  durationType: 'custom',
  durationEndBehavior: 'delete',
  maxDuration: '',
  replenishTrigger: 'custom',
  replenishAmount: '',
  description: '',
  effects: [],
  actions: [],
  localVariables: [],
  active: true,
  color: '#22c55e',
  hidden: false,
  folderId: null,
});

const asRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const importString = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback);

const importBoolean = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

const importNumber = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

const normalizeImportedEffect = (effect: Partial<StatusEffect> = {}): StatusEffect => ({
  id: importString(effect.id, `eff_${uid()}`),
  effectType: effect.effectType === 'status' || effect.effectType === 'bar-update' ? effect.effectType : 'attribute',
  targetId: importString(effect.targetId, ''),
  value: importString(effect.value, '0'),
  active: effect.active ?? true,
  useTargetPicker: effect.useTargetPicker ?? true,
  targetLabel: typeof effect.targetLabel === 'string' ? effect.targetLabel : undefined,
  statusName: typeof effect.statusName === 'string' ? effect.statusName : undefined,
  statusEntry: effect.statusEntry,
  statusFolderId: typeof effect.statusFolderId === 'string' ? effect.statusFolderId : null,
  barUpdateDescription: typeof effect.barUpdateDescription === 'string' ? effect.barUpdateDescription : undefined,
});

const normalizeImportedMacro = (macro: Partial<CharacterDiceMacro> = {}): CharacterDiceMacro => ({
  id: importString(macro.id, `macro_${uid()}`),
  name: importString(macro.name, 'Imported Macro'),
  formula: importString(macro.formula, '1d20'),
  folderId: typeof macro.folderId === 'string' ? macro.folderId : null,
});

const normalizeImportedLocalVariable = (variable: Partial<CharacterLocalVariable> = {}): CharacterLocalVariable => ({
  id: importString(variable.id, `local_${uid()}`),
  description: importString(variable.description, ''),
  value: importString(variable.value, '0'),
  kind: variable.kind === 'input' ? 'input' : 'variable',
});

const normalizeImportedAction = (action: Partial<CharacterAction> = {}): CharacterAction => ({
  id: importString(action.id, `act_${uid()}`),
  name: importString(action.name, 'Imported Action'),
  description: importString(action.description, ''),
  cost: importString(action.cost, ''),
  usageRemaining: importString(action.usageRemaining, ''),
  maxUsage: importString(action.maxUsage, ''),
  replenishTrigger: action.replenishTrigger || 'custom',
  replenishAmount: importString(action.replenishAmount, ''),
  macros: Array.isArray(action.macros) ? action.macros.map(macro => normalizeImportedMacro(macro as Partial<CharacterDiceMacro>)) : [],
  effects: Array.isArray(action.effects) ? action.effects.map(effect => normalizeImportedEffect(effect as Partial<StatusEffect>)) : [],
});

const normalizeImportedItem = (entry: Partial<CharacterInventoryItem> = {}): CharacterInventoryItem => ({
  ...createItem(),
  ...entry,
  id: importString(entry.id, `inv_${uid()}`),
  name: importString(entry.name, 'Imported Item'),
  description: importString(entry.description, ''),
  quantity: importNumber(entry.quantity, 1),
  status: importString(entry.status, entry.equipped ? 'equipped' : 'unequipped'),
  rarity: (entry.rarity || 'common') as Rarity,
  equipped: entry.equipped ?? entry.status === 'equipped',
  macros: Array.isArray(entry.macros) ? entry.macros.map(macro => normalizeImportedMacro(macro as Partial<CharacterDiceMacro>)) : [],
  effects: Array.isArray(entry.effects) ? entry.effects.map(effect => normalizeImportedEffect(effect as Partial<StatusEffect>)) : [],
  actions: Array.isArray(entry.actions) ? entry.actions.map(action => normalizeImportedAction(action as Partial<CharacterAction>)) : [],
  localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map(variable => normalizeImportedLocalVariable(variable as Partial<CharacterLocalVariable>)) : [],
  hidden: importBoolean(entry.hidden, false),
  folderId: null,
});

const normalizeImportedSpell = (entry: Partial<CharacterSpell> = {}): CharacterSpell => ({
  ...createSpell(),
  ...entry,
  id: importString(entry.id, `sp_${uid()}`),
  name: importString(entry.name, 'Imported Spell'),
  description: importString(entry.description, ''),
  level: importString(entry.level, ''),
  resourceCost: importString(entry.resourceCost, ''),
  usageRemaining: importString(entry.usageRemaining, ''),
  totalUsage: importString(entry.totalUsage, ''),
  replenishTrigger: entry.replenishTrigger || 'custom',
  replenishAmount: importString(entry.replenishAmount, ''),
  magicSchool: importString(entry.magicSchool, ''),
  color: importString(entry.color, '#38bdf8'),
  macros: Array.isArray(entry.macros) ? entry.macros.map(macro => normalizeImportedMacro(macro as Partial<CharacterDiceMacro>)) : [],
  actions: Array.isArray(entry.actions) ? entry.actions.map(action => normalizeImportedAction(action as Partial<CharacterAction>)) : [],
  localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map(variable => normalizeImportedLocalVariable(variable as Partial<CharacterLocalVariable>)) : [],
  hidden: importBoolean(entry.hidden, false),
  folderId: null,
});

const normalizeImportedStatus = (entry: Partial<CharacterStatus> = {}): CharacterStatus => ({
  ...createStatus(),
  ...entry,
  id: importString(entry.id, `st_${uid()}`),
  name: importString(entry.name, 'Imported Status'),
  duration: importString(entry.duration, ''),
  durationType: entry.durationType || 'custom',
  durationEndBehavior: entry.durationEndBehavior || 'delete',
  maxDuration: importString(entry.maxDuration, ''),
  replenishTrigger: entry.replenishTrigger || 'custom',
  replenishAmount: importString(entry.replenishAmount, ''),
  description: importString(entry.description, ''),
  effects: Array.isArray(entry.effects) ? entry.effects.map(effect => normalizeImportedEffect(effect as Partial<StatusEffect>)) : [],
  actions: Array.isArray(entry.actions) ? entry.actions.map(action => normalizeImportedAction(action as Partial<CharacterAction>)) : [],
  localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map(variable => normalizeImportedLocalVariable(variable as Partial<CharacterLocalVariable>)) : [],
  active: entry.active ?? true,
  color: importString(entry.color, '#22c55e'),
  hidden: importBoolean(entry.hidden, false),
  folderId: null,
});

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label
    className="block h-4 whitespace-nowrap text-xs uppercase leading-4 tracking-[0.18em] text-sky-200/70"
    title={typeof children === 'string' ? children : undefined}
    style={{ fontFamily: "'Cinzel', serif" }}
  >
    {children}
  </label>
);

const inputClass = 'w-full rounded-md border border-sky-900/60 bg-black/40 px-3 py-2 text-sm text-sky-50 outline-none transition focus:border-cyan-400/70 focus:bg-black/60';
const numericInputClass = `${inputClass} w-[11ch] font-mono`;
const textareaClass = `${inputClass} min-h-28 resize-y`;
const smallButtonClass = 'inline-flex items-center gap-1 rounded border border-sky-800/60 bg-sky-950/40 px-2 py-1 text-xs text-sky-100 transition hover:border-cyan-400/70 hover:bg-cyan-900/30';
const dangerButtonClass = 'inline-flex items-center gap-1 rounded border border-red-900/60 bg-red-950/30 px-2 py-1 text-xs text-red-200 transition hover:border-red-400/70 hover:bg-red-900/30';

interface EffectsEditorProps {
  effects: StatusEffect[];
  onChange: (effects: StatusEffect[]) => void;
}

const EffectsEditor: React.FC<EffectsEditorProps> = ({ effects, onChange }) => {
  const updateEffect = (index: number, patch: Partial<StatusEffect>) => {
    onChange(effects.map((effect, effectIndex) => (effectIndex === index ? { ...effect, ...patch } : effect)));
  };

  const importStatusEffect = async () => {
    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      const parsed = JSON.parse(raw) as CharacterEntryExportPayload;
      if (parsed.schema !== 'inoraxium-character-entry' || parsed.version !== 1 || parsed.kind !== 'status' || !parsed.entry) {
        throw new Error('Please import a status export JSON file.');
      }
      onChange([...effects, createStatusApplyEffect(parsed.entry as Partial<CharacterStatus>)]);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : 'Status import failed.');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-emerald-200" style={{ fontFamily: "'Cinzel', serif" }}>Effects</h4>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButtonClass} onClick={() => onChange([...effects, createEffect()])}>
            <Plus size={14} /> Add Effect
          </button>
          <button type="button" className={smallButtonClass} onClick={importStatusEffect}>
            <Plus size={14} /> Add Status
          </button>
          <button type="button" className={smallButtonClass} onClick={() => onChange([...effects, createBarUpdateEffect()])}>
            <Plus size={14} /> Bar Update
          </button>
        </div>
      </div>
      {effects.length === 0 ? (
        <p className="text-xs italic text-stone-500">No effects yet.</p>
      ) : effects.map((effect, index) => (
        effect.effectType === 'status' ? (
          <div key={effect.id || index} className="grid gap-2 rounded-md border border-indigo-900/30 bg-black/25 p-2 md:grid-cols-[auto_1fr_180px_auto]">
            <span className="rounded border border-indigo-700/50 bg-indigo-900/30 px-3 py-2 text-xs font-semibold text-indigo-200">Apply</span>
            <input className={inputClass} value={effect.statusName || effect.statusEntry?.name || 'Imported Status'} readOnly />
            <input className={inputClass} value="Choose category after import" readOnly />
            <button type="button" className={dangerButtonClass} onClick={() => onChange(effects.filter((_, effectIndex) => effectIndex !== index))}>
              <Trash2 size={14} />
            </button>
          </div>
        ) : effect.effectType === 'bar-update' ? (
          <div key={effect.id || index} className="grid gap-2 rounded-md border border-cyan-900/30 bg-black/25 p-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <span className="rounded border border-cyan-700/50 bg-cyan-900/30 px-3 py-2 text-xs font-semibold text-cyan-200">Apply</span>
            <input
              className={inputClass}
              value={effect.barUpdateDescription || ''}
              onChange={event => updateEffect(index, { barUpdateDescription: event.target.value, targetId: '' })}
              placeholder="Import prompt, e.g. Healing target bar"
            />
            <input
              className={inputClass}
              value={effect.value}
              onChange={event => updateEffect(index, { value: event.target.value })}
              placeholder="+100"
            />
            <button type="button" className={dangerButtonClass} onClick={() => onChange(effects.filter((_, effectIndex) => effectIndex !== index))}>
              <Trash2 size={14} />
            </button>
          </div>
        ) : (
          <div key={effect.id || index} className="grid gap-2 rounded-md border border-emerald-900/30 bg-black/25 p-2 md:grid-cols-[auto_1fr_160px_auto]">
            <button
              type="button"
              className={`rounded px-3 py-2 text-xs font-semibold ${effect.active ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/50' : 'bg-stone-900 text-stone-400 border border-stone-700'}`}
              onClick={() => updateEffect(index, { active: !effect.active })}
            >
              {effect.active ? 'On' : 'Off'}
            </button>
            <input
              className={inputClass}
              value={effect.targetId}
              onChange={event => updateEffect(index, { targetId: event.target.value })}
              placeholder="attribute_id"
            />
            <input
              className={inputClass}
              value={effect.value}
              onChange={event => updateEffect(index, { value: event.target.value })}
              placeholder="+3"
            />
            <button type="button" className={dangerButtonClass} onClick={() => onChange(effects.filter((_, effectIndex) => effectIndex !== index))}>
              <Trash2 size={14} />
            </button>
          </div>
        )
      ))}
    </div>
  );
};

interface MacrosEditorProps {
  macros: CharacterDiceMacro[];
  onChange: (macros: CharacterDiceMacro[]) => void;
}

const MacrosEditor: React.FC<MacrosEditorProps> = ({ macros, onChange }) => {
  const updateMacro = (index: number, patch: Partial<CharacterDiceMacro>) => {
    onChange(macros.map((macro, macroIndex) => (macroIndex === index ? { ...macro, ...patch } : macro)));
  };

  return (
    <div className="space-y-3 rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-cyan-200" style={{ fontFamily: "'Cinzel', serif" }}>Dice Macros</h4>
        <button type="button" className={smallButtonClass} onClick={() => onChange([...macros, createMacro()])}>
          <Plus size={14} /> Add Macro
        </button>
      </div>
      {macros.length === 0 ? (
        <p className="text-xs italic text-stone-500">No macros yet.</p>
      ) : macros.map((macro, index) => (
        <div key={macro.id || index} className="grid gap-2 rounded-md border border-cyan-900/30 bg-black/25 p-2 md:grid-cols-[1fr_1fr_auto]">
          <input className={inputClass} value={macro.name} onChange={event => updateMacro(index, { name: event.target.value })} placeholder="Macro name" />
          <input className={inputClass} value={macro.formula} onChange={event => updateMacro(index, { formula: event.target.value })} placeholder="1d20 + str_mod" />
          <button type="button" className={dangerButtonClass} onClick={() => onChange(macros.filter((_, macroIndex) => macroIndex !== index))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

interface LocalVariablesEditorProps {
  variables: CharacterLocalVariable[];
  onChange: (variables: CharacterLocalVariable[]) => void;
}

const LocalVariablesEditor: React.FC<LocalVariablesEditorProps> = ({ variables, onChange }) => {
  const updateVariable = (index: number, patch: Partial<CharacterLocalVariable>) => {
    onChange(variables.map((variable, variableIndex) => (variableIndex === index ? { ...variable, ...patch } : variable)));
  };

  return (
    <div className="space-y-3 rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-cyan-200" style={{ fontFamily: "'Cinzel', serif" }}>Local Variables</h4>
          <p className="text-xs text-sky-100/50">Use variables as <code className="text-cyan-300">@@id</code>. Inputs ask for a number when rolling a macro.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallButtonClass} onClick={() => onChange([...variables, createLocalVariable('variable')])}>
            <Plus size={14} /> Add Variable
          </button>
          <button type="button" className={smallButtonClass} onClick={() => onChange([...variables, createLocalVariable('input')])}>
            <Plus size={14} /> Add Input
          </button>
        </div>
      </div>
      {variables.length === 0 ? (
        <p className="text-xs italic text-stone-500">No local variables yet.</p>
      ) : variables.map((variable, index) => (
        <div key={index} className="grid gap-2 rounded-md border border-cyan-900/30 bg-black/25 p-2 md:grid-cols-[120px_160px_1fr_180px_auto]">
          <select
            className={inputClass}
            value={variable.kind || 'variable'}
            onChange={event => updateVariable(index, { kind: event.target.value as CharacterLocalVariable['kind'] })}
          >
            <option value="variable">Variable</option>
            <option value="input">Input</option>
          </select>
          <input className={inputClass} value={variable.id} onChange={event => updateVariable(index, { id: event.target.value.replace(/^@@?/, '') })} placeholder="local_id" />
          <input className={inputClass} value={variable.description} onChange={event => updateVariable(index, { description: event.target.value })} placeholder="Description" />
          {variable.kind === 'input' ? (
            <div className="rounded-md border border-amber-800/30 bg-amber-950/20 px-3 py-2 text-sm italic text-amber-300/80">
              Asked when rolling
            </div>
          ) : (
            <input className={inputClass} value={variable.value} onChange={event => updateVariable(index, { value: event.target.value })} placeholder="@dex_mod - 1" />
          )}
          <button type="button" className={dangerButtonClass} onClick={() => onChange(variables.filter((_, variableIndex) => variableIndex !== index))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
};

interface ActionsEditorProps {
  actions: CharacterAction[];
  onChange: (actions: CharacterAction[]) => void;
}

const ActionsEditor: React.FC<ActionsEditorProps> = ({ actions, onChange }) => {
  const updateAction = (index: number, patch: Partial<CharacterAction>) => {
    onChange(actions.map((action, actionIndex) => (actionIndex === index ? { ...action, ...patch } : action)));
  };

  return (
    <div className="space-y-3 rounded-lg border border-amber-900/40 bg-amber-950/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>Actions</h4>
        <button type="button" className={smallButtonClass} onClick={() => onChange([...actions, createAction()])}>
          <Plus size={14} /> Add Action
        </button>
      </div>
      {actions.length === 0 ? (
        <p className="text-xs italic text-stone-500">No actions yet.</p>
      ) : actions.map((action, index) => (
        <div key={action.id || index} className="space-y-3 rounded-lg border border-amber-900/30 bg-black/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="grid flex-1 gap-2 md:grid-cols-[1fr_140px_max-content_max-content_150px_max-content]">
              <div className="space-y-1">
                <FieldLabel>Name</FieldLabel>
                <input className={inputClass} value={action.name} onChange={event => updateAction(index, { name: event.target.value })} placeholder="Action name" />
              </div>
              <div className="space-y-1">
                <FieldLabel>Cost</FieldLabel>
                <input className={inputClass} value={action.cost} onChange={event => updateAction(index, { cost: event.target.value })} placeholder="Cost" />
              </div>
              <div className="space-y-1">
                <FieldLabel>Remaining</FieldLabel>
                <input
                  className={numericInputClass}
                  value={action.usageRemaining}
                  onChange={event => updateAction(index, { usageRemaining: sanitizeWholeNumberInput(event.target.value) })}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Max</FieldLabel>
                <input
                  className={numericInputClass}
                  value={action.maxUsage || ''}
                  onChange={event => updateAction(index, { maxUsage: sanitizeWholeNumberInput(event.target.value) })}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Replenish On</FieldLabel>
                <select
                  className={inputClass}
                  value={action.replenishTrigger || 'custom'}
                  onChange={event => updateAction(index, { replenishTrigger: event.target.value as CharacterReplenishTrigger })}
                >
                  {replenishTriggerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <FieldLabel>Gain</FieldLabel>
                <input
                  className={numericInputClass}
                  value={action.replenishAmount || ''}
                  onChange={event => updateAction(index, { replenishAmount: sanitizeWholeNumberInput(event.target.value) })}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                />
              </div>
            </div>
            <button type="button" className={dangerButtonClass} onClick={() => onChange(actions.filter((_, actionIndex) => actionIndex !== index))}>
              <Trash2 size={14} />
            </button>
          </div>
          <textarea
            className={textareaClass}
            value={action.description}
            onChange={event => updateAction(index, { description: event.target.value })}
            placeholder="What this action does..."
          />
          <MacrosEditor macros={action.macros || []} onChange={macros => updateAction(index, { macros })} />
          <EffectsEditor effects={action.effects || []} onChange={effects => updateAction(index, { effects })} />
        </div>
      ))}
    </div>
  );
};

const AssetCreatorPage: React.FC = () => {
  const [selectedKind, setSelectedKind] = useState<AssetKind>('item');
  const [item, setItem] = useState<CharacterInventoryItem>(() => createItem());
  const [spell, setSpell] = useState<CharacterSpell>(() => createSpell());
  const [status, setStatus] = useState<CharacterStatus>(() => createStatus());
  const [macro, setMacro] = useState<CharacterDiceMacro>(() => createMacro());

  const resetAsset = (kind: AssetKind) => {
    setSelectedKind(kind);
    if (kind === 'item') setItem(createItem());
    if (kind === 'spell') setSpell(createSpell());
    if (kind === 'status') setStatus(createStatus());
    if (kind === 'macro') setMacro(createMacro());
  };

  const getCurrentEntry = () => {
    if (selectedKind === 'item') return item;
    if (selectedKind === 'spell') return spell;
    if (selectedKind === 'status') return status;
    return macro;
  };

  const createExport = async () => {
    const entry = getCurrentEntry();
    const payload: CharacterEntryExportPayload = {
      schema: 'inoraxium-character-entry',
      version: 1,
      kind: selectedKind,
      exportedAt: new Date().toISOString(),
      sourceCharacterName: 'Asset Creator',
      folderName: null,
      entry,
    };

    try {
      await exportJsonWithChoice(payload, safeExportFileName(entry.name, selectedKind));
    } catch {
      window.alert('Export failed. Clipboard access may be blocked by the browser.');
    }
  };

  const loadImportedAsset = (payload: CharacterEntryExportPayload) => {
    if (payload.schema !== 'inoraxium-character-entry' || payload.version !== 1 || !payload.entry) {
      throw new Error('This is not a valid Inoraxium asset JSON file.');
    }

    const entryRecord = asRecord(payload.entry);
    if (!entryRecord) {
      throw new Error('The imported JSON does not contain a usable asset entry.');
    }

    setSelectedKind(payload.kind);
    if (payload.kind === 'item') {
      setItem(normalizeImportedItem(payload.entry as Partial<CharacterInventoryItem>));
      return;
    }
    if (payload.kind === 'spell') {
      setSpell(normalizeImportedSpell(payload.entry as Partial<CharacterSpell>));
      return;
    }
    if (payload.kind === 'status') {
      setStatus(normalizeImportedStatus(payload.entry as Partial<CharacterStatus>));
      return;
    }
    if (payload.kind === 'macro') {
      setMacro(normalizeImportedMacro(payload.entry as Partial<CharacterDiceMacro>));
      return;
    }

    throw new Error('This asset type is not supported by Asset Creator.');
  };

  const importAssetJson = async () => {
    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      loadImportedAsset(JSON.parse(raw) as CharacterEntryExportPayload);
    } catch (err: unknown) {
      window.alert(err instanceof Error ? err.message : 'Asset import failed.');
    }
  };

  const selectorCards = [
    { kind: 'item' as const, label: 'Item', icon: Package, description: 'Equipment, consumables, loot, actions, effects.' },
    { kind: 'spell' as const, label: 'Spell', icon: Sparkles, description: 'Spell text, costs, uses, macros, actions.' },
    { kind: 'status' as const, label: 'Status', icon: ShieldCheck, description: 'Buffs, debuffs, durations, effects.' },
    { kind: 'macro' as const, label: 'Macro', icon: Dices, description: 'Reusable dice formula export.' },
  ];

  return (
    <div className="min-h-[70vh] bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.16),transparent_32%),linear-gradient(135deg,rgba(2,8,23,0.98),rgba(7,20,37,0.96))] p-4 text-sky-50 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-2xl border border-sky-800/50 bg-black/40 p-5 shadow-[0_0_35px_rgba(14,165,233,0.14)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80" style={{ fontFamily: "'Cinzel', serif" }}>Inoraxium Tools</p>
              <h2 className="mt-1 text-3xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Asset Creator</h2>
              <p className="mt-2 max-w-3xl text-sm text-sky-100/70">
                Create an item, spell, status, or dice macro as a portable JSON file. The exported file uses the same format as the character sheet import buttons.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={importAssetJson}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-500/50 bg-sky-950/45 px-4 py-3 text-sm font-semibold text-sky-100 shadow-[0_0_18px_rgba(14,165,233,0.12)] transition hover:border-cyan-300/70 hover:bg-sky-900/55"
              >
                <Upload size={18} /> Import JSON
              </button>
              <button
                type="button"
                onClick={createExport}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-4 py-3 text-sm font-semibold text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)] transition hover:bg-cyan-400/25"
              >
                <Download size={18} /> Create JSON
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {selectorCards.map(card => {
            const Icon = card.icon;
            const isActive = selectedKind === card.kind;
            return (
              <button
                key={card.kind}
                type="button"
                onClick={() => resetAsset(card.kind)}
                className={`rounded-xl border p-4 text-left transition ${isActive ? 'border-cyan-300/80 bg-cyan-500/15 shadow-[0_0_18px_rgba(34,211,238,0.16)]' : 'border-sky-900/50 bg-black/30 hover:border-sky-500/60 hover:bg-sky-950/40'}`}
              >
                <div className="flex items-center gap-2 text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>
                  <Icon size={18} />
                  <span className="font-bold">{card.label}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-sky-100/60">{card.description}</p>
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-sky-800/50 bg-black/35 p-4 shadow-[0_0_28px_rgba(14,165,233,0.10)] md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-sky-900/60 pb-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70" style={{ fontFamily: "'Cinzel', serif" }}>{titleCase(selectedKind)} Builder</p>
              <h3 className="text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>{getCurrentEntry().name || `New ${titleCase(selectedKind)}`}</h3>
            </div>
            <button type="button" className={smallButtonClass} onClick={() => resetAsset(selectedKind)}>Reset</button>
          </div>

          {selectedKind === 'item' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[2fr_11ch_160px_160px]">
                <div className="space-y-1">
                  <FieldLabel>Name</FieldLabel>
                  <input className={inputClass} value={item.name} onChange={event => setItem({ ...item, name: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Quantity</FieldLabel>
                  <input
                    className={numericInputClass}
                    value={item.quantity}
                    onChange={event => setItem({ ...item, quantity: parseWholeNumberInput(event.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Rarity</FieldLabel>
                  <select className={inputClass} value={item.rarity || 'common'} onChange={event => setItem({ ...item, rarity: event.target.value as Rarity })}>
                    {rarityOptions.map(option => <option key={option} value={option}>{titleCase(option)}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <FieldLabel>Status</FieldLabel>
                  <select
                    className={inputClass}
                    value={item.status}
                    onChange={event => {
                      const nextStatus = event.target.value;
                      setItem({ ...item, status: nextStatus, equipped: nextStatus === 'equipped' });
                    }}
                  >
                    <option value="unequipped">Unequipped</option>
                    <option value="equipped">Equipped</option>
                    <option value="carried">Carried</option>
                    <option value="attuned">Attuned</option>
                    <option value="consumed">Consumed</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Description</FieldLabel>
                <textarea className={textareaClass} value={item.description} onChange={event => setItem({ ...item, description: event.target.value })} />
              </div>
              <LocalVariablesEditor variables={item.localVariables || []} onChange={localVariables => setItem({ ...item, localVariables })} />
              <MacrosEditor macros={item.macros} onChange={macros => setItem({ ...item, macros })} />
              <ActionsEditor actions={item.actions || []} onChange={actions => setItem({ ...item, actions })} />
              <EffectsEditor effects={item.effects || []} onChange={effects => setItem({ ...item, effects })} />
            </div>
          )}

          {selectedKind === 'spell' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[2fr_100px_140px_max-content_max-content_150px_max-content_90px]">
                <div className="space-y-1">
                  <FieldLabel>Name</FieldLabel>
                  <input className={inputClass} value={spell.name} onChange={event => setSpell({ ...spell, name: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Level</FieldLabel>
                  <input className={inputClass} value={spell.level} onChange={event => setSpell({ ...spell, level: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Cost</FieldLabel>
                  <input className={inputClass} value={spell.resourceCost} onChange={event => setSpell({ ...spell, resourceCost: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Remaining</FieldLabel>
                  <input
                    className={numericInputClass}
                    value={spell.usageRemaining}
                    onChange={event => setSpell({ ...spell, usageRemaining: sanitizeWholeNumberInput(event.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Max</FieldLabel>
                  <input
                    className={numericInputClass}
                    value={spell.totalUsage}
                    onChange={event => setSpell({ ...spell, totalUsage: sanitizeWholeNumberInput(event.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Replenish On</FieldLabel>
                  <select
                    className={inputClass}
                    value={spell.replenishTrigger || 'custom'}
                    onChange={event => setSpell({ ...spell, replenishTrigger: event.target.value as CharacterReplenishTrigger })}
                  >
                    {replenishTriggerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <FieldLabel>Gain</FieldLabel>
                  <input
                    className={numericInputClass}
                    value={spell.replenishAmount || ''}
                    onChange={event => setSpell({ ...spell, replenishAmount: sanitizeWholeNumberInput(event.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Color</FieldLabel>
                  <input className={`${inputClass} h-[38px] p-1`} type="color" value={spell.color} onChange={event => setSpell({ ...spell, color: event.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Description</FieldLabel>
                <textarea className={textareaClass} value={spell.description} onChange={event => setSpell({ ...spell, description: event.target.value })} />
              </div>
              <LocalVariablesEditor variables={spell.localVariables || []} onChange={localVariables => setSpell({ ...spell, localVariables })} />
              <MacrosEditor macros={spell.macros} onChange={macros => setSpell({ ...spell, macros })} />
              <ActionsEditor actions={spell.actions || []} onChange={actions => setSpell({ ...spell, actions })} />
            </div>
          )}

          {selectedKind === 'status' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[2fr_150px_130px_130px_160px_150px_150px_90px]">
                <div className="space-y-1">
                  <FieldLabel>Name</FieldLabel>
                  <input className={inputClass} value={status.name} onChange={event => setStatus({ ...status, name: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Duration Type</FieldLabel>
                  <select
                    className={inputClass}
                    value={status.durationType || 'custom'}
                    onChange={event => {
                      const nextType = event.target.value as CharacterStatusDurationType;
                      setStatus({
                        ...status,
                        durationType: nextType,
                        duration: nextType === 'custom'
                          ? status.duration
                          : (/^-?\d+(\.\d+)?$/.test(status.duration || '') ? status.duration : '1'),
                      });
                    }}
                  >
                    {statusDurationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <FieldLabel>Duration</FieldLabel>
                  <input
                    className={inputClass}
                    type={(status.durationType || 'custom') === 'custom' ? 'text' : 'number'}
                    min={(status.durationType || 'custom') === 'custom' ? undefined : 0}
                    step={(status.durationType || 'custom') === 'minute' ? 0.1 : (status.durationType || 'custom') === 'custom' ? undefined : 1}
                    value={status.duration}
                    onChange={event => setStatus({ ...status, duration: event.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Max Duration</FieldLabel>
                  <input
                    className={inputClass}
                    value={status.maxDuration || ''}
                    onChange={event => setStatus({ ...status, maxDuration: event.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>At 0</FieldLabel>
                  <select
                    className={inputClass}
                    value={status.durationEndBehavior || 'delete'}
                    onChange={event => setStatus({ ...status, durationEndBehavior: event.target.value as CharacterStatusDurationEndBehavior })}
                  >
                    {statusDurationEndBehaviorOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <FieldLabel>Replenish On</FieldLabel>
                  <select
                    className={inputClass}
                    value={status.replenishTrigger || 'custom'}
                    onChange={event => setStatus({ ...status, replenishTrigger: event.target.value as CharacterReplenishTrigger })}
                  >
                    {replenishTriggerOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <FieldLabel>Replenish Amount</FieldLabel>
                  <input
                    className={inputClass}
                    value={status.replenishAmount || ''}
                    onChange={event => setStatus({ ...status, replenishAmount: event.target.value })}
                    placeholder="Amount"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Color</FieldLabel>
                  <input className={`${inputClass} h-[38px] p-1`} type="color" value={status.color || '#22c55e'} onChange={event => setStatus({ ...status, color: event.target.value })} />
                </div>
              </div>
              <div className="space-y-1">
                <FieldLabel>Description</FieldLabel>
                <textarea className={textareaClass} value={status.description} onChange={event => setStatus({ ...status, description: event.target.value })} />
              </div>
              <LocalVariablesEditor variables={status.localVariables || []} onChange={localVariables => setStatus({ ...status, localVariables })} />
              <EffectsEditor effects={status.effects} onChange={effects => setStatus({ ...status, effects })} />
              <ActionsEditor actions={status.actions || []} onChange={actions => setStatus({ ...status, actions })} />
            </div>
          )}

          {selectedKind === 'macro' && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <FieldLabel>Name</FieldLabel>
                  <input className={inputClass} value={macro.name} onChange={event => setMacro({ ...macro, name: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Formula</FieldLabel>
                  <input className={inputClass} value={macro.formula} onChange={event => setMacro({ ...macro, formula: event.target.value })} placeholder="1d20 + str_mod" />
                </div>
              </div>
              <div className="rounded-lg border border-sky-900/40 bg-black/25 p-4 text-sm text-sky-100/70">
                This exports a single dice macro. Import it from the Macros tab on any character sheet.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssetCreatorPage;
