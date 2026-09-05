import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Star, Trash2, Save, ArrowLeft, Shield, Wand2, RefreshCw, Search, X, Filter, Settings, Dices, Zap, Edit3, Check, AlertTriangle, ArrowUp, ArrowDown, Share2, Crown, Upload } from 'lucide-react';
import { CharacterAction, CharacterAttributeSectionColumns, CharacterAttributeSectionModes, CharacterBar, CharacterData, CharacterDiceMacro, CharacterDisplayStat, CharacterEntryFolder, CharacterGalleryImage, CharacterGalleryImageTag, CharacterGeneralItem, CharacterInventoryItem, CharacterLocalVariable, CharacterOverviewSettings, CharacterReplenishTrigger, CharacterScript, CharacterScriptBarUpdateEntry, CharacterScriptCondition, CharacterScriptConditionOperator, CharacterScriptPlaceholder, CharacterScriptStatusEntry, CharacterScriptTrigger, CharacterSpell, CharacterStatusDurationEndBehavior, CharacterStatusDurationType, CustomAttribute, CharacterStatus, PartyData, SkillAttribute, StatusEffect } from '../types/character';
import { DEFAULT_CHARACTER_SYNC_SHEET_ID, DEFAULT_CHARACTER_SYNC_TAB_NAME, syncCharacterSheet } from '../lib/characterSheetSync';
import { exportJsonWithChoice, importJsonTextWithChoice, showTwoOptionModal } from '../lib/jsonTransfer';

const splitFormulaArgs = (argsString: string): string[] => {
  const args: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < argsString.length; i += 1) {
    const char = argsString[i];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      args.push(argsString.slice(start, i).trim());
      start = i + 1;
    }
  }

  args.push(argsString.slice(start).trim());
  return args;
};

const findFormulaFunctionCall = (expr: string, functionNames: string[]) => {
  const lower = expr.toLowerCase();

  for (let i = 0; i < expr.length; i += 1) {
    for (const functionName of functionNames) {
      const nameLength = functionName.length;
      if (lower.slice(i, i + nameLength) !== functionName) continue;
      const before = i > 0 ? expr[i - 1] : '';
      const after = expr[i + nameLength] || '';
      if (/[a-zA-Z0-9_]/.test(before) || after !== '(') continue;

      let depth = 0;
      for (let j = i + nameLength; j < expr.length; j += 1) {
        if (expr[j] === '(') depth += 1;
        if (expr[j] === ')') {
          depth -= 1;
          if (depth === 0) {
            return {
              name: functionName,
              start: i,
              end: j + 1,
              argsString: expr.slice(i + nameLength + 1, j),
            };
          }
        }
      }
    }
  }

  return null;
};

const normalizeFormulaConditionOperators = (expr: string): string => (
  expr
    .replace(/=</g, '<=')
    .replace(/=>/g, '>=')
    .replace(/(^|[^<>=!])=(?!=)/g, '$1===')
);

function transformIfFunctions(expr: string): string {
  let result = expr;
  let match = findFormulaFunctionCall(result, ['if']);

  while (match) {
    const args = splitFormulaArgs(match.argsString);
    if (args.length !== 3) return result;
    const condition = normalizeFormulaConditionOperators(transformIfFunctions(args[0]));
    const whenTrue = transformIfFunctions(args[1]);
    const whenFalse = transformIfFunctions(args[2]);
    result = `${result.slice(0, match.start)}((${condition}) ? (${whenTrue}) : (${whenFalse}))${result.slice(match.end)}`;
    match = findFormulaFunctionCall(result, ['if']);
  }

  return result;
}

function evalCharFormula(formula: string, context: Record<string, number>, localContext: Record<string, number> = {}): number {
  if (!formula) return 0;
  
  let expr = formula.replace(/@@([a-zA-Z0-9_-]+)/g, (_match, refId) => {
    return (localContext[refId] ?? 0).toString();
  });

  expr = expr.replace(/(^|[^@])@([a-zA-Z0-9_-]+)/g, (_match, prefix, refId) => {
    return `${prefix}${(context[refId] ?? 0).toString()}`;
  });

  expr = transformIfFunctions(expr);

  expr = expr.replace(/roundup/g, 'Math.ceil')
             .replace(/rounddown/g, 'Math.floor')
             .replace(/round/g, 'Math.round')
             .replace(/max/g, 'Math.max')
             .replace(/min/g, 'Math.min');

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    return typeof result === 'number' && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}
import { addEntryToPartyInventory, loadAdminAccess, loadCharacters, loadPartiesForCharacterTransfer, saveCharacter, saveCharacterInventory, deleteCharacterFromDB, loadFavorites, loadUserDiceSettings, saveUserDiceSettings, toggleFavorite as toggleFavoriteDB, UserDiceSettings, reloadCharacterFromFirestore, loadUserProfiles, transferCharacterOwner, UserProfile } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { addCombatantToBattleTracker } from '../lib/battleTracker';
import { getPixhostDirectImageUrl, isDirectImageUrl, uploadImageToPixhost } from '../lib/pixhost';

interface RollStep {
  label: string;
  value: number;
  detail?: string;
}

interface RollResult {
  macroName: string;
  formula: string;
  steps: RollStep[];
  total: number;
  timestamp: number;
  description?: string;
}

interface CharacterDiceState {
  macros: CharacterDiceMacro[];
  webhookUrl?: string;
  autoSend?: boolean;
}

interface DiceRoll {
  notation: string;
  rolls: number[];
  kept: number[];
  dropped: number[];
  sum: number;
}

interface CharacterAttributePreset {
  schema?: 'inoraxium-character-attributes';
  version?: 1;
  mainAttributes: CustomAttribute[];
  secondaryAttributes: CustomAttribute[];
  skills: SkillAttribute[];
  otherAttributes: CustomAttribute[];
  resistances?: CustomAttribute[];
  bars: CharacterBar[];
  displayStats?: CharacterDisplayStat[];
  displaySlotStates?: Record<string, 'unlocked' | 'locked' | 'blocked'>;
  overviewSettings?: CharacterOverviewSettings;
  attributeSectionModes?: CharacterAttributeSectionModes;
  modifierFormula: string;
  attributeSectionColumns: Required<CharacterAttributeSectionColumns>;
}

type CharacterEntryExportKind = 'item' | 'spell' | 'status' | 'macro' | 'script';

interface CharacterEntryExportPayload {
  schema: 'inoraxium-character-entry';
  version: 1;
  kind: CharacterEntryExportKind;
  exportedAt: string;
  sourceCharacterName?: string;
  folderName?: string | null;
  entry: unknown;
}

type AttributeCalculationType = NonNullable<CustomAttribute['calculationType']>;
type CharacterSheetTab = 'bio' | 'attributes' | 'macros' | 'scripts' | 'inventory' | 'spells' | 'statuses';
type BioSheetSubTab = 'main' | 'overview' | 'gallery';
type AttributeSheetSubTab = 'bars' | 'main' | 'secondary' | 'skills' | 'other' | 'resistances' | 'unassigned';
type MacroSheetSubTab = 'main' | 'rolls' | string;
type ScriptSheetSubTab = 'main' | string;

const STATUS_DURATION_OPTIONS: Array<{ value: CharacterStatusDurationType; label: string }> = [
  { value: 'custom', label: 'Custom' },
  { value: 'round', label: 'Round' },
  { value: 'battle', label: 'Battle' },
  { value: 'short-rest', label: 'Short Rest' },
  { value: 'long-rest', label: 'Long Rest' },
  { value: 'minute', label: 'Minute' },
];

const STATUS_DURATION_END_BEHAVIOR_OPTIONS: Array<{ value: CharacterStatusDurationEndBehavior; label: string }> = [
  { value: 'delete', label: 'Delete at 0' },
  { value: 'deactivate', label: 'Deactivate at 0' },
];

const REPLENISH_TRIGGER_OPTIONS: Array<{ value: CharacterReplenishTrigger; label: string }> = [
  { value: 'custom', label: 'Custom' },
  { value: 'short-rest', label: 'Short Rest' },
  { value: 'long-rest', label: 'Long Rest' },
  { value: 'battle', label: 'Battle' },
  { value: 'round', label: 'Round' },
];

const BAR_RESET_TRIGGER_OPTIONS: Array<{ value: NonNullable<CharacterBar['resetTrigger']>; label: string }> = [
  { value: 'short-rest', label: 'Short Rest' },
  { value: 'long-rest', label: 'Long Rest' },
  { value: 'turn-end', label: 'Turn End' },
  { value: 'battle-end', label: 'Battle End' },
];

const SCRIPT_TRIGGER_OPTIONS: Array<{ value: CharacterScriptTrigger; label: string }> = [
  { value: 'short-rest', label: 'Short Rest' },
  { value: 'long-rest', label: 'Long Rest' },
  { value: 'round-end', label: 'Round End' },
  { value: 'battle-end', label: 'Battle End' },
];

const SCRIPT_PLACEHOLDER_PREFIX = '__script_placeholder__:';
const getScriptPlaceholderValue = (placeholderId: string) => `${SCRIPT_PLACEHOLDER_PREFIX}${placeholderId}`;
const isScriptPlaceholderValue = (value: string | undefined) => Boolean(value?.startsWith(SCRIPT_PLACEHOLDER_PREFIX));

const getBarMode = (bar: Partial<CharacterBar>): NonNullable<CharacterBar['mode']> => bar.mode || 'default';

const getStatusDurationType = (status: Partial<CharacterStatus>): CharacterStatusDurationType => (
  status.durationType || 'custom'
);

const getStatusDurationEndBehavior = (status: Partial<CharacterStatus>): CharacterStatusDurationEndBehavior => (
  status.durationEndBehavior || 'delete'
);

const formatStatusDuration = (status: Partial<CharacterStatus>): string => {
  const duration = status.duration || '';
  const type = getStatusDurationType(status);
  if (type === 'custom') return duration || '-';
  const label = STATUS_DURATION_OPTIONS.find(option => option.value === type)?.label || 'Duration';
  return `${duration || '0'} ${label}${duration === '1' ? '' : 's'}`;
};

const parseStatusDurationAmount = (duration: string): number => {
  const parsed = Number.parseFloat(duration || '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatStatusDurationAmount = (amount: number): string => (
  Number.isInteger(amount) ? `${amount}` : `${Math.round(amount * 100) / 100}`
);

const parseReplenishAmount = (value?: string): number => {
  const parsed = Number.parseFloat(value || '0');
  return Number.isFinite(parsed) ? parsed : 0;
};

const sanitizeWholeNumberInput = (value: string): string => value.replace(/\D/g, '');

const sanitizeNumberInput = (value: string): string => {
  const normalized = value.replace(',', '.').replace(/[^\d.-]/g, '');
  const sign = normalized.startsWith('-') ? '-' : '';
  const unsigned = normalized.replace(/-/g, '');
  const [integer = '', ...decimalParts] = unsigned.split('.');
  const decimal = decimalParts.join('');
  return `${sign}${integer}${decimalParts.length > 0 ? `.${decimal}` : ''}`;
};

const parseWholeNumberInput = (value: string): number => Number.parseInt(sanitizeWholeNumberInput(value) || '0', 10);

const replenishValue = (currentValue: string | undefined, maxValue: string | undefined, amountValue: string | undefined): string => {
  const current = parseReplenishAmount(currentValue);
  const max = parseReplenishAmount(maxValue);
  const amount = parseReplenishAmount(amountValue);
  if (amount <= 0) return currentValue || '';

  const next = max > 0 ? Math.min(current + amount, max) : current + amount;
  return formatStatusDurationAmount(next);
};

const createScriptTriggerEvent = (trigger: CharacterScriptTrigger) => ({
  trigger,
  nonce: Date.now() + Math.random(),
});

const createCharacterAction = (): CharacterAction => ({
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

const createAttributeEffect = (): StatusEffect => ({
  id: `eff_${uid()}`,
  effectType: 'attribute',
  targetId: '',
  value: '0',
  active: true,
  useTargetPicker: true,
});

interface AttributeResolvedOption {
  value: number;
  label: string;
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const DEFAULT_CHARACTER_DICE_STATE: CharacterDiceState = {
  macros: [
    { id: 'macro_1', name: 'Attack Roll', formula: '1d20' },
    { id: 'macro_2', name: 'Damage Roll', formula: '1d8' },
  ],
  webhookUrl: '',
  autoSend: false,
};

const DEFAULT_ATTRIBUTE_SECTION_MODES: Required<CharacterAttributeSectionModes> = {
  main: 'all',
  secondary: 'all',
  skills: 'all',
  other: 'all',
  resistances: 'all',
  bars: 'all',
};

const DEFAULT_ATTRIBUTE_SECTION_COLUMNS: Required<CharacterAttributeSectionColumns> = {
  display: 3,
  main: 2,
  secondary: 2,
  skills: 2,
  other: 2,
  resistances: 2,
  bars: 2,
};

const DEFAULT_ATTRIBUTE_CALCULATION_TYPE: AttributeCalculationType = 'sum';

const normalizeAttributeOptions = (options?: CustomAttribute['valueOptions']): AttributeResolvedOption[] => (
  (options || [])
    .map((option) => ({
      value: Number(option.value),
      label: option.label || '',
    }))
    .filter((option) => Number.isFinite(option.value))
);

const ALIGNMENT_OPTIONS = [
  'Lawful Good',
  'Neutral Good',
  'Chaotic Good',
  'Lawful Neutral',
  'True Neutral',
  'Chaotic Neutral',
  'Lawful Evil',
  'Neutral Evil',
  'Chaotic Evil',
] as const;

const INVENTORY_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical', 'unique'] as const;

const INVENTORY_RARITY_STYLES: Record<typeof INVENTORY_RARITIES[number], { label: string; card: string; badge: string }> = {
  common: {
    label: 'Common',
    card: 'bg-slate-200/10 border-slate-300/30 shadow-slate-200/10',
    badge: 'bg-slate-300/20 text-slate-200 border-slate-300/40',
  },
  uncommon: {
    label: 'Uncommon',
    card: 'bg-emerald-500/10 border-emerald-400/35 shadow-emerald-500/10',
    badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
  },
  rare: {
    label: 'Rare',
    card: 'bg-sky-500/10 border-sky-300/40 shadow-sky-500/10',
    badge: 'bg-sky-500/20 text-sky-200 border-sky-300/40',
  },
  epic: {
    label: 'Epic',
    card: 'bg-violet-500/10 border-violet-400/40 shadow-violet-500/10',
    badge: 'bg-violet-500/20 text-violet-200 border-violet-400/40',
  },
  legendary: {
    label: 'Legendary',
    card: 'bg-yellow-400/10 border-yellow-300/45 shadow-yellow-400/15',
    badge: 'bg-yellow-400/20 text-yellow-100 border-yellow-300/40',
  },
  mythical: {
    label: 'Mythical',
    card: 'bg-gradient-to-br from-red-500/15 via-rose-500/10 to-orange-400/10 border-red-300/45 shadow-red-500/20 animate-pulse',
    badge: 'bg-red-500/20 text-red-100 border-red-300/45',
  },
  unique: {
    label: 'Unique',
    card: 'bg-gradient-to-br from-cyan-500/15 via-sky-400/10 to-blue-600/10 border-cyan-300/45 shadow-cyan-400/20 animate-pulse',
    badge: 'bg-cyan-500/20 text-cyan-100 border-cyan-300/45',
  },
};

const PORTRAIT_IMAGE_MODULES = {
  ...import.meta.glob('/public/resources/character-portraits/*.{png,jpg,jpeg,webp,avif,gif}', { eager: true, query: '?url', import: 'default' }),
} as Record<string, string>;

const CHARACTER_PORTRAIT_OPTIONS = Object.entries(PORTRAIT_IMAGE_MODULES)
  .map(([path, url]) => ({
    name: path.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ') || 'Portrait',
    url,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const normalizeLocalVariables = (variables?: CharacterLocalVariable[]): CharacterLocalVariable[] => (
  Array.isArray(variables)
    ? variables.map(variable => ({
      id: variable.id || '',
      description: variable.description || '',
      value: variable.value || '0',
      kind: variable.kind === 'input' || variable.kind === 'resource' ? variable.kind : 'variable',
      replenishTrigger: variable.replenishTrigger || 'custom',
      replenishMode: variable.replenishMode === 'set' ? 'set' : 'gain',
      replenishAmount: variable.replenishAmount || '0',
      maxValue: variable.maxValue || '',
    }))
    : []
);

const normalizeGeneralItem = (item: CharacterGeneralItem): CharacterGeneralItem => ({
  ...item,
  description: item.description || '',
  homebrewImageUrl: item.homebrewImageUrl || '',
  homebrewImageThumbUrl: item.homebrewImageThumbUrl || '',
  quantity: Number.isFinite(item.quantity) ? item.quantity : 1,
  status: item.status || (item.equipped ? 'equipped' : 'unequipped'),
  rarity: item.rarity || 'common',
  equipped: item.equipped ?? false,
  macros: item.macros || [],
  effects: item.effects || [],
  actions: item.actions || [],
  localVariables: normalizeLocalVariables(item.localVariables),
  scripts: item.scripts || [],
  hidden: item.hidden ?? false,
});

const MATH_FUNCTIONS: Record<string, (args: number[]) => number> = {
  max: (args) => Math.max(...args),
  min: (args) => Math.min(...args),
  round: (args) => Math.round(args[0]),
  roundup: (args) => Math.ceil(args[0]),
  rounddown: (args) => Math.floor(args[0]),
};

function resolveConditionExpression(expr: string): boolean {
  const normalizedExpr = normalizeFormulaConditionOperators(expr);
  if (!/^[\d\s+\-*/.()<>=!&|]+$/.test(normalizedExpr)) {
    throw new Error(`Invalid condition: ${normalizedExpr}`);
  }

  try {
    const fn = new Function(`"use strict"; return (${normalizedExpr});`);
    return Boolean(fn());
  } catch {
    throw new Error(`Failed to evaluate condition: ${normalizedExpr}`);
  }
}

function evaluateMathFunctions(expr: string): string {
  let result = expr;
  let match = findFormulaFunctionCall(result, ['rounddown', 'roundup', 'round', 'max', 'min', 'if']);

  while (match) {
    const funcName = match.name.toLowerCase();
    const argStrings = splitFormulaArgs(match.argsString);
    const args: number[] = [];

    if (funcName === 'if') {
      if (argStrings.length !== 3) throw new Error('if() needs condition, true value, and false value.');
      const condition = resolveConditionExpression(evaluateMathFunctions(argStrings[0]));
      const resultValue = resolveBasicExpression(evaluateMathFunctions(condition ? argStrings[1] : argStrings[2]));
      result = result.slice(0, match.start) + resultValue.toString() + result.slice(match.end);
      match = findFormulaFunctionCall(result, ['rounddown', 'roundup', 'round', 'max', 'min', 'if']);
      continue;
    }

    for (const argStr of argStrings) {
      args.push(resolveBasicExpression(evaluateMathFunctions(argStr)));
    }

    const func = MATH_FUNCTIONS[funcName];
    if (!func) throw new Error(`Unknown function: ${funcName}`);
    const resultValue = func(args);
    result = result.slice(0, match.start) + resultValue.toString() + result.slice(match.end);
    match = findFormulaFunctionCall(result, ['rounddown', 'roundup', 'round', 'max', 'min', 'if']);
  }

  return result;
}

function resolveBasicExpression(expr: string): number {
  if (!/^[\d\s+\-*/.()]+$/.test(expr)) {
    throw new Error(`Invalid expression: ${expr}`);
  }

  try {
    const fn = new Function(`"use strict"; return (${expr});`);
    const result = fn();
    if (typeof result !== 'number' || !isFinite(result)) throw new Error('Invalid result');
    return Math.round(result * 100) / 100;
  } catch {
    throw new Error(`Failed to evaluate: ${expr}`);
  }
}

function rollDice(notation: string): DiceRoll {
  const match = notation.match(/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i);
  if (!match) throw new Error(`Invalid dice: ${notation}`);

  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const keepMode = match[3] || null;
  const keepCount = parseInt(match[4] || '0', 10);

  if (count < 1 || count > 100) throw new Error('Dice count 1-100');
  if (sides < 2 || sides > 1000) throw new Error('Dice sides 2-1000');

  const rolls: number[] = [];
  for (let i = 0; i < count; i += 1) {
    rolls.push(Math.floor(Math.random() * sides) + 1);
  }

  let kept = [...rolls];
  let dropped: number[] = [];

  if (keepMode && keepCount > 0 && keepCount < count) {
    const indexed = rolls.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => keepMode === 'kh' ? b.v - a.v : a.v - b.v);
    const keptIndices = new Set(indexed.slice(0, keepCount).map(x => x.i));
    kept = rolls.filter((_, i) => keptIndices.has(i));
    dropped = rolls.filter((_, i) => !keptIndices.has(i));
  }

  return { notation, rolls, kept, dropped, sum: kept.reduce((a, b) => a + b, 0) };
}

function executeCharacterMacro(
  macro: CharacterDiceMacro,
  context: Record<string, number>,
  existingIds: Set<string>,
  localContext: Record<string, number> = {}
): RollResult {
  const steps: RollStep[] = [];
  const formula = macro.formula.trim();
  const parts = formula.split(/(\d*d\d+(?:kh|kl)?\d*|@@[a-zA-Z0-9_-]+|@[a-zA-Z0-9_-]+)/gi);
  const resolvedParts: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i.test(trimmed)) {
      const dice = rollDice(trimmed);
      const detail = dice.rolls.length > 1
        ? `[${dice.rolls.join(', ')}]${dice.dropped.length > 0 ? ` dropped [${dice.dropped.join(', ')}]` : ''}`
        : `${dice.sum}`;
      steps.push({ label: `🎲 ${trimmed}`, value: dice.sum, detail });
      resolvedParts.push(dice.sum.toString());
      continue;
    }

    const localRefMatch = trimmed.match(/^@@([a-zA-Z0-9_-]+)$/);
    if (localRefMatch) {
      const refId = localRefMatch[1];
      const found = Object.prototype.hasOwnProperty.call(localContext, refId);
      const value = found ? (localContext[refId] ?? 0) : 0;
      steps.push({
        label: found ? `@@${refId}` : `@@${refId}`,
        value,
        detail: found ? `${refId} = ${value}` : `${refId} local variable not found, using 0`,
      });
      resolvedParts.push(value.toString());
      continue;
    }

    const refMatch = trimmed.match(/^@([a-zA-Z0-9_-]+)$/);
    if (refMatch) {
      const refId = refMatch[1];
      const found = existingIds.has(refId);
      const value = found ? (context[refId] ?? 0) : 0;
      steps.push({
        label: found ? `📊 @${refId}` : `❌ @${refId}`,
        value,
        detail: found ? `${refId} = ${value}` : `${refId} not found, using 0`,
      });
      resolvedParts.push(value.toString());
      continue;
    }

    resolvedParts.push(trimmed);
  }

  let total = 0;
  const resolvedFormula = resolvedParts.join(' ');
  try {
    const withMathEvaluated = evaluateMathFunctions(resolvedFormula);
    const sanitized = withMathEvaluated.replace(/[^0-9+\-*/().\s]/g, '');
    const fn = new Function(`"use strict"; return (${sanitized});`);
    total = fn();
    if (typeof total !== 'number' || !isFinite(total)) total = 0;
    total = Math.round(total * 100) / 100;
  } catch {
    total = steps.reduce((sum, step) => sum + step.value, 0);
  }

  return { macroName: macro.name, formula: macro.formula, steps, total, timestamp: Date.now() };
}

async function sendToDiscord(webhookUrl: string, characterName: string, result: RollResult): Promise<string | null> {
  const endpointUrl = 'https://ulunavir-vercel.vercel.app/api/send-dice';

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, characterName, result }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return data.error || `Server error ${response.status}`;
    }
    return null;
  } catch (err) {
    console.error('Failed to connect to serverless API:', err);
    return 'Server connection error. Ensure the API route is deployed.';
  }
}

async function sendMessageToDiscord(webhookUrl: string, username: string, message: string): Promise<string | null> {
  try {
    const response = await fetch('https://ulunavir-vercel.vercel.app/api/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl,
        username,
        message,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return data.error || `Server error ${response.status}`;
    }
    return null;
  } catch (err) {
    console.error('Failed to send message to Discord:', err);
    return 'Server connection error. Ensure the API route is deployed.';
  }
}

interface CharactersProps {
  embeddedCharacterId?: string | null;
  embeddedMode?: boolean;
}

export const Characters: React.FC<CharactersProps> = ({ embeddedCharacterId = null, embeddedMode = false }) => {
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminSource, setAdminSource] = useState<string | null>(null);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [ownerTransferUid, setOwnerTransferUid] = useState('');
  const [ownerTransferStatus, setOwnerTransferStatus] = useState<string | null>(null);
  const [controlAccessUid, setControlAccessUid] = useState('');
  const [viewAccessUid, setViewAccessUid] = useState('');
  const [accessStatus, setAccessStatus] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<CharacterData[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterData | null>(null);
  const previousSelectedCharacterIdRef = useRef<string | null>(null);
  const [isViewingSheet, setIsViewingSheet] = useState(false);
  const [activeSheetTab, setActiveSheetTab] = useState<CharacterSheetTab>('bio');
  const [activeBioSubTab, setActiveBioSubTab] = useState<BioSheetSubTab>('main');
  const [activeAttributeSubTab, setActiveAttributeSubTab] = useState<AttributeSheetSubTab>('bars');

  // Filtering
  const [searchName, setSearchName] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [showOnlyFavs, setShowOnlyFavs] = useState(false);

  // Edit states
  const [editName, setEditName] = useState('');
  const [editRace, setEditRace] = useState('');
  const [editClass, setEditClass] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editBodyAge, setEditBodyAge] = useState('');
  const [editMentalAge, setEditMentalAge] = useState('');
  const [editSpiritualAge, setEditSpiritualAge] = useState('');
  const [editAlignment, setEditAlignment] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'public'>('private');
  const [sendToSpreadsheet, setSendToSpreadsheet] = useState(true);
  const [backstory, setBackstory] = useState('');
  const [notes, setNotes] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('');
  const [portraitImportUrl, setPortraitImportUrl] = useState('');
  const [portraitLoadError, setPortraitLoadError] = useState(false);
  const [galleryImages, setGalleryImages] = useState<CharacterGalleryImage[]>([]);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [fullscreenGalleryImage, setFullscreenGalleryImage] = useState<CharacterGalleryImage | null>(null);
  const [displayStats, setDisplayStats] = useState<CharacterDisplayStat[]>([]);
  const [displaySlotStates, setDisplaySlotStates] = useState<Record<string, 'unlocked' | 'locked' | 'blocked'>>({});
  const [overviewSettings, setOverviewSettings] = useState<CharacterOverviewSettings>({ mainAttributeIds: [], valueBoxes: [] });
  const [attributeSectionModes, setAttributeSectionModes] = useState<Required<CharacterAttributeSectionModes>>(DEFAULT_ATTRIBUTE_SECTION_MODES);
  const [attributeSectionColumns, setAttributeSectionColumns] = useState<Required<CharacterAttributeSectionColumns>>(DEFAULT_ATTRIBUTE_SECTION_COLUMNS);
  const [openAttributeHistoryId, setOpenAttributeHistoryId] = useState<string | null>(null);
  const [openDisplayColorStatId, setOpenDisplayColorStatId] = useState<string | null>(null);
  const [openAttributeOptionsId, setOpenAttributeOptionsId] = useState<string | null>(null);
  const [displayLayoutMode, setDisplayLayoutMode] = useState(false);
  const [draggingDisplayStatId, setDraggingDisplayStatId] = useState<string | null>(null);
  const [attributeSearches, setAttributeSearches] = useState<Record<AttributeSheetSubTab, string>>({
    bars: '',
    main: '',
    secondary: '',
    skills: '',
    other: '',
    resistances: '',
    unassigned: '',
  });
  const [unassignedAttributeSearch, setUnassignedAttributeSearch] = useState('');
  const [pendingUnassignedAttributeId, setPendingUnassignedAttributeId] = useState<string | null>(null);
  const [resistancePreviewBase, setResistancePreviewBase] = useState('100');
  const [sheetSyncStatus, setSheetSyncStatus] = useState<{ tone: 'idle' | 'success' | 'error'; message: string } | null>(null);
  const [isSheetSyncing, setIsSheetSyncing] = useState(false);
  const [charTags, setCharTags] = useState<string[]>([]);
  const [charTagInput, setCharTagInput] = useState('');
  
  const [mainAttrs, setMainAttrs] = useState<CustomAttribute[]>([]);
  const [secondaryAttrs, setSecondaryAttrs] = useState<CustomAttribute[]>([]);
  const [skills, setSkills] = useState<SkillAttribute[]>([]);
  const [otherAttrs, setOtherAttrs] = useState<CustomAttribute[]>([]);
  const [resistances, setResistances] = useState<CustomAttribute[]>([]);
  const [bars, setBars] = useState<CharacterBar[]>([]);
  const [openBarSettingsId, setOpenBarSettingsId] = useState<string | null>(null);
  const [barTargetRequest, setBarTargetRequest] = useState<{ description: string; resolve: (barId: string | null) => void } | null>(null);
  const [barTargetDraft, setBarTargetDraft] = useState('');
  const [effectTargetRequest, setEffectTargetRequest] = useState<{ label: string; resolve: (targetId: string | null) => void } | null>(null);
  const [effectTargetDraft, setEffectTargetDraft] = useState('');
  const [scriptValueTargetRequest, setScriptValueTargetRequest] = useState<{ label: string; localVariables: CharacterLocalVariable[]; resolve: (targetId: string | null) => void } | null>(null);
  const [scriptValueGlobalDraft, setScriptValueGlobalDraft] = useState('');
  const [scriptValueLocalDraft, setScriptValueLocalDraft] = useState('');
  const [localInputRequest, setLocalInputRequest] = useState<{ title: string; variables: CharacterLocalVariable[]; resolve: (values: Record<string, number> | null) => void } | null>(null);
  const [localInputDrafts, setLocalInputDrafts] = useState<Record<string, string>>({});
  const [localInputError, setLocalInputError] = useState('');
  const [charStatuses, setCharStatuses] = useState<CharacterStatus[]>([]);
  const [statusFolders, setStatusFolders] = useState<CharacterEntryFolder[]>([]);
  const [activeStatusCategoryId, setActiveStatusCategoryId] = useState<string | null>(null);
  const [collapsedStatusFolders, setCollapsedStatusFolders] = useState<string[]>([]);
  const [expandedStatusDescriptions, setExpandedStatusDescriptions] = useState<string[]>([]);
  const [expandedStatusActionDescriptions, setExpandedStatusActionDescriptions] = useState<string[]>([]);
  const [charGeneralItems, setCharGeneralItems] = useState<CharacterGeneralItem[]>([]);
  const [expandedGeneralItemDescriptions, setExpandedGeneralItemDescriptions] = useState<string[]>([]);
  const [charInventory, setCharInventory] = useState<CharacterInventoryItem[]>([]);
  const [inventoryFolders, setInventoryFolders] = useState<CharacterEntryFolder[]>([]);
  const [activeInventoryCategoryId, setActiveInventoryCategoryId] = useState<string | null>(null);
  const [collapsedInventoryFolders, setCollapsedInventoryFolders] = useState<string[]>([]);
  const [collapsedInventoryItems, setCollapsedInventoryItems] = useState<string[]>([]);
  const [expandedInventoryDescriptions, setExpandedInventoryDescriptions] = useState<string[]>([]);
  const [expandedInventoryActionDescriptions, setExpandedInventoryActionDescriptions] = useState<string[]>([]);
  const [collapsedSheetQuickRoll, setCollapsedSheetQuickRoll] = useState(false);
  const [charSpells, setCharSpells] = useState<CharacterSpell[]>([]);
  const [spellFolders, setSpellFolders] = useState<CharacterEntryFolder[]>([]);
  const [activeSpellCategoryId, setActiveSpellCategoryId] = useState<string | null>(null);
  const [collapsedSpellFolders, setCollapsedSpellFolders] = useState<string[]>([]);
  const [expandedSpellDescriptions, setExpandedSpellDescriptions] = useState<string[]>([]);
  const [expandedSpellActionDescriptions, setExpandedSpellActionDescriptions] = useState<string[]>([]);
  const [homebrewImageUploadTarget, setHomebrewImageUploadTarget] = useState<{ type: 'general-item' | 'inventory-item' | 'spell'; id: string } | null>(null);
  const [homebrewImageUploadingId, setHomebrewImageUploadingId] = useState<string | null>(null);
  const [partyTransferTarget, setPartyTransferTarget] = useState<{
    kind: 'item' | 'spell' | 'status';
    entry: CharacterGeneralItem | CharacterInventoryItem | CharacterSpell | CharacterStatus;
  } | null>(null);
  const [partyTransferOptions, setPartyTransferOptions] = useState<Array<{ campaignName: string; party: PartyData }>>([]);
  const [isLoadingPartyTransferOptions, setIsLoadingPartyTransferOptions] = useState(false);
  const [expandedBackstory, setExpandedBackstory] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState(false);
  const [showPortraitPicker, setShowPortraitPicker] = useState(false);
  const [modFormula, setModFormula] = useState<string>('rounddown((@value - 10) / 2)');
  const [showModOptions, setShowModOptions] = useState<boolean>(false);
  const [sheetDiceMacros, setSheetDiceMacros] = useState<CharacterDiceMacro[]>(DEFAULT_CHARACTER_DICE_STATE.macros);
  const [diceMacroFolders, setDiceMacroFolders] = useState<CharacterEntryFolder[]>([]);
  const [activeMacroCategoryId, setActiveMacroCategoryId] = useState<MacroSheetSubTab>('main');
  const [collapsedDiceMacroFolders, setCollapsedDiceMacroFolders] = useState<string[]>([]);
  const [charScripts, setCharScripts] = useState<CharacterScript[]>([]);
  const [scriptFolders, setScriptFolders] = useState<CharacterEntryFolder[]>([]);
  const [activeScriptCategoryId, setActiveScriptCategoryId] = useState<ScriptSheetSubTab>('main');
  const [collapsedScriptFolders, setCollapsedScriptFolders] = useState<string[]>([]);
  const [scriptTriggerEvent, setScriptTriggerEvent] = useState<{ trigger: CharacterScriptTrigger; nonce: number } | null>(null);
  const [mainDiceState, setMainDiceState] = useState<UserDiceSettings>(DEFAULT_CHARACTER_DICE_STATE);
  const [rollResults, setRollResults] = useState<RollResult[]>([]);
  const [rollPopupResult, setRollPopupResult] = useState<RollResult | null>(null);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [macroEditBuffer, setMacroEditBuffer] = useState<Partial<CharacterDiceMacro>>({});
  const [diceError, setDiceError] = useState<string | null>(null);
  const [quickDice, setQuickDice] = useState<Record<number, number>>({});
  const [quickMod, setQuickMod] = useState<number>(0);
  const [quickAdv, setQuickAdv] = useState<number>(0);
  const [quickDescription, setQuickDescription] = useState('');
  const [quickAttrInput, setQuickAttrInput] = useState('');
  const [quickAttrRefs, setQuickAttrRefs] = useState<string[]>([]);
  const [hasLoadedMainDiceState, setHasLoadedMainDiceState] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const statusDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const generalItemDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const inventoryDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const inventoryActionDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const spellDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const spellActionDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const backstoryRef = useRef<HTMLTextAreaElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const attributeImportInputRef = useRef<HTMLInputElement | null>(null);
  const homebrewImageInputRef = useRef<HTMLInputElement | null>(null);
  const galleryUploadInputRef = useRef<HTMLInputElement | null>(null);
  const historyCloseTimeoutRef = useRef<number | null>(null);
  const rollPopupTimeoutRef = useRef<number | null>(null);

  const dismissRollPopup = useCallback(() => {
    if (rollPopupTimeoutRef.current) {
      window.clearTimeout(rollPopupTimeoutRef.current);
      rollPopupTimeoutRef.current = null;
    }
    setRollPopupResult(null);
  }, []);

  const showRollPopup = useCallback((result: RollResult) => {
    setRollPopupResult(result);
    if (rollPopupTimeoutRef.current) {
      window.clearTimeout(rollPopupTimeoutRef.current);
    }
    rollPopupTimeoutRef.current = window.setTimeout(() => {
      setRollPopupResult(null);
      rollPopupTimeoutRef.current = null;
    }, 10000);
  }, []);

  const addRollResults = useCallback((results: RollResult | RollResult[]) => {
    const nextResults = Array.isArray(results) ? results : [results];
    if (nextResults.length === 0) return;
    setRollResults(prev => [...nextResults, ...prev]);
    showRollPopup(nextResults[0]);
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [showRollPopup]);

  useEffect(() => () => {
    if (rollPopupTimeoutRef.current) {
      window.clearTimeout(rollPopupTimeoutRef.current);
    }
  }, []);

  // ── Auth & Data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return authProvider.onAuthChange((state) => {
      setUserId(state.uid);
      setUserEmail(state.email);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadAdminAccess(userId, userEmail).then((access) => {
      if (cancelled) return;
      setIsAdmin(access.isAdmin);
      setAdminSource(access.source);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, userEmail]);

  useEffect(() => {
    if (!userId || userId === 'guest') {
      setUserProfiles([]);
      return;
    }

    let cancelled = false;
    loadUserProfiles().then((profiles) => {
      if (!cancelled) setUserProfiles(profiles);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const fetchAll = async () => {
    const chars = await loadCharacters(userId, isAdmin);
    setCharacters(chars);
    const favs = await loadFavorites(userId);
    setFavoriteIds(favs);
    if (embeddedMode && embeddedCharacterId) {
      setSelectedCharacter(chars.find(character => character.id === embeddedCharacterId) || null);
      setIsViewingSheet(true);
    } else if (chars.length > 0 && !selectedCharacter) {
      setSelectedCharacter(chars[0]);
    }
  };

  useEffect(() => { fetchAll(); }, [userId, isAdmin]);

  useEffect(() => {
    if (!embeddedMode) return;
    setIsViewingSheet(true);
    if (!embeddedCharacterId) {
      setSelectedCharacter(null);
      return;
    }
    const nextCharacter = characters.find(character => character.id === embeddedCharacterId) || null;
    setSelectedCharacter(nextCharacter);
  }, [embeddedMode, embeddedCharacterId, characters]);

  useEffect(() => {
    let next = [...characters];
    if (searchName.trim()) next = next.filter(c => c.name.toLowerCase().includes(searchName.toLowerCase()));
    if (showOnlyFavs) next = next.filter(c => favoriteIds.includes(c.id));
    if (filterTags.length > 0) {
      next = next.filter(c => {
        const t = `${c.race} ${c.className} ${(c.tags || []).join(' ')}`.toLowerCase();
        return filterTags.every(tag => t.includes(tag.toLowerCase()));
      });
    }
    setFilteredCharacters(next);
  }, [characters, showOnlyFavs, favoriteIds]);

  useEffect(() => {
    if (selectedCharacter) {
      setActiveBioSubTab('main');
      setEditName(selectedCharacter.name);
      setEditRace(selectedCharacter.race);
      setEditClass(selectedCharacter.className);
      setEditAge(selectedCharacter.age || '');
      setEditBodyAge(selectedCharacter.bodyAge || '');
      setEditMentalAge(selectedCharacter.mentalAge || '');
      setEditSpiritualAge(selectedCharacter.spiritualAge || '');
      setEditAlignment(selectedCharacter.alignment || '');
      setEditVisibility(selectedCharacter.visibility ?? 'private');
      setSendToSpreadsheet(selectedCharacter.sendToSpreadsheet ?? true);
      setBackstory(selectedCharacter.backstory ?? selectedCharacter.bio ?? '');
      setNotes(selectedCharacter.notes || '');
      const nextPortraitUrl = getCharacterPortraitDisplayUrl(selectedCharacter);
      setPortraitUrl(nextPortraitUrl);
      setPortraitImportUrl(nextPortraitUrl);
      setPortraitLoadError(false);
      setGalleryImages(selectedCharacter.gallery || []);
      setDisplayStats(selectedCharacter.displayStats || []);
      setDisplaySlotStates(selectedCharacter.displaySlotStates || {});
      setOverviewSettings({
        mainAttributeIds: selectedCharacter.overviewSettings?.mainAttributeIds || [],
        valueBoxes: selectedCharacter.overviewSettings?.valueBoxes || [],
      });
      setAttributeSectionModes({ ...DEFAULT_ATTRIBUTE_SECTION_MODES, ...(selectedCharacter.attributeSectionModes || {}) });
      setAttributeSectionColumns({ ...DEFAULT_ATTRIBUTE_SECTION_COLUMNS, ...(selectedCharacter.attributeSectionColumns || {}) });
      setCharTags(selectedCharacter.tags || []);
      setMainAttrs(selectedCharacter.mainAttributes || []);
      setSecondaryAttrs(selectedCharacter.secondaryAttributes || []);
      setSkills(selectedCharacter.skills || []);
      setOtherAttrs(selectedCharacter.otherAttributes || []);
      setResistances(selectedCharacter.resistances || []);
      setBars(selectedCharacter.bars || []);
      setSheetDiceMacros(selectedCharacter.diceMacros || DEFAULT_CHARACTER_DICE_STATE.macros);
      setDiceMacroFolders(selectedCharacter.diceMacroFolders || []);
      setActiveMacroCategoryId('main');
      setCollapsedDiceMacroFolders(selectedCharacter.collapsedDiceMacroFolderIds || []);
      setCharScripts(selectedCharacter.scripts || []);
      setScriptFolders(selectedCharacter.scriptFolders || []);
      setActiveScriptCategoryId('main');
      setCollapsedScriptFolders(selectedCharacter.collapsedScriptFolderIds || []);
      setCharStatuses(selectedCharacter.statuses || []);
      setStatusFolders(selectedCharacter.statusFolders || []);
      setActiveStatusCategoryId(null);
      setCollapsedStatusFolders(selectedCharacter.collapsedStatusFolderIds || []);
      setCharGeneralItems((selectedCharacter.generalItems || []).map(normalizeGeneralItem));
      setCharInventory(selectedCharacter.inventory || []);
      setInventoryFolders(selectedCharacter.inventoryFolders || []);
      setActiveInventoryCategoryId(null);
      setCollapsedInventoryFolders(selectedCharacter.collapsedInventoryFolderIds || []);
      setCollapsedSheetQuickRoll(selectedCharacter.collapsedSheetQuickRoll ?? false);
      setCharSpells(selectedCharacter.spells || []);
      setSpellFolders(selectedCharacter.spellFolders || []);
      setActiveSpellCategoryId(null);
      setCollapsedSpellFolders(selectedCharacter.collapsedSpellFolderIds || []);
      setCollapsedInventoryItems((selectedCharacter.inventory || []).filter(item => item.hidden).map(item => item.id));
      setModFormula(selectedCharacter.modifierFormula || 'Math.floor((@value - 10) / 2)');
      setOwnerTransferUid(selectedCharacter.userId || '');
      setOwnerTransferStatus(null);
      setControlAccessUid('');
      setViewAccessUid('');
      setAccessStatus(null);
    }
  }, [selectedCharacter]);

  useEffect(() => {
    if (activeInventoryCategoryId && !inventoryFolders.some(folder => folder.id === activeInventoryCategoryId)) {
      setActiveInventoryCategoryId(null);
    }
  }, [activeInventoryCategoryId, inventoryFolders]);

  useEffect(() => {
    if (activeSpellCategoryId && !spellFolders.some(folder => folder.id === activeSpellCategoryId)) {
      setActiveSpellCategoryId(null);
    }
  }, [activeSpellCategoryId, spellFolders]);

  useEffect(() => {
    if (activeStatusCategoryId && !statusFolders.some(folder => folder.id === activeStatusCategoryId)) {
      setActiveStatusCategoryId(null);
    }
  }, [activeStatusCategoryId, statusFolders]);

  useEffect(() => {
    if (activeMacroCategoryId !== 'main' && activeMacroCategoryId !== 'rolls' && !diceMacroFolders.some(folder => folder.id === activeMacroCategoryId)) {
      setActiveMacroCategoryId('main');
    }
  }, [activeMacroCategoryId, diceMacroFolders]);

  useEffect(() => {
    if (activeScriptCategoryId !== 'main' && !scriptFolders.some(folder => folder.id === activeScriptCategoryId)) {
      setActiveScriptCategoryId('main');
    }
  }, [activeScriptCategoryId, scriptFolders]);

  useEffect(() => {
    const previousCharacterId = previousSelectedCharacterIdRef.current;
    const currentCharacterId = selectedCharacter?.id || null;
    previousSelectedCharacterIdRef.current = currentCharacterId;

    if (!selectedCharacter || previousCharacterId === currentCharacterId) return;
    setRollResults([]);
    setEditingMacroId(null);
    setMacroEditBuffer({});
    setDiceError(null);
    setQuickDice({});
    setQuickMod(0);
    setQuickAdv(0);
    setQuickDescription('');
    setQuickAttrInput('');
    setQuickAttrRefs([]);
    setActiveSheetTab('bio');
    setActiveMacroCategoryId('main');
    setExpandedStatusDescriptions([]);
    setExpandedStatusActionDescriptions([]);
    setExpandedGeneralItemDescriptions([]);
    setExpandedInventoryDescriptions([]);
    setExpandedInventoryActionDescriptions([]);
    setExpandedSpellDescriptions([]);
    setExpandedSpellActionDescriptions([]);
    setExpandedBackstory(false);
    setExpandedNotes(false);
    setShowPortraitPicker(false);
  }, [selectedCharacter]);

  useEffect(() => {
    charStatuses.forEach((status) => {
      const el = statusDescriptionRefs.current[status.id];
      if (!el) return;
      if (expandedStatusDescriptions.includes(status.id)) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      } else {
        el.style.height = '';
      }
    });
  }, [charStatuses, expandedStatusDescriptions]);

  useEffect(() => {
    charGeneralItems.forEach((item) => {
      const el = generalItemDescriptionRefs.current[item.id];
      if (!el) return;
      if (expandedGeneralItemDescriptions.includes(item.id)) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      } else {
        el.style.height = '';
      }
    });
  }, [charGeneralItems, expandedGeneralItemDescriptions]);

  useEffect(() => {
    charInventory.forEach((item) => {
      const el = inventoryDescriptionRefs.current[item.id];
      if (!el) return;
      if (expandedInventoryDescriptions.includes(item.id)) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      } else {
        el.style.height = '';
      }
    });
  }, [charInventory, expandedInventoryDescriptions]);

  useEffect(() => {
    charInventory.forEach((item) => {
      (item.actions || []).forEach((action) => {
        const el = inventoryActionDescriptionRefs.current[action.id];
        if (!el) return;
        if (expandedInventoryActionDescriptions.includes(action.id)) {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        } else {
          el.style.height = '';
        }
      });
    });
  }, [charInventory, expandedInventoryActionDescriptions]);

  useEffect(() => {
    charSpells.forEach((spell) => {
      const el = spellDescriptionRefs.current[spell.id];
      if (!el) return;
      if (expandedSpellDescriptions.includes(spell.id)) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      } else {
        el.style.height = '';
      }
    });
  }, [charSpells, expandedSpellDescriptions]);

  useEffect(() => {
    charSpells.forEach((spell) => {
      (spell.actions || []).forEach((action) => {
        const el = spellActionDescriptionRefs.current[action.id];
        if (!el) return;
        if (expandedSpellActionDescriptions.includes(action.id)) {
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        } else {
          el.style.height = '';
        }
      });
    });
  }, [charSpells, expandedSpellActionDescriptions]);

  useEffect(() => {
    if (!backstoryRef.current) return;
    if (expandedBackstory) {
      backstoryRef.current.style.height = 'auto';
      backstoryRef.current.style.height = `${backstoryRef.current.scrollHeight}px`;
    } else {
      backstoryRef.current.style.height = '';
    }
  }, [backstory, expandedBackstory]);

  useEffect(() => {
    if (!notesRef.current) return;
    if (expandedNotes) {
      notesRef.current.style.height = 'auto';
      notesRef.current.style.height = `${notesRef.current.scrollHeight}px`;
    } else {
      notesRef.current.style.height = '';
    }
  }, [notes, expandedNotes]);

  useEffect(() => {
    setHasLoadedMainDiceState(false);
    loadUserDiceSettings(userId).then((settings) => {
      setMainDiceState({
        macros: settings.macros?.length ? settings.macros : DEFAULT_CHARACTER_DICE_STATE.macros,
        webhookUrl: settings.webhookUrl ?? '',
        autoSend: settings.autoSend ?? false,
      });
      setHasLoadedMainDiceState(true);
    });
  }, [userId]);

  useEffect(() => {
    if (!hasLoadedMainDiceState) return;
    saveUserDiceSettings(userId, mainDiceState);
  }, [userId, mainDiceState, hasLoadedMainDiceState]);

  const applyAttributePresetJson = (raw: string) => {
    const parsed = JSON.parse(raw) as Partial<CharacterAttributePreset>;
    setMainAttrs(Array.isArray(parsed.mainAttributes) ? parsed.mainAttributes : []);
    setSecondaryAttrs(Array.isArray(parsed.secondaryAttributes) ? parsed.secondaryAttributes : []);
    setSkills(Array.isArray(parsed.skills) ? parsed.skills : []);
    setOtherAttrs(Array.isArray(parsed.otherAttributes) ? parsed.otherAttributes : []);
    setResistances(Array.isArray(parsed.resistances) ? parsed.resistances : []);
    setBars(Array.isArray(parsed.bars) ? parsed.bars : []);
    setDisplayStats(Array.isArray(parsed.displayStats) ? parsed.displayStats : []);
    setDisplaySlotStates(parsed.displaySlotStates || {});
    setOverviewSettings({
      mainAttributeIds: parsed.overviewSettings?.mainAttributeIds || [],
      valueBoxes: parsed.overviewSettings?.valueBoxes || [],
    });
    setAttributeSectionModes({
      ...DEFAULT_ATTRIBUTE_SECTION_MODES,
      ...(parsed.attributeSectionModes || {}),
    });
    setAttributeSectionColumns({
      ...DEFAULT_ATTRIBUTE_SECTION_COLUMNS,
      ...(parsed.attributeSectionColumns || {}),
    });
    if (typeof parsed.modifierFormula === 'string' && parsed.modifierFormula.trim()) {
      setModFormula(parsed.modifierFormula);
    }
  };

  const handleImportAttributePresetFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      applyAttributePresetJson(await file.text());
    } catch {
      window.alert('Invalid preset JSON file.');
    }
  };

  const createLocalVariable = (kind: CharacterLocalVariable['kind'] = 'variable'): CharacterLocalVariable => ({
    id: `local_${uid()}`,
    description: '',
    value: '0',
    kind,
    replenishTrigger: 'custom',
    replenishMode: 'gain',
    replenishAmount: '0',
    maxValue: '',
  });

  const getLocalVariableContext = (
    variables: CharacterLocalVariable[] | undefined,
    globalContext: Record<string, number>
  ): Record<string, number> => {
    const localContext: Record<string, number> = {};
    normalizeLocalVariables(variables).forEach((variable) => {
      if (!variable.id) return;
      if (variable.kind === 'input') return;
      if (variable.kind === 'resource') {
        localContext[variable.id] = parseReplenishAmount(variable.value);
        return;
      }
      localContext[variable.id] = evalCharFormula(variable.value || '0', globalContext, localContext);
    });
    return localContext;
  };

  const requestLocalInputValues = (
    variables: CharacterLocalVariable[],
    title = 'Input Values',
  ): Promise<Record<string, number> | null> => (
    new Promise((resolve) => {
      const drafts = variables.reduce<Record<string, string>>((next, variable) => {
        next[variable.id] = '0';
        return next;
      }, {});
      setLocalInputDrafts(drafts);
      setLocalInputError('');
      setLocalInputRequest({
        title,
        variables,
        resolve: (values) => {
          setLocalInputRequest(null);
          setLocalInputError('');
          resolve(values);
        },
      });
    })
  );

  const getLocalVariableContextWithInputs = async (
    variables: CharacterLocalVariable[] | undefined,
    globalContext: Record<string, number>,
    formula: string,
    title = 'Input Values',
  ): Promise<Record<string, number> | null> => {
    const normalizedVariables = normalizeLocalVariables(variables);
    const localContext = getLocalVariableContext(normalizedVariables, globalContext);
    const referencedInputIds = Array.from(new Set(
      Array.from(formula.matchAll(/@@([a-zA-Z0-9_-]+)/g))
        .map(match => match[1])
        .filter(id => normalizedVariables.some(variable => variable.kind === 'input' && variable.id === id))
    ));

    if (referencedInputIds.length === 0) return localContext;

    const inputVariables = referencedInputIds
      .map(inputId => normalizedVariables.find(variable => variable.kind === 'input' && variable.id === inputId))
      .filter((variable): variable is CharacterLocalVariable => !!variable);
    const inputValues = await requestLocalInputValues(inputVariables, title);
    if (!inputValues) return null;
    Object.assign(localContext, inputValues);

    return localContext;
  };

  const getCharacterContext = () => {
    const context: Record<string, number> = {};
    const baseAttrs = [...(mainAttrs || []), ...(secondaryAttrs || []), ...(otherAttrs || []), ...(resistances || [])];
    const skillAttrs = skills || [];
    const allAttrs = [...baseAttrs, ...skillAttrs];
    const mainAttrIds = (mainAttrs || []).map(a => a.id).filter(Boolean);
    const baseAttrIds = baseAttrs.map(a => a.id).filter(Boolean);
    const skillIds = skillAttrs.map(a => a.id).filter(Boolean);
    const attrIds = allAttrs.map(a => a.id).filter(Boolean);
    const modIds = mainAttrIds.map(id => `${id}_mod`);

    const applyStatusEffects = (
      targetIds: string[],
      baseValues: Record<string, number>,
      sourceContext: Record<string, number>
    ) => {
      const nextValues = { ...baseValues };
      const effectBuckets: Record<string, number[]> = {};

      (charStatuses || []).forEach(status => {
        if ((status.active ?? true) === false) return;
        const statusLocalContext = getLocalVariableContext(status.localVariables, sourceContext);
        (status.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext, statusLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });

        (status.actions || []).forEach(action => {
          (action.effects || []).forEach(effect => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
              const effVal = evalCharFormula(effect.value || '0', sourceContext, statusLocalContext);
              if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
              effectBuckets[effect.targetId].push(effVal);
            }
          });
        });
      });

      Object.entries(effectBuckets).forEach(([targetId, values]) => {
        nextValues[targetId] = applyAttributeEffectValue(targetId, nextValues[targetId] || 0, values);
      });

      return nextValues;
    };

    const applyInventoryEffects = (
      targetIds: string[],
      baseValues: Record<string, number>,
      sourceContext: Record<string, number>
    ) => {
      const nextValues = { ...baseValues };
      const effectBuckets: Record<string, number[]> = {};

      (charInventory || []).forEach(item => {
        if (!item.equipped) return;
        const itemLocalContext = getLocalVariableContext(item.localVariables, sourceContext);

        (item.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext, itemLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });

        (item.actions || []).forEach(action => {
          (action.effects || []).forEach(effect => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
              const effVal = evalCharFormula(effect.value || '0', sourceContext, itemLocalContext);
              if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
              effectBuckets[effect.targetId].push(effVal);
            }
          });
        });
      });

      (charGeneralItems || []).map(normalizeGeneralItem).forEach(item => {
        if (!item.equipped) return;
        const itemLocalContext = getLocalVariableContext(item.localVariables, sourceContext);

        (item.effects || []).forEach(effect => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext, itemLocalContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });

        (item.actions || []).forEach(action => {
          (action.effects || []).forEach(effect => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
              const effVal = evalCharFormula(effect.value || '0', sourceContext, itemLocalContext);
              if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
              effectBuckets[effect.targetId].push(effVal);
            }
          });
        });
      });

      (charSpells || []).forEach(spell => {
        const spellLocalContext = getLocalVariableContext(spell.localVariables, sourceContext);
        (spell.actions || []).forEach(action => {
          (action.effects || []).forEach(effect => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
              const effVal = evalCharFormula(effect.value || '0', sourceContext, spellLocalContext);
              if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
              effectBuckets[effect.targetId].push(effVal);
            }
          });
        });
      });

      Object.entries(effectBuckets).forEach(([targetId, values]) => {
        nextValues[targetId] = applyAttributeEffectValue(targetId, nextValues[targetId] || 0, values);
      });

      return nextValues;
    };

    const MAX_PASSES = 12;

    attrIds.forEach((id) => {
      context[id] = 0;
    });
    modIds.forEach((id) => {
      context[id] = 0;
    });
    (bars || []).forEach((bar) => {
      if (bar.id) {
        context[`${bar.id}_current`] = 0;
        if (getBarMode(bar) === 'resource') {
          context[`${bar.id}_reset`] = 0;
        } else {
          context[`${bar.id}_max`] = 0;
        }
      }
    });

    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const previousContext = { ...context };
      const nextContext: Record<string, number> = {};

      baseAttrs.forEach(attr => {
        if (attr.id) {
          nextContext[attr.id] = evalCharFormula(attr.value || '0', previousContext);
        }
      });

      const attributesWithStatuses = applyStatusEffects(
        baseAttrIds,
        nextContext,
        { ...previousContext, ...nextContext }
      );

      const attributesWithItemEffects = applyInventoryEffects(
        baseAttrIds,
        attributesWithStatuses,
        { ...previousContext, ...attributesWithStatuses }
      );

      mainAttrIds.forEach(attrId => {
        const attrValue = attributesWithItemEffects[attrId] || 0;
        const formula = (modFormula || 'Math.floor((@value - 10) / 2)').replace(/@value/g, attrValue.toString());
        attributesWithItemEffects[`${attrId}_mod`] = evalCharFormula(formula, {
          ...previousContext,
          ...attributesWithItemEffects,
        });
      });

      const withModStatuses = applyStatusEffects(
        modIds,
        attributesWithItemEffects,
        { ...previousContext, ...attributesWithItemEffects }
      );

      const withModItemEffects = applyInventoryEffects(
        modIds,
        withModStatuses,
        { ...previousContext, ...withModStatuses }
      );

      skillAttrs.forEach((skill) => {
        if (!skill.id) return;
        const legacyBaseValue = evalCharFormula(skill.value || '0', {
          ...previousContext,
          ...withModItemEffects,
        });
        const linkedModifierValue = skill.linkedMainAttributeId
          ? withModItemEffects[`${skill.linkedMainAttributeId}_mod`] ?? 0
          : 0;
        const baseValue = legacyBaseValue + linkedModifierValue;
        const proficiencyValue = withModItemEffects.proficiency ?? 0;
        const mode = skill.proficiencyMode || 'none';
        const proficiencyBonus = mode === 'half'
          ? Math.floor(proficiencyValue / 2)
          : mode === 'proficient'
            ? proficiencyValue
            : mode === 'expertise'
              ? proficiencyValue * 2
              : 0;
        withModItemEffects[skill.id] = applyAttributeEffectValue(
          skill.id,
          baseValue,
          proficiencyBonus !== 0 ? [proficiencyBonus] : [],
        );
      });

      const skillValuesWithStatuses = applyStatusEffects(
        skillIds,
        withModItemEffects,
        { ...previousContext, ...withModItemEffects }
      );

      const allValuesWithEffects = applyInventoryEffects(
        skillIds,
        skillValuesWithStatuses,
        { ...previousContext, ...skillValuesWithStatuses }
      );

      (bars || []).forEach(bar => {
        if (bar.id) {
          const barMode = getBarMode(bar);
          const baseCurrentId = `${bar.id}_current`;
          allValuesWithEffects[baseCurrentId] = evalCharFormula(bar.currentValue || '0', {
            ...previousContext,
            ...allValuesWithEffects,
          });
          if (barMode === 'resource') {
            allValuesWithEffects[`${bar.id}_reset`] = evalCharFormula(bar.resetValue || '0', {
              ...previousContext,
              ...allValuesWithEffects,
            });
          } else {
            allValuesWithEffects[`${bar.id}_max`] = evalCharFormula(bar.maxValue || '0', {
              ...previousContext,
              ...allValuesWithEffects,
            });
          }
        }
      });

      const resourceBarCurrentIds = (bars || [])
        .filter(bar => bar.id && getBarMode(bar) === 'resource')
        .map(bar => `${bar.id}_current`);
      if (resourceBarCurrentIds.length > 0) {
        const resourceValuesWithStatuses = applyStatusEffects(
          resourceBarCurrentIds,
          allValuesWithEffects,
          { ...previousContext, ...allValuesWithEffects }
        );
        Object.assign(allValuesWithEffects, applyInventoryEffects(
          resourceBarCurrentIds,
          resourceValuesWithStatuses,
          { ...previousContext, ...resourceValuesWithStatuses }
        ));
      }

      const nextKeys = new Set([...Object.keys(context), ...Object.keys(allValuesWithEffects)]);
      let hasChanged = false;

      nextKeys.forEach((key) => {
        const prevValue = previousContext[key] ?? 0;
        const nextValue = allValuesWithEffects[key] ?? 0;
        context[key] = nextValue;
        if (Math.abs(nextValue - prevValue) > 0.0001) {
          hasChanged = true;
        }
      });

      if (!hasChanged) {
        break;
      }
    }

    return context;
  };

  const getCharacterReferenceIds = () => {
    const ids = new Set<string>();
    [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs, ...resistances].forEach((attr) => {
      if (attr.id) ids.add(attr.id);
    });
    mainAttrs.forEach((attr) => {
      if (attr.id) ids.add(`${attr.id}_mod`);
    });
    bars.forEach((bar) => {
      if (bar.id) {
        ids.add(`${bar.id}_current`);
        if (getBarMode(bar) === 'resource') {
          ids.add(`${bar.id}_reset`);
        } else {
          ids.add(`${bar.id}_max`);
        }
      }
    });
    return ids;
  };

  useEffect(() => {
    if (!selectedCharacter || bars.length === 0) return;

    const context = getCharacterContext();
    let changed = false;
    const nextBars = bars.map((bar) => {
      if (!bar.id || getBarMode(bar) !== 'default') return bar;

      const current = context[`${bar.id}_current`];
      const max = context[`${bar.id}_max`];
      if (!Number.isFinite(current) || !Number.isFinite(max)) return bar;

      const clampedMax = Math.max(0, max);
      if (current <= clampedMax) return bar;

      changed = true;
      return {
        ...bar,
        currentValue: `${Math.round(clampedMax * 100) / 100}`,
      };
    });

    if (changed) {
      setBars(nextBars);
    }
  }, [selectedCharacter, bars, mainAttrs, secondaryAttrs, skills, otherAttrs, resistances, charStatuses, charGeneralItems, charInventory, charSpells, modFormula]);

  const getProfileLabel = (uid: string) => {
    const profile = userProfiles.find((item) => item.uid === uid);
    return profile?.email || profile?.displayName || uid;
  };

  const canOwnCharacter = (character: CharacterData | null | undefined) => (
    !!character && !!userId && (character.userId === userId || !character.userId)
  );

  const canControlCharacter = (character: CharacterData | null | undefined) => (
    !!character && !!userId && (character.controlUserIds || []).includes(userId)
  );

  const canViewPrivateCharacter = (character: CharacterData | null | undefined) => (
    !!character && !!userId && (character.viewUserIds || []).includes(userId)
  );

  const isSelectedCharacterOwnedByUser = canOwnCharacter(selectedCharacter);
  const isSelectedCharacterControlledByUser = canControlCharacter(selectedCharacter);
  const isSelectedCharacterViewedByUser = canViewPrivateCharacter(selectedCharacter);
  const canTransferCharacterOwner = !!selectedCharacter && (isAdmin || isSelectedCharacterOwnedByUser);
  const canManageControlAccess = canTransferCharacterOwner;
  const canManageViewAccess = !!selectedCharacter && (isAdmin || isSelectedCharacterOwnedByUser || isSelectedCharacterControlledByUser);
  const isCharacterOwner = !!selectedCharacter && (isAdmin || isSelectedCharacterOwnedByUser || isSelectedCharacterControlledByUser);
  const canEditInventory = isCharacterOwner;
  const selectedAccessRole = isAdmin
    ? 'Admin'
    : isSelectedCharacterOwnedByUser
      ? 'Owner'
      : isSelectedCharacterControlledByUser
        ? 'Control'
        : isSelectedCharacterViewedByUser
          ? 'View'
          : 'Viewer';

  const createFolder = (name: string, parentId?: string | null): CharacterEntryFolder => ({
    id: `folder_${uid()}`,
    name,
    color: '#b45309',
    parentId: parentId ?? null,
    hidden: false,
  });

  const isFolderDescendant = (folders: CharacterEntryFolder[], folderId: string, possibleParentId: string | null | undefined): boolean => {
    let current = possibleParentId ?? null;
    while (current) {
      if (current === folderId) return true;
      current = folders.find(folder => folder.id === current)?.parentId ?? null;
    }
    return false;
  };

  const getFolderOptions = (folders: CharacterEntryFolder[], parentId: string | null = null, depth = 0): Array<{ id: string; label: string }> => {
    const children = folders.filter(folder => (folder.parentId ?? null) === parentId);
    return children.flatMap(folder => [
      { id: folder.id, label: `${'— '.repeat(depth)}${folder.name || 'Untitled Folder'}` },
      ...getFolderOptions(folders, folder.id, depth + 1),
    ]);
  };

  const getFolderDepth = (folders: CharacterEntryFolder[], folderId: string | null | undefined): number => {
    let depth = 0;
    let current = folderId ?? null;
    while (current) {
      current = folders.find(folder => folder.id === current)?.parentId ?? null;
      depth += 1;
    }
    return depth;
  };

  const getFolderPathLabel = (folders: CharacterEntryFolder[], folderId: string | null | undefined): string => {
    const names: string[] = [];
    let current = folderId ?? null;
    while (current) {
      const folder = folders.find(entry => entry.id === current);
      if (!folder) break;
      names.unshift(folder.name || 'Untitled Folder');
      current = folder.parentId ?? null;
    }
    return names.join(' / ');
  };

  const getOrderedFolders = (folders: CharacterEntryFolder[], parentId: string | null = null): CharacterEntryFolder[] => {
    const directChildren = folders.filter(folder => (folder.parentId ?? null) === parentId);
    return directChildren.flatMap(folder => [folder, ...getOrderedFolders(folders, folder.id)]);
  };

  const getFolderOrderIndex = (folders: CharacterEntryFolder[], folderId: string | null | undefined): number => {
    if (!folderId) return -1;
    return getOrderedFolders(folders).findIndex(folder => folder.id === folderId);
  };

  const getRootFolderId = (folders: CharacterEntryFolder[], folderId: string | null | undefined): string | null => {
    let current = folderId ?? null;
    let root: string | null = null;
    while (current) {
      root = current;
      current = folders.find(folder => folder.id === current)?.parentId ?? null;
    }
    return root;
  };

  const isFolderInTree = (folders: CharacterEntryFolder[], rootFolderId: string, folderId: string | null | undefined): boolean => (
    folderId === rootFolderId || isFolderDescendant(folders, rootFolderId, folderId)
  );

  const isFolderVisible = (folders: CharacterEntryFolder[], folderId: string | null | undefined): boolean => {
    let current = folderId ?? null;
    while (current) {
      const folder = folders.find(entry => entry.id === current);
      if (!folder) break;
      if (folder.hidden) return false;
      current = folder.parentId ?? null;
    }
    return true;
  };

  const getCollapsedFolderAncestor = (
    folders: CharacterEntryFolder[],
    collapsedFolderIds: string[],
    folderId: string | null | undefined
  ): string | null => {
    let current = folderId ?? null;
    let collapsedAncestor: string | null = null;
    while (current) {
      if (collapsedFolderIds.includes(current)) {
        collapsedAncestor = current;
      }
      current = folders.find(entry => entry.id === current)?.parentId ?? null;
    }
    return collapsedAncestor;
  };

  const updateInventoryFolder = (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => {
    setInventoryFolders(prev => prev.map(folder => folder.id === folderId ? updater(folder) : folder));
  };

  const moveInventoryFolder = (folderId: string, direction: 'up' | 'down') => {
    setInventoryFolders(prev => {
      const index = prev.findIndex(folder => folder.id === folderId);
      if (index < 0) return prev;
      const parentId = prev[index].parentId ?? null;
      const siblingIndexes = prev
        .map((folder, idx) => ({ folder, idx }))
        .filter(entry => (entry.folder.parentId ?? null) === parentId)
        .map(entry => entry.idx);
      const siblingPosition = siblingIndexes.indexOf(index);
      const targetSiblingPosition = direction === 'up' ? siblingPosition - 1 : siblingPosition + 1;
      if (siblingPosition < 0 || targetSiblingPosition < 0 || targetSiblingPosition >= siblingIndexes.length) return prev;

      const targetIndex = siblingIndexes[targetSiblingPosition];
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      const insertIndex = index < targetIndex ? targetIndex : targetIndex;
      next.splice(insertIndex, 0, moved);
      return next;
    });
  };

  const addInventoryFolder = (parentId: string | null = null) => {
    setInventoryFolders(prev => [...prev, createFolder('New Inventory Folder', parentId)]);
  };

  const updateStatusFolder = (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => {
    setStatusFolders(prev => prev.map(folder => folder.id === folderId ? updater(folder) : folder));
  };

  const moveStatusFolder = (folderId: string, direction: 'up' | 'down') => {
    setStatusFolders(prev => {
      const index = prev.findIndex(folder => folder.id === folderId);
      if (index < 0) return prev;
      const parentId = prev[index].parentId ?? null;
      const siblingIndexes = prev
        .map((folder, idx) => ({ folder, idx }))
        .filter(entry => (entry.folder.parentId ?? null) === parentId)
        .map(entry => entry.idx);
      const siblingPosition = siblingIndexes.indexOf(index);
      const targetSiblingPosition = direction === 'up' ? siblingPosition - 1 : siblingPosition + 1;
      if (siblingPosition < 0 || targetSiblingPosition < 0 || targetSiblingPosition >= siblingIndexes.length) return prev;

      const targetIndex = siblingIndexes[targetSiblingPosition];
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(index < targetIndex ? targetIndex : targetIndex, 0, moved);
      return next;
    });
  };

  const addStatusFolder = (parentId: string | null = null) => {
    setStatusFolders(prev => [...prev, createFolder('New Status Folder', parentId)]);
  };

  const updateDiceMacroFolder = (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => {
    setDiceMacroFolders(prev => prev.map(folder => folder.id === folderId ? updater(folder) : folder));
  };

  const moveDiceMacroFolder = (folderId: string, direction: 'up' | 'down') => {
    setDiceMacroFolders(prev => {
      const index = prev.findIndex(folder => folder.id === folderId);
      if (index < 0) return prev;
      const parentId = prev[index].parentId ?? null;
      const siblingIndexes = prev
        .map((folder, idx) => ({ folder, idx }))
        .filter(entry => (entry.folder.parentId ?? null) === parentId)
        .map(entry => entry.idx);
      const siblingPosition = siblingIndexes.indexOf(index);
      const targetSiblingPosition = direction === 'up' ? siblingPosition - 1 : siblingPosition + 1;
      if (siblingPosition < 0 || targetSiblingPosition < 0 || targetSiblingPosition >= siblingIndexes.length) return prev;

      const targetIndex = siblingIndexes[targetSiblingPosition];
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(index < targetIndex ? targetIndex : targetIndex, 0, moved);
      return next;
    });
  };

  const addDiceMacroFolder = (parentId: string | null = null) => {
    setDiceMacroFolders(prev => [...prev, createFolder('New Macro Folder', parentId)]);
  };

  const updateScriptFolder = (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => {
    setScriptFolders(prev => prev.map(folder => folder.id === folderId ? updater(folder) : folder));
  };

  const moveScriptFolder = (folderId: string, direction: 'up' | 'down') => {
    setScriptFolders(prev => {
      const index = prev.findIndex(folder => folder.id === folderId);
      if (index < 0) return prev;
      const parentId = prev[index].parentId ?? null;
      const siblingIndexes = prev
        .map((folder, idx) => ({ folder, idx }))
        .filter(entry => (entry.folder.parentId ?? null) === parentId)
        .map(entry => entry.idx);
      const siblingPosition = siblingIndexes.indexOf(index);
      const targetSiblingPosition = direction === 'up' ? siblingPosition - 1 : siblingPosition + 1;
      if (siblingPosition < 0 || targetSiblingPosition < 0 || targetSiblingPosition >= siblingIndexes.length) return prev;

      const targetIndex = siblingIndexes[targetSiblingPosition];
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(index < targetIndex ? targetIndex : targetIndex, 0, moved);
      return next;
    });
  };

  const addScriptFolder = (parentId: string | null = null) => {
    setScriptFolders(prev => [...prev, createFolder('New Script Folder', parentId)]);
  };

  const removeScriptFolder = (folderId: string) => {
    setScriptFolders(prev => {
      const folder = prev.find(entry => entry.id === folderId);
      const nextParentId = folder?.parentId ?? null;
      const descendants = new Set<string>();
      const collectDescendants = (parent: string) => {
        prev.forEach(entry => {
          if ((entry.parentId ?? null) === parent) {
            descendants.add(entry.id);
            collectDescendants(entry.id);
          }
        });
      };
      collectDescendants(folderId);

      if (activeScriptCategoryId === folderId || descendants.has(activeScriptCategoryId)) {
        setActiveScriptCategoryId('main');
      }

      setCharScripts(scripts => scripts.map(script => {
        if (script.folderId === folderId) return { ...script, folderId: nextParentId };
        if (script.folderId && descendants.has(script.folderId)) return { ...script, folderId: nextParentId };
        return script;
      }));

      return prev
        .filter(entry => entry.id !== folderId)
        .map(entry => descendants.has(entry.id) ? { ...entry, parentId: nextParentId } : entry);
    });
  };

  const removeDiceMacroFolder = (folderId: string) => {
    setDiceMacroFolders(prev => {
      const folder = prev.find(entry => entry.id === folderId);
      const nextParentId = folder?.parentId ?? null;
      const descendants = new Set<string>();
      const collectDescendants = (parent: string) => {
        prev.forEach(entry => {
          if ((entry.parentId ?? null) === parent) {
            descendants.add(entry.id);
            collectDescendants(entry.id);
          }
        });
      };
      collectDescendants(folderId);

      if (activeMacroCategoryId === folderId || descendants.has(activeMacroCategoryId)) {
        setActiveMacroCategoryId('main');
      }

      setSheetDiceMacros(macros => macros.map(macro => {
        if (macro.folderId === folderId) return { ...macro, folderId: nextParentId };
        if (macro.folderId && descendants.has(macro.folderId)) return { ...macro, folderId: nextParentId };
        return macro;
      }));

      return prev
        .filter(entry => entry.id !== folderId)
        .map(entry => descendants.has(entry.id) ? { ...entry, parentId: nextParentId } : entry);
    });
  };

  const removeStatusFolder = (folderId: string) => {
    setStatusFolders(prev => {
      const folder = prev.find(entry => entry.id === folderId);
      const nextParentId = folder?.parentId ?? null;
      const descendants = new Set<string>();
      const collectDescendants = (parent: string) => {
        prev.forEach(entry => {
          if ((entry.parentId ?? null) === parent) {
            descendants.add(entry.id);
            collectDescendants(entry.id);
          }
        });
      };
      collectDescendants(folderId);

      if (activeStatusCategoryId === folderId || (activeStatusCategoryId && descendants.has(activeStatusCategoryId))) {
        setActiveStatusCategoryId(null);
      }

      setCharStatuses(statuses => statuses.map(status => {
        if (status.folderId === folderId) return { ...status, folderId: nextParentId };
        if (status.folderId && descendants.has(status.folderId)) return { ...status, folderId: nextParentId };
        return status;
      }));

      return prev
        .filter(entry => entry.id !== folderId)
        .map(entry => descendants.has(entry.id) ? { ...entry, parentId: nextParentId } : entry);
    });
  };

  const removeInventoryFolder = (folderId: string) => {
    setInventoryFolders(prev => {
      const folder = prev.find(entry => entry.id === folderId);
      const nextParentId = folder?.parentId ?? null;
      const descendants = new Set<string>();
      const collectDescendants = (parent: string) => {
        prev.forEach(entry => {
          if ((entry.parentId ?? null) === parent) {
            descendants.add(entry.id);
            collectDescendants(entry.id);
          }
        });
      };
      collectDescendants(folderId);

      if (activeInventoryCategoryId === folderId || (activeInventoryCategoryId && descendants.has(activeInventoryCategoryId))) {
        setActiveInventoryCategoryId(null);
      }

      setCharInventory(items => items.map(item => {
        if (item.folderId === folderId) return { ...item, folderId: nextParentId };
        if (item.folderId && descendants.has(item.folderId)) return { ...item, folderId: nextParentId };
        return item;
      }));

      return prev
        .filter(entry => entry.id !== folderId)
        .map(entry => descendants.has(entry.id) ? { ...entry, parentId: nextParentId } : entry);
    });
  };

  const updateSpellFolder = (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => {
    setSpellFolders(prev => prev.map(folder => folder.id === folderId ? updater(folder) : folder));
  };

  const moveSpellFolder = (folderId: string, direction: 'up' | 'down') => {
    setSpellFolders(prev => {
      const index = prev.findIndex(folder => folder.id === folderId);
      if (index < 0) return prev;
      const parentId = prev[index].parentId ?? null;
      const siblingIndexes = prev
        .map((folder, idx) => ({ folder, idx }))
        .filter(entry => (entry.folder.parentId ?? null) === parentId)
        .map(entry => entry.idx);
      const siblingPosition = siblingIndexes.indexOf(index);
      const targetSiblingPosition = direction === 'up' ? siblingPosition - 1 : siblingPosition + 1;
      if (siblingPosition < 0 || targetSiblingPosition < 0 || targetSiblingPosition >= siblingIndexes.length) return prev;

      const targetIndex = siblingIndexes[targetSiblingPosition];
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      const insertIndex = index < targetIndex ? targetIndex : targetIndex;
      next.splice(insertIndex, 0, moved);
      return next;
    });
  };

  const addSpellFolder = (parentId: string | null = null) => {
    setSpellFolders(prev => [...prev, createFolder('New Spell Folder', parentId)]);
  };

  const removeSpellFolder = (folderId: string) => {
    setSpellFolders(prev => {
      const folder = prev.find(entry => entry.id === folderId);
      const nextParentId = folder?.parentId ?? null;
      const descendants = new Set<string>();
      const collectDescendants = (parent: string) => {
        prev.forEach(entry => {
          if ((entry.parentId ?? null) === parent) {
            descendants.add(entry.id);
            collectDescendants(entry.id);
          }
        });
      };
      collectDescendants(folderId);

      if (activeSpellCategoryId === folderId || (activeSpellCategoryId && descendants.has(activeSpellCategoryId))) {
        setActiveSpellCategoryId(null);
      }

      setCharSpells(items => items.map(item => {
        if (item.folderId === folderId) return { ...item, folderId: nextParentId };
        if (item.folderId && descendants.has(item.folderId)) return { ...item, folderId: nextParentId };
        return item;
      }));

      return prev
        .filter(entry => entry.id !== folderId)
        .map(entry => descendants.has(entry.id) ? { ...entry, parentId: nextParentId } : entry);
    });
  };

  const addInventoryItem = (folderId: string | null = activeInventoryCategoryId) => {
    setCharInventory(prev => [
      ...prev,
      {
        id: `inv_${uid()}`,
        name: 'New Item',
        description: '',
        homebrewImageUrl: '',
        homebrewImageThumbUrl: '',
        quantity: 1,
        status: 'unequipped',
        rarity: 'common',
        equipped: false,
        macros: [],
        effects: [],
        actions: [],
        localVariables: [],
        scripts: [],
        hidden: false,
        folderId,
      },
    ]);
  };

  const addStatus = (folderId: string | null = activeStatusCategoryId) => {
    const categoryColor = folderId
      ? statusFolders.find(folder => folder.id === getRootFolderId(statusFolders, folderId))?.color
      : null;
    setCharStatuses(prev => [
      ...prev,
      {
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
        scripts: [],
        active: true,
        color: categoryColor || '#f59e0b',
        hidden: false,
        folderId,
      },
    ]);
  };

  const updateStatus = (statusId: string, updater: (status: CharacterStatus) => CharacterStatus) => {
    setCharStatuses(prev => prev.map(status => status.id === statusId ? updater(status) : status));
  };

  const addStatusLocalVariable = (statusId: string, kind: CharacterLocalVariable['kind'] = 'variable') => {
    updateStatus(statusId, status => ({
      ...status,
      localVariables: [...(status.localVariables || []), createLocalVariable(kind)],
    }));
  };

  const updateStatusLocalVariable = (statusId: string, variableIndex: number, updater: (variable: CharacterLocalVariable) => CharacterLocalVariable) => {
    updateStatus(statusId, status => ({
      ...status,
      localVariables: (status.localVariables || []).map((variable, index) => index === variableIndex ? updater(variable) : variable),
    }));
  };

  const removeStatusLocalVariable = (statusId: string, variableIndex: number) => {
    updateStatus(statusId, status => ({
      ...status,
      localVariables: (status.localVariables || []).filter((_, index) => index !== variableIndex),
    }));
  };

  const removeStatus = (statusId: string) => {
    setCharStatuses(prev => prev.filter(status => status.id !== statusId));
    setExpandedStatusDescriptions(prev => prev.filter(id => id !== statusId));
    setExpandedStatusActionDescriptions(prev => prev.filter(id => !id.startsWith(`${statusId}:`)));
  };

  const applyStatusTimePassage = (changes: Partial<Record<CharacterStatusDurationType, number | 'deactivate'>>) => {
    setCharStatuses(prev => prev
      .map((status) => {
        const durationType = getStatusDurationType(status);
        const change = changes[durationType];
        if (!change || durationType === 'custom') return status;

        if (change === 'deactivate') {
          return { ...status, active: false };
        }

        const nextAmount = parseStatusDurationAmount(status.duration) - change;
        if (nextAmount <= 0) {
          return getStatusDurationEndBehavior(status) === 'deactivate'
            ? { ...status, duration: '0', active: false }
            : null;
        }

        return {
          ...status,
          duration: formatStatusDurationAmount(nextAmount),
        };
      })
      .filter((status): status is CharacterStatus => Boolean(status)));
  };

  const replenishActions = (actions: CharacterAction[] | undefined, triggers: CharacterReplenishTrigger[]): CharacterAction[] => (
    (actions || []).map(action => (
      action.replenishTrigger && triggers.includes(action.replenishTrigger)
        ? { ...action, usageRemaining: replenishValue(action.usageRemaining, action.maxUsage, action.replenishAmount) }
        : action
    ))
  );

  const replenishLocalVariables = (
    variables: CharacterLocalVariable[] | undefined,
    triggers: CharacterReplenishTrigger[],
  ): CharacterLocalVariable[] => (
    normalizeLocalVariables(variables).map((variable) => {
      if (variable.kind !== 'resource' || !variable.replenishTrigger || !triggers.includes(variable.replenishTrigger)) {
        return variable;
      }

      const amount = parseReplenishAmount(variable.replenishAmount);
      const current = parseReplenishAmount(variable.value);
      const nextValue = variable.replenishMode === 'set'
        ? amount
        : (() => {
          const gained = current + amount;
          const max = parseReplenishAmount(variable.maxValue);
          return max > 0 ? Math.min(gained, max) : gained;
        })();

      return {
        ...variable,
        value: formatStatusDurationAmount(nextValue),
      };
    })
  );

  const replenishSpellUsage = (spell: CharacterSpell, triggers: CharacterReplenishTrigger[]): CharacterSpell => (
    spell.replenishTrigger && triggers.includes(spell.replenishTrigger)
      ? { ...spell, usageRemaining: replenishValue(spell.usageRemaining, spell.totalUsage, spell.replenishAmount) }
      : spell
  );

  const applyActionReplenish = (triggers: CharacterReplenishTrigger[]) => {
    setCharGeneralItems(prev => prev.map(item => ({
      ...item,
      actions: replenishActions(item.actions, triggers),
      localVariables: replenishLocalVariables(item.localVariables, triggers),
    })));
    setCharInventory(prev => prev.map(item => ({
      ...item,
      actions: replenishActions(item.actions, triggers),
      localVariables: replenishLocalVariables(item.localVariables, triggers),
    })));
    setCharSpells(prev => prev.map(spell => ({
      ...replenishSpellUsage(spell, triggers),
      actions: replenishActions(spell.actions, triggers),
      localVariables: replenishLocalVariables(spell.localVariables, triggers),
    })));
    setCharStatuses(prev => prev.map(status => ({
      ...status,
      duration: status.replenishTrigger && triggers.includes(status.replenishTrigger)
        ? replenishValue(status.duration, status.maxDuration, status.replenishAmount)
        : status.duration,
      active: status.replenishTrigger && triggers.includes(status.replenishTrigger) && parseReplenishAmount(status.replenishAmount) > 0
        ? true
        : status.active,
      actions: replenishActions(status.actions, triggers),
      localVariables: replenishLocalVariables(status.localVariables, triggers),
    })));
  };

  const resetResourceBars = (trigger: NonNullable<CharacterBar['resetTrigger']>) => {
    const context = getCharacterContext();
    setBars(prev => prev.map((bar) => {
      if (getBarMode(bar) !== 'resource' || bar.resetTrigger !== trigger) return bar;
      const resetValue = evalCharFormula(bar.resetValue || '0', context);
      return {
        ...bar,
        currentValue: `${Math.round(resetValue * 100) / 100}`,
      };
    }));
  };

  const handleShortRest = () => {
    applyStatusTimePassage({
      'short-rest': 1,
      minute: 60,
      round: 'deactivate',
    });
    applyActionReplenish(['short-rest']);
    resetResourceBars('short-rest');
    setScriptTriggerEvent(createScriptTriggerEvent('short-rest'));
  };

  const handleLongRest = () => {
    const rawMinutes = window.prompt('How many minutes did the character sleep?', '480');
    if (rawMinutes === null) return;
    const minutes = Number.parseFloat(rawMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      window.alert('Please enter a valid minute amount.');
      return;
    }

    applyStatusTimePassage({
      'short-rest': 2,
      'long-rest': 1,
      minute: minutes,
      round: 'deactivate',
    });
    applyActionReplenish(['short-rest', 'long-rest']);
    resetResourceBars('long-rest');
    setScriptTriggerEvent(createScriptTriggerEvent('long-rest'));
  };

  const handleEndTurn = () => {
    applyStatusTimePassage({
      round: 1,
      minute: 0.2,
    });
    applyActionReplenish(['round']);
    resetResourceBars('turn-end');
    setScriptTriggerEvent(createScriptTriggerEvent('round-end'));
  };

  const handleEndBattle = () => {
    applyStatusTimePassage({
      battle: 1,
    });
    applyActionReplenish(['battle']);
    resetResourceBars('battle-end');
    setScriptTriggerEvent(createScriptTriggerEvent('battle-end'));
  };

  const handleSkipMinute = () => {
    const rawMinutes = window.prompt('How many minutes passed?', '1');
    if (rawMinutes === null) return;
    const minutes = Number.parseFloat(rawMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) {
      window.alert('Please enter a valid minute amount.');
      return;
    }

    applyStatusTimePassage({
      minute: minutes,
      round: 'deactivate',
    });
  };

  const moveStatus = (statusId: string, direction: 'up' | 'down') => {
    setCharStatuses(prev => {
      const index = prev.findIndex(status => status.id === statusId);
      if (index < 0) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const addScript = (folderId: string | null = activeScriptCategoryId === 'main' ? null : activeScriptCategoryId) => {
    setCharScripts(prev => [
      ...prev,
      {
        id: `script_${uid()}`,
        name: 'New Script',
        watchIds: [],
        triggerIds: [],
        conditions: [],
        active: true,
        color: folderId ? scriptFolders.find(folder => folder.id === getRootFolderId(scriptFolders, folderId))?.color || '#06b6d4' : '#06b6d4',
        hidden: false,
        folderId,
      },
    ]);
  };

  const updateScript = (scriptId: string, updater: (script: CharacterScript) => CharacterScript) => {
    setCharScripts(prev => prev.map(script => script.id === scriptId ? updater(script) : script));
  };

  const removeScript = (scriptId: string) => {
    const conditionIds = new Set(
      charScripts
        .find(script => script.id === scriptId)
        ?.conditions.map(condition => condition.id) || []
    );
    setCharStatuses(prev => prev.filter(status => !status.scriptSourceConditionId || !conditionIds.has(status.scriptSourceConditionId)));
    setCharScripts(prev => prev.filter(script => script.id !== scriptId));
  };

  const moveScript = (scriptId: string, direction: 'up' | 'down') => {
    setCharScripts(prev => {
      const index = prev.findIndex(script => script.id === scriptId);
      if (index < 0) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const addScriptCondition = (scriptId: string) => {
    updateScript(scriptId, script => ({
      ...script,
      conditions: [
        ...(script.conditions || []),
        {
          id: `cond_${uid()}`,
          leftId: script.watchIds[0] || '',
          operator: 'lte',
          compareValue: '0',
          minValue: '0',
          maxValue: '0',
          statusEntries: [],
          barUpdates: [],
          statusIds: [],
          onFalse: 'remove',
          appliedStatusInstanceIds: [],
        },
      ],
    }));
  };

  const updateScriptCondition = (
    scriptId: string,
    conditionId: string,
    updater: (condition: CharacterScriptCondition) => CharacterScriptCondition
  ) => {
    updateScript(scriptId, script => ({
      ...script,
      conditions: (script.conditions || []).map(condition => condition.id === conditionId ? updater(condition) : condition),
    }));
  };

  const removeScriptCondition = (scriptId: string, conditionId: string) => {
    setCharStatuses(prev => prev.filter(status => status.scriptSourceConditionId !== conditionId));
    updateScript(scriptId, script => ({
      ...script,
      conditions: (script.conditions || []).filter(condition => condition.id !== conditionId),
    }));
  };

  const removeScriptConditionStatusEntry = (scriptId: string, conditionId: string, entryId: string) => {
    setCharStatuses(prev => prev.filter(status => !(
      status.scriptSourceConditionId === conditionId && status.scriptSourceTemplateStatusId === entryId
    )));
    updateScriptCondition(scriptId, conditionId, current => ({
      ...current,
      statusEntries: (current.statusEntries || []).filter(entry => entry.id !== entryId),
    }));
  };

  const addScriptConditionBarUpdate = (scriptId: string, conditionId: string) => {
    updateScriptCondition(scriptId, conditionId, current => ({
      ...current,
      barUpdates: [
        ...(current.barUpdates || []),
        {
          id: `script_bar_${uid()}`,
          targetId: bars[0]?.id || '',
          value: '0',
          lastMatched: false,
        },
      ],
    }));
  };

  const updateScriptConditionBarUpdate = (
    scriptId: string,
    conditionId: string,
    entryId: string,
    updater: (entry: CharacterScriptBarUpdateEntry) => CharacterScriptBarUpdateEntry,
  ) => {
    updateScriptCondition(scriptId, conditionId, current => ({
      ...current,
      barUpdates: (current.barUpdates || []).map(entry => entry.id === entryId ? updater(entry) : entry),
    }));
  };

  const removeScriptConditionBarUpdate = (scriptId: string, conditionId: string, entryId: string) => {
    updateScriptCondition(scriptId, conditionId, current => ({
      ...current,
      barUpdates: (current.barUpdates || []).filter(entry => entry.id !== entryId),
    }));
  };

  const updateInventoryItem = (itemId: string, updater: (item: CharacterInventoryItem) => CharacterInventoryItem) => {
    setCharInventory(prev => prev.map(item => item.id === itemId ? updater(item) : item));
  };

  const removeInventoryItem = (itemId: string) => {
    setCharInventory(prev => prev.filter(item => item.id !== itemId));
    setCollapsedInventoryItems(prev => prev.filter(id => id !== itemId));
    setExpandedInventoryDescriptions(prev => prev.filter(id => id !== itemId));
  };

  const moveInventoryItem = (itemId: string, direction: 'up' | 'down') => {
    setCharInventory(prev => {
      const index = prev.findIndex(item => item.id === itemId);
      if (index < 0) return prev;

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const addInventoryMacro = (itemId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      macros: [
        ...(item.macros || []),
        { id: `macro_${uid()}`, name: 'New Item Macro', formula: '1d20' },
      ],
    }));
  };

  const updateInventoryMacro = (itemId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      macros: (item.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro),
    }));
  };

  const removeInventoryMacro = (itemId: string, macroId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      macros: (item.macros || []).filter(macro => macro.id !== macroId),
    }));
  };

  const addInventoryEffect = (itemId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      effects: [...(item.effects || []), createAttributeEffect()],
    }));
  };

  const updateInventoryEffect = (itemId: string, effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      effects: (item.effects || []).map((effect, index) => index === effectIndex ? updater(effect) : effect),
    }));
  };

  const removeInventoryEffect = (itemId: string, effectIndex: number) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      effects: (item.effects || []).filter((_, index) => index !== effectIndex),
    }));
  };

  const addInventoryLocalVariable = (itemId: string, kind: CharacterLocalVariable['kind'] = 'variable') => {
    updateInventoryItem(itemId, item => ({
      ...item,
      localVariables: [...(item.localVariables || []), createLocalVariable(kind)],
    }));
  };

  const updateInventoryLocalVariable = (itemId: string, variableIndex: number, updater: (variable: CharacterLocalVariable) => CharacterLocalVariable) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      localVariables: (item.localVariables || []).map((variable, index) => index === variableIndex ? updater(variable) : variable),
    }));
  };

  const removeInventoryLocalVariable = (itemId: string, variableIndex: number) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      localVariables: (item.localVariables || []).filter((_, index) => index !== variableIndex),
    }));
  };

  const toggleInventoryDescription = (itemId: string) => {
    setExpandedInventoryDescriptions(prev => (
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    ));
  };

  const toggleInventoryItemCollapsed = (itemId: string) => {
    setCollapsedInventoryItems(prev => (
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    ));
    updateInventoryItem(itemId, item => ({ ...item, hidden: !item.hidden }));
  };

  const toggleStatusDescription = (statusId: string) => {
    setExpandedStatusDescriptions(prev => (
      prev.includes(statusId) ? prev.filter(id => id !== statusId) : [...prev, statusId]
    ));
  };

  const toggleStatusActionDescription = (statusId: string, actionId: string) => {
    const key = `${statusId}:${actionId}`;
    setExpandedStatusActionDescriptions(prev => (
      prev.includes(key) ? prev.filter(id => id !== key) : [...prev, key]
    ));
  };

  const addStatusAction = (statusId: string) => {
    updateStatus(statusId, status => ({
      ...status,
      actions: [...(status.actions || []), createCharacterAction()],
    }));
  };

  const updateStatusAction = (statusId: string, actionId: string, updater: (action: CharacterAction) => CharacterAction) => {
    updateStatus(statusId, status => ({
      ...status,
      actions: (status.actions || []).map(action => action.id === actionId ? updater(action) : action),
    }));
  };

  const removeStatusAction = (statusId: string, actionId: string) => {
    updateStatus(statusId, status => ({
      ...status,
      actions: (status.actions || []).filter(action => action.id !== actionId),
    }));
    setExpandedStatusActionDescriptions(prev => prev.filter(id => id !== `${statusId}:${actionId}`));
  };

  const addStatusActionMacro = (statusId: string, actionId: string) => {
    updateStatusAction(statusId, actionId, current => ({
      ...current,
      macros: [...(current.macros || []), { id: `macro_${uid()}`, name: 'New Action Macro', formula: '1d20' }],
    }));
  };

  const updateStatusActionMacro = (statusId: string, actionId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateStatusAction(statusId, actionId, current => ({
      ...current,
      macros: (current.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro),
    }));
  };

  const removeStatusActionMacro = (statusId: string, actionId: string, macroId: string) => {
    updateStatusAction(statusId, actionId, current => ({
      ...current,
      macros: (current.macros || []).filter(macro => macro.id !== macroId),
    }));
  };

  const addStatusActionEffect = (statusId: string, actionId: string) => {
    updateStatusAction(statusId, actionId, current => ({
      ...current,
      effects: [...(current.effects || []), createAttributeEffect()],
    }));
  };

  const updateStatusActionEffect = (statusId: string, actionId: string, effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => {
    updateStatusAction(statusId, actionId, current => ({
      ...current,
      effects: (current.effects || []).map((effect, index) => index === effectIndex ? updater(effect) : effect),
    }));
  };

  const removeStatusActionEffect = (statusId: string, actionId: string, effectIndex: number) => {
    updateStatusAction(statusId, actionId, current => ({
      ...current,
      effects: (current.effects || []).filter((_, index) => index !== effectIndex),
    }));
  };

  const shareStatus = async (status: CharacterStatus) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing statuses.');
      return;
    }

    const message = [
      `**${status.name || 'Unnamed Status'}**`,
      `Duration: ${formatStatusDuration(status)}`,
      status.description ? `Description: ${status.description}` : '',
      (status.effects || []).length > 0 ? `Effects: ${(status.effects || []).map(effect => `${effect.targetId || 'unknown'} ${effect.value || '0'}`).join(', ')}` : '',
      (status.actions || []).length > 0 ? `Actions: ${(status.actions || []).map(action => action.name || 'Unnamed Action').join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) setDiceError(`Discord: ${discordErr}`);
  };

  const shareStatusAction = async (status: CharacterStatus, action: CharacterAction) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing actions.');
      return;
    }
    const message = [
      `**${status.name || 'Unnamed Status'} Action**`,
      action.name ? `Action: ${action.name}` : '',
      action.cost ? `Cost: ${action.cost}` : '',
      action.usageRemaining ? `Remaining Usage: ${action.usageRemaining}` : '',
      action.description ? `Description: ${action.description}` : '',
    ].filter(Boolean).join('\n');
    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) setDiceError(`Discord: ${discordErr}`);
  };

  const rollStatusActionMacro = async (status: CharacterStatus, action: CharacterAction, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(status.localVariables, context, macro.formula, `${status.name || 'Status'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${status.name}: ${action.name || 'Action'}: ${macro.name}` },
        context,
        ids,
        localContext
      );
      result.description = action.description || status.description || undefined;
      addRollResults(result);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const addGeneralItem = () => {
    setCharGeneralItems(prev => [
      ...prev,
      normalizeGeneralItem({
        id: `gen_${uid()}`,
        name: 'New General Item',
        description: '',
        quantity: 1,
        status: 'unequipped',
        rarity: 'common',
        equipped: false,
        macros: [],
        effects: [],
        actions: [],
        localVariables: [],
        scripts: [],
        hidden: false,
      }),
    ]);
  };

  const updateGeneralItem = (itemId: string, updater: (item: CharacterGeneralItem) => CharacterGeneralItem) => {
    setCharGeneralItems(prev => prev.map(item => item.id === itemId ? normalizeGeneralItem(updater(normalizeGeneralItem(item))) : item));
  };

  const removeGeneralItem = (itemId: string) => {
    setCharGeneralItems(prev => prev.filter(item => item.id !== itemId));
    setExpandedGeneralItemDescriptions(prev => prev.filter(id => id !== itemId));
  };

  const moveGeneralItem = (itemId: string, direction: 'up' | 'down') => {
    setCharGeneralItems(prev => {
      const index = prev.findIndex(item => item.id === itemId);
      if (index < 0) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const moveGeneralItemToInventoryFolder = (itemId: string, folderId: string) => {
    const sourceItem = charGeneralItems.find(item => item.id === itemId);
    if (!sourceItem || !folderId) return;
    const normalized = normalizeGeneralItem(sourceItem);
    const movedItem: CharacterInventoryItem = {
      ...normalized,
      id: `inv_${uid()}`,
      folderId,
    };
    setCharInventory(prev => [...prev, movedItem]);
    setCharGeneralItems(prev => prev.filter(item => item.id !== itemId));
    setExpandedGeneralItemDescriptions(prev => prev.filter(id => id !== itemId));
    setActiveInventoryCategoryId(getRootFolderId(inventoryFolders, folderId) || folderId);
  };

  const moveInventoryItemToGeneralItems = (itemId: string) => {
    const sourceItem = charInventory.find(item => item.id === itemId);
    if (!sourceItem) return;
    const movedItem: CharacterGeneralItem = normalizeGeneralItem({
      ...sourceItem,
      id: `gen_${uid()}`,
    });
    setCharGeneralItems(prev => [...prev, movedItem]);
    setCharInventory(prev => prev.filter(item => item.id !== itemId));
    setCollapsedInventoryItems(prev => prev.filter(id => id !== itemId));
    setExpandedInventoryDescriptions(prev => prev.filter(id => id !== itemId));
  };

  const toggleGeneralItemDescription = (itemId: string) => {
    setExpandedGeneralItemDescriptions(prev => (
      prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]
    ));
  };

  const shareGeneralItem = async (item: CharacterGeneralItem) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing general items.');
      return;
    }
    const itemState = normalizeGeneralItem(item);
    const message = [
      `**${itemState.name || 'Unnamed General Item'}**`,
      `Rarity: ${INVENTORY_RARITY_STYLES[itemState.rarity || 'common'].label}`,
      `Quantity: ${itemState.quantity}`,
      `Status: ${itemState.status || (itemState.equipped ? 'equipped' : 'available')}`,
      `Equipped: ${itemState.equipped ? 'Yes' : 'No'}`,
      itemState.description ? `Description: ${itemState.description}` : '',
      (itemState.effects || []).length > 0 ? `Effects: ${(itemState.effects || []).map(effect => `${effect.targetId || 'unknown'} ${effect.value || '0'}`).join(', ')}` : '',
      (itemState.macros || []).length > 0 ? `Macros: ${(itemState.macros || []).map(macro => `${macro.name} [${macro.formula}]`).join(', ')}` : '',
      (itemState.actions || []).length > 0 ? `Actions: ${(itemState.actions || []).map(action => action.name || 'Unnamed Action').join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) setDiceError(`Discord: ${discordErr}`);
  };

  const addGeneralMacro = (itemId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      macros: [...(item.macros || []), { id: `macro_${uid()}`, name: 'New Macro', formula: '1d20' }],
    }));
  };

  const updateGeneralMacro = (itemId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      macros: (item.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro),
    }));
  };

  const removeGeneralMacro = (itemId: string, macroId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      macros: (item.macros || []).filter(macro => macro.id !== macroId),
    }));
  };

  const addGeneralEffect = (itemId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      effects: [...(item.effects || []), createAttributeEffect()],
    }));
  };

  const updateGeneralEffect = (itemId: string, effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      effects: (item.effects || []).map((effect, index) => index === effectIndex ? updater(effect) : effect),
    }));
  };

  const removeGeneralEffect = (itemId: string, effectIndex: number) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      effects: (item.effects || []).filter((_, index) => index !== effectIndex),
    }));
  };

  const addGeneralLocalVariable = (itemId: string, kind: CharacterLocalVariable['kind'] = 'variable') => {
    updateGeneralItem(itemId, item => ({
      ...item,
      localVariables: [...(item.localVariables || []), createLocalVariable(kind)],
    }));
  };

  const updateGeneralLocalVariable = (itemId: string, variableIndex: number, updater: (variable: CharacterLocalVariable) => CharacterLocalVariable) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      localVariables: (item.localVariables || []).map((variable, index) => index === variableIndex ? updater(variable) : variable),
    }));
  };

  const removeGeneralLocalVariable = (itemId: string, variableIndex: number) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      localVariables: (item.localVariables || []).filter((_, index) => index !== variableIndex),
    }));
  };

  const addGeneralAction = (itemId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      actions: [
        ...(item.actions || []),
        createCharacterAction(),
      ],
    }));
  };

  const updateGeneralAction = (itemId: string, actionId: string, updater: (action: CharacterAction) => CharacterAction) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId ? updater(action) : action),
    }));
  };

  const removeGeneralAction = (itemId: string, actionId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).filter(action => action.id !== actionId),
    }));
    setExpandedInventoryActionDescriptions(prev => prev.filter(id => id !== actionId));
  };

  const addGeneralActionMacro = (itemId: string, actionId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId
        ? { ...action, macros: [...(action.macros || []), { id: `macro_${uid()}`, name: 'New Action Macro', formula: '1d20' }] }
        : action),
    }));
  };

  const updateGeneralActionMacro = (itemId: string, actionId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId
        ? { ...action, macros: (action.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro) }
        : action),
    }));
  };

  const removeGeneralActionMacro = (itemId: string, actionId: string, macroId: string) => {
    updateGeneralItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId
        ? { ...action, macros: (action.macros || []).filter(macro => macro.id !== macroId) }
        : action),
    }));
  };

  const addGeneralActionEffect = (itemId: string, actionId: string) => {
    updateGeneralAction(itemId, actionId, current => ({
      ...current,
      effects: [...(current.effects || []), createAttributeEffect()],
    }));
  };

  const updateGeneralActionEffect = (itemId: string, actionId: string, effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => {
    updateGeneralAction(itemId, actionId, current => ({
      ...current,
      effects: (current.effects || []).map((effect, index) => index === effectIndex ? updater(effect) : effect),
    }));
  };

  const removeGeneralActionEffect = (itemId: string, actionId: string, effectIndex: number) => {
    updateGeneralAction(itemId, actionId, current => ({
      ...current,
      effects: (current.effects || []).filter((_, index) => index !== effectIndex),
    }));
  };

  const rollGeneralMacro = async (item: CharacterGeneralItem, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(item.localVariables, context, macro.formula, `${item.name || 'Item'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro({ ...macro, name: `${item.name}: ${macro.name}` }, context, ids, localContext);
      result.description = item.description || undefined;
      addRollResults(result);
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollGeneralActionMacro = async (item: CharacterGeneralItem, action: CharacterAction, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(item.localVariables, context, macro.formula, `${item.name || 'Item'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro({ ...macro, name: `${item.name}: ${action.name}: ${macro.name}` }, context, ids, localContext);
      result.description = action.description || item.description || undefined;
      addRollResults(result);
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const openHomebrewViewer = (
    entityType: 'general-item' | 'inventory-item' | 'spell' | 'status',
    entryId: string,
  ) => {
    if (!selectedCharacter?.id || !entryId) return;
    const targetUrl = `${window.location.origin}${window.location.pathname}#homebrew-viewer/${entityType}/${encodeURIComponent(selectedCharacter.id)}/${encodeURIComponent(entryId)}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const openHomebrewLibrary = (
    category: 'general-items' | 'inventory' | 'statuses' | 'spells',
  ) => {
    if (!selectedCharacter?.id) return;
    const targetUrl = `${window.location.origin}${window.location.pathname}#homebrew-library/${category}/${encodeURIComponent(selectedCharacter.id)}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const openHomebrewCharacterSheet = () => {
    if (!selectedCharacter?.id) return;
    const targetUrl = `${window.location.origin}${window.location.pathname}#homebrew-character-sheet/${encodeURIComponent(selectedCharacter.id)}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const openSendToParty = async (
    kind: 'item' | 'spell' | 'status',
    entry: CharacterGeneralItem | CharacterInventoryItem | CharacterSpell | CharacterStatus,
  ) => {
    if (!selectedCharacter?.id || !userId || userId === 'guest') {
      window.alert('Sign in first to send entries to a party.');
      return;
    }
    setPartyTransferTarget({ kind, entry });
    setPartyTransferOptions([]);
    setIsLoadingPartyTransferOptions(true);
    try {
      const options = await loadPartiesForCharacterTransfer(userId, selectedCharacter.id, isAdmin);
      setPartyTransferOptions(options.map(({ campaign, party }) => ({ campaignName: campaign.name, party })));
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : 'Could not load parties.');
    } finally {
      setIsLoadingPartyTransferOptions(false);
    }
  };

  const sendEntryToParty = async (party: PartyData) => {
    if (!partyTransferTarget) return;
    try {
      await addEntryToPartyInventory(party, partyTransferTarget.kind, partyTransferTarget.entry);
      setPartyTransferTarget(null);
      setPartyTransferOptions([]);
      setSheetSyncStatus({ tone: 'success', message: `${partyTransferTarget.entry.name || 'Entry'} copied to ${party.name}.` });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Could not send this entry to party.';
      setSheetSyncStatus({ tone: 'error', message });
      window.alert(message);
    }
  };

  const toggleInventoryActionDescription = (actionId: string) => {
    setExpandedInventoryActionDescriptions(prev => (
      prev.includes(actionId) ? prev.filter(id => id !== actionId) : [...prev, actionId]
    ));
  };

  const moveListItem = <T extends { id: string }>(
    items: T[],
    itemId: string,
    direction: 'up' | 'down'
  ) => {
    const index = items.findIndex(item => item.id === itemId);
    if (index < 0) return items;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    return next;
  };

  const cycleSkillProficiency = (mode?: SkillAttribute['proficiencyMode']): SkillAttribute['proficiencyMode'] => {
    if (!mode || mode === 'none') return 'half';
    if (mode === 'half') return 'proficient';
    if (mode === 'proficient') return 'expertise';
    return 'none';
  };

  const getDisplaySlotKey = (row: number, column: number) => `${row}:${column}`;

  const getNextAvailableDisplaySlot = (
    stats: CharacterDisplayStat[],
    slotStatesMap: Record<string, 'unlocked' | 'locked' | 'blocked'>,
    columnCount: number,
  ) => {
    const cols = Math.max(1, columnCount);
    let index = 0;
    while (index < 500) {
      const row = Math.floor(index / cols);
      const column = index % cols;
      const slotKey = getDisplaySlotKey(row, column);
      const slotState = slotStatesMap[slotKey] || 'unlocked';
      const occupied = stats.some((stat) => (stat.row ?? 0) === row && (stat.column ?? 0) === column);
      if (!occupied && slotState !== 'blocked') {
        return { row, column };
      }
      index += 1;
    }
    return { row: 0, column: 0 };
  };

  const normalizeDisplayStatsLayout = (
    stats: CharacterDisplayStat[],
    columnCount: number,
  ) => {
    const cols = Math.max(1, columnCount);
    const occupiedKeys = new Set<string>();

    return stats.map((stat, index) => {
      const currentRow = stat.row;
      const currentColumn = stat.column;

      if (typeof currentRow === 'number' && typeof currentColumn === 'number') {
        occupiedKeys.add(getDisplaySlotKey(currentRow, currentColumn));
        return stat;
      }

      let slotIndex = index;
      let row = Math.floor(slotIndex / cols);
      let column = slotIndex % cols;
      while (occupiedKeys.has(getDisplaySlotKey(row, column))) {
        slotIndex += 1;
        row = Math.floor(slotIndex / cols);
        column = slotIndex % cols;
      }
      occupiedKeys.add(getDisplaySlotKey(row, column));

      return {
        ...stat,
        row,
        column,
      };
    });
  };

  const syncDisplayStatFavorite = (referenceId: string, nextFavorite: boolean) => {
    setDisplayStats(prev => {
      const normalizedPrev = normalizeDisplayStatsLayout(prev, attributeSectionColumns.display);
      const existing = prev.find(stat => stat.referenceId === referenceId);
      if (nextFavorite) {
          if (existing) return prev;
          const { row, column } = getNextAvailableDisplaySlot(normalizedPrev, displaySlotStates, attributeSectionColumns.display);
          return [...normalizedPrev, {
            id: `display_${uid()}`,
            referenceId,
            row,
            column,
          }];
      }
      return normalizedPrev.filter(stat => stat.referenceId !== referenceId);
    });
  };

  useEffect(() => {
    const favoriteReferenceIds = [
      ...mainAttrs.filter(attr => attr.favorite).map(attr => attr.id).filter(Boolean),
      ...secondaryAttrs.filter(attr => attr.favorite).map(attr => attr.id).filter(Boolean),
      ...skills.filter(attr => attr.favorite).map(attr => attr.id).filter(Boolean),
      ...otherAttrs.filter(attr => attr.favorite).map(attr => attr.id).filter(Boolean),
      ...bars.filter(bar => bar.favorite).map(bar => bar.id).filter(Boolean),
    ];

    setDisplayStats((prev) => {
      const normalizedPrev = normalizeDisplayStatsLayout(prev, attributeSectionColumns.display);
      const favoriteSet = new Set(favoriteReferenceIds);
      const preserved = normalizedPrev
        .filter((stat) => favoriteSet.has(stat.referenceId))
        .map((stat) => ({
          ...stat,
          row: stat.row ?? 0,
          column: stat.column ?? 0,
        }));

      const usedReferenceIds = new Set(preserved.map((stat) => stat.referenceId));
      const next = [...preserved];

      favoriteReferenceIds.forEach((referenceId) => {
        if (usedReferenceIds.has(referenceId)) return;
        const slot = getNextAvailableDisplaySlot(next, displaySlotStates, attributeSectionColumns.display);
        next.push({
          id: `display_${uid()}`,
          referenceId,
          row: slot.row,
          column: slot.column,
        });
      });

      const same =
        normalizedPrev.length === next.length &&
        normalizedPrev.every((stat, index) => {
          const candidate = next[index];
          return candidate
            && stat.id === candidate.id
            && stat.referenceId === candidate.referenceId
            && (stat.row ?? 0) === (candidate.row ?? 0)
            && (stat.column ?? 0) === (candidate.column ?? 0)
            && JSON.stringify(stat.colors || {}) === JSON.stringify(candidate.colors || {});
        });

      return same ? normalizedPrev : next;
    });
  }, [mainAttrs, secondaryAttrs, skills, otherAttrs, bars, displaySlotStates, attributeSectionColumns.display]);

  const moveDisplayStatReference = (statId: string, direction: 'up' | 'down' | 'left' | 'right') => {
    setDisplayStats(prev => {
      const cols = Math.max(1, attributeSectionColumns.display);
      const current = prev.find(stat => stat.id === statId);
      if (!current) return prev;

      const currentRow = current.row ?? 0;
      const currentColumn = current.column ?? 0;
      const nextRow = direction === 'up' ? Math.max(0, currentRow - 1) : direction === 'down' ? currentRow + 1 : currentRow;
      const nextColumn = direction === 'left' ? Math.max(0, currentColumn - 1) : direction === 'right' ? Math.min(cols - 1, currentColumn + 1) : currentColumn;

      if (nextRow === currentRow && nextColumn === currentColumn) return prev;

      const occupant = prev.find(stat => stat.id !== statId && (stat.row ?? 0) === nextRow && (stat.column ?? 0) === nextColumn);
      return prev.map(stat => {
        if (stat.id === statId) return { ...stat, row: nextRow, column: nextColumn };
        if (occupant && stat.id === occupant.id) return { ...stat, row: currentRow, column: currentColumn };
        return stat;
      });
    });
  };

  const updateAttributeSectionColumns = (section: keyof CharacterAttributeSectionColumns, value: number) => {
    const clamped = Math.min(6, Math.max(1, value || 1));
    setAttributeSectionColumns(prev => ({ ...prev, [section]: clamped }));
  };

  const cycleDisplaySlotState = (row: number, column: number) => {
    const slotKey = getDisplaySlotKey(row, column);
    setDisplaySlotStates(prev => {
      const currentState = prev[slotKey] || 'unlocked';
      const nextState = currentState === 'unlocked' ? 'locked' : currentState === 'locked' ? 'blocked' : 'unlocked';
      return { ...prev, [slotKey]: nextState };
    });

    setDisplayStats(prev => {
      const occupant = prev.find(stat => (stat.row ?? 0) === row && (stat.column ?? 0) === column);
      const currentState = displaySlotStates[slotKey] || 'unlocked';
      const nextState = currentState === 'unlocked' ? 'locked' : currentState === 'locked' ? 'blocked' : 'unlocked';
      if (!occupant || nextState !== 'blocked') return prev;
      const fallbackSlot = getNextAvailableDisplaySlot(
        prev.filter(stat => stat.id !== occupant.id),
        { ...displaySlotStates, [slotKey]: nextState },
        attributeSectionColumns.display,
      );
      return prev.map(stat => stat.id === occupant.id ? { ...stat, row: fallbackSlot.row, column: fallbackSlot.column } : stat);
    });
  };

  const moveDisplayStatToSlot = (statId: string, targetRow: number, targetColumn: number) => {
    const slotKey = getDisplaySlotKey(targetRow, targetColumn);
    const slotState = displaySlotStates[slotKey] || 'unlocked';
    if (slotState !== 'unlocked') return;

    setDisplayStats(prev => {
      const current = prev.find(stat => stat.id === statId);
      if (!current) return prev;
      const currentRow = current.row ?? 0;
      const currentColumn = current.column ?? 0;
      const targetOccupant = prev.find(stat => stat.id !== statId && (stat.row ?? 0) === targetRow && (stat.column ?? 0) === targetColumn);
      const targetOccupantState = targetOccupant ? (displaySlotStates[getDisplaySlotKey(targetRow, targetColumn)] || 'unlocked') : 'unlocked';
      if (targetOccupant && targetOccupantState !== 'unlocked') return prev;
      return prev.map(stat => {
        if (stat.id === statId) return { ...stat, row: targetRow, column: targetColumn };
        if (targetOccupant && stat.id === targetOccupant.id) return { ...stat, row: currentRow, column: currentColumn };
        return stat;
      });
    });
  };

  const updateDisplayStatColors = (
    statId: string,
    key: keyof NonNullable<CharacterDisplayStat['colors']>,
    value: string,
  ) => {
    setDisplayStats(prev => prev.map(stat => (
      stat.id === statId
        ? { ...stat, colors: { ...(stat.colors || {}), [key]: value } }
        : stat
    )));
  };

  const getAllSheetAttributes = () => [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs, ...resistances];

  const getAttributeDefinitionById = (attributeId: string) => (
    getAllSheetAttributes().find((attr) => attr.id === attributeId)
  );

  const getAttributeCalculationType = (attributeId: string): AttributeCalculationType => (
    getAttributeDefinitionById(attributeId)?.calculationType || DEFAULT_ATTRIBUTE_CALCULATION_TYPE
  );

  const resolveAttributeValueLabel = (attributeId: string, rawValue: number) => {
    const definition = getAttributeDefinitionById(attributeId);
    if (!definition) return `${rawValue}`;
    const match = normalizeAttributeOptions(definition.valueOptions).find((option) => option.value === rawValue);
    return match?.label || `${rawValue}`;
  };

  const formatAttributeOutput = (attributeId: string, rawValue: number) => resolveAttributeValueLabel(attributeId, rawValue);

  const getSheetReferenceAnchorId = (referenceId: string) => {
    if (!referenceId) return '';
    const normalizedId = referenceId.replace(/_mod$/, '');
    if (mainAttrs.some((attr) => attr.id === normalizedId)) return `sheet-attr-main-${normalizedId}`;
    if (secondaryAttrs.some((attr) => attr.id === normalizedId)) return `sheet-attr-secondary-${normalizedId}`;
    if (skills.some((attr) => attr.id === normalizedId)) return `sheet-attr-skill-${normalizedId}`;
    if (otherAttrs.some((attr) => attr.id === normalizedId)) return `sheet-attr-other-${normalizedId}`;
    if (resistances.some((attr) => attr.id === normalizedId)) return `sheet-attr-resistance-${normalizedId}`;
    if (bars.some((bar) => bar.id === normalizedId)) return `sheet-bar-${normalizedId}`;
    return '';
  };

  const applyAttributeEffectValue = (
    targetId: string,
    baseValue: number,
    contributions: number[],
  ) => {
    const calculationType = getAttributeCalculationType(targetId);
    if (calculationType === 'override-highest') {
      return baseValue + (contributions.length > 0 ? Math.max(...contributions) : 0);
    }
    if (calculationType === 'override-lowest') {
      return baseValue + (contributions.length > 0 ? Math.min(...contributions) : 0);
    }
    return baseValue + contributions.reduce((sum, contribution) => sum + contribution, 0);
  };

  const buildCharacterSheetSyncValues = (context: Record<string, number>) => {
    const values: Record<string, string | number> = {};

    [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs, ...resistances].forEach((attr) => {
      if (!attr.id) return;
      const rawValue = context[attr.id];
      if (Number.isFinite(rawValue)) {
        values[attr.id] = rawValue;
        if ((attr.valueOptions || []).length > 0) {
          values[`${attr.id}_text`] = formatAttributeOutput(attr.id, rawValue);
        }
      }
    });

    mainAttrs.forEach((attr) => {
      if (!attr.id) return;
      const rawModifier = context[`${attr.id}_mod`];
      if (Number.isFinite(rawModifier)) {
        values[`${attr.id}_mod`] = rawModifier;
      }
    });

    bars.forEach((bar) => {
      if (!bar.id) return;
      const currentValue = context[`${bar.id}_current`];
      const maxValue = context[`${bar.id}_max`];
      const resetValue = context[`${bar.id}_reset`];
      if (Number.isFinite(currentValue)) {
        values[`${bar.id}_current`] = currentValue;
      }
      if (getBarMode(bar) === 'resource' && Number.isFinite(resetValue)) {
        values[`${bar.id}_reset`] = resetValue;
      } else if (Number.isFinite(maxValue)) {
        values[`${bar.id}_max`] = maxValue;
      }
    });

    return values;
  };

  const exportAttributePreset = () => {
    const payload: CharacterAttributePreset = {
      schema: 'inoraxium-character-attributes',
      version: 1,
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      skills,
      otherAttributes: otherAttrs,
      resistances,
      bars,
      displayStats,
      displaySlotStates,
      overviewSettings,
      attributeSectionModes,
      modifierFormula: modFormula,
      attributeSectionColumns,
    };
    void exportJsonWithChoice(
      payload,
      `${(editName || 'character').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase()}-attributes.json`,
    ).catch(() => window.alert('Export failed. Clipboard access may be blocked by the browser.'));
  };

  const downloadJsonFile = (payload: unknown, fileName: string) => {
    void exportJsonWithChoice(payload, fileName)
      .catch(() => window.alert('Export failed. Clipboard access may be blocked by the browser.'));
  };

  const safeExportFileName = (name: string, suffix: string) => (
    `${(name || 'entry').replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'entry'}-${suffix}.json`
  );

  const cloneMacroForImport = (macro: Partial<CharacterDiceMacro> = {}): CharacterDiceMacro => ({
    id: `macro_${uid()}`,
    name: typeof macro.name === 'string' ? macro.name : 'New Macro',
    formula: typeof macro.formula === 'string' ? macro.formula : '1d20',
  });

  const cloneEffectForImport = (effect: Partial<StatusEffect> = {}): StatusEffect => ({
    id: `eff_${uid()}`,
    effectType: effect.effectType === 'status' || effect.effectType === 'bar-update' ? effect.effectType : 'attribute',
    targetId: typeof effect.targetId === 'string' ? effect.targetId : '',
    value: typeof effect.value === 'string' ? effect.value : '0',
    active: effect.active ?? true,
    useTargetPicker: effect.useTargetPicker ?? false,
    targetLabel: typeof effect.targetLabel === 'string' ? effect.targetLabel : undefined,
    statusName: typeof effect.statusName === 'string' ? effect.statusName : undefined,
    statusEntry: effect.statusEntry,
    statusFolderId: typeof effect.statusFolderId === 'string' ? effect.statusFolderId : null,
    barUpdateDescription: typeof effect.barUpdateDescription === 'string' ? effect.barUpdateDescription : undefined,
  });

  const cloneLocalVariableForImport = (variable: Partial<CharacterLocalVariable> = {}): CharacterLocalVariable => ({
    id: typeof variable.id === 'string' ? variable.id : `local_${uid()}`,
    description: typeof variable.description === 'string' ? variable.description : '',
    value: typeof variable.value === 'string' ? variable.value : '0',
    kind: variable.kind === 'input' || variable.kind === 'resource' ? variable.kind : 'variable',
    replenishTrigger: variable.replenishTrigger || 'custom',
    replenishMode: variable.replenishMode === 'set' ? 'set' : 'gain',
    replenishAmount: typeof variable.replenishAmount === 'string' ? variable.replenishAmount : '0',
    maxValue: typeof variable.maxValue === 'string' ? variable.maxValue : '',
  });

  const cloneActionForImport = (action: Partial<CharacterAction> = {}): CharacterAction => ({
    id: `act_${uid()}`,
    name: typeof action.name === 'string' ? action.name : 'New Action',
    description: typeof action.description === 'string' ? action.description : '',
    cost: typeof action.cost === 'string' ? action.cost : '',
    usageRemaining: typeof action.usageRemaining === 'string' ? action.usageRemaining : '',
    maxUsage: typeof action.maxUsage === 'string' ? action.maxUsage : '',
    replenishTrigger: action.replenishTrigger || 'custom',
    replenishAmount: typeof action.replenishAmount === 'string' ? action.replenishAmount : '',
    macros: Array.isArray(action.macros) ? action.macros.map(cloneMacroForImport) : [],
    effects: Array.isArray(action.effects) ? action.effects.map(cloneEffectForImport) : [],
  });

  const getEffectTargetLabelById = (targetId: string): string => (
    getEffectTargetOptions().find(option => option.id === targetId)?.label || targetId
  );

  const getScriptValueOptions = (localVariables?: CharacterLocalVariable[]) => {
    const localOptions = normalizeLocalVariables(localVariables)
      .filter(variable => !!variable.id && variable.kind !== 'input')
      .map(variable => ({
        id: `@@${variable.id}`,
        label: `${variable.description || variable.id} (@@${variable.id})`,
      }));
    return [
      ...getEffectTargetOptions(),
      ...localOptions,
    ];
  };

  const getScriptValueLabelByIdWithLocal = (valueId: string, localVariables?: CharacterLocalVariable[]): string => (
    getScriptValueOptions(localVariables).find(option => option.id === valueId)?.label || valueId
  );

  const getScriptValue = (
    valueId: string,
    context: Record<string, number>,
    localContext: Record<string, number>,
  ): number => {
    if (valueId.startsWith('@@')) return localContext[valueId.slice(2)] ?? 0;
    return context[valueId] ?? 0;
  };

  const requestScriptValueTarget = (label: string, localVariables?: CharacterLocalVariable[]): Promise<string> => {
    const globalOptions = getScriptValueOptions();
    const localOptions = normalizeLocalVariables(localVariables)
      .filter(variable => !!variable.id && variable.kind !== 'input')
      .map(variable => ({
        id: `@@${variable.id}`,
        label: `${variable.description || variable.id} (@@${variable.id})`,
      }));
    if (globalOptions.length === 0 && localOptions.length === 0) {
      throw new Error('This character has no values for this script placeholder.');
    }

    return new Promise((resolve, reject) => {
      setScriptValueGlobalDraft(globalOptions[0]?.id || '');
      setScriptValueLocalDraft('');
      setScriptValueTargetRequest({
        label,
        localVariables: normalizeLocalVariables(localVariables),
        resolve: (targetId) => {
          setScriptValueTargetRequest(null);
          if (!targetId) {
            reject(new Error('Script placeholder import was cancelled.'));
            return;
          }
          resolve(targetId);
        },
      });
    });
  };

  const replaceScriptPlaceholderValue = (
    value: string | undefined,
    replacements: Record<string, string>,
    mode: 'id' | 'formula' = 'id',
  ): string | undefined => {
    if (!value) return value;
    if (mode === 'id' && isScriptPlaceholderValue(value)) {
      const placeholderId = value.slice(SCRIPT_PLACEHOLDER_PREFIX.length);
      return replacements[placeholderId] || value;
    }
    return Object.entries(replacements).reduce((nextValue, [placeholderId, replacement]) => (
      nextValue.replaceAll(
        getScriptPlaceholderValue(placeholderId),
        mode === 'formula' && !replacement.startsWith('@@') ? `@${replacement}` : replacement,
      )
    ), value);
  };

  const resolveScriptPlaceholders = async (
    script: CharacterScript,
    localVariables?: CharacterLocalVariable[],
  ): Promise<CharacterScript> => {
    const placeholders = script.placeholders || [];
    if (placeholders.length === 0) return script;

    const replacements: Record<string, string> = {};
    for (const placeholder of placeholders) {
      if (placeholder.kind === 'bar') {
        replacements[placeholder.id] = await requestBarUpdateTarget(placeholder.label || 'Choose a bar for this script.');
      } else if (placeholder.kind === 'value') {
        replacements[placeholder.id] = await requestScriptValueTarget(placeholder.label || 'Choose a value for this script.', localVariables);
      }
    }

    return {
      ...script,
      watchIds: (script.watchIds || []).map(id => replaceScriptPlaceholderValue(id, replacements) || id),
      conditions: (script.conditions || []).map(condition => ({
        ...condition,
        leftId: replaceScriptPlaceholderValue(condition.leftId, replacements) || condition.leftId,
        compareValue: replaceScriptPlaceholderValue(condition.compareValue, replacements, 'formula'),
        minValue: replaceScriptPlaceholderValue(condition.minValue, replacements, 'formula'),
        maxValue: replaceScriptPlaceholderValue(condition.maxValue, replacements, 'formula'),
        barUpdates: (condition.barUpdates || []).map(entry => ({
          ...entry,
          targetId: replaceScriptPlaceholderValue(entry.targetId, replacements) || entry.targetId,
          value: replaceScriptPlaceholderValue(entry.value, replacements, 'formula') || entry.value,
        })),
      })),
    };
  };

  const annotateEffectsForExport = (effects?: StatusEffect[]): StatusEffect[] => (
    (effects || []).map(effect => {
      if ((!effect.effectType || effect.effectType === 'attribute') && (effect.useTargetPicker ?? true)) {
        return {
          ...effect,
          effectType: 'attribute',
          useTargetPicker: true,
          targetLabel: effect.targetLabel || getEffectTargetLabelById(effect.targetId),
        };
      }
      if (effect.effectType === 'status' && effect.statusEntry) {
        return {
          ...effect,
          statusEntry: annotateEntryForExport(effect.statusEntry),
        };
      }
      return effect;
    })
  );

  const annotateActionsForExport = (actions?: CharacterAction[]): CharacterAction[] => (
    (actions || []).map(action => ({
      ...action,
      effects: annotateEffectsForExport(action.effects),
    }))
  );

  const annotateEntryForExport = <T,>(entry: T): T => {
    const copy = JSON.parse(JSON.stringify(entry)) as T & {
      effects?: StatusEffect[];
    actions?: CharacterAction[];
      scripts?: CharacterScript[];
      conditions?: CharacterScriptCondition[];
    };
    if (Array.isArray(copy.effects)) {
      copy.effects = annotateEffectsForExport(copy.effects);
    }
    if (Array.isArray(copy.actions)) {
      copy.actions = annotateActionsForExport(copy.actions);
    }
    if (Array.isArray(copy.scripts)) {
      copy.scripts = copy.scripts.map(script => annotateEntryForExport(script));
    }
    if (Array.isArray(copy.conditions)) {
      copy.conditions = copy.conditions.map(condition => ({
        ...condition,
        statusEntries: (condition.statusEntries || []).map(statusEntry => ({
          ...statusEntry,
          entry: annotateEntryForExport(statusEntry.entry),
        })),
        barUpdates: (condition.barUpdates || []).map(barUpdate => ({
          ...barUpdate,
          lastMatched: false,
          lastTriggeredNonce: undefined,
        })),
      }));
    }
    return copy as T;
  };

  const buildEntryExportPayload = (
    kind: CharacterEntryExportKind,
    entry: CharacterInventoryItem | CharacterGeneralItem | CharacterSpell | CharacterStatus | CharacterDiceMacro | CharacterScript,
    folderName?: string | null
  ): CharacterEntryExportPayload => ({
    schema: 'inoraxium-character-entry',
    version: 1,
    kind,
    exportedAt: new Date().toISOString(),
    sourceCharacterName: selectedCharacter?.name || editName || undefined,
    folderName: folderName || null,
    entry: annotateEntryForExport(entry),
  });

  const exportCharacterEntry = (
    kind: CharacterEntryExportKind,
    entry: CharacterInventoryItem | CharacterGeneralItem | CharacterSpell | CharacterStatus | CharacterDiceMacro | CharacterScript,
    folderName?: string | null
  ) => {
    downloadJsonFile(buildEntryExportPayload(kind, entry, folderName), safeExportFileName(entry.name, kind));
  };

  const getMatchingFolderIdByName = (folders: CharacterEntryFolder[], folderName?: string | null): string | null => {
    if (!folderName) return null;
    const normalizedName = folderName.trim().toLowerCase();
    return folders.find(folder => (folder.name || '').trim().toLowerCase() === normalizedName)?.id || null;
  };

  const buildImportedGeneralItem = (entry: Partial<CharacterGeneralItem | CharacterInventoryItem>): CharacterGeneralItem => normalizeGeneralItem({
    id: `gen_${uid()}`,
    name: typeof entry.name === 'string' ? entry.name : 'Imported Item',
    description: typeof entry.description === 'string' ? entry.description : '',
    homebrewImageUrl: typeof entry.homebrewImageUrl === 'string' ? entry.homebrewImageUrl : '',
    homebrewImageThumbUrl: typeof entry.homebrewImageThumbUrl === 'string' ? entry.homebrewImageThumbUrl : '',
    quantity: Number.isFinite(entry.quantity) ? Number(entry.quantity) : 1,
    status: typeof entry.status === 'string' ? entry.status : (entry.equipped ? 'equipped' : 'unequipped'),
    rarity: entry.rarity || 'common',
    equipped: entry.equipped ?? false,
    macros: Array.isArray(entry.macros) ? entry.macros.map(cloneMacroForImport) : [],
    effects: Array.isArray(entry.effects) ? entry.effects.map(cloneEffectForImport) : [],
    actions: Array.isArray(entry.actions) ? entry.actions.map(cloneActionForImport) : [],
    localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map(cloneLocalVariableForImport) : [],
    scripts: Array.isArray(entry.scripts) ? entry.scripts.map(script => buildImportedScript(script as Partial<CharacterScript>, null)) : [],
    hidden: entry.hidden ?? false,
  });

  const buildImportedInventoryItem = (entry: Partial<CharacterGeneralItem | CharacterInventoryItem>, folderId: string): CharacterInventoryItem => ({
    ...buildImportedGeneralItem(entry),
    id: `inv_${uid()}`,
    folderId,
  });

  const buildImportedSpell = (entry: Partial<CharacterSpell>, folderId: string | null): CharacterSpell => ({
    id: `sp_${uid()}`,
    name: typeof entry.name === 'string' ? entry.name : 'Imported Spell',
    description: typeof entry.description === 'string' ? entry.description : '',
    homebrewImageUrl: typeof entry.homebrewImageUrl === 'string' ? entry.homebrewImageUrl : '',
    homebrewImageThumbUrl: typeof entry.homebrewImageThumbUrl === 'string' ? entry.homebrewImageThumbUrl : '',
    level: typeof entry.level === 'string' ? entry.level : '',
    resourceCost: typeof entry.resourceCost === 'string' ? entry.resourceCost : '',
    usageRemaining: typeof entry.usageRemaining === 'string' ? entry.usageRemaining : '',
    totalUsage: typeof entry.totalUsage === 'string' ? entry.totalUsage : '',
    replenishTrigger: entry.replenishTrigger || 'custom',
    replenishAmount: typeof entry.replenishAmount === 'string' ? entry.replenishAmount : '',
    magicSchool: typeof entry.magicSchool === 'string' ? entry.magicSchool : '',
    color: typeof entry.color === 'string' ? entry.color : '#7c3aed',
    macros: Array.isArray(entry.macros) ? entry.macros.map(cloneMacroForImport) : [],
    actions: Array.isArray(entry.actions) ? entry.actions.map(cloneActionForImport) : [],
    localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map(cloneLocalVariableForImport) : [],
    hidden: entry.hidden ?? false,
    folderId,
  });

  const buildImportedStatus = (
    entry: Partial<CharacterStatus>,
    folderId: string | null,
    source?: Pick<CharacterStatus, 'linkedStatusSourceType' | 'linkedStatusSourceId' | 'linkedStatusSourceEffectId'>,
  ): CharacterStatus => ({
    id: `st_${uid()}`,
    name: typeof entry.name === 'string' ? entry.name : 'Imported Status',
    duration: typeof entry.duration === 'string' ? entry.duration : '',
    durationType: entry.durationType || 'custom',
    durationEndBehavior: entry.durationEndBehavior || 'delete',
    maxDuration: typeof entry.maxDuration === 'string' ? entry.maxDuration : '',
    replenishTrigger: entry.replenishTrigger || 'custom',
    replenishAmount: typeof entry.replenishAmount === 'string' ? entry.replenishAmount : '',
    description: typeof entry.description === 'string' ? entry.description : '',
    effects: Array.isArray(entry.effects) ? entry.effects.map(cloneEffectForImport) : [],
    actions: Array.isArray(entry.actions) ? entry.actions.map(cloneActionForImport) : [],
    localVariables: Array.isArray(entry.localVariables) ? entry.localVariables.map(cloneLocalVariableForImport) : [],
    scripts: Array.isArray(entry.scripts) ? entry.scripts.map(script => buildImportedScript(script as Partial<CharacterScript>, null)) : [],
    active: entry.active ?? true,
    color: typeof entry.color === 'string' ? entry.color : '#f59e0b',
    hidden: entry.hidden ?? false,
    folderId,
    ...source,
  });

  const buildScriptAppliedStatus = (
    template: Partial<CharacterStatus>,
    conditionId: string,
    scriptStatusEntryId: string,
    folderId: string | null,
  ): CharacterStatus => ({
    id: `st_${uid()}`,
    name: template.name || 'Script Status',
    duration: template.duration || 'Script',
    durationType: template.durationType || 'custom',
    durationEndBehavior: template.durationEndBehavior || 'delete',
    maxDuration: template.maxDuration || '',
    replenishTrigger: template.replenishTrigger || 'custom',
    replenishAmount: template.replenishAmount || '',
    description: template.description || '',
    effects: (template.effects || []).map(cloneEffectForImport),
    actions: (template.actions || []).map(cloneActionForImport),
    localVariables: (template.localVariables || []).map(cloneLocalVariableForImport),
    scripts: (template.scripts || []).map(script => buildImportedScript(script as Partial<CharacterScript>, null)),
    active: true,
    color: template.color || '#f59e0b',
    hidden: template.hidden ?? false,
    folderId,
    scriptSourceConditionId: conditionId,
    scriptSourceTemplateStatusId: scriptStatusEntryId,
  });

  const evaluateScriptCondition = (
    condition: CharacterScriptCondition,
    context: Record<string, number>,
    localContext: Record<string, number> = {},
  ): boolean => {
    const left = getScriptValue(condition.leftId, context, localContext);
    const value = evalCharFormula(condition.compareValue || '0', context, localContext);
    const min = evalCharFormula(condition.minValue || '0', context, localContext);
    const max = evalCharFormula(condition.maxValue || '0', context, localContext);

    switch (condition.operator) {
      case 'lt':
        return left < value;
      case 'lte':
        return left <= value;
      case 'gt':
        return left > value;
      case 'gte':
        return left >= value;
      case 'eq':
        return left === value;
      case 'neq':
        return left !== value;
      case 'between':
        return left >= Math.min(min, max) && left <= Math.max(min, max);
      case 'outside':
        return left < Math.min(min, max) || left > Math.max(min, max);
      default:
        return false;
    }
  };

  const buildStatusApplyEffect = (entry: Partial<CharacterStatus>): StatusEffect => ({
    id: `eff_${uid()}`,
    effectType: 'status',
    targetId: '',
    value: '',
    active: true,
    statusName: typeof entry.name === 'string' && entry.name.trim() ? entry.name : 'Imported Status',
    statusEntry: entry,
    statusFolderId: null,
  });

  const buildBarUpdateEffect = (): StatusEffect => ({
    id: `eff_${uid()}`,
    effectType: 'bar-update',
    targetId: bars[0]?.id || '',
    value: '0',
    active: true,
  });

  const requestBarUpdateTarget = (description: string): Promise<string> => {
    if (bars.length === 0) {
      throw new Error('This character has no bars yet. Add a bar before importing an asset with Bar Update effects.');
    }

    return new Promise((resolve, reject) => {
      setBarTargetDraft(bars[0]?.id || '');
      setBarTargetRequest({
        description,
        resolve: (barId) => {
          setBarTargetRequest(null);
          if (!barId) {
            reject(new Error('Bar Update import was cancelled.'));
            return;
          }
          resolve(barId);
        },
      });
    });
  };

  const requestEffectTarget = (label: string): Promise<string> => {
    const options = getEffectTargetOptions();
    if (options.length === 0) {
      throw new Error('This character has no attributes or bars yet. Add attributes before importing an asset with attribute effects.');
    }

    return new Promise((resolve, reject) => {
      setEffectTargetDraft(options[0]?.id || '');
      setEffectTargetRequest({
        label,
        resolve: (targetId) => {
          setEffectTargetRequest(null);
          if (!targetId) {
            reject(new Error('Attribute effect import was cancelled.'));
            return;
          }
          resolve(targetId);
        },
      });
    });
  };

  const resolveImportTargets = async <T,>(entry: T): Promise<T> => {
    const clonedEntry = JSON.parse(JSON.stringify(entry)) as T;

    const resolveEffects = async (effects?: Partial<StatusEffect>[]) => {
      if (!Array.isArray(effects)) return;

      for (const effect of effects) {
        if ((!effect.effectType || effect.effectType === 'attribute') && (effect.useTargetPicker ?? true)) {
          const label = effect.targetLabel || effect.targetId || 'Choose a matching attribute for this effect.';
          effect.targetId = await requestEffectTarget(label);
          effect.useTargetPicker = true;
          effect.targetLabel = label;
        }

        if (effect.effectType === 'bar-update' && !effect.targetId) {
          const description = effect.barUpdateDescription || 'This imported asset wants to update one of this character\'s bars.';
          effect.targetId = await requestBarUpdateTarget(description);
        }

        if (effect.effectType === 'status' && effect.statusEntry) {
          effect.statusEntry = await resolveImportTargets(effect.statusEntry);
        }
      }
    };

    const entryWithEffects = clonedEntry as {
      effects?: Partial<StatusEffect>[];
      actions?: Array<Partial<CharacterAction> & { effects?: Partial<StatusEffect>[] }>;
      scripts?: Partial<CharacterScript>[];
      localVariables?: CharacterLocalVariable[];
      conditions?: Array<Partial<CharacterScriptCondition> & {
        statusEntries?: Array<Partial<CharacterScriptStatusEntry> & { entry?: Partial<CharacterStatus> }>;
      }>;
    };

    await resolveEffects(entryWithEffects.effects);
    if (Array.isArray(entryWithEffects.actions)) {
      for (const action of entryWithEffects.actions) {
        await resolveEffects(action.effects);
      }
    }
    if (Array.isArray(entryWithEffects.scripts)) {
      const normalizedLocalVariables = normalizeLocalVariables(entryWithEffects.localVariables);
      const resolvedScripts: CharacterScript[] = [];
      for (const script of entryWithEffects.scripts) {
        const importedScript = buildImportedScript(script as Partial<CharacterScript>, null);
        resolvedScripts.push(await resolveScriptPlaceholders(importedScript, normalizedLocalVariables));
      }
      entryWithEffects.scripts = resolvedScripts;
    }
    if (Array.isArray(entryWithEffects.conditions)) {
      for (const condition of entryWithEffects.conditions) {
        if (!Array.isArray(condition.statusEntries)) continue;
        for (const statusEntry of condition.statusEntries) {
          if (statusEntry.entry) {
            statusEntry.entry = await resolveImportTargets(statusEntry.entry);
          }
        }
      }
    }

    return clonedEntry;
  };

  const importStatusApplyEffect = async (onAdd: (effect: StatusEffect) => void) => {
    if (!isCharacterOwner && !canEditInventory) return;

    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      const parsed = JSON.parse(raw) as CharacterEntryExportPayload;
      if (parsed.schema !== 'inoraxium-character-entry' || parsed.version !== 1 || parsed.kind !== 'status' || !parsed.entry) {
        throw new Error('Please import a status export JSON file.');
      }
      const resolvedEntry = await resolveImportTargets(parsed.entry as Partial<CharacterStatus>);
      onAdd(buildStatusApplyEffect(resolvedEntry));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Status import failed.';
      setDiceError(message);
      window.alert(message);
    }
  };

  const importScriptEntry = async (
    onAdd: (script: CharacterScript) => void,
    localVariables?: CharacterLocalVariable[],
  ) => {
    if (!isCharacterOwner && !canEditInventory) return;

    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      const parsed = JSON.parse(raw) as CharacterEntryExportPayload;
      if (parsed.schema !== 'inoraxium-character-entry' || parsed.version !== 1 || parsed.kind !== 'script' || !parsed.entry) {
        throw new Error('Please import a script export JSON file.');
      }
      const importedScript = buildImportedScript(parsed.entry as Partial<CharacterScript>, null);
      const resolvedScript = await resolveScriptPlaceholders(importedScript, localVariables);
      onAdd(resolvedScript);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Script import failed.';
      setDiceError(message);
      window.alert(message);
    }
  };

  const applyStatusEffect = (effect: StatusEffect) => {
    if (effect.effectType !== 'status' || !effect.statusEntry) return;
    const folderId = effect.statusFolderId || null;
    setCharStatuses(prev => [...prev, buildImportedStatus(effect.statusEntry as Partial<CharacterStatus>, folderId)]);
    setActiveSheetTab('statuses');
    if (folderId) {
      setActiveStatusCategoryId(getRootFolderId(statusFolders, folderId) || folderId);
    }
  };

  useEffect(() => {
    type LinkedStatusSource = {
      type: NonNullable<CharacterStatus['linkedStatusSourceType']>;
      id: string;
      effects?: StatusEffect[];
      enabled: boolean;
    };

    const sources: LinkedStatusSource[] = [
      ...charGeneralItems.map(item => ({
        type: 'general-item' as const,
        id: item.id,
        effects: item.effects,
        enabled: !!item.equipped,
      })),
      ...charInventory.map(item => ({
        type: 'inventory-item' as const,
        id: item.id,
        effects: item.effects,
        enabled: !!item.equipped,
      })),
      ...charStatuses
        .filter(status => !status.linkedStatusSourceEffectId)
        .map(status => ({
          type: 'status' as const,
          id: status.id,
          effects: status.effects,
          enabled: status.active ?? true,
        })),
    ];

    const wanted = new Map<string, {
      source: LinkedStatusSource;
      effect: StatusEffect;
      effectId: string;
    }>();

    sources.forEach(source => {
      if (!source.enabled) return;
      (source.effects || []).forEach((effect, effectIndex) => {
        if (effect.effectType !== 'status' || !effect.statusEntry || (effect.active ?? true) === false) return;
        const effectId = effect.id || `effect_${effectIndex}`;
        wanted.set(`${source.type}:${source.id}:${effectId}`, { source, effect, effectId });
      });
    });

    setCharStatuses(prev => {
      let changed = false;
      const existingKeys = new Set<string>();
      const next = prev.filter(status => {
        if (!status.linkedStatusSourceType || !status.linkedStatusSourceId || !status.linkedStatusSourceEffectId) return true;
        const key = `${status.linkedStatusSourceType}:${status.linkedStatusSourceId}:${status.linkedStatusSourceEffectId}`;
        if (!wanted.has(key)) {
          changed = true;
          return false;
        }
        existingKeys.add(key);
        return true;
      }).map(status => {
        if (!status.linkedStatusSourceType || !status.linkedStatusSourceId || !status.linkedStatusSourceEffectId) return status;
        const key = `${status.linkedStatusSourceType}:${status.linkedStatusSourceId}:${status.linkedStatusSourceEffectId}`;
        const wantedEntry = wanted.get(key);
        if (!wantedEntry) return status;
        const nextFolderId = wantedEntry.effect.statusFolderId || null;
        if ((status.folderId || null) === nextFolderId) return status;
        changed = true;
        return { ...status, folderId: nextFolderId };
      });

      wanted.forEach(({ source, effect, effectId }, key) => {
        if (existingKeys.has(key)) return;
        next.push(buildImportedStatus(effect.statusEntry as Partial<CharacterStatus>, effect.statusFolderId || null, {
          linkedStatusSourceType: source.type,
          linkedStatusSourceId: source.id,
          linkedStatusSourceEffectId: effectId,
        }));
        changed = true;
      });

      return changed ? next : prev;
    });
  }, [charGeneralItems, charInventory, charStatuses, statusFolders]);

  useEffect(() => {
    if (!selectedCharacter) return;

    type LinkedScriptSource = {
      type: NonNullable<CharacterScript['linkedScriptSourceType']>;
      id: string;
      scripts?: CharacterScript[];
      localVariables?: CharacterLocalVariable[];
      enabled: boolean;
    };

    const sources: LinkedScriptSource[] = [
      ...charGeneralItems.map(item => {
        const normalizedItem = normalizeGeneralItem(item);
        return {
          type: 'general-item' as const,
          id: normalizedItem.id,
          scripts: normalizedItem.scripts,
          localVariables: normalizedItem.localVariables,
          enabled: !!normalizedItem.equipped,
        };
      }),
      ...charInventory.map(item => ({
        type: 'inventory-item' as const,
        id: item.id,
        scripts: item.scripts,
        localVariables: item.localVariables,
        enabled: !!item.equipped,
      })),
      ...charStatuses
        .filter(status => !status.linkedStatusSourceEffectId && !status.scriptSourceConditionId)
        .map(status => ({
          type: 'status' as const,
          id: status.id,
          scripts: status.scripts,
          localVariables: status.localVariables,
          enabled: status.active ?? true,
        })),
    ];

    const wanted = new Map<string, {
      source: LinkedScriptSource;
      script: CharacterScript;
      scriptId: string;
    }>();

    sources.forEach(source => {
      if (!source.enabled) return;
      (source.scripts || []).forEach((script, scriptIndex) => {
        const scriptId = script.id || `script_${scriptIndex}`;
        wanted.set(`${source.type}:${source.id}:${scriptId}`, { source, script, scriptId });
      });
    });

    setCharScripts(prev => {
      let changed = false;
      const existingKeys = new Set<string>();
      const removedConditionIds = new Set<string>();

      const next = prev.filter(script => {
        if (!script.linkedScriptSourceType || !script.linkedScriptSourceId || !script.linkedScriptSourceScriptId) {
          return true;
        }

        const key = `${script.linkedScriptSourceType}:${script.linkedScriptSourceId}:${script.linkedScriptSourceScriptId}`;
        if (!wanted.has(key)) {
          (script.conditions || []).forEach(condition => removedConditionIds.add(condition.id));
          changed = true;
          return false;
        }

        existingKeys.add(key);
        return true;
      }).map(script => {
        if (!script.linkedScriptSourceType || !script.linkedScriptSourceId || !script.linkedScriptSourceScriptId) {
          return script;
        }

        const key = `${script.linkedScriptSourceType}:${script.linkedScriptSourceId}:${script.linkedScriptSourceScriptId}`;
        const wantedEntry = wanted.get(key);
        if (!wantedEntry) return script;

        const nextLocalVariables = normalizeLocalVariables(wantedEntry.source.localVariables);
        if (JSON.stringify(script.localVariables || []) === JSON.stringify(nextLocalVariables)) {
          return script;
        }

        changed = true;
        return {
          ...script,
          localVariables: nextLocalVariables,
        };
      });

      wanted.forEach(({ source, script, scriptId }, key) => {
        if (existingKeys.has(key)) return;
        next.push({
          ...buildImportedScript(script as Partial<CharacterScript>, null),
          name: script.name || 'Imported Script',
          localVariables: normalizeLocalVariables(source.localVariables),
          linkedScriptSourceType: source.type,
          linkedScriptSourceId: source.id,
          linkedScriptSourceScriptId: scriptId,
        });
        changed = true;
      });

      if (removedConditionIds.size > 0) {
        setCharStatuses(prevStatuses => (
          prevStatuses.filter(status => !status.scriptSourceConditionId || !removedConditionIds.has(status.scriptSourceConditionId))
        ));
      }

      return changed ? next : prev;
    });
  }, [selectedCharacter, charGeneralItems, charInventory, charStatuses]);

  const applyBarUpdateEffect = async (effect: StatusEffect, localVariables?: CharacterLocalVariable[]) => {
    if (effect.effectType !== 'bar-update' || !effect.targetId) return;

    const context = getCharacterContext();
    const localContext = await getLocalVariableContextWithInputs(
      localVariables,
      context,
      effect.value || '0',
      'Bar Update Input Values',
    );
    if (!localContext) return;
    const delta = evalCharFormula(effect.value || '0', context, localContext);
    if (!Number.isFinite(delta)) return;

    setBars(prev => prev.map((bar) => {
      if (bar.id !== effect.targetId) return bar;
      const current = evalCharFormula(bar.currentValue || '0', context);
      const unclampedNext = current + delta;
      const max = getBarMode(bar) === 'resource' ? 0 : evalCharFormula(bar.maxValue || '0', context);
      const nextCurrent = getBarMode(bar) === 'resource' || !Number.isFinite(max) || max <= 0
        ? unclampedNext
        : Math.min(unclampedNext, max);
      return {
        ...bar,
        currentValue: `${Math.round(nextCurrent * 100) / 100}`,
      };
    }));
  };

  const getScriptRuntimeLocalVariables = (script: CharacterScript): CharacterLocalVariable[] | undefined => {
    if (!script.linkedScriptSourceType || !script.linkedScriptSourceId) return script.localVariables;

    if (script.linkedScriptSourceType === 'general-item') {
      return normalizeGeneralItem(
        charGeneralItems.find(item => item.id === script.linkedScriptSourceId) || {} as CharacterGeneralItem
      ).localVariables;
    }
    if (script.linkedScriptSourceType === 'inventory-item') {
      return charInventory.find(item => item.id === script.linkedScriptSourceId)?.localVariables || script.localVariables;
    }
    return charStatuses.find(status => status.id === script.linkedScriptSourceId)?.localVariables || script.localVariables;
  };

  const buildImportedDiceMacro = (entry: Partial<CharacterDiceMacro>, folderId: string | null = null): CharacterDiceMacro => ({
    id: `macro_${uid()}`,
    name: typeof entry.name === 'string' ? entry.name : 'Imported Macro',
    formula: typeof entry.formula === 'string' ? entry.formula : '1d20',
    folderId,
  });

  const getScriptValueLabelById = (valueId: string): string => {
    if (valueId.startsWith('@@')) return `Local Value (${valueId})`;
    if (isScriptPlaceholderValue(valueId)) return `Placeholder (${valueId.slice(SCRIPT_PLACEHOLDER_PREFIX.length)})`;
    const mainAttr = mainAttrs.find(attr => attr.id === valueId || `${attr.id}_mod` === valueId);
    if (mainAttr) return valueId.endsWith('_mod') ? `${mainAttr.name || mainAttr.id} Modifier (${valueId})` : `${mainAttr.name || mainAttr.id} (${valueId})`;
    const attribute = [...secondaryAttrs, ...skills, ...otherAttrs, ...resistances].find(attr => attr.id === valueId);
    if (attribute) return `${attribute.name || attribute.id} (${valueId})`;
    const currentBar = bars.find(bar => `${bar.id}_current` === valueId);
    if (currentBar) return `${currentBar.name || currentBar.id} Current (${valueId})`;
    const resetBar = bars.find(bar => `${bar.id}_reset` === valueId);
    if (resetBar) return `${resetBar.name || resetBar.id} Reset (${valueId})`;
    const maxBar = bars.find(bar => `${bar.id}_max` === valueId);
    if (maxBar) return `${maxBar.name || maxBar.id} Max (${valueId})`;
    return valueId;
  };

  const buildScriptExportPayload = (script: CharacterScript): CharacterEntryExportPayload => {
    const valueIds = new Set<string>([
      ...(script.watchIds || []),
      ...(script.conditions || []).map(condition => condition.leftId).filter(Boolean),
    ]);
    const importedValueLabels = Object.fromEntries(
      [...valueIds].map(valueId => [valueId, getScriptValueLabelById(valueId)])
    );

    return buildEntryExportPayload('script', {
      ...script,
      importedValueLabels: {
        ...(script.importedValueLabels || {}),
        ...importedValueLabels,
      },
    }, scriptFolders.find(folder => folder.id === script.folderId)?.name || null);
  };

  const buildImportedScriptStatusEntry = (entry: Partial<CharacterScriptStatusEntry> = {}): CharacterScriptStatusEntry => ({
    id: `script_status_${uid()}`,
    name: typeof entry.name === 'string' ? entry.name : entry.entry?.name || 'Imported Status',
    entry: entry.entry ? buildImportedStatus(entry.entry, null) : buildImportedStatus({}, null),
    statusFolderId: typeof entry.statusFolderId === 'string' ? entry.statusFolderId : null,
    onFalse: entry.onFalse === 'keep' ? 'keep' : 'remove',
    appliedStatusInstanceIds: [],
  });

  const buildImportedScriptPlaceholder = (placeholder: Partial<CharacterScriptPlaceholder> = {}): CharacterScriptPlaceholder => ({
    id: typeof placeholder.id === 'string' ? placeholder.id : `ph_${uid()}`,
    kind: placeholder.kind === 'bar' || placeholder.kind === 'status-folder' ? placeholder.kind : 'value',
    label: typeof placeholder.label === 'string' ? placeholder.label : 'Choose a value for this script.',
  });

  const buildImportedScriptCondition = (condition: Partial<CharacterScriptCondition> = {}): CharacterScriptCondition => ({
    id: `cond_${uid()}`,
    leftId: typeof condition.leftId === 'string' ? condition.leftId : '',
    operator: condition.operator || 'lte',
    compareValue: typeof condition.compareValue === 'string' ? condition.compareValue : '0',
    minValue: typeof condition.minValue === 'string' ? condition.minValue : '0',
    maxValue: typeof condition.maxValue === 'string' ? condition.maxValue : '0',
    statusEntries: Array.isArray(condition.statusEntries)
      ? condition.statusEntries.map(entry => buildImportedScriptStatusEntry(entry as Partial<CharacterScriptStatusEntry>))
      : [],
    barUpdates: Array.isArray(condition.barUpdates)
      ? condition.barUpdates.map(entry => ({
        id: `script_bar_${uid()}`,
        targetId: typeof entry.targetId === 'string' ? entry.targetId : '',
        value: typeof entry.value === 'string' ? entry.value : '0',
        lastMatched: false,
      }))
      : [],
    statusIds: [],
    onFalse: condition.onFalse === 'keep' ? 'keep' : 'remove',
    appliedStatusInstanceIds: [],
  });

  const buildImportedScript = (entry: Partial<CharacterScript>, folderId: string | null): CharacterScript => ({
    id: `script_${uid()}`,
    name: typeof entry.name === 'string' ? entry.name : 'Imported Script',
    watchIds: Array.isArray(entry.watchIds) ? entry.watchIds.filter((id): id is string => typeof id === 'string') : [],
    triggerIds: Array.isArray(entry.triggerIds)
      ? entry.triggerIds.filter((id): id is CharacterScriptTrigger => SCRIPT_TRIGGER_OPTIONS.some(option => option.value === id))
      : [],
    conditions: Array.isArray(entry.conditions)
      ? entry.conditions.map(condition => buildImportedScriptCondition(condition as Partial<CharacterScriptCondition>))
      : [],
    importedValueLabels: entry.importedValueLabels || {},
    placeholders: Array.isArray(entry.placeholders)
      ? entry.placeholders.map(placeholder => buildImportedScriptPlaceholder(placeholder as Partial<CharacterScriptPlaceholder>))
      : [],
    localVariables: Array.isArray(entry.localVariables)
      ? entry.localVariables.map(variable => cloneLocalVariableForImport(variable as Partial<CharacterLocalVariable>))
      : [],
    active: entry.active ?? true,
    color: typeof entry.color === 'string' ? entry.color : '#06b6d4',
    hidden: entry.hidden ?? false,
    folderId,
  });

  const importSharedEntryPayload = async (payload: CharacterEntryExportPayload, expectedKind: CharacterEntryExportKind) => {
    if (payload.schema !== 'inoraxium-character-entry' || payload.version !== 1 || !payload.entry) {
      throw new Error('This is not a valid character entry export file.');
    }
    if (payload.kind !== expectedKind) {
      throw new Error(`This file contains a ${payload.kind}, so it cannot be imported into ${expectedKind === 'item' ? 'Inventory' : expectedKind === 'spell' ? 'Spells' : expectedKind === 'status' ? 'Statuses' : expectedKind === 'script' ? 'Scripts' : 'Macros'}.`);
    }

    const resolvedEntry = await resolveImportTargets(payload.entry);

    if (payload.kind === 'item') {
      const folderId = getMatchingFolderIdByName(inventoryFolders, payload.folderName);
      if (folderId) {
        setCharInventory(prev => [...prev, buildImportedInventoryItem(resolvedEntry as Partial<CharacterGeneralItem | CharacterInventoryItem>, folderId)]);
      } else {
        setCharGeneralItems(prev => [...prev, buildImportedGeneralItem(resolvedEntry as Partial<CharacterGeneralItem | CharacterInventoryItem>)]);
      }
      return;
    }

    if (payload.kind === 'spell') {
      const folderId = getMatchingFolderIdByName(spellFolders, payload.folderName);
      setCharSpells(prev => [...prev, buildImportedSpell(resolvedEntry as Partial<CharacterSpell>, folderId)]);
      return;
    }

    if (payload.kind === 'status') {
      const folderId = getMatchingFolderIdByName(statusFolders, payload.folderName);
      setCharStatuses(prev => [...prev, buildImportedStatus(resolvedEntry as Partial<CharacterStatus>, folderId)]);
      return;
    }

    if (payload.kind === 'script') {
      const folderId = getMatchingFolderIdByName(scriptFolders, payload.folderName);
      setCharScripts(prev => [...prev, buildImportedScript(resolvedEntry as Partial<CharacterScript>, folderId)]);
      return;
    }

    setSheetDiceMacros(prev => [...prev, buildImportedDiceMacro(resolvedEntry as Partial<CharacterDiceMacro>, null)]);
  };

  const importSharedEntry = async (expectedKind: CharacterEntryExportKind) => {
    if (!canEditInventory && !isCharacterOwner) {
      window.alert('You do not have permission to import entries into this character.');
      return;
    }

    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      const parsed = JSON.parse(raw) as CharacterEntryExportPayload;
      await importSharedEntryPayload(parsed, expectedKind);
      setDiceError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Import failed.';
      setDiceError(message);
      window.alert(message);
    }
  };

  const chooseHomebrewImage = (type: 'general-item' | 'inventory-item' | 'spell', id: string) => {
    if (!isCharacterOwner && !canEditInventory) return;
    setHomebrewImageUploadTarget({ type, id });
    homebrewImageInputRef.current?.click();
  };

  const clearHomebrewImage = (type: 'general-item' | 'inventory-item' | 'spell', id: string) => {
    if (!isCharacterOwner && !canEditInventory) return;
    if (type === 'general-item') {
      updateGeneralItem(id, current => ({ ...current, homebrewImageUrl: '', homebrewImageThumbUrl: '' }));
    } else if (type === 'inventory-item') {
      updateInventoryItem(id, current => ({ ...current, homebrewImageUrl: '', homebrewImageThumbUrl: '' }));
    } else {
      updateSpell(id, current => ({ ...current, homebrewImageUrl: '', homebrewImageThumbUrl: '' }));
    }
  };

  const handleHomebrewImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const target = homebrewImageUploadTarget;
    setHomebrewImageUploadTarget(null);
    if (!file || !target) return;

    setHomebrewImageUploadingId(`${target.type}:${target.id}`);
    try {
      const upload = await uploadImageToPixhost(file);
      if (target.type === 'general-item') {
        updateGeneralItem(target.id, current => ({ ...current, homebrewImageUrl: upload.showUrl, homebrewImageThumbUrl: upload.thumbUrl }));
      } else if (target.type === 'inventory-item') {
        updateInventoryItem(target.id, current => ({ ...current, homebrewImageUrl: upload.showUrl, homebrewImageThumbUrl: upload.thumbUrl }));
      } else {
        updateSpell(target.id, current => ({ ...current, homebrewImageUrl: upload.showUrl, homebrewImageThumbUrl: upload.thumbUrl }));
      }
      setSheetSyncStatus({ tone: 'success', message: `Homebrew image uploaded for ${upload.name}. Save the character to keep it in Firestore.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image upload failed.';
      setSheetSyncStatus({ tone: 'error', message });
      window.alert(message);
    } finally {
      setHomebrewImageUploadingId(null);
    }
  };

  const addGalleryImage = (image: Omit<CharacterGalleryImage, 'id' | 'createdAt'>) => {
    setGalleryImages(prev => [
      ...prev,
      {
        id: `gallery_${uid()}`,
        createdAt: Date.now(),
        ...image,
      },
    ]);
  };

  const getDisplayImageUrl = (imageUrl?: string, thumbUrl?: string): string => {
    if (imageUrl && isDirectImageUrl(imageUrl)) return imageUrl;
    if (thumbUrl) return getPixhostDirectImageUrl(imageUrl || thumbUrl, thumbUrl);
    return imageUrl || '';
  };

  const getGalleryImageUrl = (image: CharacterGalleryImage): string => (
    getDisplayImageUrl(image.url, image.thumbUrl)
  );

  const getCharacterPortraitDisplayUrl = (character: Pick<CharacterData, 'portraitUrl' | 'gallery'>): string => {
    if (character.portraitUrl && isDirectImageUrl(character.portraitUrl)) return character.portraitUrl;
    const mainGalleryImage = (character.gallery || []).find(image => (image.tags || []).includes('main'));
    if (mainGalleryImage) return getGalleryImageUrl(mainGalleryImage);
    return character.portraitUrl || '';
  };

  const chooseGalleryUploadMode = async () => {
    if (!isCharacterOwner) return;
    const choice = await showTwoOptionModal(
      'Image Upload',
      'Choose how you want to add a character gallery image.',
      'Imgur Link',
      'imgur',
      'Upload to Pixhost',
      'pixhost',
    );
    if (!choice) return;
    if (choice === 'imgur') {
      const url = window.prompt('Paste the Imgur/image link');
      if (!url?.trim()) return;
      addGalleryImage({ url: url.trim(), thumbUrl: url.trim(), label: '', tags: [] });
      setSheetSyncStatus({ tone: 'success', message: 'Image link added to gallery. Save the character to keep it in Firestore.' });
      return;
    }
    galleryUploadInputRef.current?.click();
  };

  const handleGalleryImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setGalleryUploading(true);
    try {
      const upload = await uploadImageToPixhost(file);
      addGalleryImage({ url: upload.showUrl, thumbUrl: upload.thumbUrl, label: upload.name, tags: [] });
      setSheetSyncStatus({ tone: 'success', message: `Gallery image uploaded for ${upload.name}. Save the character to keep it in Firestore.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image upload failed.';
      setSheetSyncStatus({ tone: 'error', message });
      window.alert(message);
    } finally {
      setGalleryUploading(false);
    }
  };

  const updateGalleryImage = (imageId: string, updater: (image: CharacterGalleryImage) => CharacterGalleryImage) => {
    setGalleryImages(prev => prev.map(image => (image.id === imageId ? updater(image) : image)));
  };

  const removeGalleryImage = (imageId: string) => {
    const removedImage = galleryImages.find(image => image.id === imageId);
    if (removedImage?.tags?.includes('main')) {
      setPortraitUrl('');
      setPortraitImportUrl('');
      setPortraitLoadError(false);
    }
    setGalleryImages(prev => prev.filter(image => image.id !== imageId));
    setFullscreenGalleryImage(current => (current?.id === imageId ? null : current));
  };

  const toggleGalleryImageTag = (imageId: string, tag: CharacterGalleryImageTag) => {
    if (tag === 'main') {
      const selectedImage = galleryImages.find(image => image.id === imageId);
      if (selectedImage) {
        const imageUrl = getGalleryImageUrl(selectedImage);
        setPortraitUrl(imageUrl);
        setPortraitImportUrl(imageUrl);
        setPortraitLoadError(false);
      }
    }
    setGalleryImages(prev => prev.map(image => {
      const tags = image.tags || [];
      if (tag === 'main' || tag === 'splash-art') {
        const nextTags = image.id === imageId
          ? Array.from(new Set([...tags, tag]))
          : tags.filter(currentTag => currentTag !== tag);
        return { ...image, tags: nextTags };
      }
      if (image.id !== imageId) return image;
      return {
        ...image,
        tags: tags.includes(tag)
          ? tags.filter(currentTag => currentTag !== tag)
          : [...tags, tag],
      };
    }));
  };

  const renderHomebrewImageControls = (
    type: 'general-item' | 'inventory-item' | 'spell',
    id: string,
    imageUrl?: string,
    thumbUrl?: string,
    canEdit = true,
  ) => {
    const isUploading = homebrewImageUploadingId === `${type}:${id}`;
    const displayImageUrl = getDisplayImageUrl(imageUrl, thumbUrl);
    return (
      <div className="rounded-lg border border-sky-800/15 bg-black/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <label className="text-sm font-bold text-stone-300">Homebrew Image</label>
            <p className="mt-0.5 truncate text-xs text-stone-500">
              {displayImageUrl ? displayImageUrl : 'Only shown on the Homebrew Viewer page.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {imageUrl && (
              <a
                href={displayImageUrl || imageUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-sky-800/40 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900/20"
              >
                Open
              </a>
            )}
            {canEdit && (
              <>
                <button
                  onClick={() => chooseHomebrewImage(type, id)}
                  disabled={isUploading}
                  className="inline-flex items-center gap-1 rounded border border-cyan-800/40 px-2 py-1 text-xs text-cyan-300 hover:bg-cyan-900/20 disabled:opacity-50"
                >
                  <Upload size={12} /> {isUploading ? 'Uploading...' : imageUrl ? 'Replace' : 'Upload Image'}
                </button>
                {imageUrl && (
                  <button
                    onClick={() => clearHomebrewImage(type, id)}
                    disabled={isUploading}
                    className="rounded border border-red-800/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/20 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {thumbUrl && (
          <p className="mt-2 truncate text-[11px] text-stone-600">Thumbnail: {thumbUrl}</p>
        )}
      </div>
    );
  };

  const importScriptConditionStatus = async (scriptId: string, conditionId: string) => {
    if (!isCharacterOwner) return;

    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      const parsed = JSON.parse(raw) as CharacterEntryExportPayload;
      if (parsed.schema !== 'inoraxium-character-entry' || parsed.version !== 1 || parsed.kind !== 'status' || !parsed.entry) {
        throw new Error('Please import a status export JSON file.');
      }

      const resolvedEntry = await resolveImportTargets(parsed.entry as Partial<CharacterStatus>);
      const scriptStatusEntry: CharacterScriptStatusEntry = {
        id: `script_status_${uid()}`,
        name: typeof resolvedEntry.name === 'string' && resolvedEntry.name.trim() ? resolvedEntry.name : 'Imported Status',
        entry: resolvedEntry,
        statusFolderId: null,
        onFalse: 'remove',
        appliedStatusInstanceIds: [],
      };

      updateScriptCondition(scriptId, conditionId, current => ({
        ...current,
        statusEntries: [...(current.statusEntries || []), scriptStatusEntry],
      }));
      setDiceError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Status import failed.';
      setDiceError(message);
      window.alert(message);
    }
  };

  useEffect(() => {
    if (!selectedCharacter || charScripts.length === 0) {
      if (scriptTriggerEvent) {
        setScriptTriggerEvent(null);
      }
      return;
    }

    const context = getCharacterContext();
    let nextStatuses = [...charStatuses];
    const pendingBarUpdates: Array<{ entry: CharacterScriptBarUpdateEntry; localContext: Record<string, number> }> = [];
    let scriptsChanged = false;

    const processScript = (
      script: CharacterScript,
      localVariables?: CharacterLocalVariable[],
    ): { script: CharacterScript; changed: boolean } => {
      if ((script.active ?? true) === false) return { script, changed: false };
      const localContext = getLocalVariableContext(localVariables, context);
      const scriptTriggerMatched = Boolean(
        scriptTriggerEvent && (script.triggerIds || []).includes(scriptTriggerEvent.trigger)
      );
      let changed = false;

      let nextConditions = script.conditions || [];
      const updatedConditions = nextConditions.map((condition) => {
        if (!condition.leftId) return condition;

        const isMatched = evaluateScriptCondition(condition, context, localContext);
        const legacyStatusEntries: CharacterScriptStatusEntry[] = (condition.statusIds || [])
          .map((statusId) => {
            const template = nextStatuses.find(status => status.id === statusId && !status.scriptSourceConditionId);
            if (!template) return null;
            return {
              id: statusId,
              name: template.name || statusId,
              entry: template,
              statusFolderId: template.folderId ?? null,
              onFalse: condition.onFalse || 'remove',
              appliedStatusInstanceIds: condition.appliedStatusInstanceIds || [],
            };
          })
          .filter((entry): entry is CharacterScriptStatusEntry => !!entry);
        const statusEntries = condition.statusEntries?.length ? condition.statusEntries : legacyStatusEntries;
        const normalizedEntries = statusEntries.map(entry => ({
          ...entry,
          appliedStatusInstanceIds: (entry.appliedStatusInstanceIds || []).filter(statusId => (
            nextStatuses.some(status => status.id === statusId)
          )),
        }));
        const normalizedBarUpdates = (condition.barUpdates || []).map(entry => ({
          ...entry,
          lastMatched: entry.lastMatched ?? false,
          lastTriggeredNonce: entry.lastTriggeredNonce,
        }));
        let entryChanged = JSON.stringify(normalizedEntries) !== JSON.stringify(condition.statusEntries || []);
        let barUpdatesChanged = JSON.stringify(normalizedBarUpdates) !== JSON.stringify(condition.barUpdates || []);

        if (isMatched) {
          const nextStatusEntries = normalizedEntries.map((entry) => {
            const alreadyApplied = nextStatuses.some(status => (
              status.scriptSourceConditionId === condition.id && status.scriptSourceTemplateStatusId === entry.id
            ));
            if (alreadyApplied) return entry;

            const createdStatus = buildScriptAppliedStatus(entry.entry, condition.id, entry.id, entry.statusFolderId ?? null);
            nextStatuses = [...nextStatuses, createdStatus];
            entryChanged = true;
            return {
              ...entry,
              appliedStatusInstanceIds: [...(entry.appliedStatusInstanceIds || []), createdStatus.id],
            };
          });
          const nextBarUpdates = normalizedBarUpdates.map((entry) => {
            const shouldApplyForValueMatch = !entry.lastMatched;
            const shouldApplyForTrigger = Boolean(
              scriptTriggerMatched
              && scriptTriggerEvent
              && entry.lastTriggeredNonce !== scriptTriggerEvent.nonce
            );

            if ((shouldApplyForValueMatch || shouldApplyForTrigger) && entry.targetId) {
              pendingBarUpdates.push({ entry, localContext });
            }

            const nextEntry = {
              ...entry,
              lastMatched: true,
              lastTriggeredNonce: shouldApplyForTrigger && scriptTriggerEvent
                ? scriptTriggerEvent.nonce
                : entry.lastTriggeredNonce,
            };
            if (JSON.stringify(nextEntry) !== JSON.stringify(entry)) {
              barUpdatesChanged = true;
            }
            return nextEntry;
          });

          if (entryChanged || barUpdatesChanged || condition.statusIds?.length || condition.appliedStatusInstanceIds?.length) {
            changed = true;
            return {
              ...condition,
              statusEntries: nextStatusEntries,
              barUpdates: nextBarUpdates,
              statusIds: [],
              appliedStatusInstanceIds: [],
            };
          }
          return condition;
        }

        const removeIds = new Set(
          normalizedEntries
            .filter(entry => entry.onFalse === 'remove')
            .flatMap(entry => entry.appliedStatusInstanceIds || [])
        );
        if (removeIds.size > 0) {
          nextStatuses = nextStatuses.filter(status => !removeIds.has(status.id));
        }

        const nextStatusEntries = normalizedEntries.map(entry => (
          entry.onFalse === 'remove'
            ? { ...entry, appliedStatusInstanceIds: [] }
            : entry
        ));
        const nextBarUpdates = normalizedBarUpdates.map(entry => (
          entry.lastMatched ? { ...entry, lastMatched: false } : entry
        ));
        if (
          removeIds.size > 0
          || entryChanged
          || JSON.stringify(nextBarUpdates) !== JSON.stringify(condition.barUpdates || [])
          || condition.statusIds?.length
          || condition.appliedStatusInstanceIds?.length
          || JSON.stringify(nextStatusEntries) !== JSON.stringify(condition.statusEntries || [])
        ) {
          changed = true;
          return {
            ...condition,
            statusEntries: nextStatusEntries,
            barUpdates: nextBarUpdates,
            statusIds: [],
            appliedStatusInstanceIds: [],
          };
        }

        return condition;
      });

      nextConditions = updatedConditions;
      const nextScript = nextConditions === script.conditions ? script : { ...script, conditions: nextConditions };
      return { script: nextScript, changed };
    };

    const processedGlobalScripts = charScripts.map((script) => {
      const result = processScript(script, getScriptRuntimeLocalVariables(script));
      if (result.changed) scriptsChanged = true;
      return result.script;
    });

    if (nextStatuses.length !== charStatuses.length || nextStatuses.some((status, index) => status.id !== charStatuses[index]?.id)) {
      setCharStatuses(nextStatuses);
    }

    if (pendingBarUpdates.length > 0) {
      setBars(prev => prev.map((bar) => {
        const updates = pendingBarUpdates.filter(({ entry }) => entry.targetId === bar.id);
        if (updates.length === 0) return bar;

        const current = evalCharFormula(bar.currentValue || '0', context);
        const delta = updates.reduce((sum, { entry, localContext }) => sum + evalCharFormula(entry.value || '0', context, localContext), 0);
        const max = getBarMode(bar) === 'resource' ? 0 : evalCharFormula(bar.maxValue || '0', context);
        const unclampedNext = current + delta;
        const nextCurrent = getBarMode(bar) === 'resource' || !Number.isFinite(max) || max <= 0
          ? unclampedNext
          : Math.min(unclampedNext, max);
        return {
          ...bar,
          currentValue: `${Math.round(nextCurrent * 100) / 100}`,
        };
      }));
    }

    if (scriptsChanged) {
      setCharScripts(processedGlobalScripts);
    }

    if (scriptTriggerEvent) {
      setScriptTriggerEvent(null);
    }
  });

  const importAttributePreset = async () => {
    try {
      const raw = await importJsonTextWithChoice();
      if (!raw) return;
      applyAttributePresetJson(raw);
    } catch {
      window.alert('Invalid preset JSON file.');
    }
  };

  const getReferenceDisplayName = (referenceId: string) => {
    if (!referenceId) return 'Attribute';

    const mainAttr = mainAttrs.find(attr => attr.id === referenceId);
    if (mainAttr) return mainAttr.name || referenceId;

    const modMatch = referenceId.match(/^(.*)_mod$/);
    if (modMatch) {
      const baseAttr = mainAttrs.find(attr => attr.id === modMatch[1]);
      if (baseAttr) return `${baseAttr.name || modMatch[1]} Mod`;
    }

    const secondaryAttr = secondaryAttrs.find(attr => attr.id === referenceId);
    if (secondaryAttr) return secondaryAttr.name || referenceId;

    const skillAttr = skills.find(attr => attr.id === referenceId);
    if (skillAttr) return skillAttr.name || referenceId;

    const otherAttr = otherAttrs.find(attr => attr.id === referenceId);
    if (otherAttr) return otherAttr.name || referenceId;

    const currentBar = bars.find(bar => `${bar.id}_current` === referenceId);
    if (currentBar) return `${currentBar.name || currentBar.id} Current`;

    const resetBar = bars.find(bar => `${bar.id}_reset` === referenceId);
    if (resetBar) return `${resetBar.name || resetBar.id} Reset`;

    const maxBar = bars.find(bar => `${bar.id}_max` === referenceId);
    if (maxBar) return `${maxBar.name || maxBar.id} Max`;

    return referenceId.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const shareInventoryItem = async (item: CharacterInventoryItem) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing inventory items.');
      return;
    }

    const rarityLabel = INVENTORY_RARITY_STYLES[item.rarity || 'common'].label;
    const message = [
      `**${item.name || 'Unnamed Item'}**`,
      `Rarity: ${rarityLabel}`,
      `Quantity: ${item.quantity}`,
      `Status: ${item.status || (item.equipped ? 'equipped' : 'unequipped')}`,
      `Equipped: ${item.equipped ? 'Yes' : 'No'}`,
      item.description ? `Description: ${item.description}` : '',
      (item.effects || []).length > 0 ? `Effects: ${(item.effects || []).map(effect => `${effect.targetId || 'unknown'} ${effect.value || '0'}`).join(', ')}` : '',
      (item.macros || []).length > 0 ? `Macros: ${(item.macros || []).map(macro => `${macro.name} [${macro.formula}]`).join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) {
      setDiceError(`Discord: ${discordErr}`);
    } else {
      setDiceError(null);
    }
  };

  const addInventoryAction = (itemId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      actions: [...(item.actions || []), createCharacterAction()],
    }));
  };

  const updateInventoryAction = (itemId: string, actionId: string, updater: (action: CharacterAction) => CharacterAction) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId ? updater(action) : action),
    }));
  };

  const removeInventoryAction = (itemId: string, actionId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).filter(action => action.id !== actionId),
    }));
    setExpandedInventoryActionDescriptions(prev => prev.filter(id => id !== actionId));
  };

  const addInventoryActionMacro = (itemId: string, actionId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId
        ? { ...action, macros: [...(action.macros || []), { id: `macro_${uid()}`, name: 'New Action Macro', formula: '1d20' }] }
        : action),
    }));
  };

  const updateInventoryActionMacro = (itemId: string, actionId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId
        ? { ...action, macros: (action.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro) }
        : action),
    }));
  };

  const removeInventoryActionMacro = (itemId: string, actionId: string, macroId: string) => {
    updateInventoryItem(itemId, item => ({
      ...item,
      actions: (item.actions || []).map(action => action.id === actionId
        ? { ...action, macros: (action.macros || []).filter(macro => macro.id !== macroId) }
        : action),
    }));
  };

  const addInventoryActionEffect = (itemId: string, actionId: string) => {
    updateInventoryAction(itemId, actionId, current => ({
      ...current,
      effects: [...(current.effects || []), createAttributeEffect()],
    }));
  };

  const updateInventoryActionEffect = (itemId: string, actionId: string, effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => {
    updateInventoryAction(itemId, actionId, current => ({
      ...current,
      effects: (current.effects || []).map((effect, index) => index === effectIndex ? updater(effect) : effect),
    }));
  };

  const removeInventoryActionEffect = (itemId: string, actionId: string, effectIndex: number) => {
    updateInventoryAction(itemId, actionId, current => ({
      ...current,
      effects: (current.effects || []).filter((_, index) => index !== effectIndex),
    }));
  };

  const shareInventoryAction = async (item: CharacterInventoryItem, action: CharacterAction) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing actions.');
      return;
    }
    const message = [
      `**${item.name || 'Unnamed Item'} Action**`,
      action.name ? `Action: ${action.name}` : '',
      action.cost ? `Cost: ${action.cost}` : '',
      action.usageRemaining ? `Remaining Usage: ${action.usageRemaining}` : '',
      action.description ? `Description: ${action.description}` : '',
    ].filter(Boolean).join('\n');
    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) setDiceError(`Discord: ${discordErr}`);
  };

  const rollInventoryActionMacro = async (item: CharacterInventoryItem, action: CharacterAction, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(item.localVariables, context, macro.formula, `${item.name || 'Item'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${item.name}: ${action.name || 'Action'}: ${macro.name}` },
        context,
        ids,
        localContext
      );
      result.description = action.description || item.description || undefined;
      addRollResults(result);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const addSpell = (folderId: string | null = activeSpellCategoryId) => {
    const categoryColor = folderId
      ? spellFolders.find(folder => folder.id === getRootFolderId(spellFolders, folderId))?.color
      : null;
    setCharSpells(prev => [
      ...prev,
      {
        id: `spell_${uid()}`,
        name: 'New Spell',
        description: '',
        homebrewImageUrl: '',
        homebrewImageThumbUrl: '',
        level: 'Cantrip',
        resourceCost: '1 AP',
        usageRemaining: '',
        totalUsage: '',
        replenishTrigger: 'custom',
        replenishAmount: '',
        magicSchool: '',
        color: categoryColor || '#7c3aed',
        macros: [],
        actions: [],
        localVariables: [],
        hidden: false,
        folderId,
      },
    ]);
  };

  const updateSpell = (spellId: string, updater: (spell: CharacterSpell) => CharacterSpell) => {
    setCharSpells(prev => prev.map(spell => spell.id === spellId ? updater(spell) : spell));
  };

  const removeSpell = (spellId: string) => {
    setCharSpells(prev => prev.filter(spell => spell.id !== spellId));
    setExpandedSpellDescriptions(prev => prev.filter(id => id !== spellId));
  };

  const moveSpell = (spellId: string, direction: 'up' | 'down') => {
    setCharSpells(prev => {
      const index = prev.findIndex(spell => spell.id === spellId);
      if (index < 0) return prev;

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      const [spell] = next.splice(index, 1);
      next.splice(targetIndex, 0, spell);
      return next;
    });
  };

  const addSpellMacro = (spellId: string) => {
    updateSpell(spellId, spell => ({
      ...spell,
      macros: [...(spell.macros || []), { id: `macro_${uid()}`, name: 'New Spell Macro', formula: '1d20' }],
    }));
  };

  const updateSpellMacro = (spellId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateSpell(spellId, spell => ({
      ...spell,
      macros: (spell.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro),
    }));
  };

  const removeSpellMacro = (spellId: string, macroId: string) => {
    updateSpell(spellId, spell => ({
      ...spell,
      macros: (spell.macros || []).filter(macro => macro.id !== macroId),
    }));
  };

  const addSpellLocalVariable = (spellId: string, kind: CharacterLocalVariable['kind'] = 'variable') => {
    updateSpell(spellId, spell => ({
      ...spell,
      localVariables: [...(spell.localVariables || []), createLocalVariable(kind)],
    }));
  };

  const updateSpellLocalVariable = (spellId: string, variableIndex: number, updater: (variable: CharacterLocalVariable) => CharacterLocalVariable) => {
    updateSpell(spellId, spell => ({
      ...spell,
      localVariables: (spell.localVariables || []).map((variable, index) => index === variableIndex ? updater(variable) : variable),
    }));
  };

  const removeSpellLocalVariable = (spellId: string, variableIndex: number) => {
    updateSpell(spellId, spell => ({
      ...spell,
      localVariables: (spell.localVariables || []).filter((_, index) => index !== variableIndex),
    }));
  };

  const toggleSpellDescription = (spellId: string) => {
    setExpandedSpellDescriptions(prev => (
      prev.includes(spellId)
        ? prev.filter(id => id !== spellId)
        : [...prev, spellId]
    ));
  };

  const toggleSpellActionDescription = (actionId: string) => {
    setExpandedSpellActionDescriptions(prev => (
      prev.includes(actionId) ? prev.filter(id => id !== actionId) : [...prev, actionId]
    ));
  };

  const addSpellAction = (spellId: string) => {
    updateSpell(spellId, spell => ({
      ...spell,
      actions: [...(spell.actions || []), createCharacterAction()],
    }));
  };

  const updateSpellAction = (spellId: string, actionId: string, updater: (action: CharacterAction) => CharacterAction) => {
    updateSpell(spellId, spell => ({
      ...spell,
      actions: (spell.actions || []).map(action => action.id === actionId ? updater(action) : action),
    }));
  };

  const removeSpellAction = (spellId: string, actionId: string) => {
    updateSpell(spellId, spell => ({
      ...spell,
      actions: (spell.actions || []).filter(action => action.id !== actionId),
    }));
    setExpandedSpellActionDescriptions(prev => prev.filter(id => id !== actionId));
  };

  const addSpellActionMacro = (spellId: string, actionId: string) => {
    updateSpell(spellId, spell => ({
      ...spell,
      actions: (spell.actions || []).map(action => action.id === actionId
        ? { ...action, macros: [...(action.macros || []), { id: `macro_${uid()}`, name: 'New Action Macro', formula: '1d20' }] }
        : action),
    }));
  };

  const updateSpellActionMacro = (spellId: string, actionId: string, macroId: string, updater: (macro: CharacterDiceMacro) => CharacterDiceMacro) => {
    updateSpell(spellId, spell => ({
      ...spell,
      actions: (spell.actions || []).map(action => action.id === actionId
        ? { ...action, macros: (action.macros || []).map(macro => macro.id === macroId ? updater(macro) : macro) }
        : action),
    }));
  };

  const removeSpellActionMacro = (spellId: string, actionId: string, macroId: string) => {
    updateSpell(spellId, spell => ({
      ...spell,
      actions: (spell.actions || []).map(action => action.id === actionId
        ? { ...action, macros: (action.macros || []).filter(macro => macro.id !== macroId) }
        : action),
    }));
  };

  const addSpellActionEffect = (spellId: string, actionId: string) => {
    updateSpellAction(spellId, actionId, current => ({
      ...current,
      effects: [...(current.effects || []), createAttributeEffect()],
    }));
  };

  const updateSpellActionEffect = (spellId: string, actionId: string, effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => {
    updateSpellAction(spellId, actionId, current => ({
      ...current,
      effects: (current.effects || []).map((effect, index) => index === effectIndex ? updater(effect) : effect),
    }));
  };

  const removeSpellActionEffect = (spellId: string, actionId: string, effectIndex: number) => {
    updateSpellAction(spellId, actionId, current => ({
      ...current,
      effects: (current.effects || []).filter((_, index) => index !== effectIndex),
    }));
  };

  const shareSpell = async (spell: CharacterSpell) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing spells.');
      return;
    }

    const message = [
      `**${spell.name || 'Unnamed Spell'}**`,
      `Level: ${spell.level || '-'}`,
      `School: ${spell.magicSchool || '-'}`,
      `Resource Cost: ${spell.resourceCost || '-'}`,
      `Usage: ${spell.usageRemaining || '-'} / ${spell.totalUsage || '-'}`,
      `Color: ${spell.color || '#7c3aed'}`,
      spell.description ? `Description: ${spell.description}` : '',
      (spell.macros || []).length > 0 ? `Macros: ${(spell.macros || []).map(macro => `${macro.name} [${macro.formula}]`).join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) {
      setDiceError(`Discord: ${discordErr}`);
    } else {
      setDiceError(null);
    }
  };

  const shareSpellAction = async (spell: CharacterSpell, action: CharacterAction) => {
    const webhookUrl = mainDiceState.webhookUrl || '';
    if (!webhookUrl.trim()) {
      setDiceError('Discord: Add a webhook URL before sharing actions.');
      return;
    }
    const message = [
      `**${spell.name || 'Unnamed Spell'} Action**`,
      action.name ? `Action: ${action.name}` : '',
      action.cost ? `Cost: ${action.cost}` : '',
      action.usageRemaining ? `Remaining Usage: ${action.usageRemaining}` : '',
      action.description ? `Description: ${action.description}` : '',
    ].filter(Boolean).join('\n');
    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) setDiceError(`Discord: ${discordErr}`);
  };

  const rollSpellActionMacro = async (spell: CharacterSpell, action: CharacterAction, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(spell.localVariables, context, macro.formula, `${spell.name || 'Spell'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${spell.name}: ${action.name || 'Action'}: ${macro.name}` },
        context,
        ids,
        localContext
      );
      result.description = action.description || spell.description || undefined;
      addRollResults(result);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const getQuickRollFormula = useCallback((includeAdvText = true) => {
    const diceParts: string[] = [];
    const sidesList = Object.keys(quickDice).map(Number).filter(s => quickDice[s] > 0).sort((a, b) => b - a);

    for (const sides of sidesList) {
      diceParts.push(`${quickDice[sides]}d${sides}`);
    }

    const refParts = quickAttrRefs.map((ref) => `@${ref}`);
    let formula = [...diceParts, ...refParts].join(' + ');

    if (quickMod !== 0) {
      const modSign = quickMod > 0 ? '+' : '-';
      const modVal = Math.abs(quickMod);
      if (formula) {
        formula += ` ${modSign} ${modVal}`;
      } else {
        formula = `${modSign === '-' ? '-' : ''}${modVal}`;
      }
    }

    if (!formula) return '';

    if (includeAdvText) {
      if (quickAdv > 0) {
        formula += ` (Advantage${quickAdv > 1 ? ` x${quickAdv}` : ''})`;
      } else if (quickAdv < 0) {
        formula += ` (Disadvantage${quickAdv < -1 ? ` x${Math.abs(quickAdv)}` : ''})`;
      }
    }

    return formula;
  }, [quickDice, quickMod, quickAdv, quickAttrRefs]);

  const getDiceStateForMode = (mode: 'sheet' | 'main'): CharacterDiceState => (
    mode === 'sheet'
      ? { macros: sheetDiceMacros, webhookUrl: mainDiceState.webhookUrl, autoSend: mainDiceState.autoSend }
      : { macros: mainDiceState.macros, webhookUrl: mainDiceState.webhookUrl, autoSend: mainDiceState.autoSend }
  );

  const setMacrosForMode = (mode: 'sheet' | 'main', updater: CharacterDiceMacro[] | ((prev: CharacterDiceMacro[]) => CharacterDiceMacro[])) => {
    if (mode === 'sheet') {
      setSheetDiceMacros(prev => typeof updater === 'function' ? updater(prev) : updater);
      return;
    }
    setMainDiceState(prev => ({
      ...prev,
      macros: typeof updater === 'function' ? updater(prev.macros) : updater,
    }));
  };

  const addMacro = (mode: 'sheet' | 'main', folderId: string | null = null) => {
    const id = `macro_${uid()}`;
    setMacrosForMode(mode, prev => [...prev, { id, name: 'New Macro', formula: '1d20', folderId: mode === 'sheet' ? folderId : null }]);
  };

  const removeMacro = (mode: 'sheet' | 'main', id: string) => {
    setMacrosForMode(mode, prev => prev.filter(macro => macro.id !== id));
  };

  const startEditMacro = (macro: CharacterDiceMacro) => {
    setEditingMacroId(macro.id);
    setMacroEditBuffer({ ...macro });
  };

  const saveEditMacro = () => {
    if (!editingMacroId || !macroEditBuffer) return;
    setMacrosForMode(isViewingSheet ? 'sheet' : 'main', prev =>
      prev.map(macro =>
        macro.id === editingMacroId
          ? { ...macro, name: macroEditBuffer.name || macro.name, formula: macroEditBuffer.formula || macro.formula }
          : macro
      )
    );
    setEditingMacroId(null);
    setMacroEditBuffer({});
  };

  const cancelEditMacro = () => {
    setEditingMacroId(null);
    setMacroEditBuffer({});
  };

  const rollCharacterMacro = async (macro: CharacterDiceMacro, mode: 'sheet' | 'main') => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(macro, context, ids);
      addRollResults(result);

      const activeDiceState = getDiceStateForMode(mode);
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollInventoryMacro = async (item: CharacterInventoryItem, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(item.localVariables, context, macro.formula, `${item.name || 'Item'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${item.name}: ${macro.name}` },
        context,
        ids,
        localContext
      );
      result.description = item.description || undefined;
      addRollResults(result);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollSpellMacro = async (spell: CharacterSpell, macro: CharacterDiceMacro) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const localContext = await getLocalVariableContextWithInputs(spell.localVariables, context, macro.formula, `${spell.name || 'Spell'} Input Values`);
      if (!localContext) return;
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${spell.name}: ${macro.name}` },
        context,
        ids,
        localContext
      );
      result.description = spell.description || undefined;
      addRollResults(result);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollAttributeCheck = async (name: string, formula: string, description?: string) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { id: `attr_roll_${uid()}`, name, formula },
        context,
        ids
      );
      result.description = description || undefined;
      addRollResults(result);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollAllCharacterMacros = async (mode: 'sheet' | 'main', macrosOverride?: CharacterDiceMacro[]) => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const ids = getCharacterReferenceIds();
      const activeDiceState = getDiceStateForMode(mode);
      const macrosToRoll = macrosOverride || activeDiceState.macros;
      const results = macrosToRoll.map((macro) => executeCharacterMacro(macro, context, ids));
      addRollResults([...results].reverse());

      if (activeDiceState.autoSend) {
        for (const result of results) {
          const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
          if (discordErr) {
            setDiceError(`Discord: ${discordErr}`);
            break;
          }
        }
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const renderDicePanel = (
    mode: 'sheet' | 'main',
    options: {
      showDiscordQuick?: boolean;
      showMacros?: boolean;
      showResults?: boolean;
      macroFolderId?: string | null;
      macroFolderTitle?: string;
      showMacroFolders?: boolean;
    } = {}
  ) => {
    if (!selectedCharacter) {
      return (
        <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
          <div className="relative z-10 text-stone-500 text-center py-8 italic">
            Select a character to use Quick Roll and Dice Macros.
          </div>
        </div>
      );
    }

    const activeDiceState = getDiceStateForMode(mode);
    const showDiscordQuick = options.showDiscordQuick ?? true;
    const showMacros = options.showMacros ?? true;
    const showResults = options.showResults ?? true;
    const visibleMacros = activeDiceState.macros.filter(macro => {
      if (mode !== 'sheet') return true;
      if (options.macroFolderId === undefined) return true;
      if (options.macroFolderId === null) return (macro.folderId ?? null) === null;
      return isFolderInTree(diceMacroFolders, options.macroFolderId, macro.folderId) && isFolderVisible(diceMacroFolders, macro.folderId);
    });

    return (
      <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
        <div className="relative z-10">
          {diceError && (
            <div className="mb-4 p-3 bg-red-900/30 border border-red-700/40 rounded-lg flex items-center gap-2 text-red-300 text-sm">
              <AlertTriangle size={16} /> {diceError}
              <button onClick={() => setDiceError(null)} className="ml-auto text-red-400 hover:text-red-300 cursor-pointer">
                <X size={14} />
              </button>
            </div>
          )}

          {showDiscordQuick && (
          <>
          <div className="mb-6 p-4 bg-indigo-900/20 border border-indigo-700/30 rounded-lg">
            <h3 className="text-lg text-indigo-300 mb-3 flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
              🔗 Discord Integration
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <label className="block text-xs text-stone-400 mb-1">Webhook URL</label>
                <input
                  type="url"
                  value={mainDiceState.webhookUrl || ''}
                  onChange={e => setMainDiceState(prev => ({ ...prev, webhookUrl: e.target.value }))}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-stone-200 text-sm font-mono"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none pb-1.5">
                <input
                  type="checkbox"
                  checked={mainDiceState.autoSend || false}
                  onChange={e => setMainDiceState(prev => ({ ...prev, autoSend: e.target.checked }))}
                  className="w-4 h-4 rounded border-stone-600 bg-stone-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0"
                />
                <span className="text-sm text-indigo-200 whitespace-nowrap">Send as {selectedCharacter.name}</span>
              </label>
            </div>
          </div>

          <div className="mb-6 p-4 bg-amber-900/10 border border-amber-700/20 rounded-lg">
            <h3 className="text-lg text-amber-300 mb-3 flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
              🎯 Quick Roll
            </h3>

            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
              {[2, 4, 6, 8, 10, 12, 20, 100].map(sides => (
                <button
                  key={sides}
                  onClick={() => setQuickDice(prev => ({ ...prev, [sides]: (prev[sides] || 0) + 1 }))}
                  className="py-2 bg-stone-800 border border-amber-700/40 rounded hover:bg-amber-900/30 hover:border-amber-500/60 text-amber-300 font-mono font-bold transition-all text-sm cursor-pointer"
                >
                  d{sides}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
              {[1, 3, 5].map(n => (
                <button
                  key={`plus${n}`}
                  onClick={() => setQuickMod(prev => prev + n)}
                  className="py-2 bg-stone-800 border border-emerald-700/40 rounded hover:bg-emerald-900/30 hover:border-emerald-500/60 text-emerald-300 font-mono font-bold transition-all text-sm cursor-pointer"
                >
                  +{n}
                </button>
              ))}
              <button
                onClick={() => setQuickAdv(prev => prev < 0 ? 0 : prev + 1)}
                className="py-2 bg-stone-800 border border-blue-700/40 rounded hover:bg-blue-900/30 hover:border-blue-500/60 text-blue-300 font-mono font-bold transition-all text-xs flex flex-col items-center justify-center cursor-pointer"
              >
                <span>ADV</span>
                {quickAdv > 0 && <span className="text-[9px] text-blue-200">x{quickAdv}</span>}
              </button>
              {[1, 3, 5].map(n => (
                <button
                  key={`minus${n}`}
                  onClick={() => setQuickMod(prev => prev - n)}
                  className="py-2 bg-stone-800 border border-red-700/40 rounded hover:bg-red-900/30 hover:border-red-500/60 text-red-300 font-mono font-bold transition-all text-sm cursor-pointer"
                >
                  -{n}
                </button>
              ))}
              <button
                onClick={() => setQuickAdv(prev => prev > 0 ? 0 : prev - 1)}
                className="py-2 bg-stone-800 border border-purple-700/40 rounded hover:bg-purple-900/30 hover:border-purple-500/60 text-purple-300 font-mono font-bold transition-all text-xs flex flex-col items-center justify-center cursor-pointer"
              >
                <span>DIS</span>
                {quickAdv < 0 && <span className="text-[9px] text-purple-200">x{Math.abs(quickAdv)}</span>}
              </button>
            </div>

            <div className="mb-3">
              <label className="block text-xs text-stone-400 mb-1">Add Character Attribute ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickAttrInput}
                  onChange={(e) => setQuickAttrInput(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && quickAttrInput.trim()) {
                      e.preventDefault();
                      const nextId = quickAttrInput.trim();
                      if (!quickAttrRefs.includes(nextId)) {
                        setQuickAttrRefs(prev => [...prev, nextId]);
                      }
                      setQuickAttrInput('');
                    }
                  }}
                  placeholder="dex_mod"
                  className="flex-1 bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-amber-100 text-sm font-mono"
                />
                <button
                  onClick={() => {
                    const nextId = quickAttrInput.trim();
                    if (!nextId) return;
                    if (!quickAttrRefs.includes(nextId)) {
                      setQuickAttrRefs(prev => [...prev, nextId]);
                    }
                    setQuickAttrInput('');
                  }}
                  className="px-3 py-1.5 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 text-sm cursor-pointer"
                >
                  Add
                </button>
              </div>
              {quickAttrRefs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {quickAttrRefs.map((ref) => (
                    <button
                      key={ref}
                      onClick={() => setQuickAttrRefs(prev => prev.filter(item => item !== ref))}
                      className="px-2 py-0.5 bg-amber-950/40 border border-amber-800/40 hover:border-red-500/40 rounded text-[10px] text-amber-300 hover:text-red-400 transition-all font-mono flex items-center gap-1 cursor-pointer"
                    >
                      @{ref} <X size={10} />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mb-3">
              <label className="block text-xs text-stone-400 mb-1">Formula</label>
              <div className="bg-stone-800 border border-stone-600 rounded px-3 py-2 text-amber-200 font-mono min-h-[40px] flex items-center">
                {getQuickRollFormula() || <span className="text-stone-500">Click dice, modifiers, or add attribute IDs...</span>}
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-stone-400 mb-1">Description (optional)</label>
              <input
                type="text"
                value={quickDescription}
                onChange={e => setQuickDescription(e.target.value)}
                placeholder="e.g., Attack with Greatsword, Fireball save..."
                className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-amber-100 text-sm focus:outline-none focus:border-amber-500/50 placeholder-stone-600 font-serif"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const baseFormula = getQuickRollFormula(false);
                  if (!baseFormula) return;
                  setDiceError(null);

                  try {
                    const rollsToKeep = Math.abs(quickAdv) + 1;
                    const context = getCharacterContext();
                    const ids = getCharacterReferenceIds();
                    const results: RollResult[] = [];

                    for (let i = 0; i < rollsToKeep; i += 1) {
                      results.push(executeCharacterMacro({ id: 'quick', name: 'Quick Roll', formula: baseFormula }, context, ids));
                    }

                    let selectedIdx = 0;
                    let finalResultObj = results[0];
                    for (let i = 1; i < results.length; i += 1) {
                      if (quickAdv > 0 && results[i].total > finalResultObj.total) {
                        finalResultObj = results[i];
                        selectedIdx = i;
                      } else if (quickAdv < 0 && results[i].total < finalResultObj.total) {
                        finalResultObj = results[i];
                        selectedIdx = i;
                      }
                    }

                    const combinedSteps: RollStep[] = [];
                    results.forEach((result, idx) => {
                      combinedSteps.push({
                        label: `🔄 Attempt ${idx + 1}${idx === selectedIdx ? ' (Kept)' : ''}`,
                        value: result.total,
                        detail: result.steps.map(step => `${step.label.replace('🎲 ', '')}: ${step.value}${step.detail ? ` [${step.detail}]` : ''}`).join(', '),
                      });
                    });

                    combinedSteps.push({
                      label: quickAdv > 0 ? '🏆 Kept Highest' : (quickAdv < 0 ? '💀 Kept Lowest' : '⚡ Final Result'),
                      value: finalResultObj.total,
                      detail: `Formula: ${baseFormula}`,
                    });

                    const finalResult: RollResult = {
                      macroName: `Quick Roll${quickAdv > 0 ? ` [Adv x${quickAdv}]` : (quickAdv < 0 ? ` [Dis x${Math.abs(quickAdv)}]` : '')}`,
                      formula: getQuickRollFormula(true),
                      steps: combinedSteps,
                      total: finalResultObj.total,
                      timestamp: Date.now(),
                      description: quickDescription.trim() || undefined,
                    };

                    addRollResults(finalResult);

                    if (activeDiceState.autoSend) {
                      const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter.name, finalResult);
                      if (discordErr) setDiceError(`Discord: ${discordErr}`);
                    }
                  } catch (err: unknown) {
                    setDiceError(err instanceof Error ? err.message : 'Roll failed');
                  }
                }}
                disabled={!getQuickRollFormula(false)}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-700/50 text-amber-200 rounded border border-amber-600/50 hover:bg-amber-700/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold cursor-pointer"
              >
                <Dices size={14} /> Roll
              </button>
              <button
                onClick={() => {
                  setQuickDice({});
                  setQuickMod(0);
                  setQuickAdv(0);
                  setQuickDescription('');
                  setQuickAttrInput('');
                  setQuickAttrRefs([]);
                }}
                disabled={!getQuickRollFormula(false)}
                className="flex items-center gap-1.5 px-4 py-2 bg-stone-700/50 text-stone-300 rounded border border-stone-600/50 hover:bg-stone-700/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm cursor-pointer"
              >
                <X size={14} /> Clear
              </button>
            </div>
          </div>

          </>
          )}

          {showMacros && (
          <div className="mb-8">
            {mode === 'sheet' && options.showMacroFolders && renderFolderTree(diceMacroFolders, {
              editable: isCharacterOwner,
              emptyLabel: 'No macro folders yet. Add a folder here and it will become a macro tab.',
              title: 'Macro Folders',
              description: 'Root folders appear as macro tabs. Subfolders stay inside their category.',
              addLabel: '+ Add Folder',
              onAddRoot: () => addDiceMacroFolder(),
              onAddChild: (parentId) => addDiceMacroFolder(parentId),
              onMove: moveDiceMacroFolder,
              onUpdate: updateDiceMacroFolder,
              onRemove: removeDiceMacroFolder,
            })}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>⚡ {options.macroFolderTitle || 'Dice Macros'}</h3>
              <div className="flex gap-2">
                {visibleMacros.length > 1 && (
                  <button onClick={() => rollAllCharacterMacros(mode, visibleMacros)} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/40 text-purple-300 rounded border border-purple-800/40 hover:bg-purple-900/60 transition-colors text-sm cursor-pointer">
                    <Zap size={14} /> Roll All
                  </button>
                )}
                <button onClick={() => addMacro(mode, mode === 'sheet' ? (options.macroFolderId ?? null) : null)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 transition-colors text-sm cursor-pointer">
                  <Plus size={14} /> Add Macro
                </button>
              </div>
            </div>

            {visibleMacros.length === 0 ? (
              <div className="text-stone-500 text-center py-8 border border-dashed border-stone-700 rounded-lg">
                No macros yet. Add one to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {visibleMacros.map(macro => {
                  const isEditing = editingMacroId === macro.id;
                  return (
                    <div key={macro.id} className="flex items-center gap-3 p-3 bg-stone-900/60 border border-stone-700/50 rounded-lg group">
                      {isEditing ? (
                        <>
                          <div className="flex-1 grid grid-cols-[150px_1fr] gap-2">
                            <input value={macroEditBuffer.name || ''} onChange={e => setMacroEditBuffer(buffer => ({ ...buffer, name: e.target.value }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-200 text-sm" placeholder="Macro Name" />
                            <input value={macroEditBuffer.formula || ''} onChange={e => setMacroEditBuffer(buffer => ({ ...buffer, formula: e.target.value }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-200 text-sm font-mono" placeholder="Formula (e.g. 1d20 + @dex_mod)" />
                          </div>
                          <button onClick={saveEditMacro} className="p-1.5 text-emerald-400 hover:text-emerald-300 cursor-pointer"><Check size={16} /></button>
                          <button onClick={cancelEditMacro} className="p-1.5 text-stone-400 hover:text-stone-300 cursor-pointer"><X size={16} /></button>
                        </>
                      ) : (
                        <>
                          <div className="w-40 text-amber-200 font-medium truncate">{macro.name}</div>
                          <code className="flex-1 text-purple-300 text-sm bg-stone-800 px-2 py-0.5 rounded font-mono truncate">{macro.formula}</code>
                          {mode === 'sheet' && (
                            <select
                              value={macro.folderId ?? ''}
                              onChange={(e) => setMacrosForMode('sheet', prev => prev.map(current => current.id === macro.id ? { ...current, folderId: e.target.value || null } : current))}
                              className="min-w-[180px] bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-100 text-xs focus:outline-none"
                            >
                              <option value="">General Macros</option>
                              {getFolderOptions(diceMacroFolders).map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          )}
                          <button onClick={() => rollCharacterMacro(macro, mode)} className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-sm font-bold cursor-pointer">
                            <Dices size={14} /> Roll
                          </button>
                          {mode === 'sheet' && (
                            <button onClick={() => exportCharacterEntry('macro', macro, diceMacroFolders.find(folder => folder.id === macro.folderId)?.name || null)} className="px-2 py-1 text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-800/30 rounded hover:bg-emerald-900/20 cursor-pointer">
                              Export
                            </button>
                          )}
                          <button onClick={() => startEditMacro(macro)} className="p-1.5 text-stone-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"><Edit3 size={14} /></button>
                          <button onClick={() => removeMacro(mode, macro.id)} className="p-1.5 text-stone-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"><Trash2 size={14} /></button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          )}

          {showResults && (
          <div ref={resultsRef}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>📜 Roll Results</h3>
              {rollResults.length > 0 && (
                <button onClick={() => setRollResults([])} className="text-sm text-stone-500 hover:text-stone-300 transition-colors cursor-pointer">
                  Clear All
                </button>
              )}
            </div>

            {rollResults.length === 0 ? (
              <div className="text-stone-500 text-center py-8 border border-dashed border-stone-700 rounded-lg">
                Roll a macro to see results here.
              </div>
            ) : (
              <div className="space-y-3">
                {rollResults.map((result, idx) => (
                  <div key={`${result.timestamp}-${idx}`} className="bg-stone-900/60 border border-amber-800/30 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-amber-900/20 border-b border-amber-800/20">
                      <div className="flex items-center gap-2">
                        <Dices size={16} className="text-amber-400" />
                        <span className="text-amber-300 font-bold" style={{ fontFamily: "'Cinzel', serif" }}>{result.macroName}</span>
                        <code className="text-stone-400 text-xs bg-stone-800 px-1.5 py-0.5 rounded">{result.formula}</code>
                      </div>
                      <span className="text-2xl font-bold text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>{result.total}</span>
                    </div>
                    <div className="px-4 py-2">
                      {result.description && (
                        <p className="text-stone-300 text-sm italic mb-2 px-3 py-1 bg-black/30 border-l-2 border-amber-600/60 rounded">
                          💭 {result.description}
                        </p>
                      )}
                      <div className="space-y-1">
                        {result.steps.map((step, stepIdx) => (
                          <div key={stepIdx} className="flex items-center gap-2 text-sm">
                            <span className="text-stone-400 w-40 truncate">{step.label}</span>
                            <span className="text-amber-300 font-mono font-bold">{step.value}</span>
                            {step.detail && <span className="text-stone-500 text-xs truncate">({step.detail})</span>}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 pt-2 border-t border-amber-800/20 flex items-center justify-between">
                        <span className="text-amber-400 text-sm font-bold">Total</span>
                        <span className="text-amber-300 text-lg font-bold font-mono">{result.total}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
          )}
      </div>
      </div>
    );
  };

  // ── Filtering ────────────────────────────────────────────────────────────────

  const applyFilters = () => {
    let next = [...characters];
    if (searchName.trim()) next = next.filter(c => c.name.toLowerCase().includes(searchName.toLowerCase()));
    if (showOnlyFavs) next = next.filter(c => favoriteIds.includes(c.id));
    if (filterTags.length > 0) {
      next = next.filter(c => {
        const t = `${c.race} ${c.className} ${(c.tags || []).join(' ')}`.toLowerCase();
        return filterTags.every(tag => t.includes(tag.toLowerCase()));
      });
    }
    setFilteredCharacters(next);
  };

  const clearFilters = () => {
    setSearchName('');
    setTagInput('');
    setFilterTags([]);
    setShowOnlyFavs(false);
    setFilteredCharacters(characters);
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      if (!filterTags.includes(tagInput.trim())) setFilterTags([...filterTags, tagInput.trim()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => setFilterTags(filterTags.filter(t => t !== tag));

  const toggleOverviewMainAttribute = (attributeId: string) => {
    setOverviewSettings((current) => {
      const currentIds = current.mainAttributeIds || [];
      return {
        ...current,
        mainAttributeIds: currentIds.includes(attributeId)
          ? currentIds.filter((id) => id !== attributeId)
          : [...currentIds, attributeId],
      };
    });
  };

  const moveOverviewMainAttribute = (attributeId: string, direction: -1 | 1) => {
    setOverviewSettings((current) => {
      const ids = [...(current.mainAttributeIds || [])];
      const index = ids.indexOf(attributeId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return current;
      [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
      return { ...current, mainAttributeIds: ids };
    });
  };

  const addOverviewValueBox = () => {
    setOverviewSettings((current) => ({
      ...current,
      valueBoxes: [
        ...(current.valueBoxes || []),
        {
          id: `overview_box_${uid()}`,
          mode: 'default',
          valueId: getEffectTargetOptions()[0]?.id || '',
          secondaryValueId: getEffectTargetOptions()[1]?.id || getEffectTargetOptions()[0]?.id || '',
          barId: bars[0]?.id || '',
          secondaryBarId: bars[1]?.id || bars[0]?.id || '',
          color: '#0ea5e9',
          secondaryColor: '#a855f7',
          pipCount: 4,
          secondaryPipCount: 4,
          label: '',
        },
      ],
    }));
  };

  const updateOverviewValueBox = (
    boxId: string,
    patch: Partial<NonNullable<CharacterOverviewSettings['valueBoxes']>[number]>,
  ) => {
    setOverviewSettings((current) => ({
      ...current,
      valueBoxes: (current.valueBoxes || []).map((box) => (box.id === boxId ? { ...box, ...patch } : box)),
    }));
  };

  const removeOverviewValueBox = (boxId: string) => {
    setOverviewSettings((current) => ({
      ...current,
      valueBoxes: (current.valueBoxes || []).filter((box) => box.id !== boxId),
    }));
  };

  const moveOverviewValueBox = (boxId: string, direction: -1 | 1) => {
    setOverviewSettings((current) => {
      const boxes = [...(current.valueBoxes || [])];
      const index = boxes.findIndex((box) => box.id === boxId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= boxes.length) return current;
      [boxes[index], boxes[nextIndex]] = [boxes[nextIndex], boxes[index]];
      return { ...current, valueBoxes: boxes };
    });
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!userId || userId === 'guest') {
      window.alert('Please sign in before creating a character so it can be saved to Firestore.');
      return;
    }

    const id = `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newChar: CharacterData = {
      id,
      name: 'New Hero',
      race: 'Human',
      className: 'Vanguard',
      age: '',
      bodyAge: '',
      mentalAge: '',
      spiritualAge: '',
      alignment: '',
      visibility: 'private',
      sendToSpreadsheet: true,
      userId,
      ownerEmail: userEmail || undefined,
      controlUserIds: [],
      viewUserIds: [],
      bio: '',
      backstory: '',
      notes: '',
      portraitUrl: '',
      gallery: [],
      tags: [],
      displayStats: [],
      displaySlotStates: {},
      overviewSettings: { mainAttributeIds: [], valueBoxes: [] },
      attributeSectionModes: DEFAULT_ATTRIBUTE_SECTION_MODES,
      attributeSectionColumns: DEFAULT_ATTRIBUTE_SECTION_COLUMNS,
      mainAttributes: [],
      secondaryAttributes: [],
      skills: [],
      otherAttributes: [],
      resistances: [],
      bars: [],
      diceMacros: DEFAULT_CHARACTER_DICE_STATE.macros.map((macro) => ({ ...macro })),
      diceMacroFolders: [],
      collapsedDiceMacroFolderIds: [],
      scripts: [],
      scriptFolders: [],
      collapsedScriptFolderIds: [],
      statuses: [],
      statusFolders: [],
      collapsedStatusFolderIds: [],
      generalItems: [],
      inventory: [],
      inventoryFolders: [],
      collapsedInventoryFolderIds: [],
      collapsedSheetQuickRoll: false,
      spells: [],
      spellFolders: [],
      collapsedSpellFolderIds: [],
      modifierFormula: modFormula,
      createdAt: Date.now(),
    };

    const saveResult = await saveCharacter(newChar);
    if (!saveResult.remoteSaved) {
      const message = saveResult.remoteSkipped
        ? 'Character was created locally, but Firestore save was skipped because the signed-in user was not available.'
        : 'Character was created locally, but Firestore save failed. Check Firebase rules/login and try Save again.';
      setSheetSyncStatus({ tone: 'error', message });
      window.alert(message);
    } else {
      setSheetSyncStatus({ tone: 'success', message: 'Character created and saved to Firestore.' });
    }
    setCharacters([...characters, newChar]);
    setSelectedCharacter(newChar);
  };

  const cloneEntryFolders = (folders: CharacterEntryFolder[] = []) => {
    const idMap = new Map<string, string>();
    const clonedFolders = folders.map((folder) => {
      const nextId = `folder_${uid()}`;
      idMap.set(folder.id, nextId);
      return {
        ...folder,
        id: nextId,
      };
    });

    return {
      idMap,
      folders: clonedFolders.map((folder) => ({
        ...folder,
        parentId: folder.parentId ? idMap.get(folder.parentId) || null : null,
      })),
    };
  };

  const cloneDiceMacro = (macro: CharacterDiceMacro, folderMap?: Map<string, string>): CharacterDiceMacro => ({
    ...macro,
    id: `macro_${uid()}`,
    folderId: macro.folderId ? folderMap?.get(macro.folderId) || null : null,
  });

  const cloneStatusEffect = (effect: StatusEffect): StatusEffect => ({
    ...effect,
    id: effect.id ? `eff_${uid()}` : undefined,
  });

  const cloneLocalVariable = (variable: CharacterLocalVariable): CharacterLocalVariable => ({
    ...variable,
  });

  const cloneAction = (action: CharacterAction): CharacterAction => ({
    ...action,
    id: `act_${uid()}`,
    macros: (action.macros || []).map((macro) => cloneDiceMacro(macro)),
    effects: (action.effects || []).map(cloneStatusEffect),
  });

  const cloneEmbeddedScript = (script: CharacterScript): CharacterScript => buildImportedScript(script, null);

  const handleCreateFromSelected = async () => {
    if (!selectedCharacter) return;
    if (!userId || userId === 'guest') {
      window.alert('Please sign in before creating a character so it can be saved to Firestore.');
      return;
    }

    const inventoryFolderClone = cloneEntryFolders(selectedCharacter.inventoryFolders || []);
    const spellFolderClone = cloneEntryFolders(selectedCharacter.spellFolders || []);
    const statusFolderClone = cloneEntryFolders(selectedCharacter.statusFolders || []);
    const diceMacroFolderClone = cloneEntryFolders(selectedCharacter.diceMacroFolders || []);
    const scriptFolderClone = cloneEntryFolders(selectedCharacter.scriptFolders || []);
    const id = `char-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const newChar: CharacterData = {
      id,
      name: `${selectedCharacter.name || 'Character'} Copy`,
      race: '',
      className: '',
      age: '',
      bodyAge: '',
      mentalAge: '',
      spiritualAge: '',
      alignment: '',
      visibility: 'private',
      sendToSpreadsheet: selectedCharacter.sendToSpreadsheet ?? true,
      userId,
      ownerEmail: userEmail || undefined,
      controlUserIds: [],
      viewUserIds: [],
      bio: '',
      backstory: '',
      notes: '',
      portraitUrl: '',
      gallery: [],
      tags: [],
      displayStats: (selectedCharacter.displayStats || []).map((stat) => ({ ...stat })),
      displaySlotStates: { ...(selectedCharacter.displaySlotStates || {}) },
      overviewSettings: {
        mainAttributeIds: [...(selectedCharacter.overviewSettings?.mainAttributeIds || [])],
        valueBoxes: (selectedCharacter.overviewSettings?.valueBoxes || []).map((box) => ({ ...box })),
      },
      attributeSectionModes: {
        ...DEFAULT_ATTRIBUTE_SECTION_MODES,
        ...(selectedCharacter.attributeSectionModes || {}),
      },
      attributeSectionColumns: {
        ...DEFAULT_ATTRIBUTE_SECTION_COLUMNS,
        ...(selectedCharacter.attributeSectionColumns || {}),
      },
      mainAttributes: (selectedCharacter.mainAttributes || []).map((attr) => ({ ...attr, valueOptions: attr.valueOptions ? attr.valueOptions.map((option) => ({ ...option })) : undefined })),
      secondaryAttributes: (selectedCharacter.secondaryAttributes || []).map((attr) => ({ ...attr, valueOptions: attr.valueOptions ? attr.valueOptions.map((option) => ({ ...option })) : undefined })),
      skills: (selectedCharacter.skills || []).map((skill) => ({ ...skill, valueOptions: skill.valueOptions ? skill.valueOptions.map((option) => ({ ...option })) : undefined })),
      otherAttributes: (selectedCharacter.otherAttributes || []).map((attr) => ({ ...attr, valueOptions: attr.valueOptions ? attr.valueOptions.map((option) => ({ ...option })) : undefined })),
      resistances: (selectedCharacter.resistances || []).map((attr) => ({ ...attr, valueOptions: attr.valueOptions ? attr.valueOptions.map((option) => ({ ...option })) : undefined })),
      bars: (selectedCharacter.bars || []).map((bar) => ({ ...bar })),
      diceMacros: (selectedCharacter.diceMacros || []).map((macro) => cloneDiceMacro(macro, diceMacroFolderClone.idMap)),
      diceMacroFolders: diceMacroFolderClone.folders,
      collapsedDiceMacroFolderIds: (selectedCharacter.collapsedDiceMacroFolderIds || [])
        .map((folderId) => diceMacroFolderClone.idMap.get(folderId))
        .filter((folderId): folderId is string => !!folderId),
      scripts: (selectedCharacter.scripts || []).map((script) => ({
        ...script,
        id: `script_${uid()}`,
        folderId: script.folderId ? scriptFolderClone.idMap.get(script.folderId) || null : null,
        conditions: (script.conditions || []).map((condition) => ({
          ...condition,
          id: `cond_${uid()}`,
          barUpdates: (condition.barUpdates || []).map(entry => ({
            ...entry,
            id: `script_bar_${uid()}`,
            lastMatched: false,
            lastTriggeredNonce: undefined,
          })),
          appliedStatusInstanceIds: [],
        })),
      })),
      scriptFolders: scriptFolderClone.folders,
      collapsedScriptFolderIds: (selectedCharacter.collapsedScriptFolderIds || [])
        .map((folderId) => scriptFolderClone.idMap.get(folderId))
        .filter((folderId): folderId is string => !!folderId),
      statuses: (selectedCharacter.statuses || []).map((status) => ({
        ...status,
        id: `st_${uid()}`,
        folderId: status.folderId ? statusFolderClone.idMap.get(status.folderId) || null : null,
        effects: (status.effects || []).map(cloneStatusEffect),
        actions: (status.actions || []).map(cloneAction),
        localVariables: (status.localVariables || []).map(cloneLocalVariable),
        scripts: (status.scripts || []).map(cloneEmbeddedScript),
      })),
      statusFolders: statusFolderClone.folders,
      collapsedStatusFolderIds: (selectedCharacter.collapsedStatusFolderIds || [])
        .map((folderId) => statusFolderClone.idMap.get(folderId))
        .filter((folderId): folderId is string => !!folderId),
      generalItems: (selectedCharacter.generalItems || []).map((item) => normalizeGeneralItem({
        ...item,
        id: `gen_${uid()}`,
        macros: (item.macros || []).map((macro) => cloneDiceMacro(macro)),
        effects: (item.effects || []).map(cloneStatusEffect),
        actions: (item.actions || []).map(cloneAction),
        localVariables: (item.localVariables || []).map(cloneLocalVariable),
        scripts: (item.scripts || []).map(cloneEmbeddedScript),
      })),
      inventory: (selectedCharacter.inventory || []).map((item) => ({
        ...item,
        id: `inv_${uid()}`,
        folderId: item.folderId ? inventoryFolderClone.idMap.get(item.folderId) || null : null,
        macros: (item.macros || []).map((macro) => cloneDiceMacro(macro)),
        effects: (item.effects || []).map(cloneStatusEffect),
        actions: (item.actions || []).map(cloneAction),
        localVariables: (item.localVariables || []).map(cloneLocalVariable),
        scripts: (item.scripts || []).map(cloneEmbeddedScript),
      })),
      inventoryFolders: inventoryFolderClone.folders,
      collapsedInventoryFolderIds: (selectedCharacter.collapsedInventoryFolderIds || [])
        .map((folderId) => inventoryFolderClone.idMap.get(folderId))
        .filter((folderId): folderId is string => !!folderId),
      collapsedSheetQuickRoll: selectedCharacter.collapsedSheetQuickRoll ?? false,
      spells: (selectedCharacter.spells || []).map((spell) => ({
        ...spell,
        id: `sp_${uid()}`,
        folderId: spell.folderId ? spellFolderClone.idMap.get(spell.folderId) || null : null,
        macros: (spell.macros || []).map((macro) => cloneDiceMacro(macro)),
        actions: (spell.actions || []).map(cloneAction),
        localVariables: (spell.localVariables || []).map(cloneLocalVariable),
      })),
      spellFolders: spellFolderClone.folders,
      collapsedSpellFolderIds: (selectedCharacter.collapsedSpellFolderIds || [])
        .map((folderId) => spellFolderClone.idMap.get(folderId))
        .filter((folderId): folderId is string => !!folderId),
      modifierFormula: selectedCharacter.modifierFormula || modFormula,
      createdAt: Date.now(),
    };

    const saveResult = await saveCharacter(newChar);
    if (!saveResult.remoteSaved) {
      const message = saveResult.remoteSkipped
        ? 'Character copy was created locally, but Firestore save was skipped because the signed-in user was not available.'
        : 'Character copy was created locally, but Firestore save failed. Check Firebase rules/login and try Save again.';
      setSheetSyncStatus({ tone: 'error', message });
      window.alert(message);
    } else {
      setSheetSyncStatus({ tone: 'success', message: 'Character copy created and saved to Firestore.' });
    }
    setCharacters(prev => [...prev, newChar]);
    setSelectedCharacter(newChar);
  };

  const handleSaveAll = async () => {
    if (!selectedCharacter) return;

    if (!isCharacterOwner) {
      if (!canEditInventory) return;
      const normalizedGeneralItems = charGeneralItems.map(normalizeGeneralItem);
      await saveCharacterInventory(selectedCharacter.id, charInventory, inventoryFolders, collapsedInventoryFolders, normalizedGeneralItems, userId);
      const updated = { ...selectedCharacter, generalItems: normalizedGeneralItems, inventory: charInventory, inventoryFolders, collapsedInventoryFolderIds: collapsedInventoryFolders };
      setCharacters(prev => prev.map(c => (c.id === selectedCharacter.id ? { ...c, generalItems: normalizedGeneralItems, inventory: charInventory, inventoryFolders, collapsedInventoryFolderIds: collapsedInventoryFolders } : c)));
      setSelectedCharacter(updated);
      if (updated.sendToSpreadsheet ?? true) {
        const syncValues = buildCharacterSheetSyncValues(getCharacterContext());
        setIsSheetSyncing(true);
        const syncResult = await syncCharacterSheet({
          characterId: updated.id,
          characterName: updated.name,
          sheetId: DEFAULT_CHARACTER_SYNC_SHEET_ID,
          tabName: DEFAULT_CHARACTER_SYNC_TAB_NAME,
          values: syncValues,
        });
        setIsSheetSyncing(false);
        setSheetSyncStatus({
          tone: syncResult.success ? 'success' : 'error',
          message: syncResult.message,
        });
      } else {
        setSheetSyncStatus({
          tone: 'success',
          message: 'Spreadsheet sync skipped for this character.',
        });
      }
      return;
    }

    const updated: CharacterData = {
      ...selectedCharacter,
      name: editName.trim() || selectedCharacter.name,
      race: editRace.trim() || selectedCharacter.race,
      className: editClass.trim() || selectedCharacter.className,
      age: editAge,
      bodyAge: editBodyAge,
      mentalAge: editMentalAge,
      spiritualAge: editSpiritualAge,
      alignment: editAlignment,
      visibility: editVisibility,
      sendToSpreadsheet,
      bio: backstory,
      backstory,
      notes,
      portraitUrl,
      gallery: galleryImages,
      tags: charTags,
      displayStats,
      displaySlotStates,
      overviewSettings,
      attributeSectionModes,
      attributeSectionColumns,
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      skills,
      otherAttributes: otherAttrs,
      resistances,
      bars,
      diceMacros: sheetDiceMacros,
      diceMacroFolders,
      collapsedDiceMacroFolderIds: collapsedDiceMacroFolders,
      scripts: charScripts,
      scriptFolders,
      collapsedScriptFolderIds: collapsedScriptFolders,
      statuses: charStatuses,
      statusFolders,
      collapsedStatusFolderIds: collapsedStatusFolders,
      generalItems: charGeneralItems.map(normalizeGeneralItem),
      inventory: charInventory,
      inventoryFolders,
      collapsedInventoryFolderIds: collapsedInventoryFolders,
      collapsedSheetQuickRoll,
      spells: charSpells,
      spellFolders,
      collapsedSpellFolderIds: collapsedSpellFolders,
      modifierFormula: modFormula,
    };
    const saveResult = await saveCharacter(updated);
    setCharacters(characters.map(c => (c.id === updated.id ? updated : c)));
    setSelectedCharacter(updated);
    if (!saveResult.remoteSaved && !saveResult.remoteSkipped) {
      window.alert('Character was saved locally, but Firestore save failed. Your browser has the changes, but the database does not yet.');
      setSheetSyncStatus({
        tone: 'error',
        message: 'Character was saved locally, but Firestore save failed. Your browser has the changes, but the database does not yet.',
      });
      return;
    }
    if (saveResult.remoteSkipped) {
      window.alert('Character was saved locally only because no signed-in Firestore user was available.');
      setSheetSyncStatus({
        tone: 'error',
        message: 'Character was saved locally only because no signed-in Firestore user was available.',
      });
      return;
    }
    if (updated.sendToSpreadsheet ?? true) {
      const syncValues = buildCharacterSheetSyncValues(getCharacterContext());
      setIsSheetSyncing(true);
      const syncResult = await syncCharacterSheet({
        characterId: updated.id,
        characterName: updated.name,
        sheetId: DEFAULT_CHARACTER_SYNC_SHEET_ID,
        tabName: DEFAULT_CHARACTER_SYNC_TAB_NAME,
        values: syncValues,
      });
      setIsSheetSyncing(false);
      setSheetSyncStatus({
        tone: syncResult.success ? 'success' : 'error',
        message: syncResult.message,
      });
    } else {
      setSheetSyncStatus({
        tone: 'success',
        message: 'Spreadsheet sync skipped for this character.',
      });
    }
  };

  const handleReloadFromFirestore = async () => {
    if (!selectedCharacter) return;

    const reloadedCharacter = await reloadCharacterFromFirestore(selectedCharacter.id, userId);
    if (!reloadedCharacter) {
      window.alert('Could not reload this character from Firestore.');
      return;
    }

    setCharacters((prev) => prev.map((character) => (
      character.id === reloadedCharacter.id ? reloadedCharacter : character
    )));
    setSelectedCharacter(reloadedCharacter);
    setSheetSyncStatus(null);
  };

  const handleToggleFav = async (e: React.MouseEvent, charId: string) => {
    e.stopPropagation();
    const isFav = favoriteIds.includes(charId);
    const isNowFav = await toggleFavoriteDB(userId, charId, isFav);
    setFavoriteIds(prev => (isNowFav ? [...prev, charId] : prev.filter(id => id !== charId)));
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this character permanently?')) return;
    await deleteCharacterFromDB(id);
    const next = characters.filter(c => c.id !== id);
    setCharacters(next);
    setFavoriteIds(favoriteIds.filter(f => f !== id));
    if (selectedCharacter?.id === id) setSelectedCharacter(next[0] || null);
  };

  const persistSelectedCharacterAccess = async (updated: CharacterData, successMessage: string) => {
    setCharacters((prev) => prev.map((character) => (
      character.id === updated.id ? updated : character
    )));
    setSelectedCharacter(updated);
    setAccessStatus('Saving access changes...');

    const saveResult = await saveCharacter(updated);
    if (!saveResult.remoteSaved && !saveResult.remoteSkipped) {
      setAccessStatus('Access change was saved locally, but Firestore rejected it. Check rules/login.');
      return;
    }
    setAccessStatus(successMessage);
  };

  const handleAddAccessUser = async (kind: 'control' | 'view') => {
    if (!selectedCharacter) return;
    if (kind === 'control' && !canManageControlAccess) return;
    if (kind === 'view' && !canManageViewAccess) return;

    const uidToAdd = (kind === 'control' ? controlAccessUid : viewAccessUid).trim();
    if (!uidToAdd || uidToAdd === selectedCharacter.userId) return;

    const controlIds = selectedCharacter.controlUserIds || [];
    const viewIds = selectedCharacter.viewUserIds || [];
    const updated: CharacterData = kind === 'control'
      ? {
        ...selectedCharacter,
        controlUserIds: Array.from(new Set([...controlIds, uidToAdd])),
        viewUserIds: viewIds.filter((uid) => uid !== uidToAdd),
      }
      : {
        ...selectedCharacter,
        viewUserIds: Array.from(new Set([...viewIds, uidToAdd])),
      };

    await persistSelectedCharacterAccess(updated, `${getProfileLabel(uidToAdd)} now has ${kind === 'control' ? 'Control' : 'View'} access.`);
    if (kind === 'control') setControlAccessUid('');
    if (kind === 'view') setViewAccessUid('');
  };

  const handleRemoveAccessUser = async (kind: 'control' | 'view', uidToRemove: string) => {
    if (!selectedCharacter) return;
    if (kind === 'control' && !canManageControlAccess) return;
    if (kind === 'view' && !canManageViewAccess) return;

    const updated: CharacterData = kind === 'control'
      ? { ...selectedCharacter, controlUserIds: (selectedCharacter.controlUserIds || []).filter((uid) => uid !== uidToRemove) }
      : { ...selectedCharacter, viewUserIds: (selectedCharacter.viewUserIds || []).filter((uid) => uid !== uidToRemove) };

    await persistSelectedCharacterAccess(updated, `${getProfileLabel(uidToRemove)} access removed.`);
  };

  const handleTransferOwner = async () => {
    if (!canTransferCharacterOwner || !selectedCharacter || !ownerTransferUid.trim()) return;

    const nextOwner = userProfiles.find((profile) => profile.uid === ownerTransferUid);
    const nextOwnerLabel = nextOwner?.email || nextOwner?.displayName || ownerTransferUid;
    if (!window.confirm(`Transfer "${selectedCharacter.name}" to ${nextOwnerLabel}?`)) return;

    setOwnerTransferStatus('Transferring owner...');
    try {
      await transferCharacterOwner(selectedCharacter.id, ownerTransferUid, nextOwner?.email);
      const updated: CharacterData = {
        ...selectedCharacter,
        userId: ownerTransferUid,
        ownerEmail: nextOwner?.email || '',
        controlUserIds: (selectedCharacter.controlUserIds || []).filter((uid) => uid !== ownerTransferUid),
        viewUserIds: (selectedCharacter.viewUserIds || []).filter((uid) => uid !== ownerTransferUid),
        ownerTransferredAt: Date.now(),
      };
      setCharacters((prev) => prev.map((character) => (
        character.id === updated.id ? updated : character
      )));
      setSelectedCharacter(updated);
      setOwnerTransferStatus(`Owner changed to ${nextOwnerLabel}.`);
    } catch (error) {
      console.error('Failed to transfer owner:', error);
      setOwnerTransferStatus('Owner transfer failed. Check Firestore rules/permissions.');
    }
  };

  const handleAddToBattleTracker = (characterName: string) => {
    addCombatantToBattleTracker(characterName);
  };

  const renderFolderTree = (
    folders: CharacterEntryFolder[],
    options: {
      editable: boolean;
      emptyLabel: string;
      title?: string;
      description?: string;
      addLabel?: string;
      showChildren?: boolean;
      rootParentId?: string | null;
      onAddRoot: () => void;
      onAddChild: (parentId: string) => void;
      onMove: (folderId: string, direction: 'up' | 'down') => void;
      onUpdate: (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => void;
      onRemove: (folderId: string) => void;
    }
  ) => {
    const rootParentId = options.rootParentId ?? null;
    const parentOptions = rootParentId
      ? getFolderOptions(folders, rootParentId)
      : getFolderOptions(folders);
    const hasVisibleRootNodes = folders.some(folder => (folder.parentId ?? null) === rootParentId);

    const renderNodes = (parentId: string | null = rootParentId, depth = 0): React.ReactNode => {
      const nodes = folders.filter(folder => (folder.parentId ?? null) === parentId);
      if (nodes.length === 0) return null;

      return (
        <div className="space-y-2">
          {nodes.map((folder) => (
            <div
              key={folder.id}
              className="rounded-lg border p-3"
              style={{
                marginLeft: `${depth * 20}px`,
                borderColor: `${folder.color || '#b45309'}55`,
                background: `linear-gradient(135deg, ${folder.color || '#b45309'}18, rgba(12, 10, 9, 0.42))`,
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={folder.name}
                  onChange={(e) => options.onUpdate(folder.id, current => ({ ...current, name: e.target.value }))}
                  disabled={!options.editable}
                  className="min-w-[160px] flex-1 bg-stone-900/70 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                  placeholder="Folder name"
                />
                <input
                  type="color"
                  value={folder.color || '#b45309'}
                  onChange={(e) => options.onUpdate(folder.id, current => ({ ...current, color: e.target.value }))}
                  disabled={!options.editable}
                  className="h-10 w-14 bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer disabled:opacity-60"
                />
                <select
                  value={folder.parentId ?? ''}
                  onChange={(e) => options.onUpdate(folder.id, current => {
                    const nextParentId = e.target.value || null;
                    if (nextParentId === folder.id || isFolderDescendant(folders, folder.id, nextParentId)) {
                      return current;
                    }
                    return { ...current, parentId: nextParentId };
                  })}
                  disabled={!options.editable}
                  className="min-w-[180px] bg-stone-900/70 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                >
                  {rootParentId ? (
                    <option value={rootParentId}>Category Root</option>
                  ) : (
                    <option value="">Root</option>
                  )}
                  {parentOptions
                    .filter(option => option.id !== folder.id)
                    .map(option => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => options.onUpdate(folder.id, current => ({ ...current, hidden: !current.hidden }))}
                  className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                >
                  {folder.hidden ? 'Show' : 'Hide'}
                </button>
                {options.editable && (
                  <>
                    <button
                      onClick={() => options.onAddChild(folder.id)}
                      className="px-2 py-1 text-xs bg-amber-900/20 hover:bg-amber-900/40 rounded text-amber-300 cursor-pointer"
                    >
                      + Subfolder
                    </button>
                    <button
                      onClick={() => options.onMove(folder.id, 'up')}
                      disabled={nodes[0]?.id === folder.id}
                      className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => options.onMove(folder.id, 'down')}
                      disabled={nodes[nodes.length - 1]?.id === folder.id}
                      className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      onClick={() => options.onRemove(folder.id)}
                      className="p-1.5 text-stone-500 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              {options.showChildren !== false && renderNodes(folder.id, depth + 1)}
            </div>
          ))}
        </div>
      );
    };

    return (
      <div className="mb-6 rounded-xl border border-amber-800/20 bg-black/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-lg font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>{options.title || 'Folders'}</h4>
            <p className="text-sm text-stone-500">{options.description || 'Nested categories with color and show/hide controls.'}</p>
          </div>
          {options.editable && (
            <button
              onClick={options.onAddRoot}
              className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-sm text-amber-200 hover:bg-amber-900/60 cursor-pointer"
            >
              {options.addLabel || '+ Add Folder'}
            </button>
          )}
        </div>
        {!hasVisibleRootNodes ? (
          <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
            {options.emptyLabel}
          </div>
        ) : renderNodes()}
      </div>
    );
  };

  const getEffectTargetOptions = () => [
    ...mainAttrs.flatMap(attr => attr.id ? [
      { id: attr.id, label: `${attr.name || attr.id} (${attr.id})` },
      { id: `${attr.id}_mod`, label: `${attr.name || attr.id} Modifier (${attr.id}_mod)` },
    ] : []),
    ...secondaryAttrs.map(attr => attr.id ? { id: attr.id, label: `${attr.name || attr.id} (${attr.id})` } : null).filter((option): option is { id: string; label: string } => !!option),
    ...skills.map(attr => attr.id ? { id: attr.id, label: `${attr.name || attr.id} (${attr.id})` } : null).filter((option): option is { id: string; label: string } => !!option),
    ...otherAttrs.map(attr => attr.id ? { id: attr.id, label: `${attr.name || attr.id} (${attr.id})` } : null).filter((option): option is { id: string; label: string } => !!option),
    ...resistances.map(attr => attr.id ? { id: attr.id, label: `${attr.name || attr.id} (${attr.id})` } : null).filter((option): option is { id: string; label: string } => !!option),
    ...bars.flatMap(bar => {
      if (!bar.id) return [];
      const barName = bar.name || bar.id;
      return getBarMode(bar) === 'resource'
        ? [
          { id: `${bar.id}_current`, label: `${barName} Current (${bar.id}_current)` },
          { id: `${bar.id}_reset`, label: `${barName} Reset (${bar.id}_reset)` },
        ]
        : [
          { id: `${bar.id}_current`, label: `${barName} Current (${bar.id}_current)` },
          { id: `${bar.id}_max`, label: `${barName} Max (${bar.id}_max)` },
        ];
    }),
  ];

  const renderBarTargetResolverModal = () => {
    if (!barTargetRequest) return null;

    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-cyan-700/50 bg-stone-950 p-5 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
          <h3 className="text-lg font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>
            Choose Bar Target
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-300">
            This imported asset has a Bar Update effect. Choose which bar on this character it should update.
          </p>
          <div className="mt-4 rounded-xl border border-cyan-900/40 bg-cyan-950/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/70">Asset Note</div>
            <div className="mt-1 text-sm text-cyan-50">{barTargetRequest.description}</div>
          </div>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-amber-500">
            Target Bar
          </label>
          <select
            value={barTargetDraft}
            onChange={(e) => setBarTargetDraft(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:border-cyan-500/60 focus:outline-none"
          >
            {bars.map((bar) => (
              <option key={bar.id} value={bar.id}>
                {bar.name || bar.id} ({bar.id})
              </option>
            ))}
          </select>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => barTargetRequest.resolve(null)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
            >
              Cancel Import
            </button>
            <button
              onClick={() => barTargetRequest.resolve(barTargetDraft || bars[0]?.id || null)}
              disabled={!barTargetDraft && bars.length === 0}
              className="rounded-lg border border-cyan-500/60 bg-cyan-900/40 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-800/55 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Use This Bar
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderEffectTargetResolverModal = () => {
    if (!effectTargetRequest) return null;
    const options = getEffectTargetOptions();

    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-amber-700/50 bg-stone-950 p-5 shadow-[0_0_40px_rgba(251,191,36,0.18)]">
          <h3 className="text-lg font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
            Choose Attribute Target
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-300">
            This imported asset has an attribute effect. Choose the matching attribute or bar value on this character.
          </p>
          <div className="mt-4 rounded-xl border border-amber-900/40 bg-amber-950/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300/70">Exported Target</div>
            <div className="mt-1 text-sm text-amber-50">{effectTargetRequest.label}</div>
          </div>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-amber-500">
            Target Attribute
          </label>
          <select
            value={effectTargetDraft}
            onChange={(e) => setEffectTargetDraft(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/60 focus:outline-none"
          >
            <option value="">Choose target...</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => effectTargetRequest.resolve(null)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
            >
              Cancel Import
            </button>
            <button
              onClick={() => effectTargetRequest.resolve(effectTargetDraft || null)}
              disabled={!effectTargetDraft}
              className="rounded-lg border border-amber-500/60 bg-amber-900/40 px-4 py-2 text-sm font-bold text-amber-100 transition hover:bg-amber-800/55 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Use This Attribute
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderLocalInputModal = () => {
    if (!localInputRequest) return null;

    const submitInputs = () => {
      const values: Record<string, number> = {};
      for (const variable of localInputRequest.variables) {
        const rawValue = localInputDrafts[variable.id] ?? '';
        const parsed = Number(rawValue.trim().replace(',', '.'));
        if (!Number.isFinite(parsed)) {
          setLocalInputError(`${variable.description || variable.id} needs a valid number.`);
          return;
        }
        values[variable.id] = parsed;
      }
      localInputRequest.resolve(values);
    };

    return (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-cyan-700/50 bg-stone-950 p-5 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
          <h3 className="text-lg font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>
            {localInputRequest.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-300">
            This action needs temporary local input values before it can be applied.
          </p>
          <div className="mt-4 space-y-3">
            {localInputRequest.variables.map((variable, index) => (
              <label key={variable.id} className="block rounded-xl border border-cyan-900/35 bg-cyan-950/15 p-3">
                <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/70">
                  {variable.description || 'Input Value'}
                </span>
                <span className="mt-1 block font-mono text-xs text-stone-400">@@{variable.id}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={localInputDrafts[variable.id] ?? ''}
                  onChange={(event) => {
                    setLocalInputDrafts(prev => ({ ...prev, [variable.id]: sanitizeNumberInput(event.target.value) }));
                    setLocalInputError('');
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitInputs();
                    if (event.key === 'Escape') localInputRequest.resolve(null);
                  }}
                  autoFocus={index === 0}
                  className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm font-mono text-cyan-100 focus:border-cyan-500/60 focus:outline-none"
                  placeholder="0"
                />
              </label>
            ))}
          </div>
          {localInputError && (
            <div className="mt-4 rounded-lg border border-red-800/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
              {localInputError}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => localInputRequest.resolve(null)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
            >
              Cancel
            </button>
            <button
              onClick={submitInputs}
              className="rounded-lg border border-cyan-500/60 bg-cyan-900/40 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-800/55"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderScriptValueTargetResolverModal = () => {
    if (!scriptValueTargetRequest) return null;
    const globalOptions = getScriptValueOptions();
    const localOptions = normalizeLocalVariables(scriptValueTargetRequest.localVariables)
      .filter(variable => !!variable.id && variable.kind !== 'input')
      .map(variable => ({
        id: `@@${variable.id}`,
        label: `${variable.description || variable.id} (@@${variable.id})`,
      }));
    const selectedTarget = scriptValueLocalDraft || scriptValueGlobalDraft || '';

    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
        <div className="w-full max-w-2xl rounded-2xl border border-cyan-700/50 bg-stone-950 p-5 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
          <h3 className="text-lg font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>
            Choose Script Placeholder
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-stone-300">
            This imported script needs a value. Choose a character value or a local value from the item/status you are importing into.
          </p>
          <div className="mt-4 rounded-xl border border-cyan-900/40 bg-cyan-950/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300/70">Placeholder</div>
            <div className="mt-1 text-sm text-cyan-50">{scriptValueTargetRequest.label}</div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-500">Global Value</span>
              <select
                value={scriptValueGlobalDraft}
                onChange={(e) => {
                  setScriptValueGlobalDraft(e.target.value);
                  if (e.target.value) setScriptValueLocalDraft('');
                }}
                className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-amber-100 focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="">Choose global value...</option>
                {globalOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">Local Value</span>
              <select
                value={scriptValueLocalDraft}
                onChange={(e) => {
                  setScriptValueLocalDraft(e.target.value);
                  if (e.target.value) setScriptValueGlobalDraft('');
                }}
                className="mt-1 w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-cyan-100 focus:border-cyan-500/60 focus:outline-none"
              >
                <option value="">Choose local value...</option>
                {localOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              {localOptions.length === 0 && (
                <span className="mt-1 block text-xs text-stone-500">This item/status has no local values yet.</span>
              )}
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => scriptValueTargetRequest.resolve(null)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm text-stone-300 transition hover:border-stone-500 hover:text-stone-100"
            >
              Cancel Import
            </button>
            <button
              onClick={() => scriptValueTargetRequest.resolve(selectedTarget || null)}
              disabled={!selectedTarget}
              className="rounded-lg border border-cyan-500/60 bg-cyan-900/40 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-800/55 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Use This Value
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Full Character Sheet ─────────────────────────────────────────────────────

    if (isViewingSheet && selectedCharacter) {
      const finalContext = getCharacterContext();
      const inventoryRootCategories = inventoryFolders.filter(folder => (folder.parentId ?? null) === null);
      const activeInventoryCategory = activeInventoryCategoryId
        ? inventoryFolders.find(folder => folder.id === activeInventoryCategoryId) || null
        : null;
      const visibleInventoryItems = charInventory
        .filter(item => isFolderVisible(inventoryFolders, item.folderId))
        .filter(item => activeInventoryCategoryId
          ? isFolderInTree(inventoryFolders, activeInventoryCategoryId, item.folderId)
          : item.folderId === null
        );
      const spellRootCategories = spellFolders.filter(folder => (folder.parentId ?? null) === null);
      const activeSpellCategory = activeSpellCategoryId
        ? spellFolders.find(folder => folder.id === activeSpellCategoryId) || null
        : null;
      const visibleSpellItems = charSpells
        .filter(spell => isFolderVisible(spellFolders, spell.folderId))
        .filter(spell => activeSpellCategoryId
          ? isFolderInTree(spellFolders, activeSpellCategoryId, spell.folderId)
          : spell.folderId === null
        );
      const statusRootCategories = statusFolders.filter(folder => (folder.parentId ?? null) === null);
      const activeStatusCategory = activeStatusCategoryId
        ? statusFolders.find(folder => folder.id === activeStatusCategoryId) || null
        : null;
      const visibleStatusItems = charStatuses
        .filter(status => isFolderVisible(statusFolders, status.folderId))
        .filter(status => activeStatusCategoryId
          ? isFolderInTree(statusFolders, activeStatusCategoryId, status.folderId)
          : status.folderId === null
        );
      const diceMacroRootCategories = diceMacroFolders.filter(folder => (folder.parentId ?? null) === null);
      const activeMacroCategory = activeMacroCategoryId !== 'main' && activeMacroCategoryId !== 'rolls'
        ? diceMacroFolders.find(folder => folder.id === activeMacroCategoryId) || null
        : null;
      const scriptRootCategories = scriptFolders.filter(folder => (folder.parentId ?? null) === null);
      const activeScriptCategory = activeScriptCategoryId !== 'main'
        ? scriptFolders.find(folder => folder.id === activeScriptCategoryId) || null
        : null;
      const scriptValueOptions = getScriptValueOptions();
      const attributeEffectHistory: Record<string, Array<{ label: string; value: number; sourceAnchorId?: string }>> = {};
      const pushAttributeHistory = (targetId: string, label: string, value: number, sourceAnchorId?: string) => {
        if (!targetId || !Number.isFinite(value) || Math.abs(value) < 0.0001) return;
        if (!attributeEffectHistory[targetId]) attributeEffectHistory[targetId] = [];
        attributeEffectHistory[targetId].push({ label, value, sourceAnchorId });
      };

      [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs, ...resistances].forEach((attr) => {
        if (!attr.id) return;
        const baseValue = evalCharFormula(attr.value || '0', finalContext);
        pushAttributeHistory(attr.id, `${attr.name || attr.id} base`, baseValue);
      });

      mainAttrs.forEach((attr) => {
        if (!attr.id) return;
        const baseValue = finalContext[attr.id] || 0;
        const formula = (modFormula || 'Math.floor((@value - 10) / 2)').replace(/@value/g, baseValue.toString());
        const modValue = evalCharFormula(formula, finalContext);
        pushAttributeHistory(`${attr.id}_mod`, `${attr.name || attr.id} modifier formula`, modValue);
      });

      skills.forEach((skill) => {
        if (!skill.id) return;
        const linkedMainAttribute = skill.linkedMainAttributeId
          ? mainAttrs.find((attr) => attr.id === skill.linkedMainAttributeId)
          : null;
        if (linkedMainAttribute?.id) {
          pushAttributeHistory(
            skill.id,
            `${linkedMainAttribute.name || linkedMainAttribute.id} modifier`,
            finalContext[`${linkedMainAttribute.id}_mod`] ?? 0,
            `sheet-attr-main-${linkedMainAttribute.id}`
          );
        }
        const proficiencyValue = finalContext.proficiency ?? 0;
        const mode = skill.proficiencyMode || 'none';
        const proficiencyBonus = mode === 'half'
          ? Math.floor(proficiencyValue / 2)
          : mode === 'proficient'
            ? proficiencyValue
            : mode === 'expertise'
              ? proficiencyValue * 2
              : 0;
        if (proficiencyBonus !== 0) {
          pushAttributeHistory(skill.id, `${skill.name || skill.id} proficiency`, proficiencyBonus);
        }
      });

      (charStatuses || []).forEach((status) => {
        if ((status.active ?? true) === false) return;
        const statusLocalContext = getLocalVariableContext(status.localVariables, finalContext);
        (status.effects || []).forEach((effect) => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if (!(effect.active ?? true) || !effect.targetId) return;
          const effectValue = evalCharFormula(effect.value || '0', finalContext, statusLocalContext);
          pushAttributeHistory(effect.targetId, `${status.name || 'Status'} effect`, effectValue, `status-${status.id}`);
        });
        (status.actions || []).forEach((action) => {
          (action.effects || []).forEach((effect) => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if (!(effect.active ?? true) || !effect.targetId) return;
            const effectValue = evalCharFormula(effect.value || '0', finalContext, statusLocalContext);
            pushAttributeHistory(effect.targetId, `${status.name || 'Status'} / ${action.name || 'Action'}`, effectValue, `status-${status.id}`);
          });
        });
      });

      (charInventory || []).forEach((item) => {
        if (!item.equipped) return;
        const itemLocalContext = getLocalVariableContext(item.localVariables, finalContext);
        (item.effects || []).forEach((effect) => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if (!(effect.active ?? true) || !effect.targetId) return;
          const effectValue = evalCharFormula(effect.value || '0', finalContext, itemLocalContext);
          pushAttributeHistory(effect.targetId, `${item.name || 'Item'} effect`, effectValue, `inventory-item-${item.id}`);
        });
        (item.actions || []).forEach((action) => {
          (action.effects || []).forEach((effect) => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if (!(effect.active ?? true) || !effect.targetId) return;
            const effectValue = evalCharFormula(effect.value || '0', finalContext, itemLocalContext);
            pushAttributeHistory(effect.targetId, `${item.name || 'Item'} / ${action.name || 'Action'}`, effectValue, `inventory-item-${item.id}`);
          });
        });
      });

      (charGeneralItems || []).map(normalizeGeneralItem).forEach((item) => {
        if (!item.equipped) return;
        const itemLocalContext = getLocalVariableContext(item.localVariables, finalContext);
        (item.effects || []).forEach((effect) => {
          if (effect.effectType && effect.effectType !== 'attribute') return;
          if (!(effect.active ?? true) || !effect.targetId) return;
          const effectValue = evalCharFormula(effect.value || '0', finalContext, itemLocalContext);
          pushAttributeHistory(effect.targetId, `${item.name || 'General Item'} effect`, effectValue, `general-item-${item.id}`);
        });
        (item.actions || []).forEach((action) => {
          (action.effects || []).forEach((effect) => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if (!(effect.active ?? true) || !effect.targetId) return;
            const effectValue = evalCharFormula(effect.value || '0', finalContext, itemLocalContext);
            pushAttributeHistory(effect.targetId, `${item.name || 'General Item'} / ${action.name || 'Action'}`, effectValue, `general-item-${item.id}`);
          });
        });
      });

      (charSpells || []).forEach((spell) => {
        const spellLocalContext = getLocalVariableContext(spell.localVariables, finalContext);
        (spell.actions || []).forEach((action) => {
          (action.effects || []).forEach((effect) => {
            if (effect.effectType && effect.effectType !== 'attribute') return;
            if (!(effect.active ?? true) || !effect.targetId) return;
            const effectValue = evalCharFormula(effect.value || '0', finalContext, spellLocalContext);
            pushAttributeHistory(effect.targetId, `${spell.name || 'Spell'} / ${action.name || 'Action'}`, effectValue, `spell-${spell.id}`);
          });
        });
      });

      const knownAttributeReferenceIds = getCharacterReferenceIds();
      const unassignedAttributeEntries = Object.entries(attributeEffectHistory)
        .filter(([referenceId, entries]) => !knownAttributeReferenceIds.has(referenceId) && entries.length > 0)
        .map(([referenceId, entries]) => ({
          referenceId,
          value: entries.reduce((sum, entry) => sum + entry.value, 0),
          entries,
        }))
        .filter((entry) => {
          const query = unassignedAttributeSearch.trim().toLowerCase();
          if (!query) return true;
          return entry.referenceId.toLowerCase().includes(query)
            || entry.entries.some((historyEntry) => historyEntry.label.toLowerCase().includes(query));
        })
        .sort((left, right) => left.referenceId.localeCompare(right.referenceId));

      const favoriteDisplayMap = new Map<string, { id: string; name: string; value: string }>();
      mainAttrs.filter(attr => attr.favorite).forEach((attr) => {
        const baseValue = finalContext[attr.id] ?? 0;
        const modValue = finalContext[`${attr.id}_mod`] ?? 0;
        favoriteDisplayMap.set(attr.id, {
        id: attr.id,
        name: attr.name || getReferenceDisplayName(attr.id),
        value: `${formatAttributeOutput(attr.id, baseValue)} (${modValue >= 0 ? `+${modValue}` : modValue})`,
      });
    });
    secondaryAttrs.filter(attr => attr.favorite).forEach((attr) => {
      favoriteDisplayMap.set(attr.id, {
        id: attr.id,
        name: attr.name || getReferenceDisplayName(attr.id),
        value: formatAttributeOutput(attr.id, finalContext[attr.id] ?? 0),
      });
    });
    skills.filter(attr => attr.favorite).forEach((attr) => {
      favoriteDisplayMap.set(attr.id, {
        id: attr.id,
        name: attr.name || getReferenceDisplayName(attr.id),
        value: formatAttributeOutput(attr.id, finalContext[attr.id] ?? 0),
      });
    });
    otherAttrs.filter(attr => attr.favorite).forEach((attr) => {
      favoriteDisplayMap.set(attr.id, {
        id: attr.id,
        name: attr.name || getReferenceDisplayName(attr.id),
        value: formatAttributeOutput(attr.id, finalContext[attr.id] ?? 0),
      });
    });
    resistances.filter(attr => attr.favorite).forEach((attr) => {
      const value = finalContext[attr.id] ?? 0;
      favoriteDisplayMap.set(attr.id, {
        id: attr.id,
        name: attr.name || getReferenceDisplayName(attr.id),
        value: `${value >= 0 ? '%' : '-%'}${Math.abs(value)}`,
      });
    });
      bars.filter(bar => bar.favorite).forEach((bar) => {
        const barMode = getBarMode(bar);
        favoriteDisplayMap.set(bar.id, {
          id: bar.id,
          name: bar.name || getReferenceDisplayName(bar.id),
          value: barMode === 'resource'
            ? `${finalContext[`${bar.id}_current`] ?? 0}/${finalContext[`${bar.id}_reset`] ?? 0}`
            : `${finalContext[`${bar.id}_current`] ?? 0}/${finalContext[`${bar.id}_max`] ?? 0}`,
        });
      });
      const favoriteDisplayEntries = (() => {
        const cols = Math.max(1, attributeSectionColumns.display);
        const persistedStats = displayStats.filter(stat => favoriteDisplayMap.has(stat.referenceId));
        const usedReferenceIds = new Set(persistedStats.map(stat => stat.referenceId).filter(Boolean));
        const entries = displayStats
          .map((stat, index) => {
            const favorite = favoriteDisplayMap.get(stat.referenceId);
            if (!favorite) return null;
            return {
              slotId: stat.id,
              referenceId: stat.referenceId,
              colors: stat.colors,
              row: stat.row ?? Math.floor(index / cols),
              column: stat.column ?? (index % cols),
              ...favorite,
            };
          })
          .filter(Boolean) as Array<{ slotId: string; referenceId: string; colors?: CharacterDisplayStat['colors']; row: number; column: number; id: string; name: string; value: string }>;

        const virtualStats = persistedStats.map(stat => ({
          ...stat,
          row: stat.row ?? 0,
          column: stat.column ?? 0,
        }));
        Array.from(favoriteDisplayMap.values()).forEach((favorite) => {
          if (usedReferenceIds.has(favorite.id)) return;
          const slot = getNextAvailableDisplaySlot(virtualStats, displaySlotStates, cols);
          entries.push({
            slotId: `display_auto_${favorite.id}`,
            referenceId: favorite.id,
            colors: undefined,
            row: slot.row,
            column: slot.column,
            ...favorite,
          });
          virtualStats.push({
            id: `virtual_${favorite.id}`,
            referenceId: favorite.id,
            row: slot.row,
            column: slot.column,
          });
        });

        return entries.sort((left, right) => {
          if (left.row !== right.row) return left.row - right.row;
          if (left.column !== right.column) return left.column - right.column;
          return left.name.localeCompare(right.name);
        });
      })();

      const PROFICIENCY_STYLES: Record<NonNullable<SkillAttribute['proficiencyMode']>, { label: string; icon: React.ReactNode; className: string }> = {
        none: { label: 'No Proficiency', icon: <X size={14} />, className: 'bg-stone-900/60 border-stone-700 text-stone-400' },
        half: { label: 'Half Proficiency', icon: <Shield size={14} />, className: 'bg-sky-900/30 border-sky-500/40 text-sky-200 shadow-[0_0_14px_rgba(56,189,248,0.28)]' },
        proficient: { label: 'Proficient', icon: <Check size={14} />, className: 'bg-emerald-900/30 border-emerald-500/40 text-emerald-200 shadow-[0_0_14px_rgba(52,211,153,0.28)]' },
        expertise: { label: 'Expertise', icon: <Star size={14} />, className: 'bg-amber-900/40 border-amber-400/50 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.35)]' },
      };

      const jumpToHistorySource = (anchorId: string) => {
        const element = document.getElementById(anchorId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };

      const jumpToSheetReference = (referenceId: string) => {
        const anchorId = getSheetReferenceAnchorId(referenceId);
        if (!anchorId) return;
        jumpToHistorySource(anchorId);
      };

      const openHistoryPopover = (referenceId: string) => {
        if (historyCloseTimeoutRef.current) {
          window.clearTimeout(historyCloseTimeoutRef.current);
          historyCloseTimeoutRef.current = null;
        }
        setOpenAttributeHistoryId(referenceId);
      };

      const closeHistoryPopover = (referenceId: string) => {
        if (historyCloseTimeoutRef.current) {
          window.clearTimeout(historyCloseTimeoutRef.current);
        }
        historyCloseTimeoutRef.current = window.setTimeout(() => {
          setOpenAttributeHistoryId(current => current === referenceId ? null : current);
          historyCloseTimeoutRef.current = null;
        }, 260);
      };

      const renderAttributeHistory = (referenceId: string) => {
        const historyEntries = attributeEffectHistory[referenceId] || [];
        return (
          <div
            className="relative inline-block"
            onPointerEnter={() => openHistoryPopover(referenceId)}
            onPointerLeave={() => closeHistoryPopover(referenceId)}
          >
            <button
              onClick={() => setOpenAttributeHistoryId(current => current === referenceId ? null : referenceId)}
              className="px-2 py-1 rounded border border-amber-800/30 bg-black/20 text-[10px] uppercase tracking-[0.18em] text-amber-400 hover:text-amber-200 cursor-pointer"
            >
              History
            </button>
            {openAttributeHistoryId === referenceId && (
              <div
                className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-amber-700/30 bg-stone-950/95 p-3 shadow-2xl"
                onPointerEnter={() => openHistoryPopover(referenceId)}
                onPointerLeave={() => closeHistoryPopover(referenceId)}
              >
                <p className="text-[11px] uppercase tracking-[0.18em] text-amber-500 mb-2">Affecting this value</p>
                {historyEntries.length === 0 ? (
                  <p className="text-xs text-stone-500 italic">No active effects.</p>
                ) : (
                  <div className="space-y-1.5">
                    {historyEntries.map((entry, index) => (
                      <div key={`${referenceId}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                        {entry.sourceAnchorId ? (
                          <button
                            onClick={() => jumpToHistorySource(entry.sourceAnchorId!)}
                            className="text-left text-amber-100/85 hover:text-amber-300 underline cursor-pointer"
                          >
                            {entry.label}
                          </button>
                        ) : (
                          <span className="text-amber-100/85">{entry.label}</span>
                        )}
                        <span className={`font-mono ${entry.value >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {entry.value >= 0 ? '+' : ''}{entry.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      };

      const renderMainAttributeHistory = (attributeId: string) => (
        <div className="space-y-2">
          {renderAttributeHistory(attributeId)}
          <div className="border-t border-amber-800/20 pt-2">
            {renderAttributeHistory(`${attributeId}_mod`)}
          </div>
        </div>
      );

      const renderLocalVariablesEditor = (
        variables: CharacterLocalVariable[] | undefined,
        onAdd: (kind?: CharacterLocalVariable['kind']) => void,
        onUpdate: (variableIndex: number, updater: (variable: CharacterLocalVariable) => CharacterLocalVariable) => void,
        onRemove: (variableIndex: number) => void,
        canEdit: boolean,
      ) => (
        <div className="bg-black/20 p-3 rounded-lg border border-cyan-800/10">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <label className="text-sm font-bold text-stone-300">Local Variables</label>
              <p className="text-[11px] text-stone-500">Use variables with <code className="text-cyan-300">@@id</code>. Inputs ask for a number when rolling a macro.</p>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => onAdd('variable')} className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer">
                  + Add Variable
                </button>
                <button onClick={() => onAdd('resource')} className="text-xs bg-emerald-900/20 hover:bg-emerald-900/40 px-2 py-1 rounded text-emerald-300 cursor-pointer">
                  + Add Resource
                </button>
                <button onClick={() => onAdd('input')} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                  + Add Input
                </button>
              </div>
            )}
          </div>
          {(variables || []).length === 0 ? (
            <span className="text-[10px] text-stone-600 italic">No local variables added.</span>
          ) : (
            <div className="space-y-2">
              {(variables || []).map((variable, variableIndex) => (
                <div key={variableIndex} className="grid grid-cols-1 md:grid-cols-[110px_150px_1fr_1fr_auto] gap-2 items-center">
                  {renderActionField('Type', (
                    <select
                      value={variable.kind || 'variable'}
                      onChange={(e) => onUpdate(variableIndex, current => ({
                        ...current,
                        kind: e.target.value as CharacterLocalVariable['kind'],
                        value: e.target.value === 'resource' ? sanitizeNumberInput(current.value || '0') || '0' : current.value,
                      }))}
                      disabled={!canEdit}
                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                    >
                      <option value="variable">Variable</option>
                      <option value="resource">Local Resource Variable</option>
                      <option value="input">Input</option>
                    </select>
                  ), 'min-w-0')}
                  {renderActionField('ID', (
                    <input
                      type="text"
                      value={variable.id}
                      onChange={(e) => onUpdate(variableIndex, current => ({ ...current, id: e.target.value.replace(/^@@?/, '') }))}
                      disabled={!canEdit}
                      placeholder="local_id"
                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-300 font-mono focus:outline-none disabled:opacity-60"
                    />
                  ), 'min-w-0')}
                  {renderActionField('Description', (
                    <input
                      type="text"
                      value={variable.description}
                      onChange={(e) => onUpdate(variableIndex, current => ({ ...current, description: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="Description"
                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                    />
                  ), 'min-w-0')}
                  {renderActionField('Value', variable.kind === 'input' ? (
                    <div className="rounded border border-amber-800/30 bg-amber-950/15 px-3 py-2 text-sm italic text-amber-300/80">
                      Asked when rolling
                    </div>
                  ) : variable.kind === 'resource' ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={variable.value}
                      onChange={(e) => onUpdate(variableIndex, current => ({ ...current, value: sanitizeNumberInput(e.target.value) }))}
                      disabled={!canEdit}
                      placeholder="0"
                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
                    />
                  ) : (
                    <input
                      type="text"
                      value={variable.value}
                      onChange={(e) => onUpdate(variableIndex, current => ({ ...current, value: e.target.value }))}
                      disabled={!canEdit}
                      placeholder="@dex_mod - 1"
                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
                    />
                  ), 'min-w-0')}
                  {canEdit ? (
                    <button onClick={() => onRemove(variableIndex)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <div />
                  )}
                  {variable.kind === 'resource' && (
                    <div className="md:col-span-5 grid grid-cols-1 gap-2 rounded-lg border border-emerald-900/25 bg-emerald-950/10 p-2 md:grid-cols-[1fr_120px_1fr_1fr]">
                      {renderActionField('Replenish On', (
                        <select
                          value={variable.replenishTrigger || 'custom'}
                          onChange={(e) => onUpdate(variableIndex, current => ({ ...current, replenishTrigger: e.target.value as CharacterReplenishTrigger }))}
                          disabled={!canEdit}
                          className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-100 focus:outline-none disabled:opacity-60"
                        >
                          {REPLENISH_TRIGGER_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      ), 'min-w-0')}
                      {renderActionField('Mode', (
                        <select
                          value={variable.replenishMode || 'gain'}
                          onChange={(e) => onUpdate(variableIndex, current => ({ ...current, replenishMode: e.target.value as NonNullable<CharacterLocalVariable['replenishMode']> }))}
                          disabled={!canEdit}
                          className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-100 focus:outline-none disabled:opacity-60"
                        >
                          <option value="gain">Gain</option>
                          <option value="set">Set</option>
                        </select>
                      ), 'min-w-0')}
                      {renderActionField('Replenish Value', (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={variable.replenishAmount || ''}
                          onChange={(e) => onUpdate(variableIndex, current => ({ ...current, replenishAmount: sanitizeNumberInput(e.target.value) }))}
                          disabled={!canEdit}
                          placeholder="0"
                          className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-200 font-mono focus:outline-none disabled:opacity-60"
                        />
                      ), 'min-w-0')}
                      {renderActionField('Max Value', (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={variable.maxValue || ''}
                          onChange={(e) => onUpdate(variableIndex, current => ({ ...current, maxValue: sanitizeNumberInput(e.target.value) }))}
                          disabled={!canEdit || (variable.replenishMode || 'gain') !== 'gain'}
                          placeholder={(variable.replenishMode || 'gain') === 'gain' ? 'Optional cap' : 'Gain only'}
                          className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-200 font-mono focus:outline-none disabled:opacity-40"
                        />
                      ), 'min-w-0')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );

      const renderEffectEditorRow = (
        effect: StatusEffect,
        effectIndex: number,
        onUpdate: (effectIndex: number, updater: (effect: StatusEffect) => StatusEffect) => void,
        onRemove: (effectIndex: number) => void,
        canEdit: boolean,
        targetPlaceholder = 'Target ID (e.g. str_mod)',
        valuePlaceholder = 'Value (e.g. +2)',
        localVariables?: CharacterLocalVariable[],
        autoApplyStatusEffects = false,
      ) => {
        if (effect.effectType === 'status') {
          const exportedStatusEntry = effect.statusEntry
            ? {
              ...effect.statusEntry,
              name: effect.statusEntry.name || effect.statusName || 'Imported Status',
            } as CharacterStatus
            : null;

          return (
            <div key={effect.id || effectIndex} className="grid grid-cols-1 md:grid-cols-[auto_1fr_220px_auto] gap-2 items-center">
              <button
                onClick={() => autoApplyStatusEffects ? undefined : applyStatusEffect(effect)}
                disabled={autoApplyStatusEffects || !canEdit || !effect.statusEntry}
                className={`h-8 min-w-[4.5rem] px-2 rounded border text-xs font-bold justify-self-start ${
                  autoApplyStatusEffects
                    ? 'bg-emerald-900/25 border-emerald-700/45 text-emerald-200 cursor-default'
                    : 'bg-indigo-900/30 border-indigo-700/50 text-indigo-200 hover:bg-indigo-900/50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer'
                }`}
                title={autoApplyStatusEffects ? 'Automatically applied while the parent item/status is active' : 'Apply this status now'}
              >
                {autoApplyStatusEffects ? 'Auto' : 'Apply'}
              </button>
              <button
                type="button"
                onClick={() => exportedStatusEntry && exportCharacterEntry('status', exportedStatusEntry, null)}
                disabled={!exportedStatusEntry}
                className="min-w-0 truncate bg-stone-900 border border-stone-800 rounded px-3 py-2 text-left text-sm text-indigo-200 font-semibold focus:outline-none hover:border-indigo-500/50 hover:bg-indigo-950/30 disabled:cursor-not-allowed disabled:opacity-60"
                title={exportedStatusEntry ? 'Export this imported status' : 'No imported status data'}
              >
                {effect.statusName || effect.statusEntry?.name || 'Imported Status'}
              </button>
              <select
                value={effect.statusFolderId ?? ''}
                onChange={(e) => onUpdate(effectIndex, current => ({ ...current, statusFolderId: e.target.value || null }))}
                disabled={!canEdit}
                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
              >
                <option value="">General Statuses</option>
                {getFolderOptions(statusFolders).map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {canEdit ? (
                <button onClick={() => onRemove(effectIndex)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                  <Trash2 size={14} />
                </button>
              ) : (
                <div />
              )}
            </div>
          );
        }

        if (effect.effectType === 'bar-update') {
          return (
            <div key={effect.id || effectIndex} className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
              <button
                onClick={() => applyBarUpdateEffect(effect, localVariables)}
                disabled={!canEdit || !effect.targetId}
                className="h-8 min-w-[4.5rem] px-2 rounded border text-xs font-bold cursor-pointer justify-self-start bg-cyan-900/30 border-cyan-700/50 text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Apply
              </button>
              <select
                value={effect.targetId}
                onChange={(e) => onUpdate(effectIndex, current => ({ ...current, targetId: e.target.value }))}
                disabled={!canEdit}
                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
              >
                <option value="">Choose bar</option>
                {bars.map((bar) => (
                  <option key={bar.id} value={bar.id}>
                    {bar.name || bar.id}
                  </option>
                ))}
              </select>
              <input
                value={effect.value}
                onChange={(e) => onUpdate(effectIndex, current => ({ ...current, value: e.target.value }))}
                disabled={!canEdit}
                placeholder="Amount (e.g. 100)"
                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-200 font-mono focus:outline-none disabled:opacity-60"
              />
              {canEdit ? (
                <button onClick={() => onRemove(effectIndex)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                  <Trash2 size={14} />
                </button>
              ) : (
                <div />
              )}
            </div>
          );
        }

        return (
          <div key={effect.id || effectIndex} className="grid grid-cols-1 md:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
            <button
              onClick={() => onUpdate(effectIndex, current => ({ ...current, active: !(current.active ?? true) }))}
              disabled={!canEdit}
              className={`h-8 min-w-[3.5rem] px-2 rounded border text-xs font-bold cursor-pointer justify-self-start disabled:opacity-40 disabled:cursor-not-allowed ${(effect.active ?? true) ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-stone-900/40 border-stone-700/40 text-stone-400'}`}
            >
              {(effect.active ?? true) ? 'On' : 'Off'}
            </button>
            <button
              onClick={() => onUpdate(effectIndex, current => ({ ...current, useTargetPicker: !(current.useTargetPicker ?? true) }))}
              disabled={!canEdit}
              className={`h-8 w-9 rounded border grid place-items-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${(effect.useTargetPicker ?? true) ? 'bg-amber-900/35 border-amber-400/50 text-amber-200' : 'bg-stone-900/40 border-stone-700/60 text-stone-500'}`}
              title={(effect.useTargetPicker ?? true) ? 'Picker mode: choose a character attribute' : 'Manual mode: type target id'}
            >
              <Crown size={14} fill={(effect.useTargetPicker ?? true) ? 'currentColor' : 'none'} />
            </button>
            {renderActionField('Target', (
              (effect.useTargetPicker ?? true) ? (
                <select
                  value={effect.targetId}
                  onChange={(e) => onUpdate(effectIndex, current => ({
                    ...current,
                    targetId: e.target.value,
                    targetLabel: getEffectTargetLabelById(e.target.value),
                  }))}
                  disabled={!canEdit}
                  className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-300 focus:outline-none disabled:opacity-60"
                >
                  <option value="">Choose target...</option>
                  {getEffectTargetOptions().map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={effect.targetId}
                  onChange={(e) => onUpdate(effectIndex, current => ({ ...current, targetId: e.target.value }))}
                  disabled={!canEdit}
                  placeholder={targetPlaceholder}
                  className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-400 font-mono focus:outline-none disabled:opacity-60"
                />
              )
            ), 'min-w-0')}
            {renderActionField('Value', (
              <input
                value={effect.value}
                onChange={(e) => onUpdate(effectIndex, current => ({ ...current, value: e.target.value }))}
                disabled={!canEdit}
                placeholder={valuePlaceholder}
                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
              />
            ), 'min-w-0')}
            {canEdit ? (
              <button onClick={() => onRemove(effectIndex)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                <Trash2 size={14} />
              </button>
            ) : (
              <div />
            )}
          </div>
        );
      };

      const renderEmbeddedScriptsEditor = (
        scripts: CharacterScript[] | undefined,
        onImport: () => void,
        onRemove: (scriptIndex: number) => void,
        canEdit: boolean,
      ) => (
        <div className="bg-black/20 p-3 rounded-lg border border-cyan-800/10">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div>
              <label className="text-sm font-bold text-stone-300">Scripts</label>
              <p className="text-[11px] text-stone-500">Equipped items and active statuses create linked scripts in the Scripts page.</p>
            </div>
            {canEdit && (
              <button onClick={onImport} className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer">
                + Import Script
              </button>
            )}
          </div>
          {(scripts || []).length === 0 ? (
            <span className="text-[10px] text-stone-600 italic">No scripts imported.</span>
          ) : (
            <div className="space-y-2">
              {(scripts || []).map((script, scriptIndex) => (
                <div key={script.id || scriptIndex} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 rounded-lg border border-cyan-900/25 bg-stone-950/45 p-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-cyan-100">{script.name || 'Imported Script'}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(script.triggerIds || []).length > 0 ? (script.triggerIds || []).map(triggerId => (
                        <span key={triggerId} className="rounded border border-amber-800/35 bg-amber-950/25 px-2 py-0.5 text-[10px] text-amber-200">
                          {SCRIPT_TRIGGER_OPTIONS.find(option => option.value === triggerId)?.label || triggerId}
                        </span>
                      )) : (
                        <span className="text-[10px] italic text-stone-500">Value controlled</span>
                      )}
                      <span className="text-[10px] text-stone-500">{(script.conditions || []).length} IF</span>
                    </div>
                  </div>
                  {canEdit && (
                    <button onClick={() => onRemove(scriptIndex)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );

      const renderActionField = (
        label: string,
        children: React.ReactNode,
        className = 'min-w-[140px]',
      ) => {
        const labelFitStyle = className.includes('w-[11ch]')
          ? { minWidth: `${Math.max(11, Math.ceil(label.length * 0.8))}ch` }
          : undefined;

        return (
          <label className={`flex flex-col gap-1 ${className}`} style={labelFitStyle}>
            <span
              className="h-4 whitespace-nowrap text-[10px] font-bold uppercase leading-4 tracking-[0.16em] text-stone-500"
              title={label}
            >
              {label}
            </span>
            {children}
          </label>
        );
      };

      const renderActionUsageControls = (
        action: CharacterAction,
        onUpdate: (updater: (action: CharacterAction) => CharacterAction) => void,
        canEdit: boolean,
      ) => (
        <>
          {renderActionField('Remaining', (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={action.usageRemaining}
              onChange={(e) => onUpdate(current => ({ ...current, usageRemaining: sanitizeWholeNumberInput(e.target.value) }))}
              disabled={!canEdit}
              placeholder="0"
              className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
            />
          ), 'w-[11ch] flex-none')}
          {renderActionField('Max', (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={action.maxUsage || ''}
              onChange={(e) => onUpdate(current => ({ ...current, maxUsage: sanitizeWholeNumberInput(e.target.value) }))}
              disabled={!canEdit}
              placeholder="0"
              className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
            />
          ), 'w-[11ch] flex-none')}
          {renderActionField('Replenish On', (
            <select
              value={action.replenishTrigger || 'custom'}
              onChange={(e) => onUpdate(current => ({ ...current, replenishTrigger: e.target.value as CharacterReplenishTrigger }))}
              disabled={!canEdit}
              className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
              title="When this action regains usage"
            >
              {REPLENISH_TRIGGER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ), 'min-w-[150px]')}
          {renderActionField('Gain', (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={action.replenishAmount || ''}
              onChange={(e) => onUpdate(current => ({ ...current, replenishAmount: sanitizeWholeNumberInput(e.target.value) }))}
              disabled={!canEdit}
              placeholder="0"
              className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
            />
          ), 'w-[11ch] flex-none')}
        </>
      );

      const renderStatusActionsEditor = (status: CharacterStatus, canEdit: boolean) => (
        <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-bold text-stone-300">Actions</label>
            {canEdit && (
              <button onClick={() => addStatusAction(status.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                + Add Action
              </button>
            )}
          </div>
          {(status.actions || []).length === 0 ? (
            <span className="text-xs text-stone-600 italic">No actions added.</span>
          ) : (
            <div className="space-y-3">
              {(status.actions || []).map((action) => {
                const actionKey = `${status.id}:${action.id}`;
                const isExpanded = expandedStatusActionDescriptions.includes(actionKey);
                return (
                  <div key={action.id} className="rounded-lg border border-amber-800/15 bg-amber-950/10 p-3">
                    <div className="flex flex-wrap gap-2 items-start mb-2">
                      {renderActionField('Name', (
                        <input
                          type="text"
                          value={action.name}
                          onChange={(e) => updateStatusAction(status.id, action.id, current => ({ ...current, name: e.target.value }))}
                          disabled={!canEdit}
                          placeholder="Action name"
                          className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                        />
                      ), 'min-w-[180px]')}
                      {renderActionField('Cost', (
                        <input
                          type="text"
                          value={action.cost}
                          onChange={(e) => updateStatusAction(status.id, action.id, current => ({ ...current, cost: e.target.value }))}
                          disabled={!canEdit}
                          placeholder="Cost"
                          className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                        />
                      ), 'min-w-[140px]')}
                      {renderActionUsageControls(action, updater => updateStatusAction(status.id, action.id, updater), canEdit)}
                      <button onClick={() => shareStatusAction(status, action)} className="inline-flex items-center gap-1 px-3 py-2 bg-sky-900/30 border border-sky-800/40 rounded text-sm text-sky-200 hover:bg-sky-900/50 cursor-pointer">
                        <Share2 size={14} /> Share
                      </button>
                      {canEdit && (
                        <button onClick={() => removeStatusAction(status.id, action.id)} className="p-2 text-stone-500 hover:text-red-400 cursor-pointer">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    <textarea
                      value={action.description}
                      onChange={(e) => updateStatusAction(status.id, action.id, current => ({ ...current, description: e.target.value }))}
                      disabled={!canEdit}
                      rows={isExpanded ? 2 : 6}
                      placeholder="Action description"
                      className="w-full bg-stone-900 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                    />
                    <button onClick={() => toggleStatusActionDescription(status.id, action.id)} className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer">
                      {isExpanded ? 'Show More' : 'Hide'}
                    </button>
                    <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-bold text-stone-300">Action Macros</label>
                        {canEdit && (
                          <button onClick={() => addStatusActionMacro(status.id, action.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                            + Add Macro
                          </button>
                        )}
                      </div>
                      {(action.macros || []).length === 0 ? (
                        <span className="text-xs text-stone-600 italic">No macros added.</span>
                      ) : (
                        <div className="space-y-2">
                          {(action.macros || []).map((macro) => (
                            <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                              <input value={macro.name} onChange={(e) => updateStatusActionMacro(status.id, action.id, macro.id, current => ({ ...current, name: e.target.value }))} disabled={!canEdit} className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60" />
                              <input value={macro.formula} onChange={(e) => updateStatusActionMacro(status.id, action.id, macro.id, current => ({ ...current, formula: e.target.value }))} disabled={!canEdit} className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60" />
                              <button onClick={() => rollStatusActionMacro(status, action, macro)} className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer">
                                <Dices size={12} /> Roll
                              </button>
                              {canEdit ? (
                                <button onClick={() => removeStatusActionMacro(status.id, action.id, macro.id)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                                  <Trash2 size={14} />
                                </button>
                              ) : (
                                <div />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-sm font-bold text-stone-300">Effects</label>
                        {canEdit && (
                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => addStatusActionEffect(status.id, action.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                              + Add Effect
                            </button>
                            <button
                              onClick={() => importStatusApplyEffect(effect => updateStatusAction(status.id, action.id, current => ({ ...current, effects: [...(current.effects || []), effect] })))}
                              className="text-xs bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300 cursor-pointer"
                            >
                              + Add Status
                            </button>
                            <button
                              onClick={() => updateStatusAction(status.id, action.id, current => ({ ...current, effects: [...(current.effects || []), buildBarUpdateEffect()] }))}
                              className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                            >
                              + Bar Update
                            </button>
                          </div>
                        )}
                      </div>
                      {(action.effects || []).length === 0 ? (
                        <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                      ) : (
                        <div className="space-y-2">
                          {(action.effects || []).map((effect, effectIndex) => renderEffectEditorRow(
                            effect,
                            effectIndex,
                            (index, updater) => updateStatusActionEffect(status.id, action.id, index, updater),
                            (index) => removeStatusActionEffect(status.id, action.id, index),
                            canEdit,
                            'Target ID (e.g. str_mod)',
                            'Value (e.g. @@bonus)',
                            status.localVariables,
                            true
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );

      const renderAttributeOptionsEditor = (
        attr: CustomAttribute | SkillAttribute,
        items: (CustomAttribute | SkillAttribute)[],
        setItems: React.Dispatch<React.SetStateAction<any[]>>,
        actualIndex: number,
      ) => {
        if (openAttributeOptionsId !== attr.id) return null;
        const valueOptions = attr.valueOptions || [];

        return (
          <div className="mt-2 rounded-xl border border-amber-800/20 bg-black/20 p-3 space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.16em] text-amber-500 mb-2">Attribute Type</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'sum', label: 'Normal' },
                  { key: 'override-highest', label: 'Highest Override' },
                  { key: 'override-lowest', label: 'Lowest Override' },
                ].map((mode) => (
                  <button
                    key={mode.key}
                    onClick={() => {
                      const next = [...items];
                      next[actualIndex] = { ...next[actualIndex], calculationType: mode.key as AttributeCalculationType };
                      setItems(next);
                    }}
                    className={`px-2 py-1 rounded border text-[11px] cursor-pointer ${
                      (attr.calculationType || DEFAULT_ATTRIBUTE_CALCULATION_TYPE) === mode.key
                        ? 'bg-amber-900/40 border-amber-500/50 text-amber-100'
                        : 'bg-stone-900/40 border-stone-700/40 text-stone-400 hover:text-amber-200'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-[11px] font-bold uppercase tracking-[0.16em] text-amber-500">Value Labels</label>
                <button
                  onClick={() => {
                    const next = [...items];
                    const nextOptions = [...(next[actualIndex].valueOptions || []), { value: '0', label: '' }];
                    next[actualIndex] = { ...next[actualIndex], valueOptions: nextOptions };
                    setItems(next);
                  }}
                  className="px-2 py-1 bg-amber-900/30 border border-amber-800/40 rounded text-[10px] text-amber-200 hover:bg-amber-900/50 cursor-pointer"
                >
                  + Label
                </button>
              </div>
              <div className="space-y-2">
                {valueOptions.length === 0 ? (
                  <p className="text-xs text-stone-500 italic">No labels yet. Add one to map values like `1 = Light Armor`.</p>
                ) : valueOptions.map((option, optionIndex) => (
                  <div key={`${attr.id}-option-${optionIndex}`} className="grid grid-cols-[90px_minmax(0,1fr)_auto] gap-2 items-center">
                    <input
                      type="number"
                      value={option.value}
                      onChange={(e) => {
                        const next = [...items];
                        const nextOptions = [...(next[actualIndex].valueOptions || [])];
                        nextOptions[optionIndex] = { ...nextOptions[optionIndex], value: e.target.value };
                        next[actualIndex] = { ...next[actualIndex], valueOptions: nextOptions };
                        setItems(next);
                      }}
                      className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={option.label}
                      onChange={(e) => {
                        const next = [...items];
                        const nextOptions = [...(next[actualIndex].valueOptions || [])];
                        nextOptions[optionIndex] = { ...nextOptions[optionIndex], label: e.target.value };
                        next[actualIndex] = { ...next[actualIndex], valueOptions: nextOptions };
                        setItems(next);
                      }}
                      placeholder="Heavy Armor"
                      className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm text-amber-100 focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        const next = [...items];
                        next[actualIndex] = {
                          ...next[actualIndex],
                          valueOptions: (next[actualIndex].valueOptions || []).filter((_: unknown, index: number) => index !== optionIndex),
                        };
                        setItems(next);
                      }}
                      className="text-stone-600 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      };

      const getAttributeSearchValue = (tab: AttributeSheetSubTab) => (
        tab === 'unassigned' ? unassignedAttributeSearch : attributeSearches[tab]
      );

      const setAttributeSearchValue = (tab: AttributeSheetSubTab, value: string) => {
        if (tab === 'unassigned') {
          setUnassignedAttributeSearch(value);
          return;
        }
        setAttributeSearches(prev => ({ ...prev, [tab]: value }));
      };

      const matchesAttributeSearch = (
        item: { id?: string; name?: string },
        tab: AttributeSheetSubTab,
      ) => {
        const query = getAttributeSearchValue(tab).trim().toLowerCase();
        if (!query) return true;
        return (item.id || '').toLowerCase().includes(query)
          || (item.name || '').toLowerCase().includes(query);
      };

      const renderAttributeSearch = (tab: AttributeSheetSubTab, placeholder = 'Search attributes...') => (
        <div className="relative w-full md:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-500/65" />
          <input
            value={getAttributeSearchValue(tab)}
            onChange={(e) => setAttributeSearchValue(tab, e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-lg border border-amber-800/30 bg-stone-950/65 py-1.5 pl-8 pr-3 text-xs text-amber-100 placeholder:text-stone-600 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
      );

      const addUnassignedAttributeToTab = (
        referenceId: string,
        targetTab: 'main' | 'secondary' | 'skills' | 'other' | 'resistances',
      ) => {
        const newAttribute = { id: referenceId, name: referenceId, value: '0' };
        if (targetTab === 'main') setMainAttrs(prev => [...prev, newAttribute]);
        if (targetTab === 'secondary') setSecondaryAttrs(prev => [...prev, newAttribute]);
        if (targetTab === 'skills') setSkills(prev => [...prev, { ...newAttribute, proficiencyMode: 'none', linkedMainAttributeId: '' }]);
        if (targetTab === 'other') setOtherAttrs(prev => [...prev, newAttribute]);
        if (targetTab === 'resistances') setResistances(prev => [...prev, newAttribute]);
        setPendingUnassignedAttributeId(null);
        setActiveAttributeSubTab(targetTab);
      };

    const renderAttributeSection = (
      title: string,
      items: (CustomAttribute | SkillAttribute)[],
      setItems: React.Dispatch<React.SetStateAction<any[]>>,
      idPrefix: string,
      options?: { skillMode?: boolean; sectionKey: keyof CharacterAttributeSectionModes; subTab: AttributeSheetSubTab; resistanceMode?: boolean }
    ) => (
      <div className="mb-8">
        <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
          <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>{title}</h3>
          <div className="flex items-center gap-2">
            {options?.resistanceMode && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-800/25 bg-emerald-950/10 px-2 py-1">
                <label className="text-[11px] text-emerald-300 uppercase tracking-[0.16em]">Base</label>
                <input
                  type="number"
                  value={resistancePreviewBase}
                  onChange={(e) => setResistancePreviewBase(e.target.value)}
                  className="w-24 bg-stone-950/70 border border-emerald-800/30 rounded px-2 py-1 text-xs font-mono text-emerald-100 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            )}
            {options?.subTab && renderAttributeSearch(options.subTab)}
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-stone-400 uppercase tracking-[0.18em]">Cols</label>
              <input
                type="number"
                min={1}
                max={6}
                value={attributeSectionColumns[options?.sectionKey || 'main']}
                onChange={(e) => updateAttributeSectionColumns(options?.sectionKey || 'main', parseInt(e.target.value, 10) || 1)}
                className="w-14 bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 focus:outline-none"
              />
            </div>
            <div className="flex items-center rounded border border-amber-800/30 overflow-hidden">
              {[
                { key: 'all', label: 'Show All' },
                { key: 'favorites', label: 'Show only Favorites' },
                { key: 'hidden', label: 'Hide' },
              ].map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => setAttributeSectionModes(prev => ({ ...prev, [options?.sectionKey || 'main']: mode.key as 'all' | 'favorites' | 'hidden' }))}
                  className={`px-2 py-1 text-[11px] cursor-pointer ${attributeSectionModes[options?.sectionKey || 'main'] === mode.key ? 'bg-amber-900/40 text-amber-200' : 'bg-stone-900/40 text-stone-400 hover:text-amber-200'}`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setItems([
                ...items,
                options?.skillMode
                  ? { id: `${idPrefix}_${Date.now().toString(36)}`, name: 'New Skill', value: '0', proficiencyMode: 'none', linkedMainAttributeId: '' }
                  : {
                    id: `${idPrefix}_${Date.now().toString(36)}`,
                    name: options?.resistanceMode ? 'New Resistance' : 'New Attribute',
                    value: options?.resistanceMode ? '0' : '10',
                  },
              ])}
              className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
            >
              + Add
            </button>
          </div>
        </div>

        {attributeSectionModes[options?.sectionKey || 'main'] !== 'hidden' && (
        <div
          className="grid gap-3 mb-4"
          style={{ gridTemplateColumns: `repeat(${attributeSectionColumns[options?.sectionKey || 'main']}, minmax(0, 1fr))` }}
        >
          {items
            .filter(attr => attributeSectionModes[options?.sectionKey || 'main'] === 'all' || attr.favorite)
            .filter(attr => matchesAttributeSearch(attr, options?.subTab || 'main'))
            .map((attr, idx, filteredItems) => {
            const actualIndex = items.findIndex(item => item.id === attr.id);
            const evalVal = finalContext[attr.id] || 0;
            const displayValue = formatAttributeOutput(attr.id, evalVal);
            const resistanceMode = !!options?.resistanceMode;
            const resistanceValueClass = evalVal >= 0 ? 'text-emerald-300' : 'text-rose-300';
            const resistanceDisplayValue = `${evalVal >= 0 ? '%' : '-%'}${Math.abs(evalVal)}`;
            const resistanceBaseValue = evalCharFormula(resistancePreviewBase || '0', finalContext);
            const resistanceAppliedValue = resistanceBaseValue * (1 - (evalVal / 100));
            const resistanceAppliedDisplayValue = Number.isInteger(resistanceAppliedValue)
              ? resistanceAppliedValue.toString()
              : resistanceAppliedValue.toFixed(2).replace(/\.?0+$/, '');
            const skillMode = options?.skillMode;
            const proficiencyMode = skillMode ? ((attr as SkillAttribute).proficiencyMode || 'none') : 'none';
            const proficiencyStyle = PROFICIENCY_STYLES[proficiencyMode as NonNullable<SkillAttribute['proficiencyMode']>];

            return (
                <div id={`sheet-attr-${idPrefix}-${attr.id}`} key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-3 flex flex-col gap-2 shadow-lg">
                  <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={attr.name}
                    onChange={(e) => {
                      const next = [...items];
                      next[actualIndex].name = e.target.value;
                      setItems(next);
                    }}
                    className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                  />
                  <input
                    type="text"
                    value={attr.id}
                    onChange={(e) => {
                      const next = [...items];
                      next[actualIndex].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                      setItems(next);
                    }}
                    className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-16"
                    placeholder="id"
                  />
                  <button
                    onClick={() => {
                      const nextFavorite = !attr.favorite;
                      const next = [...items];
                      next[actualIndex] = { ...next[actualIndex], favorite: nextFavorite };
                      setItems(next);
                      syncDisplayStatFavorite(attr.id, nextFavorite);
                    }}
                    className={`p-1 rounded border cursor-pointer ${attr.favorite ? 'bg-amber-400/20 border-amber-300/50 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.28)]' : 'border-stone-700 text-stone-500 hover:text-amber-300'}`}
                    title={attr.favorite ? 'Remove from display favorites' : 'Add to display favorites'}
                  >
                    <Star size={14} fill={attr.favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => setOpenAttributeOptionsId(current => current === attr.id ? null : attr.id)}
                    className={`p-1 rounded border cursor-pointer ${openAttributeOptionsId === attr.id ? 'bg-amber-900/40 border-amber-500/50 text-amber-100' : 'border-stone-700 text-stone-500 hover:text-amber-300'}`}
                    title="Override and value label options"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    onClick={() => setItems(moveListItem(items as any[], attr.id, 'up'))}
                    disabled={idx === 0}
                    className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => setItems(moveListItem(items as any[], attr.id, 'down'))}
                    disabled={idx === filteredItems.length - 1}
                    className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    onClick={() => {
                      setItems(items.filter(item => item.id !== attr.id));
                      syncDisplayStatFavorite(attr.id, false);
                    }}
                    className="text-stone-600 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                  </div>
                  {renderAttributeOptionsEditor(attr, items, setItems, actualIndex)}
                  <div className="flex items-center justify-end">
                    {attr.id && renderAttributeHistory(attr.id)}
                  </div>
                  <div className="flex items-center justify-end">
                  {skillMode ? (
                    <select
                      value={(attr as SkillAttribute).linkedMainAttributeId || ''}
                      onChange={(e) => {
                        const next = [...items] as SkillAttribute[];
                        next[actualIndex] = {
                          ...next[actualIndex],
                          linkedMainAttributeId: e.target.value,
                          value: next[actualIndex].value || '0',
                        };
                        setItems(next);
                      }}
                      className="mr-auto min-w-36 bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm text-amber-100 focus:outline-none"
                    >
                      <option value="">No Main Attribute</option>
                      {mainAttrs.map((mainAttr) => (
                        <option key={mainAttr.id} value={mainAttr.id}>
                          {mainAttr.name || mainAttr.id} ({mainAttr.id}_mod)
                        </option>
                      ))}
                    </select>
                  ) : resistanceMode ? (
                    <div className="mr-auto flex flex-col rounded-lg border border-emerald-800/25 bg-black/25 px-3 py-2">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-stone-500">After Resistance</span>
                      <span className={`font-mono text-lg font-bold ${resistanceAppliedValue <= resistanceBaseValue ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {resistanceAppliedDisplayValue}
                      </span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={attr.value}
                      onChange={(e) => {
                        const next = [...items];
                        next[actualIndex].value = e.target.value;
                        setItems(next);
                      }}
                      className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 w-24 focus:outline-none mr-auto"
                    />
                  )}
                  {skillMode && (
                    <button
                      onClick={() => rollAttributeCheck(`${attr.name || 'Skill'} Check`, `1d20 + @${attr.id}`, `${attr.name || 'Skill'} skill check`)}
                      className="mr-2 flex items-center gap-1 px-2.5 py-1.5 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer"
                    >
                      <Dices size={12} /> Roll
                    </button>
                  )}
                  {skillMode && (
                    <button
                      onClick={() => {
                        const next = [...items] as SkillAttribute[];
                        next[actualIndex] = { ...next[actualIndex], proficiencyMode: cycleSkillProficiency(next[actualIndex].proficiencyMode) };
                        setItems(next);
                      }}
                      className={`mr-3 inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-xs font-bold cursor-pointer transition-all ${proficiencyStyle.className}`}
                      title={proficiencyStyle.label}
                    >
                      {proficiencyStyle.icon}
                      <span className="hidden sm:inline">{proficiencyStyle.label}</span>
                    </button>
                  )}
                  <span className={`text-lg font-bold font-mono ${resistanceMode ? resistanceValueClass : 'text-amber-200'}`}>
                    {resistanceMode ? resistanceDisplayValue : displayValue}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    );

    return (
      <div className="w-full bg-stone-900/50 p-6 rounded-2xl border border-amber-800/40 shadow-xl animate-fade-in text-[15px]" style={{ fontFamily: "'IM Fell English', serif" }}>
        {renderBarTargetResolverModal()}
        {renderEffectTargetResolverModal()}
        {renderLocalInputModal()}
        {renderScriptValueTargetResolverModal()}
        {rollPopupResult && (
          <button
            type="button"
            onClick={dismissRollPopup}
            className="fixed bottom-5 right-5 z-[9999] w-[min(360px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-amber-400/55 bg-stone-950/95 text-left shadow-[0_18px_55px_rgba(0,0,0,0.55)] ring-1 ring-amber-200/10 backdrop-blur transition hover:border-amber-300"
          >
            <div className="flex items-center justify-between gap-3 border-b border-amber-800/30 bg-amber-900/25 px-4 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Dices size={17} className="shrink-0 text-amber-300" />
                <span className="truncate text-sm font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
                  {rollPopupResult.macroName || 'Roll Result'}
                </span>
              </div>
              <span className="shrink-0 text-3xl font-black text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                {rollPopupResult.total}
              </span>
            </div>
            <div className="space-y-2 px-4 py-3">
              <code className="block truncate rounded border border-stone-700/60 bg-black/35 px-2 py-1 text-xs text-stone-300">
                {rollPopupResult.formula}
              </code>
              {rollPopupResult.description && (
                <p className="line-clamp-2 text-sm italic text-stone-300">{rollPopupResult.description}</p>
              )}
              <div className="space-y-1">
                {rollPopupResult.steps.slice(0, 3).map((step, index) => (
                  <div key={`${rollPopupResult.timestamp}-${index}`} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-stone-400">{step.label}</span>
                    <span className="font-mono font-bold text-amber-200">{step.value}</span>
                  </div>
                ))}
                {rollPopupResult.steps.length > 3 && (
                  <p className="text-xs text-stone-500">+{rollPopupResult.steps.length - 3} more step</p>
                )}
              </div>
            </div>
          </button>
        )}
        <input
          ref={attributeImportInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportAttributePresetFile}
          className="hidden"
        />
        <input
          ref={homebrewImageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          onChange={handleHomebrewImageSelected}
          className="hidden"
        />
        <input
          ref={galleryUploadInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,image/avif"
          onChange={handleGalleryImageSelected}
          className="hidden"
        />
        {fullscreenGalleryImage && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-4"
            onClick={() => setFullscreenGalleryImage(null)}
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                setFullscreenGalleryImage(null);
              }}
              className="absolute right-5 top-5 rounded-xl border border-stone-700/70 bg-stone-950/80 p-2 text-stone-200 shadow-xl hover:border-cyan-400/60 hover:text-cyan-100"
            >
              <X size={18} />
            </button>
            <div className="flex max-h-[92vh] max-w-[94vw] flex-col items-center gap-3">
              <img
                src={getGalleryImageUrl(fullscreenGalleryImage)}
                alt={fullscreenGalleryImage.label || editName || 'Gallery image'}
                className="max-h-[86vh] max-w-[94vw] rounded-2xl border border-cyan-700/35 object-contain shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
                onError={(event) => {
                  const fallbackUrl = fullscreenGalleryImage.thumbUrl || fullscreenGalleryImage.url;
                  if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                    event.currentTarget.src = fallbackUrl;
                  }
                }}
                onClick={(event) => event.stopPropagation()}
              />
              {fullscreenGalleryImage.label && (
                <p className="rounded-full border border-cyan-700/35 bg-stone-950/80 px-4 py-2 text-sm font-bold text-cyan-100">
                  {fullscreenGalleryImage.label}
                </p>
              )}
            </div>
          </div>
        )}
        {partyTransferTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-sky-800/45 bg-stone-950 p-5 shadow-2xl">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>Send to Party</h3>
                  <p className="mt-1 text-sm text-stone-400">
                    Copy "{partyTransferTarget.entry.name || 'Entry'}" to one of this character's parties.
                  </p>
                </div>
                <button
                  onClick={() => setPartyTransferTarget(null)}
                  className="rounded-lg border border-stone-700/60 p-2 text-stone-400 hover:text-sky-100"
                >
                  <X size={16} />
                </button>
              </div>
              {isLoadingPartyTransferOptions ? (
                <p className="rounded-xl border border-sky-900/40 bg-black/25 p-4 text-sky-100/70">Loading parties...</p>
              ) : partyTransferOptions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sky-900/40 bg-black/25 p-4 text-sky-100/50">
                  This character is not in any party yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {partyTransferOptions.map(({ campaignName, party }) => (
                    <button
                      key={party.id}
                      onClick={() => sendEntryToParty(party)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-sky-900/40 bg-black/30 p-3 text-left hover:border-cyan-500/50 hover:bg-cyan-950/20"
                    >
                      <span>
                        <span className="block font-bold text-sky-100">{party.name}</span>
                        <span className="text-xs text-sky-100/45">{campaignName} • {party.visibility}</span>
                      </span>
                      <span className="text-sm text-cyan-200">Send</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="sticky top-3 z-30 mb-6 border border-amber-700/40 bg-stone-950/88 backdrop-blur-md rounded-2xl px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.32)]">
          <div className="flex flex-wrap justify-between items-center gap-3">
          {embeddedMode ? (
            <span className="text-amber-500 font-bold tracking-wider" style={{ fontFamily: "'Cinzel', serif" }}>
              {selectedCharacter.name}
            </span>
          ) : (
            <button onClick={() => setIsViewingSheet(false)} className="flex items-center gap-2 text-amber-500 hover:text-amber-300 font-bold tracking-wider cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>
              <ArrowLeft size={20} /> Back to List
            </button>
          )}
          <div className="flex gap-3">
            {sheetSyncStatus && (
              <div
                className={`flex items-center px-3 py-2 text-xs rounded border ${
                  sheetSyncStatus.tone === 'error'
                    ? 'border-rose-800/40 bg-rose-950/20 text-rose-200'
                    : 'border-emerald-800/40 bg-emerald-950/20 text-emerald-200'
                }`}
              >
                {isSheetSyncing ? 'Syncing spreadsheet...' : sheetSyncStatus.message}
              </div>
            )}
            {/* Visibility dropdown — only owner can change */}
            {isCharacterOwner ? (
              <>
                <select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as 'private' | 'public')}
                  className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm text-amber-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                >
                  <option value="private">🔒 Private</option>
                  <option value="public">🌐 Public</option>
                </select>
                <select
                  value={sendToSpreadsheet ? 'send' : 'skip'}
                  onChange={(e) => setSendToSpreadsheet(e.target.value === 'send')}
                  className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm text-amber-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                >
                  <option value="send">Send to Spreadsheet</option>
                  <option value="skip">Do Not Send to Spreadsheet</option>
                </select>
              </>
            ) : (
              <span className="flex items-center gap-1 px-3 py-2 text-sm text-stone-400 border border-stone-700/30 rounded">
                {selectedCharacter.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
              </span>
            )}
            <button
              onClick={handleReloadFromFirestore}
              disabled={!selectedCharacter || !userId || userId === 'guest' || isSheetSyncing}
              className="flex items-center gap-2 px-4 py-2 bg-stone-900/40 border border-stone-700/40 rounded hover:bg-stone-900/60 hover:border-amber-500/60 text-stone-200 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={16} /> Load
            </button>
            <button onClick={handleSaveAll} disabled={(!canEditInventory && !isCharacterOwner) || isSheetSyncing} className="flex items-center gap-2 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <Save size={16} /> Save
            </button>
          </div>
          </div>
        </div>

        <div className="sticky top-[5.75rem] z-20 mb-4 rounded-2xl border border-amber-800/30 bg-stone-950/86 px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)] backdrop-blur-md overflow-visible">
          <div className="flex flex-wrap items-center justify-between gap-3 overflow-visible">
            <div className="flex min-w-0 gap-2 overflow-x-auto overflow-y-visible py-0.5">
              {[
                { key: 'bio', label: 'Bio', hint: 'Story and profile' },
                { key: 'attributes', label: 'Attributes', hint: 'Stats and bars' },
                { key: 'macros', label: 'Macros', hint: 'Quick rolls and dice macros' },
                { key: 'scripts', label: 'Scripts', hint: 'Automatic status logic' },
                { key: 'inventory', label: 'Inventory', hint: 'Gear and general items' },
                { key: 'spells', label: 'Spells', hint: 'Magic and abilities' },
                { key: 'statuses', label: 'Statuses', hint: 'Effects and conditions' },
              ].map((tab) => {
                const isActive = activeSheetTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveSheetTab(tab.key as CharacterSheetTab)}
                    title={tab.hint}
                    className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none tracking-wide transition-all cursor-pointer ${
                      isActive
                        ? 'border-amber-400/60 bg-amber-900/42 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.16)]'
                        : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-amber-700/45 hover:text-amber-200'
                    }`}
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                onClick={handleShortRest}
                disabled={!isCharacterOwner}
                className="rounded-xl border border-emerald-700/45 bg-emerald-950/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-emerald-200 transition hover:bg-emerald-900/45 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                Short Rest
              </button>
              <button
                onClick={handleLongRest}
                disabled={!isCharacterOwner}
                className="rounded-xl border border-sky-700/45 bg-sky-950/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-sky-200 transition hover:bg-sky-900/45 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                Long Rest
              </button>
              <button
                onClick={handleEndTurn}
                disabled={!isCharacterOwner}
                className="rounded-xl border border-amber-700/45 bg-amber-950/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-900/45 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                End Turn
              </button>
              <button
                onClick={handleEndBattle}
                disabled={!isCharacterOwner}
                className="rounded-xl border border-red-700/45 bg-red-950/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-200 transition hover:bg-red-900/45 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                End Battle
              </button>
              <button
                onClick={handleSkipMinute}
                disabled={!isCharacterOwner}
                className="rounded-xl border border-violet-700/45 bg-violet-950/35 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-violet-200 transition hover:bg-violet-900/45 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                Skip Minute
              </button>
            </div>
          </div>
        </div>

        {activeSheetTab === 'bio' && (
          <div className="sticky top-[9.6rem] z-20 mb-4 rounded-2xl border border-amber-800/30 bg-stone-950/86 px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)] backdrop-blur-md overflow-visible">
            <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
              {[
                { key: 'main', label: 'Main' },
                { key: 'overview', label: 'Character Overview' },
                { key: 'gallery', label: 'Gallery' },
              ].map((tab) => {
                const isActive = activeBioSubTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveBioSubTab(tab.key as BioSheetSubTab)}
                    className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-all cursor-pointer ${
                      isActive
                        ? 'border-amber-400/60 bg-amber-900/42 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.16)]'
                        : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-amber-700/45 hover:text-amber-200'
                    }`}
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeSheetTab === 'attributes' && (
          <div className="sticky top-[9.6rem] z-20 mb-4 rounded-2xl border border-amber-800/30 bg-stone-950/86 px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.24)] backdrop-blur-md overflow-visible">
            <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
              {[
                { key: 'bars', label: 'Bars' },
                { key: 'main', label: 'Main' },
                { key: 'secondary', label: 'Secondary' },
                { key: 'skills', label: 'Skills' },
                { key: 'other', label: 'Other' },
                { key: 'resistances', label: 'Resistances' },
                { key: 'unassigned', label: `Unassigned${unassignedAttributeEntries.length ? ` (${unassignedAttributeEntries.length})` : ''}` },
              ].map((tab) => {
                const isActive = activeAttributeSubTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveAttributeSubTab(tab.key as AttributeSheetSubTab)}
                    className={`shrink-0 rounded-xl border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-all cursor-pointer ${
                      isActive
                        ? 'border-amber-400/60 bg-amber-900/42 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.16)]'
                        : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-amber-700/45 hover:text-amber-200'
                    }`}
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeSheetTab === 'inventory' && (
        <div className="sticky top-[9.35rem] z-20 mb-6 rounded-2xl border border-sky-800/30 bg-stone-950/88 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible">
          <div className="flex items-center justify-between gap-3 overflow-visible">
          <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
            <button
              onClick={() => setActiveInventoryCategoryId(null)}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                !activeInventoryCategoryId
                  ? 'border-sky-300/60 bg-sky-900/45 text-sky-100 shadow-[0_0_16px_rgba(56,189,248,0.16)]'
                  : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-sky-700/45 hover:text-sky-200'
              }`}
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Main
            </button>
            {inventoryRootCategories.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setActiveInventoryCategoryId(folder.id)}
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                  activeInventoryCategoryId === folder.id
                    ? 'text-sky-50 shadow-[0_0_16px_rgba(56,189,248,0.16)]'
                    : 'bg-stone-900/55 text-stone-300 hover:text-sky-100'
                }`}
                style={{
                  fontFamily: "'Cinzel', serif",
                  borderColor: activeInventoryCategoryId === folder.id ? `${folder.color || '#0284c7'}cc` : `${folder.color || '#334155'}66`,
                  background: activeInventoryCategoryId === folder.id
                    ? `linear-gradient(135deg, ${folder.color || '#0284c7'}66, rgba(12, 10, 9, 0.72))`
                    : `linear-gradient(135deg, ${folder.color || '#334155'}22, rgba(12, 10, 9, 0.52))`,
                }}
              >
                {folder.name || 'Untitled Category'}
              </button>
            ))}
          </div>
          {canEditInventory && (
            <button
              onClick={() => importSharedEntry('item')}
              className="shrink-0 rounded-xl border border-sky-700/50 bg-sky-900/35 px-4 py-2 text-sm font-bold leading-none text-sky-100 hover:bg-sky-900/55 cursor-pointer"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Import
            </button>
          )}
          </div>
        </div>
        )}

        {activeSheetTab === 'spells' && (
        <div className="sticky top-[9.35rem] z-20 mb-6 rounded-2xl border border-violet-800/30 bg-stone-950/88 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible">
          <div className="flex items-center justify-between gap-3 overflow-visible">
          <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
            <button
              onClick={() => setActiveSpellCategoryId(null)}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                !activeSpellCategoryId
                  ? 'border-violet-300/60 bg-violet-900/45 text-violet-100 shadow-[0_0_16px_rgba(167,139,250,0.16)]'
                  : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-violet-700/45 hover:text-violet-200'
              }`}
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Main
            </button>
            {spellRootCategories.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setActiveSpellCategoryId(folder.id)}
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                  activeSpellCategoryId === folder.id
                    ? 'text-violet-50 shadow-[0_0_16px_rgba(167,139,250,0.16)]'
                    : 'bg-stone-900/55 text-stone-300 hover:text-violet-100'
                }`}
                style={{
                  fontFamily: "'Cinzel', serif",
                  borderColor: activeSpellCategoryId === folder.id ? `${folder.color || '#7c3aed'}cc` : `${folder.color || '#334155'}66`,
                  background: activeSpellCategoryId === folder.id
                    ? `linear-gradient(135deg, ${folder.color || '#7c3aed'}66, rgba(12, 10, 9, 0.72))`
                    : `linear-gradient(135deg, ${folder.color || '#334155'}22, rgba(12, 10, 9, 0.52))`,
                }}
              >
                {folder.name || 'Untitled Category'}
              </button>
            ))}
          </div>
          {isCharacterOwner && (
            <button
              onClick={() => importSharedEntry('spell')}
              className="shrink-0 rounded-xl border border-violet-700/50 bg-violet-900/35 px-4 py-2 text-sm font-bold leading-none text-violet-100 hover:bg-violet-900/55 cursor-pointer"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Import
            </button>
          )}
          </div>
        </div>
        )}

        {activeSheetTab === 'statuses' && (
        <div className="sticky top-[9.35rem] z-20 mb-6 rounded-2xl border border-orange-800/30 bg-stone-950/88 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible">
          <div className="flex items-center justify-between gap-3 overflow-visible">
          <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
            <button
              onClick={() => setActiveStatusCategoryId(null)}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                !activeStatusCategoryId
                  ? 'border-orange-300/60 bg-orange-900/45 text-orange-100 shadow-[0_0_16px_rgba(251,146,60,0.16)]'
                  : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-orange-700/45 hover:text-orange-200'
              }`}
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Main
            </button>
            {statusRootCategories.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setActiveStatusCategoryId(folder.id)}
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                  activeStatusCategoryId === folder.id
                    ? 'text-orange-50 shadow-[0_0_16px_rgba(251,146,60,0.16)]'
                    : 'bg-stone-900/55 text-stone-300 hover:text-orange-100'
                }`}
                style={{
                  fontFamily: "'Cinzel', serif",
                  borderColor: activeStatusCategoryId === folder.id ? `${folder.color || '#f59e0b'}cc` : `${folder.color || '#334155'}66`,
                  background: activeStatusCategoryId === folder.id
                    ? `linear-gradient(135deg, ${folder.color || '#f59e0b'}66, rgba(12, 10, 9, 0.72))`
                    : `linear-gradient(135deg, ${folder.color || '#334155'}22, rgba(12, 10, 9, 0.52))`,
                }}
              >
                {folder.name || 'Untitled Category'}
              </button>
            ))}
          </div>
          {isCharacterOwner && (
            <button
              onClick={() => importSharedEntry('status')}
              className="shrink-0 rounded-xl border border-orange-700/50 bg-orange-900/35 px-4 py-2 text-sm font-bold leading-none text-orange-100 hover:bg-orange-900/55 cursor-pointer"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Import
            </button>
          )}
          </div>
        </div>
        )}

        {activeSheetTab === 'macros' && (
        <div className="sticky top-[9.35rem] z-20 mb-6 rounded-2xl border border-amber-800/30 bg-stone-950/88 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible">
          <div className="flex items-center justify-between gap-3 overflow-visible">
          <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
            <button
              onClick={() => setActiveMacroCategoryId('main')}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                activeMacroCategoryId === 'main'
                  ? 'border-amber-300/60 bg-amber-900/45 text-amber-100 shadow-[0_0_16px_rgba(251,191,36,0.16)]'
                  : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-amber-700/45 hover:text-amber-200'
              }`}
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Main
            </button>
            <button
              onClick={() => setActiveMacroCategoryId('rolls')}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                activeMacroCategoryId === 'rolls'
                  ? 'border-purple-300/60 bg-purple-900/45 text-purple-100 shadow-[0_0_16px_rgba(168,85,247,0.16)]'
                  : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-purple-700/45 hover:text-purple-200'
              }`}
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Rolls
            </button>
            {diceMacroRootCategories.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setActiveMacroCategoryId(folder.id)}
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                  activeMacroCategoryId === folder.id
                    ? 'text-amber-50 shadow-[0_0_16px_rgba(251,191,36,0.16)]'
                    : 'bg-stone-900/55 text-stone-300 hover:text-amber-100'
                }`}
                style={{
                  fontFamily: "'Cinzel', serif",
                  borderColor: activeMacroCategoryId === folder.id ? `${folder.color || '#b45309'}cc` : `${folder.color || '#334155'}66`,
                  background: activeMacroCategoryId === folder.id
                    ? `linear-gradient(135deg, ${folder.color || '#b45309'}66, rgba(12, 10, 9, 0.72))`
                    : `linear-gradient(135deg, ${folder.color || '#334155'}22, rgba(12, 10, 9, 0.52))`,
                }}
              >
                {folder.name || 'Untitled Folder'}
              </button>
            ))}
          </div>
          {isCharacterOwner && (
            <button
              onClick={() => importSharedEntry('macro')}
              className="shrink-0 rounded-xl border border-amber-700/50 bg-amber-900/35 px-4 py-2 text-sm font-bold leading-none text-amber-100 hover:bg-amber-900/55 cursor-pointer"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Import
            </button>
          )}
          </div>
        </div>
        )}

        {activeSheetTab === 'scripts' && (
        <div className="sticky top-[9.35rem] z-20 mb-6 rounded-2xl border border-cyan-800/30 bg-stone-950/88 px-3 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.22)] backdrop-blur-md overflow-visible">
          <div className="flex items-center justify-between gap-3 overflow-visible">
          <div className="flex gap-2 overflow-x-auto overflow-y-visible py-0.5">
            <button
              onClick={() => setActiveScriptCategoryId('main')}
              className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                activeScriptCategoryId === 'main'
                  ? 'border-cyan-300/60 bg-cyan-900/45 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.16)]'
                  : 'border-stone-700/60 bg-stone-900/55 text-stone-400 hover:border-cyan-700/45 hover:text-cyan-200'
              }`}
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              Main
            </button>
            {scriptRootCategories.map((folder) => (
              <button
                key={folder.id}
                onClick={() => setActiveScriptCategoryId(folder.id)}
                className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none transition-all cursor-pointer ${
                  activeScriptCategoryId === folder.id
                    ? 'text-cyan-50 shadow-[0_0_16px_rgba(34,211,238,0.16)]'
                    : 'bg-stone-900/55 text-stone-300 hover:text-cyan-100'
                }`}
                style={{
                  fontFamily: "'Cinzel', serif",
                  borderColor: activeScriptCategoryId === folder.id ? `${folder.color || '#0891b2'}cc` : `${folder.color || '#334155'}66`,
                  background: activeScriptCategoryId === folder.id
                    ? `linear-gradient(135deg, ${folder.color || '#0891b2'}66, rgba(12, 10, 9, 0.72))`
                    : `linear-gradient(135deg, ${folder.color || '#334155'}22, rgba(12, 10, 9, 0.52))`,
                }}
              >
                {folder.name || 'Untitled Folder'}
              </button>
            ))}
          </div>
          {isCharacterOwner && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => importSharedEntry('script')}
                className="rounded-xl border border-cyan-700/50 bg-cyan-900/35 px-4 py-2 text-sm font-bold leading-none text-cyan-100 hover:bg-cyan-900/55 cursor-pointer"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                Import
              </button>
              <button
                onClick={() => addScript(activeScriptCategoryId === 'main' ? null : activeScriptCategoryId)}
                className="rounded-xl border border-cyan-700/50 bg-cyan-900/35 px-4 py-2 text-sm font-bold leading-none text-cyan-100 hover:bg-cyan-900/55 cursor-pointer"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                + Add Script
              </button>
            </div>
          )}
          </div>
        </div>
        )}

        <div className="space-y-8">
          {activeSheetTab === 'bio' && activeBioSubTab === 'main' && (
          <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] pointer-events-none"></div>
            <div className="relative z-10">
              <div
                onClick={() => isCharacterOwner && setShowPortraitPicker(prev => !prev)}
                className={`w-28 h-28 rounded-2xl border-2 border-amber-500/50 bg-amber-950/40 mx-auto flex items-center justify-center text-5xl mb-4 shadow-xl overflow-hidden ${isCharacterOwner ? 'cursor-pointer hover:border-amber-300/80' : ''}`}
                title={isCharacterOwner ? 'Click to choose portrait' : undefined}
              >
                {portraitUrl && !portraitLoadError ? (
                  <img
                    src={portraitUrl}
                    alt={editName}
                    className="w-full h-full object-cover"
                    onError={(event) => {
                      const mainGalleryImage = galleryImages.find(image => (image.tags || []).includes('main'));
                      const fallbackUrl = mainGalleryImage?.thumbUrl || '';
                      if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                        event.currentTarget.src = fallbackUrl;
                        return;
                      }
                      setPortraitLoadError(true);
                    }}
                  />
                ) : (
                  editClass.toLowerCase().includes('arcanist') || editClass.toLowerCase().includes('mage') ? '🔮' : '⚔️'
                )}
              </div>
              <h2 className="text-3xl font-bold text-amber-200 mb-1 text-center" style={{ fontFamily: "'Cinzel', serif" }}>{editName}</h2>
              <p className="text-amber-500/70 text-lg mb-4 italic text-center">{editRace} • {editClass}</p>
              <div className="mb-5 flex justify-center">
                <button
                  onClick={openHomebrewCharacterSheet}
                  className="inline-flex items-center gap-2 rounded-lg border border-cyan-700/45 bg-cyan-950/30 px-4 py-2 text-sm font-bold text-cyan-100 hover:border-cyan-400/60 hover:bg-cyan-900/45 cursor-pointer"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  <Share2 size={15} /> Share Web
                </button>
              </div>

              {showPortraitPicker && isCharacterOwner && (
                <div className="mb-6 border border-amber-800/20 bg-stone-950/60 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-amber-200">Choose Portrait</p>
                      <p className="text-[11px] text-stone-500">Put images in `public/resources/character-portraits/` and they will appear here automatically.</p>
                    </div>
                    <button
                      onClick={() => setShowPortraitPicker(false)}
                      className="text-stone-500 hover:text-amber-300 cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mb-4 rounded-xl border border-amber-800/20 bg-black/20 p-3">
                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Import Portrait via URL</label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="url"
                        value={portraitImportUrl}
                        onChange={(e) => setPortraitImportUrl(e.target.value)}
                        placeholder="https://example.com/portrait.png"
                        className="flex-1 bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40 font-mono"
                      />
                      <button
                        onClick={() => {
                          setPortraitUrl(portraitImportUrl.trim());
                          setPortraitLoadError(false);
                        }}
                        className="px-3 py-2 bg-sky-900/40 border border-sky-800/40 rounded text-xs text-sky-200 hover:bg-sky-900/60 cursor-pointer"
                      >
                        Use URL
                      </button>
                      <button
                        onClick={() => {
                          setPortraitImportUrl('');
                          setPortraitUrl('');
                          setPortraitLoadError(false);
                        }}
                        className="px-3 py-2 bg-stone-900/40 border border-stone-700/40 rounded text-xs text-stone-300 hover:bg-stone-900/60 cursor-pointer"
                      >
                        Default
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-stone-500">If the URL fails to load, the portrait falls back to the default class icon.</p>
                  </div>
                  {CHARACTER_PORTRAIT_OPTIONS.length === 0 ? (
                    <div className="text-xs text-stone-500 italic">No portraits found yet.</div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                      {CHARACTER_PORTRAIT_OPTIONS.map((portrait) => (
                        <button
                          key={portrait.url}
                          onClick={() => {
                            setPortraitUrl(portrait.url);
                            setPortraitImportUrl(portrait.url);
                            setPortraitLoadError(false);
                            setShowPortraitPicker(false);
                          }}
                          className={`group border rounded-xl p-2 bg-black/30 hover:border-amber-400/70 transition-all cursor-pointer ${portraitUrl === portrait.url ? 'border-amber-300/70' : 'border-stone-700/50'}`}
                        >
                          <div className="w-full aspect-square rounded-lg overflow-hidden mb-2 bg-stone-900/80">
                            <img src={portrait.url} alt={portrait.name} className="w-full h-full object-cover" />
                          </div>
                          <p className="text-[10px] text-stone-300 truncate">{portrait.name}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="bg-amber-950/30 border border-amber-800/20 p-4 rounded-xl mb-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-500">Display Attributes</p>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <label className="text-[11px] text-stone-400 uppercase tracking-[0.18em]">Cols</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={attributeSectionColumns.display}
                      onChange={(e) => updateAttributeSectionColumns('display', parseInt(e.target.value, 10) || 1)}
                      className="w-14 bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 focus:outline-none"
                    />
                    <button
                      onClick={() => setDisplayLayoutMode(prev => !prev)}
                      className={`p-1.5 rounded border cursor-pointer ${displayLayoutMode ? 'bg-amber-900/40 border-amber-600/50 text-amber-200' : 'bg-stone-900/50 border-stone-700/40 text-stone-300 hover:text-amber-200'}`}
                      title="Display layout settings"
                    >
                      <Settings size={14} />
                    </button>
                  </div>
                </div>
                {favoriteDisplayEntries.length === 0 ? (
                  <div className="text-xs text-stone-500 italic">No favorite attributes or bars yet.</div>
                ) : (
                  (() => {
                    const cols = Math.max(1, attributeSectionColumns.display);
                    const slotMap = new Map(
                      favoriteDisplayEntries.map(entry => [getDisplaySlotKey(entry.row, entry.column), entry])
                    );
                    const stateIndexes = Object.keys(displaySlotStates).map((key) => {
                      const [row, column] = key.split(':').map(Number);
                      return row * cols + column;
                    });
                    const maxEntryIndex = favoriteDisplayEntries.reduce((highest, entry) => Math.max(highest, entry.row * cols + entry.column), -1);
                    const maxStateIndex = stateIndexes.length > 0 ? Math.max(...stateIndexes) : -1;
                    const baseRows = Math.max(
                      1,
                      Math.floor(Math.max(maxEntryIndex, maxStateIndex, cols - 1) / cols) + 1,
                    );
                    const totalRows = displayLayoutMode ? baseRows + 1 : baseRows;
                    const slots = Array.from({ length: totalRows * cols });

                    const getSlotStateClasses = (slotState: 'unlocked' | 'locked' | 'blocked') => {
                      if (slotState === 'blocked') return 'border-red-800/50 bg-red-950/10';
                      if (slotState === 'locked') return 'border-sky-800/50 bg-sky-950/10';
                      return 'border-stone-700/40 bg-black/10';
                    };

                    const getSlotStateLabel = (slotState: 'unlocked' | 'locked' | 'blocked') => {
                      if (slotState === 'blocked') return 'Blocked';
                      if (slotState === 'locked') return 'Locked';
                      return 'Unlocked';
                    };

                    return (
                      <div
                        className="grid gap-3"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                      >
                        {slots.map((_, gridIndex) => {
                          const row = Math.floor(gridIndex / cols);
                          const column = gridIndex % cols;
                          const slotKey = getDisplaySlotKey(row, column);
                          const slotState = displaySlotStates[slotKey] || 'unlocked';
                          const stat = slotMap.get(slotKey) || null;
                          const canDrop = displayLayoutMode && slotState === 'unlocked';
                          const canDrag = Boolean(stat && displayLayoutMode && slotState === 'unlocked' && !String(stat?.slotId).startsWith('display_auto_'));

                          const slotControls = displayLayoutMode ? (
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-[10px] text-stone-500">R{row + 1} C{column + 1}</span>
                              <button
                                onClick={() => cycleDisplaySlotState(row, column)}
                                className={`px-1.5 py-0.5 rounded text-[10px] border cursor-pointer ${
                                  slotState === 'blocked'
                                    ? 'bg-red-950/30 border-red-700/40 text-red-200'
                                    : slotState === 'locked'
                                      ? 'bg-sky-950/30 border-sky-700/40 text-sky-200'
                                      : 'bg-stone-900/40 border-stone-700/40 text-stone-300'
                                }`}
                                title={`Slot state: ${getSlotStateLabel(slotState)}`}
                              >
                                {slotState === 'unlocked' ? 'U' : slotState === 'locked' ? 'L' : 'X'}
                              </button>
                            </div>
                          ) : null;

                          if (!stat) {
                            if (!displayLayoutMode) {
                              return <div key={`display-empty-${gridIndex}`} aria-hidden="true" />;
                            }

                            return (
                              <div
                                key={`display-empty-${gridIndex}`}
                                onDragOver={(event) => {
                                  if (!canDrop) return;
                                  event.preventDefault();
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  if (!canDrop || !draggingDisplayStatId) return;
                                  moveDisplayStatToSlot(draggingDisplayStatId, row, column);
                                  setDraggingDisplayStatId(null);
                                }}
                                className={`min-h-[10rem] rounded-xl border border-dashed p-2 ${getSlotStateClasses(slotState)}`}
                              >
                                {slotControls}
                                <div className="flex h-[calc(100%-1.5rem)] items-center justify-center rounded-lg border border-dashed border-stone-800/40 text-[11px] uppercase tracking-[0.18em] text-stone-600">
                                  {slotState === 'blocked' ? 'Blocked Slot' : slotState === 'locked' ? 'Locked Empty Slot' : 'Drop Attribute Here'}
                                </div>
                              </div>
                            );
                          }

                          const backgroundColor = stat.colors?.background;
                          const labelColor = stat.colors?.label;
                          const valueColor = stat.colors?.value;

                          return (
                            <div
                              key={stat.slotId}
                              onDragOver={(event) => {
                                if (!canDrop) return;
                                event.preventDefault();
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (!canDrop || !draggingDisplayStatId) return;
                                moveDisplayStatToSlot(draggingDisplayStatId, row, column);
                                setDraggingDisplayStatId(null);
                              }}
                              className={displayLayoutMode ? `min-h-[10rem] rounded-xl border border-dashed p-2 ${getSlotStateClasses(slotState)}` : ''}
                            >
                              {slotControls}
                              <div
                                draggable={canDrag}
                                onDragStart={() => canDrag && setDraggingDisplayStatId(stat.slotId)}
                                onDragEnd={() => setDraggingDisplayStatId(null)}
                                className={`rounded-xl border border-amber-700/20 bg-gradient-to-br from-amber-950/30 to-black/20 p-3 shadow-lg ${canDrag ? 'cursor-move' : ''} ${displayLayoutMode && slotState === 'locked' ? 'opacity-80' : ''}`}
                                style={backgroundColor ? { background: backgroundColor, borderColor: backgroundColor } : undefined}
                              >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <button
                                    onClick={() => jumpToSheetReference(stat.referenceId)}
                                    className="text-[11px] uppercase tracking-[0.2em] truncate text-left hover:underline cursor-pointer"
                                    style={{ color: labelColor || undefined }}
                                    title="Jump to attribute"
                                  >
                                    {stat.name}
                                  </button>
                                  <div className="relative">
                                    <button
                                      onClick={() => setOpenDisplayColorStatId(current => current === stat.slotId ? null : stat.slotId)}
                                      className="p-1 text-stone-500 hover:text-amber-300 cursor-pointer"
                                      title="Colors"
                                    >
                                      <Settings size={13} />
                                    </button>
                                    {openDisplayColorStatId === stat.slotId && (
                                      <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-lg border border-amber-800/20 bg-stone-950/95 p-2 shadow-xl">
                                        <div className="grid grid-cols-3 gap-2 mb-2">
                                          <label className="text-[10px] text-stone-400">
                                            Bg
                                            <input type="color" value={stat.colors?.background || '#1c1917'} onChange={(e) => updateDisplayStatColors(stat.slotId, 'background', e.target.value)} className="block w-full h-8 mt-1 bg-transparent cursor-pointer" />
                                          </label>
                                          <label className="text-[10px] text-stone-400">
                                            Label
                                            <input type="color" value={stat.colors?.label || '#f59e0b'} onChange={(e) => updateDisplayStatColors(stat.slotId, 'label', e.target.value)} className="block w-full h-8 mt-1 bg-transparent cursor-pointer" />
                                          </label>
                                          <label className="text-[10px] text-stone-400">
                                            Value
                                            <input type="color" value={stat.colors?.value || '#fde68a'} onChange={(e) => updateDisplayStatColors(stat.slotId, 'value', e.target.value)} className="block w-full h-8 mt-1 bg-transparent cursor-pointer" />
                                          </label>
                                        </div>
                                        <button
                                          onClick={() => {
                                            setDisplayStats(prev => prev.map(entry => entry.id === stat.slotId ? { ...entry, colors: {} } : entry));
                                            setOpenDisplayColorStatId(null);
                                          }}
                                          className="w-full px-2 py-1 bg-stone-900/50 border border-stone-700/40 rounded text-[10px] text-stone-200 hover:bg-stone-900/70 cursor-pointer"
                                        >
                                          Reset Colors
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <p className="text-3xl font-bold font-mono break-all leading-none" style={{ color: valueColor || undefined }}>
                                  {stat.value}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Ages</label>
                  <div className="rounded-xl border border-amber-800/20 bg-black/20 p-2">
                    <div className="grid grid-cols-4 gap-2 min-h-[118px]">
                      <div className="flex flex-col">
                        <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-400 mb-2">Age</label>
                        <input
                          type="text"
                          value={editAge}
                          onChange={(e) => setEditAge(e.target.value)}
                          placeholder="27"
                          className="flex-1 min-h-[78px] bg-stone-900 border border-stone-800 rounded-lg px-3 py-3 text-xl text-amber-100 focus:outline-none focus:border-amber-500/40"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-400 mb-2">Body</label>
                        <input
                          type="text"
                          value={editBodyAge}
                          onChange={(e) => setEditBodyAge(e.target.value)}
                          placeholder="27"
                          className="flex-1 min-h-[78px] bg-stone-900 border border-stone-800 rounded-lg px-3 py-3 text-xl text-amber-100 focus:outline-none focus:border-amber-500/40"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-400 mb-2">Mental</label>
                        <input
                          type="text"
                          value={editMentalAge}
                          onChange={(e) => setEditMentalAge(e.target.value)}
                          placeholder="27"
                          className="flex-1 min-h-[78px] bg-stone-900 border border-stone-800 rounded-lg px-3 py-3 text-xl text-amber-100 focus:outline-none focus:border-amber-500/40"
                        />
                      </div>
                      <div className="flex flex-col">
                        <label className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-400 mb-2">Spiritual</label>
                        <input
                          type="text"
                          value={editSpiritualAge}
                          onChange={(e) => setEditSpiritualAge(e.target.value)}
                          placeholder="27"
                          className="flex-1 min-h-[78px] bg-stone-900 border border-stone-800 rounded-lg px-3 py-3 text-xl text-amber-100 focus:outline-none focus:border-amber-500/40"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Alignment</label>
                  <div className="rounded-xl border border-amber-800/20 bg-black/20 p-2">
                    <div className="grid grid-cols-3 gap-2">
                      {ALIGNMENT_OPTIONS.map((alignment) => (
                        <button
                          key={alignment}
                          onClick={() => setEditAlignment(alignment)}
                          className={`px-2 py-2 rounded text-xs font-bold transition-all cursor-pointer border ${editAlignment === alignment ? 'bg-amber-900/40 border-amber-400/50 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.2)]' : 'bg-stone-900/50 border-stone-800 text-stone-400 hover:text-amber-200 hover:border-amber-700/40'}`}
                        >
                          {alignment}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-base font-bold uppercase tracking-wider text-amber-400 mb-2">Backstory</label>
                  <textarea
                    ref={backstoryRef}
                    value={backstory}
                    onChange={(e) => setBackstory(e.target.value)}
                    rows={expandedBackstory ? 8 : 4}
                    className="w-full bg-stone-900 border border-stone-800 rounded-lg p-4 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 font-serif resize-none"
                    placeholder="The legend begins here..."
                  />
                  <button onClick={() => setExpandedBackstory(prev => !prev)} className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer">
                    {expandedBackstory ? 'Hide' : 'Show More'}
                  </button>
                </div>
                <div>
                  <label className="block text-base font-bold uppercase tracking-wider text-amber-400 mb-2">Notes</label>
                  <textarea
                    ref={notesRef}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={expandedNotes ? 8 : 4}
                    className="w-full bg-stone-900 border border-stone-800 rounded-lg p-4 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 font-serif resize-none"
                    placeholder="Session notes, reminders, secrets..."
                  />
                  <button onClick={() => setExpandedNotes(prev => !prev)} className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer">
                    {expandedNotes ? 'Hide' : 'Show More'}
                  </button>
                </div>
              </div>

              {/* Character Tags */}
              <div className="text-left w-full border-t border-amber-800/20 pt-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-1">Character Tags</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={charTagInput}
                    onChange={(e) => setCharTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && charTagInput.trim()) {
                        e.preventDefault();
                        if (!charTags.includes(charTagInput.trim())) {
                          setCharTags([...charTags, charTagInput.trim()]);
                        }
                        setCharTagInput('');
                      }
                    }}
                    placeholder="Add tag and press Enter"
                    className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-1 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  {charTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setCharTags(charTags.filter(t => t !== tag))}
                      className="px-2 py-0.5 bg-amber-950/40 border border-amber-800/40 hover:border-red-500/40 rounded text-[10px] text-amber-300 hover:text-red-400 transition-all font-mono flex items-center gap-1 cursor-pointer"
                      title="Click to remove"
                    >
                      {tag} <X size={10} />
                    </button>
                  ))}
                  {charTags.length === 0 && <span className="text-[10px] text-stone-600 italic">No tags added yet.</span>}
                </div>
              </div>
            </div>
          </div>
          )}

          {activeSheetTab === 'bio' && activeBioSubTab === 'gallery' && (
          <div className="border border-cyan-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] pointer-events-none"></div>
            <div className="relative z-10 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cyan-800/25 pb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    Gallery
                  </p>
                  <h3 className="mt-2 text-2xl font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
                    Character Images
                  </h3>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-400">
                    Add portraits, reference art, and tokens. Main sets the default portrait; Splash Art is shown on the Homebrew Character Overview.
                  </p>
                </div>
                <button
                  onClick={chooseGalleryUploadMode}
                  disabled={!isCharacterOwner || galleryUploading}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-700/45 bg-cyan-950/35 px-4 py-2 text-sm font-bold text-cyan-100 hover:bg-cyan-900/45 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ fontFamily: "'Cinzel', serif" }}
                >
                  <Upload size={16} />
                  {galleryUploading ? 'Uploading...' : 'Image Upload'}
                </button>
              </div>

              {galleryImages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-cyan-800/35 bg-stone-950/35 p-8 text-center text-sm italic text-stone-500">
                  No gallery images yet.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {galleryImages.map((image) => {
                    const tags = image.tags || [];
                    const isMain = tags.includes('main');
                    const isSplashArt = tags.includes('splash-art');
                    const isToken = tags.includes('token');
                    return (
                      <div
                        key={image.id}
                        className={`overflow-hidden rounded-2xl border bg-stone-950/45 shadow-lg ${
                          isMain ? 'border-amber-400/55 ring-1 ring-amber-300/35' : 'border-cyan-900/35'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setFullscreenGalleryImage(image)}
                          className="group relative block aspect-[4/3] w-full overflow-hidden bg-black/35"
                        >
                          <img
                            src={image.thumbUrl || getGalleryImageUrl(image)}
                            alt={image.label || editName || 'Gallery image'}
                            onError={(event) => {
                              const fallbackUrl = getGalleryImageUrl(image);
                              if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                                event.currentTarget.src = fallbackUrl;
                              }
                            }}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                          />
                          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                            {isMain && (
                              <span className="rounded-full border border-amber-300/50 bg-amber-950/75 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-100">
                                Main
                              </span>
                            )}
                            {isSplashArt && (
                              <span className="rounded-full border border-fuchsia-300/50 bg-fuchsia-950/75 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-fuchsia-100">
                                Splash Art
                              </span>
                            )}
                            {isToken && (
                              <span className="rounded-full border border-cyan-300/50 bg-cyan-950/75 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100">
                                Token
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="space-y-3 p-3">
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Label</span>
                            <input
                              value={image.label || ''}
                              onChange={(event) => updateGalleryImage(image.id, current => ({ ...current, label: event.target.value }))}
                              disabled={!isCharacterOwner}
                              placeholder="Portrait, scene, token..."
                              className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50 disabled:opacity-60"
                            />
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            {(['main', 'splash-art', 'token'] as CharacterGalleryImageTag[]).map((tag) => {
                              const active = tags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => toggleGalleryImageTag(image.id, tag)}
                                  disabled={!isCharacterOwner}
                                  className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                    active
                                      ? 'border-amber-300/60 bg-amber-500/20 text-amber-100'
                                      : 'border-stone-700/60 bg-stone-900/60 text-stone-400 hover:border-cyan-500/50 hover:text-cyan-100'
                                  }`}
                                >
                                  {tag === 'main' ? 'Main' : tag === 'splash-art' ? 'Splash Art' : 'Token'}
                                </button>
                              );
                            })}
                            {isCharacterOwner && (
                              <button
                                type="button"
                                onClick={() => removeGalleryImage(image.id)}
                                className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-red-800/45 bg-red-950/20 px-3 py-1.5 text-xs font-bold text-red-200 hover:bg-red-900/35"
                              >
                                <Trash2 size={13} />
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          )}

          {activeSheetTab === 'bio' && activeBioSubTab === 'overview' && (
          <div className="border border-cyan-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] pointer-events-none"></div>
            <div className="relative z-10 space-y-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-cyan-300" style={{ fontFamily: "'Cinzel', serif" }}>
                  Character Overview
                </p>
                <h3 className="mt-2 text-2xl font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
                  Homebrew Overview Settings
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-stone-400">
                  Karakter overview'da gözükecek attribute'ları sırası ile seç. Soldaki bölüm main attribute modifier kutularını,
                  sağdaki bölüm ise value + bar yüzdesi ile dolan overview kutularını kontrol eder.
                </p>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <section className="rounded-2xl border border-amber-800/25 bg-stone-950/45 p-4">
                  <div className="mb-4">
                    <h4 className="text-lg font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>Main Attribute Diamonds</h4>
                    <p className="text-xs text-stone-500">Seçilen sırayla homebrew kartının solunda görünür.</p>
                  </div>
                  <div className="space-y-2">
                    {mainAttrs.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-stone-700/60 p-4 text-center text-sm italic text-stone-500">No main attributes yet.</p>
                    ) : mainAttrs.map((attr) => {
                      const selectedIds = overviewSettings.mainAttributeIds || [];
                      const isSelected = selectedIds.includes(attr.id);
                      const orderIndex = selectedIds.indexOf(attr.id);
                      return (
                        <div key={attr.id} className={`flex items-center gap-2 rounded-xl border p-3 ${isSelected ? 'border-amber-500/45 bg-amber-950/25' : 'border-stone-800 bg-black/20'}`}>
                          <button
                            onClick={() => toggleOverviewMainAttribute(attr.id)}
                            className={`h-6 w-6 rounded border text-xs font-bold ${isSelected ? 'border-amber-300 bg-amber-500/30 text-amber-100' : 'border-stone-600 text-stone-500'}`}
                          >
                            {isSelected ? '✓' : ''}
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-amber-100">{attr.name || attr.id}</p>
                            <p className="truncate text-[11px] text-stone-500">{attr.id}</p>
                          </div>
                          {isSelected && (
                            <>
                              <span className="rounded-full border border-amber-800/35 px-2 py-1 text-[11px] text-amber-200">#{orderIndex + 1}</span>
                              <button
                                onClick={() => moveOverviewMainAttribute(attr.id, -1)}
                                disabled={orderIndex <= 0}
                                className="rounded border border-stone-700/60 p-1 text-stone-400 hover:text-amber-200 disabled:opacity-30"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                onClick={() => moveOverviewMainAttribute(attr.id, 1)}
                                disabled={orderIndex >= selectedIds.length - 1}
                                className="rounded border border-stone-700/60 p-1 text-stone-400 hover:text-amber-200 disabled:opacity-30"
                              >
                                <ArrowDown size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-cyan-800/25 bg-stone-950/45 p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>Overview Value Boxes</h4>
                      <p className="text-xs text-stone-500">Her kutu bir value gösterir ve seçilen bar yüzdesi kadar dolar.</p>
                    </div>
                    <button
                      onClick={addOverviewValueBox}
                      className="rounded-lg border border-cyan-700/45 bg-cyan-950/35 px-3 py-2 text-xs font-bold text-cyan-100 hover:bg-cyan-900/45"
                    >
                      + Add Box
                    </button>
                  </div>
                  <div className="space-y-3">
                    {(overviewSettings.valueBoxes || []).length === 0 ? (
                      <p className="rounded-xl border border-dashed border-stone-700/60 p-4 text-center text-sm italic text-stone-500">No overview boxes yet.</p>
                    ) : (overviewSettings.valueBoxes || []).map((box, boxIndex) => {
                      const boxMode = box.mode || 'default';
                      const targetOptions = getEffectTargetOptions();
                      const overviewBoxCount = (overviewSettings.valueBoxes || []).length;
                      return (
                        <div key={box.id} className="grid gap-3 rounded-xl border border-cyan-900/35 bg-black/25 p-3 lg:grid-cols-6">
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Label</span>
                            <input
                              value={box.label || ''}
                              onChange={(e) => updateOverviewValueBox(box.id, { label: e.target.value })}
                              placeholder="HP, AC, Speed..."
                              className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Mode</span>
                            <select
                              value={boxMode}
                              onChange={(e) => updateOverviewValueBox(box.id, { mode: e.target.value as NonNullable<CharacterOverviewSettings['valueBoxes']>[number]['mode'] })}
                              className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                            >
                              <option value="default">Default</option>
                              <option value="two-sided">Two-Sided</option>
                              <option value="double-value">Double Value</option>
                              <option value="pip-counter">Pip Counter</option>
                              <option value="two-sided-pip">Two-Sided Pip</option>
                            </select>
                          </label>
                          {boxMode === 'default' ? (
                            <>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Value</span>
                                <select
                                  value={box.valueId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { valueId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="">Choose value...</option>
                                  {targetOptions.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Fill Bar</span>
                                <select
                                  value={box.barId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { barId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="__color">Color</option>
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                                {box.barId === '__color' && (
                                  <input
                                    type="color"
                                    value={box.color || '#0ea5e9'}
                                    onChange={(e) => updateOverviewValueBox(box.id, { color: e.target.value })}
                                    className="mt-2 h-9 w-full rounded-lg border border-stone-800 bg-stone-900 p-1"
                                  />
                                )}
                              </label>
                            </>
                          ) : boxMode === 'two-sided' ? (
                            <>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Left Bar</span>
                                <select
                                  value={box.barId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { barId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="__color">Color</option>
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                                {box.barId === '__color' && (
                                  <input
                                    type="color"
                                    value={box.color || '#0ea5e9'}
                                    onChange={(e) => updateOverviewValueBox(box.id, { color: e.target.value })}
                                    className="mt-2 h-9 w-full rounded-lg border border-stone-800 bg-stone-900 p-1"
                                  />
                                )}
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Right Bar</span>
                                <select
                                  value={box.secondaryBarId || ''}
                                  onChange={(e) => updateOverviewValueBox(box.id, { secondaryBarId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="__color">Color</option>
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                                {box.secondaryBarId === '__color' && (
                                  <input
                                    type="color"
                                    value={box.secondaryColor || '#ef4444'}
                                    onChange={(e) => updateOverviewValueBox(box.id, { secondaryColor: e.target.value })}
                                    className="mt-2 h-9 w-full rounded-lg border border-stone-800 bg-stone-900 p-1"
                                  />
                                )}
                              </label>
                            </>
                          ) : boxMode === 'double-value' ? (
                            <>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Value A</span>
                                <select
                                  value={box.valueId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { valueId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="">Choose value...</option>
                                  {targetOptions.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Bar A</span>
                                <select
                                  value={box.barId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { barId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="__color">Color</option>
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                                {box.barId === '__color' && (
                                  <input
                                    type="color"
                                    value={box.color || '#0ea5e9'}
                                    onChange={(e) => updateOverviewValueBox(box.id, { color: e.target.value })}
                                    className="mt-2 h-9 w-full rounded-lg border border-stone-800 bg-stone-900 p-1"
                                  />
                                )}
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Value B</span>
                                <select
                                  value={box.secondaryValueId || ''}
                                  onChange={(e) => updateOverviewValueBox(box.id, { secondaryValueId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="">Choose value...</option>
                                  {targetOptions.map((option) => (
                                    <option key={option.id} value={option.id}>{option.label}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Bar B</span>
                                <select
                                  value={box.secondaryBarId || ''}
                                  onChange={(e) => updateOverviewValueBox(box.id, { secondaryBarId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="__color">Color</option>
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                                {box.secondaryBarId === '__color' && (
                                  <input
                                    type="color"
                                    value={box.secondaryColor || '#a855f7'}
                                    onChange={(e) => updateOverviewValueBox(box.id, { secondaryColor: e.target.value })}
                                    className="mt-2 h-9 w-full rounded-lg border border-stone-800 bg-stone-900 p-1"
                                  />
                                )}
                              </label>
                            </>
                          ) : boxMode === 'pip-counter' ? (
                            <>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Bar</span>
                                <select
                                  value={box.barId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { barId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Pips</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={box.pipCount || 4}
                                  onChange={(e) => updateOverviewValueBox(box.id, { pipCount: Math.max(1, Number(e.target.value) || 1) })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                />
                              </label>
                            </>
                          ) : (
                            <>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Left Bar</span>
                                <select
                                  value={box.barId}
                                  onChange={(e) => updateOverviewValueBox(box.id, { barId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Left Pips</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={box.pipCount || 4}
                                  onChange={(e) => updateOverviewValueBox(box.id, { pipCount: Math.max(1, Number(e.target.value) || 1) })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Right Bar</span>
                                <select
                                  value={box.secondaryBarId || ''}
                                  onChange={(e) => updateOverviewValueBox(box.id, { secondaryBarId: e.target.value })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                >
                                  <option value="">Choose bar...</option>
                                  {bars.map((bar) => (
                                    <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                  ))}
                                </select>
                              </label>
                              <label className="block">
                                <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300/70">Right Pips</span>
                                <input
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={box.secondaryPipCount || 4}
                                  onChange={(e) => updateOverviewValueBox(box.id, { secondaryPipCount: Math.max(1, Number(e.target.value) || 1) })}
                                  className="w-full rounded-lg border border-stone-800 bg-stone-900 px-3 py-2 text-sm text-amber-100 outline-none focus:border-cyan-500/50"
                                />
                              </label>
                            </>
                          )}
                          <div className="flex items-end justify-end gap-1">
                            <button
                              onClick={() => moveOverviewValueBox(box.id, -1)}
                              disabled={boxIndex <= 0}
                              className="grid h-10 w-10 place-items-center rounded-lg border border-stone-700/60 bg-stone-900/60 text-stone-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-30"
                              title="Move overview box up"
                            >
                              <ArrowUp size={15} />
                            </button>
                            <button
                              onClick={() => moveOverviewValueBox(box.id, 1)}
                              disabled={boxIndex >= overviewBoxCount - 1}
                              className="grid h-10 w-10 place-items-center rounded-lg border border-stone-700/60 bg-stone-900/60 text-stone-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-30"
                              title="Move overview box down"
                            >
                              <ArrowDown size={15} />
                            </button>
                            <button
                              onClick={() => removeOverviewValueBox(box.id)}
                              className="grid h-10 w-10 place-items-center rounded-lg border border-red-800/45 bg-red-950/25 text-red-200 hover:bg-red-900/35"
                              title="Remove overview box"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </div>
          )}

          {activeSheetTab === 'macros' && (
          <div className="rounded-2xl border border-emerald-800/30 bg-gradient-to-br from-emerald-950/26 via-black/20 to-teal-950/16 p-6 relative overflow-hidden shadow-[0_18px_50px_rgba(6,78,59,0.16)]">
            <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-400/80 via-teal-400/45 to-transparent"></div>
            <div className="relative z-10">
              <div className="flex items-center justify-between border-b border-emerald-800/30 pb-3 mb-4">
                <div>
                  <div className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-200 mb-2">
                    Tactics
                  </div>
                  <h3 className="text-xl font-bold text-emerald-100" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Quick Roll & Dice
                  </h3>
                  <p className="text-xs text-emerald-100/55 mt-1">Fast rolls, macros, and Discord sending for this character sheet.</p>
                </div>
              </div>
              {activeMacroCategoryId === 'main' && renderDicePanel('sheet', {
                showDiscordQuick: true,
                showMacros: true,
                showResults: false,
                macroFolderId: null,
                macroFolderTitle: 'General Macros',
                showMacroFolders: true,
              })}
              {activeMacroCategoryId === 'rolls' && renderDicePanel('sheet', {
                showDiscordQuick: false,
                showMacros: false,
                showResults: true,
              })}
              {activeMacroCategoryId !== 'main' && activeMacroCategoryId !== 'rolls' && (
                <>
                  <div className="mb-6">
                    {renderFolderTree(diceMacroFolders, {
                      editable: isCharacterOwner,
                      emptyLabel: `No subfolders in ${activeMacroCategory?.name || 'this folder'} yet.`,
                      title: `${activeMacroCategory?.name || 'Macro Folder'} Subfolders`,
                      description: 'Subfolders organize this macro category only and do not appear in the macro tab bar.',
                      addLabel: '+ Add Subfolder',
                      rootParentId: activeMacroCategoryId,
                      onAddRoot: () => addDiceMacroFolder(activeMacroCategoryId),
                      onAddChild: (parentId) => addDiceMacroFolder(parentId),
                      onMove: moveDiceMacroFolder,
                      onUpdate: updateDiceMacroFolder,
                      onRemove: removeDiceMacroFolder,
                    })}
                  </div>
                  {renderDicePanel('sheet', {
                    showDiscordQuick: false,
                    showMacros: true,
                    showResults: false,
                    macroFolderId: activeMacroCategoryId,
                    macroFolderTitle: `${activeMacroCategory?.name || 'Folder'} Macros`,
                  })}
                </>
              )}
            </div>
          </div>
          )}

          {activeSheetTab === 'scripts' && (
          <div className="rounded-2xl border border-cyan-800/30 bg-gradient-to-br from-cyan-950/26 via-black/20 to-slate-950/16 p-6 relative overflow-hidden shadow-[0_18px_50px_rgba(8,145,178,0.16)]">
            <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-400/80 via-sky-400/45 to-transparent"></div>
            <div className="relative z-10 space-y-6">
              <div className="flex items-center justify-between border-b border-cyan-800/30 pb-3">
                <div>
                  <div className="inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-200 mb-2">
                    Automation
                  </div>
                  <h3 className="text-xl font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Scripts
                  </h3>
                  <p className="text-xs text-cyan-100/55 mt-1">
                    Watch attributes or bars, then automatically apply or remove statuses when conditions match.
                  </p>
                </div>
              </div>

              {activeScriptCategoryId === 'main' ? (
                <div>
                  {renderFolderTree(scriptFolders, {
                    editable: isCharacterOwner,
                    emptyLabel: 'No script folders yet. Add a folder here and it will become a script tab.',
                    title: 'Script Folders',
                    description: 'Root folders appear as script tabs. Subfolders stay inside their category.',
                    addLabel: '+ Add Folder',
                    rootParentId: null,
                    onAddRoot: () => addScriptFolder(),
                    onAddChild: (parentId) => addScriptFolder(parentId),
                    onMove: moveScriptFolder,
                    onUpdate: updateScriptFolder,
                    onRemove: removeScriptFolder,
                  })}
                </div>
              ) : (
                <div>
                  {renderFolderTree(scriptFolders, {
                    editable: isCharacterOwner,
                    emptyLabel: `No subfolders in ${activeScriptCategory?.name || 'this folder'} yet.`,
                    title: `${activeScriptCategory?.name || 'Script Folder'} Subfolders`,
                    description: 'Subfolders organize this script category only and do not appear in the script tab bar.',
                    addLabel: '+ Add Subfolder',
                    rootParentId: activeScriptCategoryId,
                    onAddRoot: () => addScriptFolder(activeScriptCategoryId),
                    onAddChild: (parentId) => addScriptFolder(parentId),
                    onMove: moveScriptFolder,
                    onUpdate: updateScriptFolder,
                    onRemove: removeScriptFolder,
                  })}
                </div>
              )}

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>
                    {activeScriptCategoryId === 'main' ? 'General Scripts' : `${activeScriptCategory?.name || 'Category'} Scripts`}
                  </h4>
                  {isCharacterOwner && (
                    <button
                      onClick={() => addScript(activeScriptCategoryId === 'main' ? null : activeScriptCategoryId)}
                      className="rounded-lg border border-cyan-700/50 bg-cyan-900/35 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-900/55 cursor-pointer"
                    >
                      + Add Script
                    </button>
                  )}
                </div>

                {charScripts
                  .filter(script => activeScriptCategoryId === 'main'
                    ? (script.folderId ?? null) === null
                    : isFolderInTree(scriptFolders, activeScriptCategoryId, script.folderId) && isFolderVisible(scriptFolders, script.folderId))
                  .length === 0 ? (
                    <div className="rounded-xl border border-dashed border-cyan-900/40 bg-black/20 px-4 py-8 text-center text-sm italic text-stone-500">
                      No scripts here yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {charScripts
                        .filter(script => activeScriptCategoryId === 'main'
                          ? (script.folderId ?? null) === null
                          : isFolderInTree(scriptFolders, activeScriptCategoryId, script.folderId) && isFolderVisible(scriptFolders, script.folderId))
                        .map((script, idx, visibleScripts) => {
                          const isScriptActive = script.active ?? true;
                          const isScriptCollapsed = script.hidden ?? false;
                          return (
                            <div key={script.id} className={`rounded-xl border p-4 shadow-lg transition-opacity ${isScriptActive ? '' : 'opacity-60'}`} style={{ borderColor: `${script.color || '#06b6d4'}55`, background: `linear-gradient(135deg, ${script.color || '#06b6d4'}1f, rgba(8, 47, 73, 0.16))` }}>
                              <div className="flex flex-wrap items-end gap-3">
                                {renderActionField('Active', (
                                  <button
                                    onClick={() => updateScript(script.id, current => ({ ...current, active: !(current.active ?? true) }))}
                                    disabled={!isCharacterOwner}
                                    className={`h-10 w-10 shrink-0 rounded-lg border grid place-items-center transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                                      isScriptActive
                                        ? 'border-cyan-400/70 bg-cyan-500/20 text-cyan-200 shadow-[0_0_16px_rgba(34,211,238,0.24)]'
                                        : 'border-stone-700 bg-stone-950/70 text-stone-600 hover:text-stone-400'
                                    }`}
                                    title={isScriptActive ? 'Script active' : 'Script inactive'}
                                  >
                                    <Zap size={17} fill={isScriptActive ? 'currentColor' : 'none'} />
                                  </button>
                                ), 'min-w-[48px]')}
                                {renderActionField('Script Name', (
                                  <input
                                    value={script.name}
                                    onChange={(e) => updateScript(script.id, current => ({ ...current, name: e.target.value }))}
                                    disabled={!isCharacterOwner}
                                    className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-base text-cyan-100 focus:outline-none focus:border-cyan-500/40 disabled:opacity-60"
                                    placeholder="Script name"
                                  />
                                ), 'min-w-[220px] flex-1')}
                                {renderActionField('Color', (
                                  <input
                                    type="color"
                                    value={script.color || '#06b6d4'}
                                    onChange={(e) => updateScript(script.id, current => ({ ...current, color: e.target.value }))}
                                    disabled={!isCharacterOwner}
                                    className="h-10 w-14 bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer disabled:opacity-60"
                                  />
                                ), 'min-w-[64px]')}
                                {renderActionField('Category', (
                                  <select
                                    value={script.folderId ?? ''}
                                    onChange={(e) => updateScript(script.id, current => ({ ...current, folderId: e.target.value || null }))}
                                    disabled={!isCharacterOwner}
                                    className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-100 focus:outline-none focus:border-cyan-500/40 disabled:opacity-60"
                                  >
                                    <option value="">General Scripts</option>
                                    {getFolderOptions(scriptFolders).map(option => (
                                      <option key={option.id} value={option.id}>{option.label}</option>
                                    ))}
                                  </select>
                                ), 'min-w-[200px]')}
                                {isCharacterOwner && (
                                  <div className="ml-auto flex items-center gap-1">
                                    <button
                                      onClick={() => updateScript(script.id, current => ({ ...current, hidden: !current.hidden }))}
                                      className="px-2 py-1 text-xs text-cyan-200 border border-cyan-800/40 rounded hover:bg-cyan-900/20 cursor-pointer"
                                    >
                                      {isScriptCollapsed ? 'Show' : 'Collapse'}
                                    </button>
                                    <button
                                      onClick={() => downloadJsonFile(buildScriptExportPayload(script), safeExportFileName(script.name, 'script'))}
                                      className="px-2 py-1 text-xs text-emerald-300 border border-emerald-800/30 rounded hover:bg-emerald-900/20 cursor-pointer"
                                    >
                                      Export
                                    </button>
                                    <button onClick={() => moveScript(script.id, 'up')} disabled={idx === 0} className="p-1 text-stone-500 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><ArrowUp size={15} /></button>
                                    <button onClick={() => moveScript(script.id, 'down')} disabled={idx === visibleScripts.length - 1} className="p-1 text-stone-500 hover:text-cyan-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"><ArrowDown size={15} /></button>
                                    <button onClick={() => removeScript(script.id)} className="p-1 text-stone-500 hover:text-red-400 cursor-pointer"><Trash2 size={16} /></button>
                                  </div>
                                )}
                              </div>

                              {!isScriptCollapsed && (
                              <>
                              <div className="mt-4 rounded-lg border border-cyan-900/30 bg-black/20 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <div>
                                    <label className="text-sm font-bold text-stone-300">Control Values</label>
                                    <p className="text-xs text-stone-500">The script checks its conditions whenever these values change.</p>
                                  </div>
                                  {isCharacterOwner && (
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        onClick={() => updateScript(script.id, current => ({ ...current, watchIds: [...(current.watchIds || []), scriptValueOptions[0]?.id || ''] }))}
                                        className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                                      >
                                        + Add Control
                                      </button>
                                      <button
                                        onClick={() => updateScript(script.id, current => ({ ...current, triggerIds: [...(current.triggerIds || []), 'short-rest'] }))}
                                        className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                      >
                                        + Add Trigger
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <div className="space-y-2">
                                  {(script.watchIds || []).length === 0 ? (
                                    <span className="text-xs text-stone-600 italic">No control values selected.</span>
                                  ) : script.watchIds.map((watchId, watchIndex) => {
                                    const importedLabel = script.importedValueLabels?.[watchId];
                                    const hasCurrentOption = scriptValueOptions.some(option => option.id === watchId);
                                    return (
                                    <div key={`${script.id}-watch-${watchIndex}`} className="grid grid-cols-[1fr_auto] gap-2">
                                      {renderActionField('Control Value', (
                                        <>
                                          <select
                                            value={watchId}
                                            onChange={(e) => updateScript(script.id, current => ({ ...current, watchIds: (current.watchIds || []).map((id, index) => index === watchIndex ? e.target.value : id) }))}
                                            disabled={!isCharacterOwner}
                                            className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-100 focus:outline-none disabled:opacity-60"
                                          >
                                            <option value="">Choose value...</option>
                                            {!hasCurrentOption && watchId && (
                                              <option value={watchId}>{importedLabel || `Imported value (${watchId})`}</option>
                                            )}
                                            {scriptValueOptions.map(option => (
                                              <option key={option.id} value={option.id}>{option.label}</option>
                                            ))}
                                          </select>
                                          {importedLabel && (
                                            <span className="text-[10px] text-cyan-300/70">Imported as: {importedLabel}</span>
                                          )}
                                        </>
                                      ), 'min-w-0')}
                                      {isCharacterOwner && (
                                        <button onClick={() => updateScript(script.id, current => ({ ...current, watchIds: (current.watchIds || []).filter((_, index) => index !== watchIndex) }))} className="text-stone-600 hover:text-red-400 cursor-pointer">
                                          <Trash2 size={14} />
                                        </button>
                                      )}
                                    </div>
                                    );
                                  })}
                                  {(script.triggerIds || []).length > 0 && (
                                    <div className="pt-2">
                                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300/70">Event Triggers</div>
                                      <div className="space-y-2">
                                        {(script.triggerIds || []).map((triggerId, triggerIndex) => (
                                          <div key={`${script.id}-trigger-${triggerIndex}`} className="grid grid-cols-[1fr_auto] gap-2">
                                            {renderActionField('Trigger', (
                                              <select
                                                value={triggerId}
                                                onChange={(e) => updateScript(script.id, current => ({ ...current, triggerIds: (current.triggerIds || []).map((id, index) => index === triggerIndex ? e.target.value as CharacterScriptTrigger : id) }))}
                                                disabled={!isCharacterOwner}
                                                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                              >
                                                {SCRIPT_TRIGGER_OPTIONS.map(option => (
                                                  <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                              </select>
                                            ), 'min-w-0')}
                                            {isCharacterOwner && (
                                              <button onClick={() => updateScript(script.id, current => ({ ...current, triggerIds: (current.triggerIds || []).filter((_, index) => index !== triggerIndex) }))} className="text-stone-600 hover:text-red-400 cursor-pointer">
                                                <Trash2 size={14} />
                                              </button>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="mt-4 rounded-lg border border-cyan-900/30 bg-black/20 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                  <label className="text-sm font-bold text-stone-300">If Conditions</label>
                                  {isCharacterOwner && (
                                    <button onClick={() => addScriptCondition(script.id)} className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer">
                                      + Add If
                                    </button>
                                  )}
                                </div>
                                <div className="space-y-3">
                                  {(script.conditions || []).length === 0 ? (
                                    <span className="text-xs text-stone-600 italic">No conditions yet.</span>
                                  ) : script.conditions.map((condition) => {
                                    const importedLeftLabel = script.importedValueLabels?.[condition.leftId];
                                    const hasCurrentLeftOption = scriptValueOptions.some(option => option.id === condition.leftId);
                                    return (
                                    <div key={condition.id} className="rounded-lg border border-cyan-900/25 bg-stone-950/45 p-3 space-y-3">
                                      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1.2fr_160px_1fr_1fr_auto]">
                                        {renderActionField('If Value', (
                                          <>
                                            <select
                                              value={condition.leftId}
                                              onChange={(e) => updateScriptCondition(script.id, condition.id, current => ({ ...current, leftId: e.target.value }))}
                                              disabled={!isCharacterOwner}
                                              className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-100 focus:outline-none disabled:opacity-60"
                                            >
                                              <option value="">Choose value...</option>
                                              {!hasCurrentLeftOption && condition.leftId && (
                                                <option value={condition.leftId}>{importedLeftLabel || `Imported value (${condition.leftId})`}</option>
                                              )}
                                              {scriptValueOptions.map(option => (
                                                <option key={option.id} value={option.id}>{option.label}</option>
                                              ))}
                                            </select>
                                            {importedLeftLabel && (
                                              <span className="text-[10px] text-cyan-300/70">Imported as: {importedLeftLabel}</span>
                                            )}
                                          </>
                                        ), 'min-w-0')}
                                        {renderActionField('Operator', (
                                          <select
                                            value={condition.operator}
                                            onChange={(e) => updateScriptCondition(script.id, condition.id, current => ({ ...current, operator: e.target.value as CharacterScriptConditionOperator }))}
                                            disabled={!isCharacterOwner}
                                            className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-100 focus:outline-none disabled:opacity-60"
                                          >
                                            <option value="lte">is ≤</option>
                                            <option value="lt">is &lt;</option>
                                            <option value="gte">is ≥</option>
                                            <option value="gt">is &gt;</option>
                                            <option value="eq">is equal to</option>
                                            <option value="neq">is not equal to</option>
                                            <option value="between">is between</option>
                                            <option value="outside">is outside</option>
                                          </select>
                                        ), 'min-w-[160px]')}
                                        {condition.operator === 'between' || condition.operator === 'outside' ? (
                                          <>
                                            {renderActionField('Min', (
                                              <input
                                                value={condition.minValue || ''}
                                                onChange={(e) => updateScriptCondition(script.id, condition.id, current => ({ ...current, minValue: e.target.value }))}
                                                disabled={!isCharacterOwner}
                                                placeholder="Min"
                                                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                              />
                                            ), 'min-w-0')}
                                            {renderActionField('Max', (
                                              <input
                                                value={condition.maxValue || ''}
                                                onChange={(e) => updateScriptCondition(script.id, condition.id, current => ({ ...current, maxValue: e.target.value }))}
                                                disabled={!isCharacterOwner}
                                                placeholder="Max"
                                                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                              />
                                            ), 'min-w-0')}
                                          </>
                                        ) : (
                                          <>
                                            {renderActionField('Compare Value', (
                                              <input
                                                value={condition.compareValue || ''}
                                                onChange={(e) => updateScriptCondition(script.id, condition.id, current => ({ ...current, compareValue: e.target.value }))}
                                                disabled={!isCharacterOwner}
                                                placeholder="Value or formula"
                                                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                              />
                                            ), 'min-w-0 lg:col-span-2')}
                                          </>
                                        )}
                                        {isCharacterOwner && (
                                          <button onClick={() => removeScriptCondition(script.id, condition.id)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </div>

                                      <div className="rounded-lg border border-cyan-900/20 bg-black/20 p-3">
                                        <div>
                                          <div className="mb-2 flex items-center justify-between gap-3">
                                            <div>
                                              <label className="block text-xs font-bold uppercase tracking-[0.16em] text-cyan-200">Apply Status JSON</label>
                                              <p className="text-xs text-stone-500">Import one or more status JSON files. Each one can remove itself or stay when the condition becomes false.</p>
                                            </div>
                                            {isCharacterOwner && (
                                              <button
                                                onClick={() => importScriptConditionStatus(script.id, condition.id)}
                                                className="shrink-0 rounded border border-cyan-700/50 bg-cyan-900/30 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-900/50 cursor-pointer"
                                              >
                                                + Import Status JSON
                                              </button>
                                            )}
                                          </div>
                                          {(condition.statusEntries || []).length === 0 ? (
                                            <div className="rounded border border-dashed border-stone-700/60 px-3 py-3 text-center text-xs italic text-stone-600">
                                              No status JSON imported for this condition.
                                            </div>
                                          ) : (
                                            <div className="space-y-2">
                                              {(condition.statusEntries || []).map((statusEntry) => (
                                                <div key={statusEntry.id} className="grid grid-cols-1 gap-2 rounded-lg border border-cyan-900/25 bg-stone-950/45 p-2 lg:grid-cols-[1fr_220px_190px_auto]">
                                                  <div className="min-w-0">
                                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500">Status JSON</div>
                                                    <div className="truncate text-sm font-bold text-cyan-100">{statusEntry.name || statusEntry.entry?.name || 'Imported Status'}</div>
                                                    <div className="text-[10px] text-stone-500">
                                                      Applied now: {(statusEntry.appliedStatusInstanceIds || []).length}
                                                    </div>
                                                  </div>
                                                  {renderActionField('Target Category', (
                                                    <select
                                                      value={statusEntry.statusFolderId ?? ''}
                                                      onChange={(e) => {
                                                        const nextFolderId = e.target.value || null;
                                                        updateScriptCondition(script.id, condition.id, current => ({
                                                          ...current,
                                                          statusEntries: (current.statusEntries || []).map(entry => entry.id === statusEntry.id ? { ...entry, statusFolderId: nextFolderId } : entry),
                                                        }));
                                                        setCharStatuses(prev => prev.map(status => (
                                                          status.scriptSourceConditionId === condition.id && status.scriptSourceTemplateStatusId === statusEntry.id
                                                            ? { ...status, folderId: nextFolderId }
                                                            : status
                                                        )));
                                                      }}
                                                      disabled={!isCharacterOwner}
                                                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-100 focus:outline-none disabled:opacity-60"
                                                    >
                                                      <option value="">General Statuses</option>
                                                      {getFolderOptions(statusFolders).map(option => (
                                                        <option key={option.id} value={option.id}>{option.label}</option>
                                                      ))}
                                                    </select>
                                                  ), 'min-w-0')}
                                                  {renderActionField('When False', (
                                                    <select
                                                      value={statusEntry.onFalse}
                                                      onChange={(e) => updateScriptCondition(script.id, condition.id, current => ({
                                                        ...current,
                                                        statusEntries: (current.statusEntries || []).map(entry => entry.id === statusEntry.id ? { ...entry, onFalse: e.target.value as 'remove' | 'keep' } : entry),
                                                      }))}
                                                      disabled={!isCharacterOwner}
                                                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-cyan-100 focus:outline-none disabled:opacity-60"
                                                    >
                                                      <option value="remove">Remove when false</option>
                                                      <option value="keep">Keep when false</option>
                                                    </select>
                                                  ), 'min-w-0')}
                                                  {isCharacterOwner && (
                                                    <button
                                                      onClick={() => removeScriptConditionStatusEntry(script.id, condition.id, statusEntry.id)}
                                                      className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end"
                                                    >
                                                      <Trash2 size={14} />
                                                    </button>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {(condition.statusIds || []).length > 0 && (
                                            <div className="mt-2 rounded border border-amber-800/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                                              This condition has legacy status links. They will be migrated the next time the script evaluates.
                                            </div>
                                          )}
                                        </div>
                                      </div>

                                      <div className="rounded-lg border border-sky-900/25 bg-black/20 p-3">
                                        <div className="mb-2 flex items-center justify-between gap-3">
                                          <div>
                                            <label className="block text-xs font-bold uppercase tracking-[0.16em] text-sky-200">Bar Updates</label>
                                            <p className="text-xs text-stone-500">When this IF becomes true, or when a selected trigger fires while it is true, update the chosen bar.</p>
                                          </div>
                                          {isCharacterOwner && (
                                            <button
                                              onClick={() => addScriptConditionBarUpdate(script.id, condition.id)}
                                              className="shrink-0 rounded border border-sky-700/50 bg-sky-900/30 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/50 cursor-pointer"
                                            >
                                              + Bar Update
                                            </button>
                                          )}
                                        </div>
                                        {(condition.barUpdates || []).length === 0 ? (
                                          <div className="rounded border border-dashed border-stone-700/60 px-3 py-3 text-center text-xs italic text-stone-600">
                                            No bar updates for this condition.
                                          </div>
                                        ) : (
                                          <div className="space-y-2">
                                            {(condition.barUpdates || []).map((barUpdate) => (
                                              <div key={barUpdate.id} className="grid grid-cols-1 gap-2 rounded-lg border border-sky-900/25 bg-stone-950/45 p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                                                {renderActionField('Bar', (
                                                  <select
                                                    value={barUpdate.targetId}
                                                    onChange={(e) => updateScriptConditionBarUpdate(script.id, condition.id, barUpdate.id, current => ({ ...current, targetId: e.target.value }))}
                                                    disabled={!isCharacterOwner}
                                                    className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-sky-100 focus:outline-none disabled:opacity-60"
                                                  >
                                                    <option value="">Choose bar</option>
                                                    {bars.map((bar) => (
                                                      <option key={bar.id} value={bar.id}>{bar.name || bar.id}</option>
                                                    ))}
                                                  </select>
                                                ), 'min-w-0')}
                                                {renderActionField('Value', (
                                                  <input
                                                    value={barUpdate.value}
                                                    onChange={(e) => updateScriptConditionBarUpdate(script.id, condition.id, barUpdate.id, current => ({ ...current, value: e.target.value }))}
                                                    disabled={!isCharacterOwner}
                                                    placeholder="Amount or formula"
                                                    className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-sky-200 font-mono focus:outline-none disabled:opacity-60"
                                                  />
                                                ), 'min-w-0')}
                                                {isCharacterOwner && (
                                                  <button
                                                    onClick={() => removeScriptConditionBarUpdate(script.id, condition.id, barUpdate.id)}
                                                    className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end"
                                                  >
                                                    <Trash2 size={14} />
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                    );
                                  })}
                                </div>
                              </div>
                              </>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  )}
              </div>
            </div>
          </div>
          )}

          {activeSheetTab === 'attributes' && (
          <>
          <div className="flex flex-col gap-6">
            <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
              <div className="relative z-10">
              <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Attributes & Bars
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Import and export only main, secondary, other attributes, bars, and the main-attribute modifier formula.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={importAttributePreset}
                    className="px-2 py-1 bg-sky-900/40 border border-sky-800/40 rounded text-xs text-sky-200 hover:bg-sky-900/60 cursor-pointer"
                  >
                    Import
                  </button>
                  <button
                    onClick={exportAttributePreset}
                    className="px-2 py-1 bg-emerald-900/40 border border-emerald-800/40 rounded text-xs text-emerald-200 hover:bg-emerald-900/60 cursor-pointer"
                  >
                    Export
                  </button>
                </div>
              </div>
              {activeAttributeSubTab === 'main' && (
              <>
              {/* 1. Main Attributes */}
              <div className="mb-8">
                <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Main Attributes
                  </h3>
                  <div className="flex items-center gap-2">
                    {renderAttributeSearch('main')}
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-stone-400 uppercase tracking-[0.18em]">Cols</label>
                      <input
                        type="number"
                        min={1}
                        max={6}
                        value={attributeSectionColumns.main}
                        onChange={(e) => updateAttributeSectionColumns('main', parseInt(e.target.value, 10) || 1)}
                        className="w-14 bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center rounded border border-amber-800/30 overflow-hidden">
                      {[
                        { key: 'all', label: 'Show All' },
                        { key: 'favorites', label: 'Show only Favorites' },
                        { key: 'hidden', label: 'Hide' },
                      ].map((mode) => (
                        <button
                          key={mode.key}
                          onClick={() => setAttributeSectionModes(prev => ({ ...prev, main: mode.key as 'all' | 'favorites' | 'hidden' }))}
                          className={`px-2 py-1 text-[11px] cursor-pointer ${attributeSectionModes.main === mode.key ? 'bg-amber-900/40 text-amber-200' : 'bg-stone-900/40 text-stone-400 hover:text-amber-200'}`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setShowModOptions(!showModOptions)}
                      className="p-1.5 text-amber-500 hover:text-amber-300 cursor-pointer"
                      title="Modifier Formula"
                    >
                      <Settings size={18} />
                    </button>
                    <button
                      onClick={() => setMainAttrs([...mainAttrs, { id: `attr_${Date.now().toString(36)}`, name: 'New Attribute', value: '10' }])}
                      className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>
                </div>

                {showModOptions && (
                  <div className="mb-4 p-3 bg-stone-900/80 border border-amber-800/30 rounded-lg">
                    <label className="block text-xs font-bold text-amber-500 mb-1">Modifier Formula (use @value for own value)</label>
                    <input
                      type="text"
                      value={modFormula}
                      onChange={(e) => setModFormula(e.target.value)}
                      className="w-full bg-stone-800 border border-stone-700 rounded px-2 py-1 text-sm font-mono text-amber-200 focus:outline-none"
                    />
                  </div>
                )}

                {attributeSectionModes.main !== 'hidden' && (
                <div
                  className="grid gap-3 mb-4"
                  style={{ gridTemplateColumns: `repeat(${attributeSectionColumns.main}, minmax(0, 1fr))` }}
                >
                  {mainAttrs
                    .filter(attr => attributeSectionModes.main === 'all' || attr.favorite)
                    .filter(attr => matchesAttributeSearch(attr, 'main'))
                    .map((attr, idx, filteredMainAttrs) => {
                    const actualIndex = mainAttrs.findIndex(item => item.id === attr.id);
                    const evalVal = finalContext[attr.id] || 0;
                    const displayValue = formatAttributeOutput(attr.id, evalVal);
                    const modVal = finalContext[`${attr.id}_mod`] || 0;

                    return (
                      <div id={`sheet-attr-main-${attr.id}`} key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-3 flex flex-col gap-2 shadow-lg">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={attr.name}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[actualIndex].name = e.target.value;
                              setMainAttrs(next);
                            }}
                            className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                          />
                          <input
                            type="text"
                            value={attr.id}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[actualIndex].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                              setMainAttrs(next);
                            }}
                            className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-16"
                            placeholder="id"
                          />
                          <button
                            onClick={() => {
                              const nextFavorite = !attr.favorite;
                              const next = [...mainAttrs];
                              next[actualIndex] = { ...next[actualIndex], favorite: nextFavorite };
                              setMainAttrs(next);
                              syncDisplayStatFavorite(attr.id, nextFavorite);
                            }}
                            className={`p-1 rounded border cursor-pointer ${attr.favorite ? 'bg-amber-400/20 border-amber-300/50 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.28)]' : 'border-stone-700 text-stone-500 hover:text-amber-300'}`}
                            title={attr.favorite ? 'Remove from display favorites' : 'Add to display favorites'}
                          >
                            <Star size={14} fill={attr.favorite ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            onClick={() => setOpenAttributeOptionsId(current => current === attr.id ? null : attr.id)}
                            className={`p-1 rounded border cursor-pointer ${openAttributeOptionsId === attr.id ? 'bg-amber-900/40 border-amber-500/50 text-amber-100' : 'border-stone-700 text-stone-500 hover:text-amber-300'}`}
                            title="Override and value label options"
                          >
                            <Settings size={14} />
                          </button>
                          <button
                            onClick={() => setMainAttrs(moveListItem(mainAttrs, attr.id, 'up'))}
                            disabled={idx === 0}
                            className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            onClick={() => setMainAttrs(moveListItem(mainAttrs, attr.id, 'down'))}
                            disabled={idx === filteredMainAttrs.length - 1}
                            className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <ArrowDown size={14} />
                          </button>
                          <button
                            onClick={() => {
                              setMainAttrs(mainAttrs.filter(item => item.id !== attr.id));
                              syncDisplayStatFavorite(attr.id, false);
                            }}
                            className="text-stone-600 hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        {renderAttributeOptionsEditor(attr, mainAttrs, setMainAttrs, actualIndex)}
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={attr.value}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[actualIndex].value = e.target.value;
                              setMainAttrs(next);
                            }}
                            className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 w-24 focus:outline-none"
                          />
                          <button
                            onClick={() => rollAttributeCheck(`${attr.name || 'Attribute'} Check`, `1d20 + @${attr.id}_mod`, `${attr.name || 'Attribute'} ability check`)}
                            className="mr-2 flex items-center gap-1 px-2.5 py-1.5 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer"
                          >
                            <Dices size={12} /> Roll
                          </button>
                          <div className="mr-2">
                            {attr.id && renderMainAttributeHistory(attr.id)}
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-lg font-bold font-mono text-amber-200">{displayValue}</span>
                            <span className="text-xs font-mono font-bold bg-amber-900/40 px-2 py-0.5 rounded text-amber-400">
                              {modVal >= 0 ? `+${modVal}` : modVal}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
              </>
              )}

                {activeAttributeSubTab === 'secondary' && renderAttributeSection('✦ Secondary Attributes', secondaryAttrs, setSecondaryAttrs, 'sec', { sectionKey: 'secondary', subTab: 'secondary' })}
                {activeAttributeSubTab === 'skills' && renderAttributeSection('✦ Skills', skills, setSkills, 'skill', { skillMode: true, sectionKey: 'skills', subTab: 'skills' })}
                {activeAttributeSubTab === 'other' && renderAttributeSection('✦ Other Attributes', otherAttrs, setOtherAttrs, 'other', { sectionKey: 'other', subTab: 'other' })}
                {activeAttributeSubTab === 'resistances' && renderAttributeSection('✦ Resistances', resistances, setResistances, 'resistance', { sectionKey: 'resistances', subTab: 'resistances', resistanceMode: true })}

                {activeAttributeSubTab === 'bars' && (
                <div className="mb-4">
                  <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                    <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                      ✦ Bars
                    </h3>
                    <div className="flex items-center gap-2">
                      {renderAttributeSearch('bars', 'Search bars...')}
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-stone-400 uppercase tracking-[0.18em]">Cols</label>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={attributeSectionColumns.bars}
                          onChange={(e) => updateAttributeSectionColumns('bars', parseInt(e.target.value, 10) || 1)}
                          className="w-14 bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center rounded border border-amber-800/30 overflow-hidden">
                        {[
                          { key: 'all', label: 'Show All' },
                          { key: 'favorites', label: 'Show only Favorites' },
                          { key: 'hidden', label: 'Hide' },
                        ].map((mode) => (
                          <button
                            key={mode.key}
                            onClick={() => setAttributeSectionModes(prev => ({ ...prev, bars: mode.key as 'all' | 'favorites' | 'hidden' }))}
                            className={`px-2 py-1 text-[11px] cursor-pointer ${attributeSectionModes.bars === mode.key ? 'bg-amber-900/40 text-amber-200' : 'bg-stone-900/40 text-stone-400 hover:text-amber-200'}`}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setBars([...bars, { id: `bar_${Date.now().toString(36)}`, name: 'New Bar', currentValue: '0', maxValue: '100', mode: 'default', resetValue: '0', resetTrigger: 'short-rest', color: '#f59e0b' }])}
                        className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                      >
                        + Add
                      </button>
                    </div>
                  </div>

                  {attributeSectionModes.bars !== 'hidden' && (
                  <div
                    className="grid gap-4"
                    style={{ gridTemplateColumns: `repeat(${attributeSectionColumns.bars}, minmax(0, 1fr))` }}
                  >
                    {bars
                      .filter(bar => attributeSectionModes.bars === 'all' || bar.favorite)
                      .filter(bar => matchesAttributeSearch(bar, 'bars'))
                      .map((bar, idx, filteredBars) => {
                      const actualIndex = bars.findIndex(item => item.id === bar.id);
                      const barMode = getBarMode(bar);
                      const rawMax = finalContext[`${bar.id}_max`] || 0;
                      const rawReset = finalContext[`${bar.id}_reset`] || 0;
                      const rawCurrent = finalContext[`${bar.id}_current`] || 0;
                      const safeMax = rawMax > 0 ? rawMax : 0;
                      const clampedCurrent = safeMax > 0 ? Math.min(Math.max(rawCurrent, 0), safeMax) : 0;
                      const displayedCurrent = barMode === 'resource' ? rawCurrent : clampedCurrent;
                      const referenceValue = barMode === 'resource' ? rawReset : safeMax;
                      const percent = referenceValue > 0 ? Math.min(100, Math.max(0, Math.round((displayedCurrent / referenceValue) * 100))) : 0;

                      return (
                        <div id={`sheet-bar-${bar.id}`} key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
                          <div className="flex items-center justify-between gap-2">
                            <input
                              type="text"
                              value={bar.name}
                              onChange={(e) => {
                                const next = [...bars];
                                next[actualIndex].name = e.target.value;
                                setBars(next);
                              }}
                              className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-32"
                            />
                            <input
                              type="text"
                              value={bar.id}
                              onChange={(e) => {
                                const next = [...bars];
                                next[actualIndex].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                                setBars(next);
                              }}
                              className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                              placeholder="id"
                            />
                            <button
                              onClick={() => {
                                const nextFavorite = !bar.favorite;
                                const next = [...bars];
                                next[actualIndex] = { ...next[actualIndex], favorite: nextFavorite };
                                setBars(next);
                                syncDisplayStatFavorite(bar.id, nextFavorite);
                              }}
                              className={`p-1 rounded border cursor-pointer ${bar.favorite ? 'bg-amber-400/20 border-amber-300/50 text-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.28)]' : 'border-stone-700 text-stone-500 hover:text-amber-300'}`}
                              title={bar.favorite ? 'Remove from display favorites' : 'Add to display favorites'}
                            >
                              <Star size={14} fill={bar.favorite ? 'currentColor' : 'none'} />
                            </button>
                            <button
                              onClick={() => setOpenBarSettingsId(openBarSettingsId === bar.id ? null : bar.id)}
                              className={`p-1 rounded border cursor-pointer ${openBarSettingsId === bar.id ? 'bg-sky-400/20 border-sky-300/50 text-sky-100' : 'border-stone-700 text-stone-500 hover:text-sky-300'}`}
                              title="Bar settings"
                            >
                              <Settings size={14} />
                            </button>
                            <button
                              onClick={() => setBars(moveListItem(bars, bar.id, 'up'))}
                              disabled={idx === 0}
                              className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              onClick={() => setBars(moveListItem(bars, bar.id, 'down'))}
                              disabled={idx === filteredBars.length - 1}
                              className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              onClick={() => {
                                setBars(bars.filter(item => item.id !== bar.id));
                                syncDisplayStatFavorite(bar.id, false);
                              }}
                              className="text-stone-600 hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {openBarSettingsId === bar.id && (
                            <div className="grid grid-cols-1 gap-3 rounded-lg border border-sky-800/25 bg-sky-950/10 p-3 sm:grid-cols-2">
                              <div>
                                <label className="block text-[11px] font-bold uppercase tracking-wider text-sky-300 mb-1">Bar Mode</label>
                                <select
                                  value={barMode}
                                  onChange={(e) => {
                                    const nextMode = e.target.value as NonNullable<CharacterBar['mode']>;
                                    const next = [...bars];
                                    next[actualIndex] = {
                                      ...next[actualIndex],
                                      mode: nextMode,
                                      resetValue: next[actualIndex].resetValue ?? next[actualIndex].maxValue ?? '0',
                                      resetTrigger: next[actualIndex].resetTrigger ?? 'short-rest',
                                    };
                                    setBars(next);
                                  }}
                                  className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm text-amber-100 focus:outline-none"
                                >
                                  <option value="default">Default</option>
                                  <option value="resource">Resource</option>
                                </select>
                              </div>
                              {barMode === 'resource' && (
                                <div>
                                  <label className="block text-[11px] font-bold uppercase tracking-wider text-sky-300 mb-1">Reset On</label>
                                  <select
                                    value={bar.resetTrigger || 'short-rest'}
                                    onChange={(e) => {
                                      const next = [...bars];
                                      next[actualIndex].resetTrigger = e.target.value as NonNullable<CharacterBar['resetTrigger']>;
                                      setBars(next);
                                    }}
                                    className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm text-amber-100 focus:outline-none"
                                  >
                                    {BAR_RESET_TRIGGER_OPTIONS.map(option => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                            <div>
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-500 mb-1">Current Value</label>
                              <input
                                type="text"
                                value={bar.currentValue}
                                onChange={(e) => {
                                  const next = [...bars];
                                  next[actualIndex].currentValue = e.target.value;
                                  setBars(next);
                                }}
                                className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-500 mb-1">{barMode === 'resource' ? 'Reset Value' : 'Max Value'}</label>
                              <input
                                type="text"
                                value={barMode === 'resource' ? (bar.resetValue ?? '') : bar.maxValue}
                                onChange={(e) => {
                                  const next = [...bars];
                                  if (barMode === 'resource') {
                                    next[actualIndex].resetValue = e.target.value;
                                  } else {
                                    next[actualIndex].maxValue = e.target.value;
                                  }
                                  setBars(next);
                                }}
                                className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-500 mb-1">Color</label>
                              <input
                                type="color"
                                value={bar.color || '#f59e0b'}
                                onChange={(e) => {
                                  const next = [...bars];
                                  next[actualIndex].color = e.target.value;
                                  setBars(next);
                                }}
                                className="h-[34px] w-14 bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-amber-400 font-mono">
                              <span>{displayedCurrent} / {referenceValue}</span>
                              <span>{barMode === 'resource' ? 'Resource' : `%${percent}`}</span>
                            </div>
                            <div className="relative h-6 rounded-full border border-amber-800/30 bg-stone-950/80 overflow-hidden">
                              <div
                                className="absolute inset-y-0 left-0 transition-all"
                                style={{
                                  width: `${percent}%`,
                                  background: `linear-gradient(to right, ${bar.color || '#b45309'}, ${bar.color || '#f59e0b'})`,
                                }}
                              />
                              <div className="absolute inset-0 flex items-center justify-center text-xs font-bold font-mono text-amber-100">
                                {barMode === 'resource' ? displayedCurrent : `%${percent}`}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
                )}

                {activeAttributeSubTab === 'unassigned' && (
                  <div className="mb-4 rounded-2xl border border-sky-800/30 bg-sky-950/10 p-5 shadow-lg">
                    <div className="mb-4 flex flex-col gap-3 border-b border-sky-800/25 pb-4 md:flex-row md:items-end md:justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-sky-200" style={{ fontFamily: "'Cinzel', serif" }}>
                          ✦ Unassigned Values
                        </h3>
                        <p className="mt-1 text-sm text-stone-500">
                          Active effects targeting ids that do not exist in Bars, Main, Secondary, Skills, Other, or Resistances yet.
                        </p>
                      </div>
                      <div className="relative w-full md:w-80">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-sky-400/70" />
                        <input
                          value={unassignedAttributeSearch}
                          onChange={(e) => setUnassignedAttributeSearch(e.target.value)}
                          placeholder="Search id or source..."
                          className="w-full rounded-lg border border-sky-800/35 bg-stone-950/70 py-2 pl-9 pr-3 text-sm text-sky-100 placeholder:text-stone-600 focus:border-sky-500/60 focus:outline-none"
                        />
                      </div>
                    </div>

                    {unassignedAttributeEntries.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-stone-700/60 bg-black/20 px-4 py-8 text-center text-sm italic text-stone-500">
                        No unassigned active effect values found.
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {unassignedAttributeEntries.map((entry) => (
                          <div
                            key={entry.referenceId}
                            onClick={() => setPendingUnassignedAttributeId(current => current === entry.referenceId ? null : entry.referenceId)}
                            className="rounded-xl border border-sky-800/25 bg-black/25 p-4 transition-colors hover:border-sky-500/50 hover:bg-sky-950/15 cursor-pointer"
                          >
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div>
                                <h4 className="font-mono text-sm font-bold text-sky-200">{entry.referenceId}</h4>
                                <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500">Click to register this target id</p>
                              </div>
                              <span className={`rounded-lg border px-3 py-1 font-mono text-lg font-bold ${
                                entry.value >= 0
                                  ? 'border-emerald-700/40 bg-emerald-950/25 text-emerald-200'
                                  : 'border-rose-700/40 bg-rose-950/25 text-rose-200'
                              }`}>
                                {entry.value >= 0 ? '+' : ''}{entry.value}
                              </span>
                            </div>
                            {pendingUnassignedAttributeId === entry.referenceId && (
                              <div
                                className="mb-3 rounded-xl border border-sky-700/35 bg-stone-950/75 p-3"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-sky-300">
                                  Add `{entry.referenceId}` to:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    { key: 'main', label: 'Main' },
                                    { key: 'secondary', label: 'Secondary' },
                                    { key: 'skills', label: 'Skills' },
                                    { key: 'other', label: 'Other' },
                                    { key: 'resistances', label: 'Resistances' },
                                  ].map((target) => (
                                    <button
                                      key={target.key}
                                      onClick={() => addUnassignedAttributeToTab(entry.referenceId, target.key as 'main' | 'secondary' | 'skills' | 'other' | 'resistances')}
                                      className="rounded-lg border border-sky-700/35 bg-sky-900/20 px-3 py-1.5 text-xs font-bold text-sky-100 hover:bg-sky-800/35 cursor-pointer"
                                      style={{ fontFamily: "'Cinzel', serif" }}
                                    >
                                      {target.label}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => setPendingUnassignedAttributeId(null)}
                                    className="rounded-lg border border-stone-700/50 bg-stone-900/50 px-3 py-1.5 text-xs text-stone-300 hover:text-stone-100 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="space-y-1.5">
                              {entry.entries.map((historyEntry, index) => (
                                <div key={`${entry.referenceId}-unassigned-${index}`} className="flex items-center justify-between gap-3 text-xs">
                                  {historyEntry.sourceAnchorId ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        jumpToHistorySource(historyEntry.sourceAnchorId!);
                                      }}
                                      className="text-left text-sky-100/85 underline decoration-sky-500/40 underline-offset-2 hover:text-sky-300 cursor-pointer"
                                    >
                                      {historyEntry.label}
                                    </button>
                                  ) : (
                                    <span className="text-sky-100/85">{historyEntry.label}</span>
                                  )}
                                  <span className={`font-mono ${historyEntry.value >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                    {historyEntry.value >= 0 ? '+' : ''}{historyEntry.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          </>
          )}

            {activeSheetTab === 'statuses' && (
            <div className="border border-orange-700/35 bg-gradient-to-br from-orange-950/30 via-black/25 to-amber-950/20 p-6 rounded-2xl relative overflow-hidden shadow-[0_18px_50px_rgba(120,53,15,0.18)]">
              <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-orange-400/80 via-amber-500/50 to-transparent"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between border-b border-orange-700/30 pb-3 mb-4">
                  <div>
                    <div className="inline-flex items-center rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-orange-200 mb-2">
                      Conditions
                    </div>
                    <h3 className="text-xl font-bold text-orange-200" style={{ fontFamily: "'Cinzel', serif" }}>
                      ✦ Statuses & Effects
                    </h3>
                    <p className="text-xs text-orange-100/55 mt-1">Temporary conditions, active modifiers, and encounter-state effects.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openHomebrewLibrary('statuses')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-900/30 border border-indigo-800/40 rounded text-xs text-indigo-200 hover:bg-indigo-900/50 cursor-pointer"
                    >
                      <Share2 size={13} /> Share Web
                    </button>
                    {activeStatusCategoryId && (
                      <button
                        onClick={() => addStatus(activeStatusCategoryId)}
                        className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                      >
                        + Add Status to {activeStatusCategory?.name || 'Category'}
                      </button>
                    )}
                  </div>
                </div>

                {!activeStatusCategoryId && renderFolderTree(statusFolders, {
                  editable: isCharacterOwner,
                  emptyLabel: 'No status categories yet. Add a folder here and it will become a status tab.',
                  title: 'Status Categories',
                  description: 'Root folders appear as status category tabs. Subfolders stay inside their category.',
                  addLabel: '+ Add Category',
                  showChildren: false,
                  onAddRoot: () => addStatusFolder(),
                  onAddChild: (parentId) => addStatusFolder(parentId),
                  onMove: moveStatusFolder,
                  onUpdate: updateStatusFolder,
                  onRemove: removeStatusFolder,
                })}

                {!activeStatusCategoryId && (
                  <div className="mb-6 rounded-xl border border-orange-800/20 bg-black/20 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-lg font-bold text-orange-100" style={{ fontFamily: "'Cinzel', serif" }}>General Statuses</h4>
                        <p className="text-sm text-stone-500">Statuses and effects that are not assigned to a category.</p>
                      </div>
                      {isCharacterOwner && (
                        <button
                          onClick={() => addStatus(null)}
                          className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                        >
                          + Add General Status
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {activeStatusCategoryId && (
                  <div className="mb-6">
                    {renderFolderTree(statusFolders, {
                      editable: isCharacterOwner,
                      emptyLabel: `No subfolders in ${activeStatusCategory?.name || 'this category'} yet.`,
                      title: `${activeStatusCategory?.name || 'Category'} Subfolders`,
                      description: 'Subfolders organize this category only and do not appear in the category bar.',
                      addLabel: '+ Add Subfolder',
                      rootParentId: activeStatusCategoryId,
                      onAddRoot: () => addStatusFolder(activeStatusCategoryId),
                      onAddChild: (parentId) => addStatusFolder(parentId),
                      onMove: moveStatusFolder,
                      onUpdate: updateStatusFolder,
                      onRemove: removeStatusFolder,
                    })}
                  </div>
                )}

                <div className="space-y-4">
                  {visibleStatusItems.length === 0 ? (
                    <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      {activeStatusCategoryId
                        ? `No statuses in ${activeStatusCategory?.name || 'this category'} yet.`
                        : 'No general statuses yet.'}
                    </div>
                  ) : visibleStatusItems
                    .sort((a, b) => {
                      const orderA = getFolderOrderIndex(statusFolders, a.folderId);
                      const orderB = getFolderOrderIndex(statusFolders, b.folderId);
                      if (orderA !== orderB) return orderA - orderB;
                      return charStatuses.findIndex(status => status.id === a.id) - charStatuses.findIndex(status => status.id === b.id);
                    })
                    .map((status, idx, visibleStatuses) => {
                    const actualIndex = charStatuses.findIndex(item => item.id === status.id);
                    const collapsedAncestorId = getCollapsedFolderAncestor(statusFolders, collapsedStatusFolders, status.folderId);
                    const effectiveFolderId = collapsedAncestorId ?? status.folderId ?? null;
                    const previousCollapsedAncestorId = idx > 0 ? getCollapsedFolderAncestor(statusFolders, collapsedStatusFolders, visibleStatuses[idx - 1].folderId) : null;
                    const previousFolderId = idx > 0 ? (previousCollapsedAncestorId ?? visibleStatuses[idx - 1].folderId ?? null) : null;
                    const folderLabel = getFolderPathLabel(statusFolders, effectiveFolderId);
                    const folderDepth = getFolderDepth(statusFolders, effectiveFolderId);
                    const isFolderSectionCollapsed = !!collapsedAncestorId;
                    const shouldShowFolderHeader = !!folderLabel && effectiveFolderId !== activeStatusCategoryId;
                    const isStatusActive = status.active ?? true;
                    return (
                    <React.Fragment key={status.id}>
                    {shouldShowFolderHeader && previousFolderId !== effectiveFolderId && (
                      <div
                        className="relative rounded-lg border px-4 py-2 text-sm font-bold tracking-wide text-amber-100 flex items-center justify-between gap-3"
                        style={{
                          marginLeft: `${Math.max(0, folderDepth - 1) * 20}px`,
                          borderColor: `${statusFolders.find(folder => folder.id === effectiveFolderId)?.color || '#f59e0b'}55`,
                          background: `${statusFolders.find(folder => folder.id === effectiveFolderId)?.color || '#f59e0b'}18`,
                        }}
                      >
                        {folderDepth > 0 && (
                          <div
                            className="absolute -left-4 top-1/2 h-px w-4"
                            style={{ backgroundColor: `${statusFolders.find(folder => folder.id === effectiveFolderId)?.color || '#f59e0b'}88` }}
                          />
                        )}
                        <span>{folderLabel}</span>
                        <button
                          onClick={() => effectiveFolderId && setCollapsedStatusFolders(prev => prev.includes(effectiveFolderId) ? prev.filter(id => id !== effectiveFolderId) : [...prev, effectiveFolderId])}
                          className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer shrink-0"
                        >
                          {isFolderSectionCollapsed ? 'Show' : 'Collapse'}
                        </button>
                      </div>
                    )}
                    {!isFolderSectionCollapsed && (
                    <div className="relative" style={{ marginLeft: `${folderDepth * 20}px` }}>
                    {effectiveFolderId && (
                      <div
                        className="absolute -left-4 top-0 bottom-0 w-px"
                        style={{ background: `linear-gradient(to bottom, ${statusFolders.find(folder => folder.id === effectiveFolderId)?.color || '#f59e0b'}aa, ${statusFolders.find(folder => folder.id === effectiveFolderId)?.color || '#f59e0b'}22)` }}
                      />
                    )}
                    {actualIndex >= 0 && (
                    <div id={`status-${status.id}`} key={status.id} className={`rounded-xl p-4 shadow-lg flex flex-col gap-3 border transition-opacity ${isStatusActive ? '' : 'opacity-60'}`} style={{ background: `linear-gradient(135deg, ${(status.color || '#f59e0b')}22, rgba(69, 26, 3, 0.18))`, borderColor: `${status.color || '#f59e0b'}55` }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-white/30"
                            style={{ backgroundColor: status.color || '#f59e0b' }}
                          />
                          <span className="text-xs uppercase tracking-[0.22em] text-stone-300">Status Card</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateStatus(status.id, current => ({ ...current, hidden: !current.hidden }))}
                            className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                          >
                            {status.hidden ? 'Show' : 'Hide'}
                          </button>
                          <button
                            onClick={() => shareStatus(status)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sky-300 hover:text-sky-200 border border-sky-800/30 rounded hover:bg-sky-900/20 cursor-pointer"
                          >
                            <Share2 size={12} /> Share
                          </button>
                          <button
                            onClick={() => openHomebrewViewer('status', status.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-800/30 rounded hover:bg-indigo-900/20 cursor-pointer"
                          >
                            <Share2 size={12} /> Share Web
                          </button>
                          <button
                            onClick={() => exportCharacterEntry('status', status, statusFolders.find(folder => folder.id === status.folderId)?.name || null)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-800/30 rounded hover:bg-emerald-900/20 cursor-pointer"
                          >
                            Export
                          </button>
                          <button
                            onClick={() => openSendToParty('status', status)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-cyan-300 hover:text-cyan-200 border border-cyan-800/30 rounded hover:bg-cyan-900/20 cursor-pointer"
                          >
                            Send to Party
                          </button>
                          {isCharacterOwner && (
                            <>
                              <button
                                onClick={() => moveStatus(status.id, 'up')}
                                disabled={idx === 0}
                                className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <ArrowUp size={15} />
                              </button>
                              <button
                                onClick={() => moveStatus(status.id, 'down')}
                                disabled={idx === visibleStatuses.length - 1}
                                className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <ArrowDown size={15} />
                              </button>
                              <button
                                onClick={() => removeStatus(status.id)}
                                className="p-1 text-stone-500 hover:text-red-400 cursor-pointer"
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-3 items-end">
                        {renderActionField('Active', (
                          <button
                            onClick={() => updateStatus(status.id, current => ({ ...current, active: !(current.active ?? true) }))}
                            disabled={!isCharacterOwner}
                            className={`h-10 w-10 shrink-0 rounded-lg border grid place-items-center transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                              isStatusActive
                                ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200 shadow-[0_0_16px_rgba(16,185,129,0.28)]'
                                : 'border-stone-700 bg-stone-950/70 text-stone-600 hover:text-stone-400'
                            }`}
                            title={isStatusActive ? 'Status active: effects are applied' : 'Status inactive: effects are ignored'}
                          >
                            <Shield size={17} fill={isStatusActive ? 'currentColor' : 'none'} />
                          </button>
                        ), 'min-w-[48px]')}
                        {renderActionField('Status Name', (
                          <input
                            type="text"
                            value={status.name}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, name: e.target.value }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            placeholder="Status name"
                          />
                        ), 'min-w-[220px] flex-1')}
                        {renderActionField('Duration Type', (
                          <select
                            value={getStatusDurationType(status)}
                            onChange={(e) => {
                              const nextType = e.target.value as CharacterStatusDurationType;
                              updateStatus(status.id, current => ({
                                ...current,
                                durationType: nextType,
                                duration: nextType === 'custom'
                                  ? current.duration
                                  : (/^-?\d+(\.\d+)?$/.test(current.duration || '') ? current.duration : '1'),
                              }));
                            }}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                          >
                            {STATUS_DURATION_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ), 'min-w-[150px]')}
                        {renderActionField('Duration', (
                          <input
                            type={getStatusDurationType(status) === 'custom' ? 'text' : 'number'}
                            min={getStatusDurationType(status) === 'custom' ? undefined : 0}
                            step={getStatusDurationType(status) === 'minute' ? 0.1 : getStatusDurationType(status) === 'custom' ? undefined : 1}
                            value={status.duration}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, duration: e.target.value }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            placeholder={getStatusDurationType(status) === 'custom' ? 'Duration' : 'Amount'}
                          />
                        ), 'min-w-[120px]')}
                        {renderActionField('Max Duration', (
                          <input
                            type="text"
                            value={status.maxDuration || ''}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, maxDuration: e.target.value }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            placeholder="Max duration"
                            title="Optional cap used when this status replenishes"
                          />
                        ), 'min-w-[130px]')}
                        {renderActionField('At 0', (
                          <select
                            value={getStatusDurationEndBehavior(status)}
                            onChange={(e) => updateStatus(status.id, current => ({
                              ...current,
                              durationEndBehavior: e.target.value as CharacterStatusDurationEndBehavior,
                            }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            title="What happens when typed duration reaches 0"
                          >
                            {STATUS_DURATION_END_BEHAVIOR_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ), 'min-w-[160px]')}
                        {renderActionField('Replenish On', (
                          <select
                            value={status.replenishTrigger || 'custom'}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, replenishTrigger: e.target.value as CharacterReplenishTrigger }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            title="When this status duration replenishes"
                          >
                            {REPLENISH_TRIGGER_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ), 'min-w-[150px]')}
                        {renderActionField('Replenish Amount', (
                          <input
                            type="text"
                            value={status.replenishAmount || ''}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, replenishAmount: e.target.value }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            placeholder="Replenish amount"
                          />
                        ), 'min-w-[150px]')}
                        {renderActionField('Color', (
                          <input
                            type="color"
                            value={status.color || '#f59e0b'}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, color: e.target.value }))}
                            disabled={!isCharacterOwner}
                            className="h-10 w-14 bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer disabled:opacity-60"
                          />
                        ), 'min-w-[64px]')}
                        {renderActionField('Category', (
                          <select
                            value={status.folderId ?? ''}
                            onChange={(e) => updateStatus(status.id, current => ({ ...current, folderId: e.target.value || null }))}
                            disabled={!isCharacterOwner}
                            className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                          >
                            <option value="">General Statuses</option>
                            {getFolderOptions(statusFolders).map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ), 'min-w-[200px]')}
                      </div>
                      {!status.hidden && (
                      <>
                      <textarea
                        ref={(el) => { statusDescriptionRefs.current[status.id] = el; }}
                        value={status.description}
                        onChange={(e) => {
                          const next = [...charStatuses];
                          next[actualIndex].description = e.target.value;
                          setCharStatuses(next);
                        }}
                        placeholder="Description of the status"
                        rows={expandedStatusDescriptions.includes(status.id) ? 2 : 6}
                        className="w-full bg-stone-900/60 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none"
                      />
                      <button
                        onClick={() => toggleStatusDescription(status.id)}
                        className="text-base text-amber-300 hover:text-amber-200 cursor-pointer self-start"
                      >
                        {expandedStatusDescriptions.includes(status.id) ? 'Show More' : 'Hide'}
                      </button>

                      {renderLocalVariablesEditor(
                        status.localVariables,
                        (kind) => addStatusLocalVariable(status.id, kind),
                        (variableIndex, updater) => updateStatusLocalVariable(status.id, variableIndex, updater),
                        (variableIndex) => removeStatusLocalVariable(status.id, variableIndex),
                        isCharacterOwner
                      )}

                      {renderEmbeddedScriptsEditor(
                        status.scripts,
                        () => importScriptEntry(
                          script => updateStatus(status.id, current => ({ ...current, scripts: [...(current.scripts || []), script] })),
                          status.localVariables
                        ),
                        (scriptIndex) => updateStatus(status.id, current => ({ ...current, scripts: (current.scripts || []).filter((_, index) => index !== scriptIndex) })),
                        isCharacterOwner
                      )}

                      {/* Effects area */}
                      <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-base font-bold text-stone-300">Effects</label>
                          {isCharacterOwner && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => {
                                  const next = [...charStatuses];
                                  next[actualIndex].effects = [...(next[actualIndex].effects || []), createAttributeEffect()];
                                  setCharStatuses(next);
                                }}
                                className="text-sm bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300"
                              >
                                + Add Effect
                              </button>
                              <button
                                onClick={() => importStatusApplyEffect(effect => {
                                  const next = [...charStatuses];
                                  next[actualIndex].effects = [...(next[actualIndex].effects || []), effect];
                                  setCharStatuses(next);
                                })}
                                className="text-sm bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300"
                              >
                                + Add Status
                              </button>
                              <button
                                onClick={() => {
                                  const next = [...charStatuses];
                                  next[actualIndex].effects = [...(next[actualIndex].effects || []), buildBarUpdateEffect()];
                                  setCharStatuses(next);
                                }}
                                className="text-sm bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300"
                              >
                                + Bar Update
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          {(status.effects || []).map((effect, effIdx) => renderEffectEditorRow(
                            effect,
                            effIdx,
                            (index, updater) => {
                              const next = [...charStatuses];
                              next[actualIndex].effects[index] = updater(next[actualIndex].effects[index]);
                              setCharStatuses(next);
                            },
                            (index) => {
                              const next = [...charStatuses];
                              next[actualIndex].effects = next[actualIndex].effects.filter((_, i) => i !== index);
                              setCharStatuses(next);
                            },
                            isCharacterOwner,
                            'Target ID (e.g. wis_mod)',
                            'Value (e.g. -2)',
                            status.localVariables
                          ))}
                          {(status.effects || []).length === 0 && <span className="text-[10px] text-stone-600 italic">No effects added.</span>}
                        </div>
                      </div>
                      {renderStatusActionsEditor(status, isCharacterOwner)}
                      </>
                      )}
                    </div>
                    )}
                    </div>
                    )}
                    </React.Fragment>
                  )})}
                </div>
              </div>
            </div>
            )}

                {activeSheetTab === 'inventory' && (
                <div className="rounded-2xl border border-sky-800/30 bg-gradient-to-br from-sky-950/28 via-black/20 to-cyan-950/18 p-6 relative overflow-hidden shadow-[0_18px_50px_rgba(8,47,73,0.16)]">
                  <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-sky-400/80 via-cyan-500/45 to-transparent"></div>
                  <div className="flex items-center justify-between border-b border-sky-800/30 pb-3 mb-4 relative z-10">
                    <div>
                      <div className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-sky-200 mb-2">
                        Gear
                      </div>
                      <h3 className="text-xl font-bold text-sky-100" style={{ fontFamily: "'Cinzel', serif" }}>
                        ✦ Inventory
                      </h3>
                      <p className="text-xs text-sky-100/55 mt-1">
                        Weapons, armor, trinkets, and item actions. Folder groups show loadout structure at a glance.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openHomebrewLibrary('inventory')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-900/30 border border-indigo-800/40 rounded text-xs text-indigo-200 hover:bg-indigo-900/50 cursor-pointer"
                      >
                        <Share2 size={13} /> Share Web
                      </button>
                      {canEditInventory && activeInventoryCategoryId && (
                        <button
                          onClick={() => addInventoryItem(activeInventoryCategoryId)}
                          className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                        >
                          + Add Item to {activeInventoryCategory?.name || 'Category'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!canEditInventory && (
                    <div className="mb-3 text-sm text-stone-500 italic">
                      Inventory can be edited by the owner, or by anyone when the character is public.
                    </div>
                  )}

                  {!activeInventoryCategoryId && renderFolderTree(inventoryFolders, {
                    editable: canEditInventory,
                    emptyLabel: 'No inventory categories yet. Add a folder here and it will become an inventory tab.',
                    title: 'Inventory Categories',
                    description: 'Root folders appear as inventory category tabs. Subfolders stay inside their category.',
                    addLabel: '+ Add Category',
                    showChildren: false,
                    onAddRoot: () => addInventoryFolder(),
                    onAddChild: (parentId) => addInventoryFolder(parentId),
                    onMove: moveInventoryFolder,
                    onUpdate: updateInventoryFolder,
                    onRemove: removeInventoryFolder,
                  })}

                  {!activeInventoryCategoryId && (
                  <div className="mb-6 rounded-xl border border-amber-800/20 bg-black/20 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-lg font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>General Items</h4>
                        <p className="text-sm text-stone-500">Simple shared items like potions, rations, or keys.</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openHomebrewLibrary('general-items')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-900/30 border border-indigo-800/40 rounded text-xs text-indigo-200 hover:bg-indigo-900/50 cursor-pointer"
                        >
                          <Share2 size={13} /> Share Web
                        </button>
                        {canEditInventory && (
                          <button
                            onClick={addGeneralItem}
                            className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-sm text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                          >
                            + Add General Item
                          </button>
                        )}
                      </div>
                    </div>
                    {charGeneralItems.length === 0 ? (
                      <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                        No general items yet.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {charGeneralItems.map((item, itemIndex) => {
                          const itemState = normalizeGeneralItem(item);
                          const isExpanded = expandedGeneralItemDescriptions.includes(item.id);
                          const rarityKey = itemState.rarity || 'common';
                          const rarityStyle = INVENTORY_RARITY_STYLES[rarityKey];
                          return (
                            <div id={`general-item-${item.id}`} key={item.id} className={`relative border rounded-xl p-4 shadow-lg flex flex-col gap-3 transition-all ${rarityStyle.card} ${itemState.equipped ? 'ring-1 ring-amber-300/40 shadow-amber-300/10' : ''}`}>
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] border rounded-full ${rarityStyle.badge}`}>
                                    {rarityStyle.label}
                                  </span>
                                  {itemState.equipped && (
                                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] border rounded-full bg-amber-400/20 text-amber-100 border-amber-300/40">
                                      Equipped
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => updateGeneralItem(item.id, current => ({ ...current, hidden: !current.hidden }))}
                                    className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                                  >
                                    {itemState.hidden ? 'Show' : 'Hide'}
                                  </button>
                                  <button
                                    onClick={() => shareGeneralItem(itemState)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sky-300 hover:text-sky-200 border border-sky-800/30 rounded hover:bg-sky-900/20 cursor-pointer"
                                  >
                                    <Share2 size={12} /> Share
                                  </button>
                                  <button
                                    onClick={() => openHomebrewViewer('general-item', item.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-800/30 rounded hover:bg-indigo-900/20 cursor-pointer"
                                  >
                                    <Share2 size={12} /> Share Web
                                  </button>
                                  <button
                                    onClick={() => exportCharacterEntry('item', itemState, null)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-800/30 rounded hover:bg-emerald-900/20 cursor-pointer"
                                  >
                                    Export
                                  </button>
                                  <button
                                    onClick={() => openSendToParty('item', itemState)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-xs text-cyan-300 hover:text-cyan-200 border border-cyan-800/30 rounded hover:bg-cyan-900/20 cursor-pointer"
                                  >
                                    Send to Party
                                  </button>
                                  {canEditInventory ? (
                                    <>
                                      <button
                                        onClick={() => moveGeneralItem(item.id, 'up')}
                                        disabled={itemIndex === 0}
                                        className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                      >
                                        <ArrowUp size={15} />
                                      </button>
                                      <button
                                        onClick={() => moveGeneralItem(item.id, 'down')}
                                        disabled={itemIndex === charGeneralItems.length - 1}
                                        className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                      >
                                        <ArrowDown size={15} />
                                      </button>
                                      <button
                                        onClick={() => removeGeneralItem(item.id)}
                                        className="p-1 text-stone-600 hover:text-red-400 cursor-pointer"
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </>
                                  ) : null}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-3 items-end">
                                {renderActionField('Item Name', (
                                  <input
                                    type="text"
                                    value={itemState.name}
                                    onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, name: e.target.value }))}
                                    disabled={!canEditInventory}
                                    className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                    placeholder="Item name"
                                  />
                                ), 'min-w-[220px] flex-1')}
                                {renderActionField('Quantity', (
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    min={0}
                                    value={itemState.quantity}
                                    onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, quantity: parseWholeNumberInput(e.target.value) }))}
                                    disabled={!canEditInventory}
                                    className="min-w-0 w-full bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60 font-mono"
                                    placeholder="Qty"
                                    />
                                ), 'w-[11ch] flex-none')}
                                {renderActionField('Equip', (
                                  <button
                                    onClick={() => canEditInventory && updateGeneralItem(item.id, current => ({ ...current, equipped: !current.equipped, status: !current.equipped ? 'equipped' : (current.status === 'equipped' ? 'unequipped' : current.status) }))}
                                    disabled={!canEditInventory}
                                    className={`grid h-[38px] w-full place-items-center rounded border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${itemState.equipped ? 'bg-amber-400/20 border-amber-300/60 text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.35)]' : 'bg-stone-900/60 border-stone-700 text-stone-400 hover:text-amber-200'}`}
                                    title={itemState.equipped ? 'Unequip item' : 'Equip item'}
                                  >
                                    <Shield size={15} />
                                  </button>
                                ), 'w-[44px] flex-none')}
                                {renderActionField('Rarity', (
                                  <select
                                    value={rarityKey}
                                    onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, rarity: e.target.value as CharacterGeneralItem['rarity'] }))}
                                    disabled={!canEditInventory}
                                    className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                  >
                                    {INVENTORY_RARITIES.map((rarity) => (
                                      <option key={rarity} value={rarity}>
                                        {INVENTORY_RARITY_STYLES[rarity].label}
                                      </option>
                                    ))}
                                  </select>
                                ), 'min-w-[180px]')}
                                {renderActionField('Category', (
                                  <select
                                    value="general"
                                    onChange={(e) => {
                                      if (e.target.value !== 'general') {
                                        moveGeneralItemToInventoryFolder(item.id, e.target.value);
                                      }
                                    }}
                                    disabled={!canEditInventory}
                                    className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                  >
                                    <option value="general">General Items</option>
                                    {getFolderOptions(inventoryFolders).map(option => (
                                      <option key={option.id} value={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                ), 'min-w-[200px]')}
                              </div>
                              {!itemState.hidden && (
                              <>
                                <div className="space-y-2">
                                  <textarea
                                    ref={(el) => { generalItemDescriptionRefs.current[item.id] = el; }}
                                    value={itemState.description}
                                    onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, description: e.target.value }))}
                                    disabled={!canEditInventory}
                                    rows={isExpanded ? 2 : 6}
                                    placeholder="Description, lore, notes..."
                                    className="w-full bg-stone-900/60 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                                  />
                                  <div className="flex items-center gap-3">
                                    <button onClick={() => toggleGeneralItemDescription(item.id)} className="text-base text-amber-300 hover:text-amber-200 cursor-pointer">
                                      {isExpanded ? 'Show More' : 'Hide'}
                                    </button>
                                  </div>
                                </div>
                                {renderHomebrewImageControls(
                                  'general-item',
                                  item.id,
                                  itemState.homebrewImageUrl,
                                  itemState.homebrewImageThumbUrl,
                                  canEditInventory
                                )}
                                {renderLocalVariablesEditor(
                                  itemState.localVariables,
                                  (kind) => addGeneralLocalVariable(item.id, kind),
                                  (variableIndex, updater) => updateGeneralLocalVariable(item.id, variableIndex, updater),
                                  (variableIndex) => removeGeneralLocalVariable(item.id, variableIndex),
                                  canEditInventory
                                )}
                                {renderEmbeddedScriptsEditor(
                                  itemState.scripts,
                                  () => importScriptEntry(
                                    script => updateGeneralItem(item.id, current => ({ ...current, scripts: [...(current.scripts || []), script] })),
                                    itemState.localVariables
                                  ),
                                  (scriptIndex) => updateGeneralItem(item.id, current => ({ ...current, scripts: (current.scripts || []).filter((_, index) => index !== scriptIndex) })),
                                  canEditInventory
                                )}
                                <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                                  <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-bold text-stone-300">Item Macros</label>
                                    {canEditInventory && (
                                      <button onClick={() => addGeneralMacro(item.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                                        + Add Macro
                                      </button>
                                    )}
                                  </div>
                                  {(itemState.macros || []).length === 0 ? (
                                    <span className="text-[10px] text-stone-600 italic">No macros added.</span>
                                  ) : (
                                    <div className="space-y-2">
                                      {(itemState.macros || []).map((macro) => (
                                        <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                                          <input value={macro.name} onChange={(e) => updateGeneralMacro(item.id, macro.id, current => ({ ...current, name: e.target.value }))} disabled={!canEditInventory} className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60" />
                                          <input value={macro.formula} onChange={(e) => updateGeneralMacro(item.id, macro.id, current => ({ ...current, formula: e.target.value }))} disabled={!canEditInventory} className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60" />
                                          <button onClick={() => rollGeneralMacro(itemState, macro)} className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer">
                                            <Dices size={12} /> Roll
                                          </button>
                                          {canEditInventory && (
                                            <button onClick={() => removeGeneralMacro(item.id, macro.id)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                                              <Trash2 size={14} />
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                                  <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-bold text-stone-300">Actions</label>
                                    {canEditInventory && (
                                      <button onClick={() => addGeneralAction(item.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                                        + Add Action
                                      </button>
                                    )}
                                  </div>
                                  {(itemState.actions || []).length === 0 ? (
                                    <span className="text-[10px] text-stone-600 italic">No actions added.</span>
                                  ) : (
                                    <div className="space-y-3">
                                      {(itemState.actions || []).map((action) => {
                                        const isActionExpanded = expandedInventoryActionDescriptions.includes(action.id);
                                        return (
                                          <div key={action.id} className="rounded-lg border border-amber-800/15 bg-amber-950/10 p-3">
                                            <div className="flex flex-wrap gap-2 items-start mb-2">
                                              {renderActionField('Name', (
                                                <input value={action.name} onChange={(e) => updateGeneralAction(item.id, action.id, current => ({ ...current, name: e.target.value }))} disabled={!canEditInventory} className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60" placeholder="Action name" />
                                              ), 'min-w-[180px]')}
                                              {renderActionField('Cost', (
                                                <input value={action.cost} onChange={(e) => updateGeneralAction(item.id, action.id, current => ({ ...current, cost: e.target.value }))} disabled={!canEditInventory} className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60" placeholder="Cost" />
                                              ), 'min-w-[140px]')}
                                              {renderActionUsageControls(action, updater => updateGeneralAction(item.id, action.id, updater), canEditInventory)}
                                              {canEditInventory && (
                                                <button onClick={() => removeGeneralAction(item.id, action.id)} className="p-2 text-stone-500 hover:text-red-400 cursor-pointer">
                                                  <Trash2 size={14} />
                                                </button>
                                              )}
                                            </div>
                                            <textarea
                                              ref={(el) => { inventoryActionDescriptionRefs.current[action.id] = el; }}
                                              value={action.description}
                                              onChange={(e) => updateGeneralAction(item.id, action.id, current => ({ ...current, description: e.target.value }))}
                                              disabled={!canEditInventory}
                                              rows={isActionExpanded ? 2 : 6}
                                              className="w-full bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                                              placeholder="Action description"
                                            />
                                            <button onClick={() => toggleInventoryActionDescription(action.id)} className="mt-2 text-sm text-amber-300 hover:text-amber-200 cursor-pointer">
                                              {isActionExpanded ? 'Show More' : 'Hide'}
                                            </button>
                                            <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                                              <div className="flex items-center justify-between mb-2">
                                                <label className="text-sm font-bold text-stone-300">Action Macros</label>
                                                {canEditInventory && (
                                                  <button onClick={() => addGeneralActionMacro(item.id, action.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                                                    + Add Macro
                                                  </button>
                                                )}
                                              </div>
                                              {(action.macros || []).length === 0 ? (
                                                <span className="text-xs text-stone-600 italic">No macros added.</span>
                                              ) : (
                                                <div className="space-y-2">
                                                  {(action.macros || []).map((macro) => (
                                                    <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                                                      <input value={macro.name} onChange={(e) => updateGeneralActionMacro(item.id, action.id, macro.id, current => ({ ...current, name: e.target.value }))} disabled={!canEditInventory} className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60" />
                                                      <input value={macro.formula} onChange={(e) => updateGeneralActionMacro(item.id, action.id, macro.id, current => ({ ...current, formula: e.target.value }))} disabled={!canEditInventory} className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60" />
                                                      <button onClick={() => rollGeneralActionMacro(itemState, action, macro)} className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer">
                                                        <Dices size={12} /> Roll
                                                      </button>
                                                      {canEditInventory && (
                                                        <button onClick={() => removeGeneralActionMacro(item.id, action.id, macro.id)} className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end">
                                                          <Trash2 size={14} />
                                                        </button>
                                                      )}
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                            <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                                              <div className="flex items-center justify-between mb-2">
                                                <label className="text-sm font-bold text-stone-300">Action Effects</label>
                                                {canEditInventory && (
                                                  <div className="flex flex-wrap gap-2">
                                                    <button onClick={() => addGeneralActionEffect(item.id, action.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                                                      + Add Effect
                                                    </button>
                                                    <button
                                                      onClick={() => importStatusApplyEffect(effect => updateGeneralAction(item.id, action.id, current => ({ ...current, effects: [...(current.effects || []), effect] })))}
                                                      className="text-xs bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300 cursor-pointer"
                                                    >
                                                      + Add Status
                                                    </button>
                                                    <button
                                                      onClick={() => updateGeneralAction(item.id, action.id, current => ({ ...current, effects: [...(current.effects || []), buildBarUpdateEffect()] }))}
                                                      className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                                                    >
                                                      + Bar Update
                                                    </button>
                                                  </div>
                                                )}
                                              </div>
                                              {(action.effects || []).length === 0 ? (
                                                <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                                              ) : (
                                                <div className="space-y-2">
                                                  {(action.effects || []).map((effect, effectIndex) => renderEffectEditorRow(
                                                    effect,
                                                    effectIndex,
                                                    (index, updater) => updateGeneralActionEffect(item.id, action.id, index, updater),
                                                    (index) => removeGeneralActionEffect(item.id, action.id, index),
                                                    canEditInventory,
                                                    'Target ID (e.g. str_mod)',
                                                    'Value (e.g. +2)',
                                                    itemState.localVariables
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                                  <div className="flex items-center justify-between mb-2">
                                    <label className="text-sm font-bold text-stone-300">Effects {itemState.equipped ? '(Active)' : '(Inactive until equipped)'}</label>
                                    {canEditInventory && (
                                      <div className="flex flex-wrap gap-2">
                                        <button onClick={() => addGeneralEffect(item.id)} className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer">
                                          + Add Effect
                                        </button>
                                        <button
                                          onClick={() => importStatusApplyEffect(effect => updateGeneralItem(item.id, current => ({ ...current, effects: [...(current.effects || []), effect] })))}
                                          className="text-xs bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300 cursor-pointer"
                                        >
                                          + Add Status
                                        </button>
                                        <button
                                          onClick={() => updateGeneralItem(item.id, current => ({ ...current, effects: [...(current.effects || []), buildBarUpdateEffect()] }))}
                                          className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                                        >
                                          + Bar Update
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {(itemState.effects || []).length === 0 ? (
                                    <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                                  ) : (
                                    <div className="space-y-2">
                                      {(itemState.effects || []).map((effect, effectIndex) => renderEffectEditorRow(
                                        effect,
                                        effectIndex,
                                        (index, updater) => updateGeneralEffect(item.id, index, updater),
                                        (index) => removeGeneralEffect(item.id, index),
                                        canEditInventory,
                                        'Target ID (e.g. str_mod)',
                                        'Value (e.g. +2)',
                                        itemState.localVariables,
                                        true
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  )}

                  {activeInventoryCategoryId && (
                  <div className="mb-6">
                    {renderFolderTree(inventoryFolders, {
                      editable: canEditInventory,
                      emptyLabel: `No subfolders in ${activeInventoryCategory?.name || 'this category'} yet.`,
                      title: `${activeInventoryCategory?.name || 'Category'} Subfolders`,
                      description: 'Subfolders organize this category only and do not appear in the category bar.',
                      addLabel: '+ Add Subfolder',
                      rootParentId: activeInventoryCategoryId,
                      onAddRoot: () => addInventoryFolder(activeInventoryCategoryId),
                      onAddChild: (parentId) => addInventoryFolder(parentId),
                      onMove: moveInventoryFolder,
                      onUpdate: updateInventoryFolder,
                      onRemove: removeInventoryFolder,
                    })}
                  </div>
                  )}

                  {activeInventoryCategoryId && visibleInventoryItems.length === 0 ? (
                    <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      No items in {activeInventoryCategory?.name || 'this category'} yet.
                    </div>
                  ) : activeInventoryCategoryId ? (
                    <div className="space-y-4">
                      {visibleInventoryItems
                        .sort((a, b) => {
                          const orderA = getFolderOrderIndex(inventoryFolders, a.folderId);
                          const orderB = getFolderOrderIndex(inventoryFolders, b.folderId);
                          if (orderA !== orderB) return orderA - orderB;
                          return charInventory.findIndex(item => item.id === a.id) - charInventory.findIndex(item => item.id === b.id);
                        })
                        .map((item, itemIndex, visibleInventory) => {
                        const collapsedAncestorId = getCollapsedFolderAncestor(inventoryFolders, collapsedInventoryFolders, item.folderId);
                        const effectiveFolderId = collapsedAncestorId ?? item.folderId ?? null;
                        const previousCollapsedAncestorId = itemIndex > 0 ? getCollapsedFolderAncestor(inventoryFolders, collapsedInventoryFolders, visibleInventory[itemIndex - 1].folderId) : null;
                        const previousFolderId = itemIndex > 0 ? (previousCollapsedAncestorId ?? visibleInventory[itemIndex - 1].folderId ?? null) : null;
                        const rarityKey = item.rarity || 'common';
                        const rarityStyle = INVENTORY_RARITY_STYLES[rarityKey];
                        const isDescriptionExpanded = expandedInventoryDescriptions.includes(item.id);
                        const isCollapsed = collapsedInventoryItems.includes(item.id);
                        const folderLabel = getFolderPathLabel(inventoryFolders, effectiveFolderId);
                        const folderDepth = getFolderDepth(inventoryFolders, effectiveFolderId);
                        const isFolderSectionCollapsed = !!collapsedAncestorId;
                        const shouldShowFolderHeader = !!folderLabel && effectiveFolderId !== activeInventoryCategoryId;
                        return (
                        <React.Fragment key={item.id}>
                        {shouldShowFolderHeader && previousFolderId !== effectiveFolderId && (
                          <div
                            className="relative rounded-lg border px-4 py-2 text-sm font-bold tracking-wide text-amber-100 flex items-center justify-between gap-3"
                            style={{
                              marginLeft: `${Math.max(0, folderDepth - 1) * 20}px`,
                              borderColor: `${inventoryFolders.find(folder => folder.id === effectiveFolderId)?.color || '#b45309'}55`,
                              background: `${inventoryFolders.find(folder => folder.id === effectiveFolderId)?.color || '#b45309'}18`,
                            }}
                          >
                            {folderDepth > 0 && (
                              <div
                                className="absolute -left-4 top-1/2 h-px w-4"
                                style={{ backgroundColor: `${inventoryFolders.find(folder => folder.id === effectiveFolderId)?.color || '#b45309'}88` }}
                              />
                            )}
                            <span>{folderLabel}</span>
                            <button
                              onClick={() => effectiveFolderId && setCollapsedInventoryFolders(prev => prev.includes(effectiveFolderId) ? prev.filter(id => id !== effectiveFolderId) : [...prev, effectiveFolderId])}
                              className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer shrink-0"
                            >
                              {isFolderSectionCollapsed ? 'Show' : 'Collapse'}
                            </button>
                          </div>
                        )}
                        {!isFolderSectionCollapsed && (
                        <div className="relative" style={{ marginLeft: `${folderDepth * 20}px` }}>
                        {effectiveFolderId && (
                          <div
                            className="absolute -left-4 top-0 bottom-0 w-px"
                            style={{ background: `linear-gradient(to bottom, ${inventoryFolders.find(folder => folder.id === effectiveFolderId)?.color || '#b45309'}aa, ${inventoryFolders.find(folder => folder.id === effectiveFolderId)?.color || '#b45309'}22)` }}
                          />
                        )}
                        <div id={`inventory-item-${item.id}`} className={`relative border rounded-xl p-4 shadow-lg flex flex-col gap-3 transition-all ${rarityStyle.card} ${item.equipped ? 'ring-1 ring-amber-300/40 shadow-amber-300/10' : ''}`}>
                          {effectiveFolderId && (
                            <div
                              className="absolute -left-4 top-7 h-px w-4"
                              style={{ backgroundColor: `${inventoryFolders.find(folder => folder.id === effectiveFolderId)?.color || '#b45309'}88` }}
                            />
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] border rounded-full ${rarityStyle.badge}`}>
                                {rarityStyle.label}
                              </span>
                              {item.equipped && (
                                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] border rounded-full bg-amber-400/20 text-amber-100 border-amber-300/40">
                                  Equipped
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => toggleInventoryItemCollapsed(item.id)}
                                className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                              >
                                {isCollapsed ? 'Show' : 'Hide'}
                              </button>
                              <button
                                onClick={() => shareInventoryItem(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sky-300 hover:text-sky-200 border border-sky-800/30 rounded hover:bg-sky-900/20 cursor-pointer"
                              >
                                <Share2 size={12} /> Share
                              </button>
                              <button
                                onClick={() => openHomebrewViewer('inventory-item', item.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-800/30 rounded hover:bg-indigo-900/20 cursor-pointer"
                              >
                                <Share2 size={12} /> Share Web
                              </button>
                              <button
                                onClick={() => exportCharacterEntry('item', item, inventoryFolders.find(folder => folder.id === item.folderId)?.name || null)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-800/30 rounded hover:bg-emerald-900/20 cursor-pointer"
                              >
                                Export
                              </button>
                              <button
                                onClick={() => openSendToParty('item', item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-cyan-300 hover:text-cyan-200 border border-cyan-800/30 rounded hover:bg-cyan-900/20 cursor-pointer"
                              >
                                Send to Party
                              </button>
                              {canEditInventory ? (
                                <>
                                  <button
                                    onClick={() => moveInventoryItem(item.id, 'up')}
                                    disabled={itemIndex === 0}
                                    className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                  >
                                    <ArrowUp size={15} />
                                  </button>
                                  <button
                                    onClick={() => moveInventoryItem(item.id, 'down')}
                                    disabled={itemIndex === visibleInventory.length - 1}
                                    className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                  >
                                    <ArrowDown size={15} />
                                  </button>
                                  <button
                                    onClick={() => removeInventoryItem(item.id)}
                                    className="p-1 text-stone-600 hover:text-red-400 cursor-pointer"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-3 items-end">
                            {renderActionField('Item Name', (
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, name: e.target.value }))}
                                disabled={!canEditInventory}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="Item name"
                              />
                            ), 'min-w-[220px] flex-1')}
                            {renderActionField('Quantity', (
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  min={0}
                                  value={item.quantity}
                                  onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, quantity: parseWholeNumberInput(e.target.value) }))}
                                  disabled={!canEditInventory}
                                  className="min-w-0 w-full bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60 font-mono"
                                  placeholder="Qty"
                                />
                            ), 'w-[11ch] flex-none')}
                            {renderActionField('Equip', (
                              <button
                                onClick={() => canEditInventory && updateInventoryItem(item.id, current => ({ ...current, equipped: !current.equipped, status: !current.equipped ? 'equipped' : (current.status === 'equipped' ? 'unequipped' : current.status) }))}
                                disabled={!canEditInventory}
                                className={`grid h-[38px] w-full place-items-center rounded border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${item.equipped ? 'bg-amber-400/20 border-amber-300/60 text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.35)]' : 'bg-stone-900/60 border-stone-700 text-stone-400 hover:text-amber-200'}`}
                                title={item.equipped ? 'Unequip item' : 'Equip item'}
                              >
                                <Shield size={15} />
                              </button>
                            ), 'w-[44px] flex-none')}
                            {renderActionField('Rarity', (
                              <select
                                value={rarityKey}
                                onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, rarity: e.target.value as CharacterInventoryItem['rarity'] }))}
                                disabled={!canEditInventory}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              >
                                {INVENTORY_RARITIES.map((rarity) => (
                                  <option key={rarity} value={rarity}>
                                    {INVENTORY_RARITY_STYLES[rarity].label}
                                  </option>
                                ))}
                              </select>
                            ), 'min-w-[180px]')}
                            {renderActionField('Category', (
                              <select
                                value={item.folderId ?? 'general'}
                                onChange={(e) => {
                                  if (e.target.value === 'general') {
                                    moveInventoryItemToGeneralItems(item.id);
                                    return;
                                  }
                                  updateInventoryItem(item.id, current => ({ ...current, folderId: e.target.value }));
                                }}
                                disabled={!canEditInventory}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              >
                                <option value="general">General Items</option>
                                {getFolderOptions(inventoryFolders).map(option => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ), 'min-w-[200px]')}
                          </div>

                          {!isCollapsed && (
                          <>
                          <div className="space-y-2">
                            <textarea
                              ref={(el) => { inventoryDescriptionRefs.current[item.id] = el; }}
                              value={item.description}
                              onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, description: e.target.value }))}
                              disabled={!canEditInventory}
                              placeholder="Description, lore, notes..."
                              rows={isDescriptionExpanded ? 2 : 6}
                              className="w-full bg-stone-900/60 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                            />
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => toggleInventoryDescription(item.id)}
                                className="text-base text-amber-300 hover:text-amber-200 cursor-pointer"
                              >
                                {isDescriptionExpanded ? 'Show More' : 'Hide'}
                              </button>
                            </div>
                          </div>

                          {renderHomebrewImageControls(
                            'inventory-item',
                            item.id,
                            item.homebrewImageUrl,
                            item.homebrewImageThumbUrl,
                            canEditInventory
                          )}

                          {renderLocalVariablesEditor(
                            item.localVariables,
                            (kind) => addInventoryLocalVariable(item.id, kind),
                            (variableIndex, updater) => updateInventoryLocalVariable(item.id, variableIndex, updater),
                            (variableIndex) => removeInventoryLocalVariable(item.id, variableIndex),
                            canEditInventory
                          )}

                          {renderEmbeddedScriptsEditor(
                            item.scripts,
                            () => importScriptEntry(
                              script => updateInventoryItem(item.id, current => ({ ...current, scripts: [...(current.scripts || []), script] })),
                              item.localVariables
                            ),
                            (scriptIndex) => updateInventoryItem(item.id, current => ({ ...current, scripts: (current.scripts || []).filter((_, index) => index !== scriptIndex) })),
                            canEditInventory
                          )}

                          <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm font-bold text-stone-300">Item Macros</label>
                              {canEditInventory && (
                                <button
                                  onClick={() => addInventoryMacro(item.id)}
                                  className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                >
                                  + Add Macro
                                </button>
                              )}
                            </div>
                            {(item.macros || []).length === 0 ? (
                              <span className="text-[10px] text-stone-600 italic">No macros added.</span>
                            ) : (
                              <div className="space-y-2">
                                {(item.macros || []).map((macro) => (
                                  <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                                    <input
                                      type="text"
                                      value={macro.name}
                                      onChange={(e) => updateInventoryMacro(item.id, macro.id, current => ({ ...current, name: e.target.value }))}
                                      disabled={!canEditInventory}
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                      placeholder="Attack Roll"
                                    />
                                    <input
                                      type="text"
                                      value={macro.formula}
                                      onChange={(e) => updateInventoryMacro(item.id, macro.id, current => ({ ...current, formula: e.target.value }))}
                                      disabled={!canEditInventory}
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
                                      placeholder="1d20 + @dex_mod"
                                    />
                                    <button
                                      onClick={() => rollInventoryMacro(item, macro)}
                                      className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer"
                                    >
                                      <Dices size={12} /> Roll
                                    </button>
                                    {canEditInventory ? (
                                      <button
                                        onClick={() => removeInventoryMacro(item.id, macro.id)}
                                        className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    ) : (
                                      <div />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm font-bold text-stone-300">Actions</label>
                              {canEditInventory && (
                                <button
                                  onClick={() => addInventoryAction(item.id)}
                                  className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                >
                                  + Add Action
                                </button>
                              )}
                            </div>
                            {(item.actions || []).length === 0 ? (
                              <span className="text-xs text-stone-600 italic">No actions added.</span>
                            ) : (
                              <div className="space-y-3">
                                {(item.actions || []).map((action) => {
                                  const isExpanded = expandedInventoryActionDescriptions.includes(action.id);
                                  return (
                                    <div key={action.id} className="rounded-lg border border-amber-800/15 bg-amber-950/10 p-3">
                                      <div className="flex flex-wrap gap-2 items-start mb-2">
                                        {renderActionField('Name', (
                                          <input
                                            type="text"
                                            value={action.name}
                                            onChange={(e) => updateInventoryAction(item.id, action.id, current => ({ ...current, name: e.target.value }))}
                                            disabled={!canEditInventory}
                                            placeholder="Action name"
                                            className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                          />
                                        ), 'min-w-[180px]')}
                                        {renderActionField('Cost', (
                                          <input
                                            type="text"
                                            value={action.cost}
                                            onChange={(e) => updateInventoryAction(item.id, action.id, current => ({ ...current, cost: e.target.value }))}
                                            disabled={!canEditInventory}
                                            placeholder="Cost"
                                            className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                          />
                                        ), 'min-w-[140px]')}
                                        {renderActionUsageControls(action, updater => updateInventoryAction(item.id, action.id, updater), canEditInventory)}
                                        <button
                                          onClick={() => shareInventoryAction(item, action)}
                                          className="inline-flex items-center gap-1 px-3 py-2 bg-sky-900/30 border border-sky-800/40 rounded text-sm text-sky-200 hover:bg-sky-900/50 cursor-pointer"
                                        >
                                          <Share2 size={14} /> Share
                                        </button>
                                        {canEditInventory && (
                                          <button
                                            onClick={() => removeInventoryAction(item.id, action.id)}
                                            className="p-2 text-stone-500 hover:text-red-400 cursor-pointer"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </div>
                                      <textarea
                                        ref={(el) => { inventoryActionDescriptionRefs.current[action.id] = el; }}
                                        value={action.description}
                                        onChange={(e) => updateInventoryAction(item.id, action.id, current => ({ ...current, description: e.target.value }))}
                                        disabled={!canEditInventory}
                                        rows={isExpanded ? 2 : 6}
                                        placeholder="Action description"
                                        className="w-full bg-stone-900 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                                      />
                                      <button
                                        onClick={() => toggleInventoryActionDescription(action.id)}
                                        className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer"
                                      >
                                        {isExpanded ? 'Show More' : 'Hide'}
                                      </button>
                                      <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                                        <div className="flex justify-between items-center mb-2">
                                          <label className="text-sm font-bold text-stone-300">Action Macros</label>
                                          {canEditInventory && (
                                            <button
                                              onClick={() => addInventoryActionMacro(item.id, action.id)}
                                              className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                            >
                                              + Add Macro
                                            </button>
                                          )}
                                        </div>
                                        {(action.macros || []).length === 0 ? (
                                          <span className="text-xs text-stone-600 italic">No macros added.</span>
                                        ) : (
                                          <div className="space-y-2">
                                            {(action.macros || []).map((macro) => (
                                              <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                                                <input
                                                  type="text"
                                                  value={macro.name}
                                                  onChange={(e) => updateInventoryActionMacro(item.id, action.id, macro.id, current => ({ ...current, name: e.target.value }))}
                                                  disabled={!canEditInventory}
                                                  className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                                />
                                                <input
                                                  type="text"
                                                  value={macro.formula}
                                                  onChange={(e) => updateInventoryActionMacro(item.id, action.id, macro.id, current => ({ ...current, formula: e.target.value }))}
                                                  disabled={!canEditInventory}
                                                  className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
                                                />
                                                <button
                                                  onClick={() => rollInventoryActionMacro(item, action, macro)}
                                                  className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer"
                                                >
                                                  <Dices size={12} /> Roll
                                                </button>
                                                {canEditInventory && (
                                                  <button
                                                    onClick={() => removeInventoryActionMacro(item.id, action.id, macro.id)}
                                                    className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end"
                                                  >
                                                    <Trash2 size={14} />
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                                        <div className="flex justify-between items-center mb-2">
                                          <label className="text-sm font-bold text-stone-300">Effects</label>
                                          {canEditInventory && (
                                            <div className="flex flex-wrap gap-2">
                                              <button
                                                onClick={() => addInventoryActionEffect(item.id, action.id)}
                                                className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                              >
                                                + Add Effect
                                              </button>
                                              <button
                                                onClick={() => importStatusApplyEffect(effect => updateInventoryAction(item.id, action.id, current => ({ ...current, effects: [...(current.effects || []), effect] })))}
                                                className="text-xs bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300 cursor-pointer"
                                              >
                                                + Add Status
                                              </button>
                                              <button
                                                onClick={() => updateInventoryAction(item.id, action.id, current => ({ ...current, effects: [...(current.effects || []), buildBarUpdateEffect()] }))}
                                                className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                                              >
                                                + Bar Update
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                        {(action.effects || []).length === 0 ? (
                                          <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                                        ) : (
                                          <div className="space-y-2">
                                            {(action.effects || []).map((effect, effectIndex) => renderEffectEditorRow(
                                              effect,
                                              effectIndex,
                                              (index, updater) => updateInventoryActionEffect(item.id, action.id, index, updater),
                                              (index) => removeInventoryActionEffect(item.id, action.id, index),
                                              canEditInventory,
                                              'Target ID (e.g. str_mod)',
                                              'Value (e.g. +2)',
                                              item.localVariables
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm font-bold text-stone-300">
                                Effects {item.equipped ? '(Active)' : '(Inactive until equipped)'}
                              </label>
                              {canEditInventory && (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    onClick={() => addInventoryEffect(item.id)}
                                    className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                  >
                                    + Add Effect
                                  </button>
                                  <button
                                    onClick={() => importStatusApplyEffect(effect => updateInventoryItem(item.id, current => ({ ...current, effects: [...(current.effects || []), effect] })))}
                                    className="text-xs bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300 cursor-pointer"
                                  >
                                    + Add Status
                                  </button>
                                  <button
                                    onClick={() => updateInventoryItem(item.id, current => ({ ...current, effects: [...(current.effects || []), buildBarUpdateEffect()] }))}
                                    className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                                  >
                                    + Bar Update
                                  </button>
                                </div>
                              )}
                            </div>
                            {(item.effects || []).length === 0 ? (
                              <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                            ) : (
                              <div className="space-y-2">
                                {(item.effects || []).map((effect, effectIndex) => renderEffectEditorRow(
                                  effect,
                                  effectIndex,
                                  (index, updater) => updateInventoryEffect(item.id, index, updater),
                                  (index) => removeInventoryEffect(item.id, index),
                                  canEditInventory,
                                  'Target ID (e.g. str_mod)',
                                  'Value (e.g. +2)',
                                  item.localVariables,
                                  true
                                ))}
                              </div>
                            )}
                          </div>
                          </>
                          )}
                        </div>
                        </div>
                        )}
                        </React.Fragment>
                      )})}
                    </div>
                  ) : (
                    <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      Select an inventory category to view or add items.
                    </div>
                  )}
                </div>
                )}

                {activeSheetTab === 'spells' && (
                <div className="rounded-2xl border border-violet-800/30 bg-gradient-to-br from-violet-950/30 via-black/22 to-fuchsia-950/16 p-6 relative overflow-hidden shadow-[0_18px_50px_rgba(76,29,149,0.18)]">
                  <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-400/85 via-fuchsia-500/45 to-transparent"></div>
                  <div className="flex items-center justify-between border-b border-violet-800/30 pb-3 mb-4 relative z-10">
                    <div>
                      <div className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-violet-200 mb-2">
                        Arcana
                      </div>
                      <h3 className="text-xl font-bold text-violet-100" style={{ fontFamily: "'Cinzel', serif" }}>
                        ✦ Spells & Abilities
                      </h3>
                      <p className="text-xs text-violet-100/55 mt-1">
                        Magic, techniques, and powers. Folder groups help separate schools, loadouts, or situational kits.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openHomebrewLibrary('spells')}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-900/30 border border-indigo-800/40 rounded text-xs text-indigo-200 hover:bg-indigo-900/50 cursor-pointer"
                      >
                        <Share2 size={13} /> Share Web
                      </button>
                      {isCharacterOwner && activeSpellCategoryId && (
                        <button
                          onClick={() => addSpell(activeSpellCategoryId)}
                          className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                        >
                          + Add Spell to {activeSpellCategory?.name || 'Category'}
                        </button>
                      )}
                    </div>
                  </div>

                  {!isCharacterOwner && (
                    <div className="mb-3 text-sm text-stone-500 italic">
                      Only the character owner can edit spells and abilities.
                    </div>
                  )}

                  {!activeSpellCategoryId && renderFolderTree(spellFolders, {
                    editable: isCharacterOwner,
                    emptyLabel: 'No spell categories yet. Add a folder here and it will become a spell tab.',
                    title: 'Spell Categories',
                    description: 'Root folders appear as spell category tabs. Subfolders stay inside their category.',
                    addLabel: '+ Add Category',
                    showChildren: false,
                    onAddRoot: () => addSpellFolder(),
                    onAddChild: (parentId) => addSpellFolder(parentId),
                    onMove: moveSpellFolder,
                    onUpdate: updateSpellFolder,
                    onRemove: removeSpellFolder,
                  })}

                  {!activeSpellCategoryId && (
                    <div className="mb-6 rounded-xl border border-violet-800/20 bg-black/20 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-lg font-bold text-violet-100" style={{ fontFamily: "'Cinzel', serif" }}>General Spells</h4>
                          <p className="text-sm text-stone-500">Spells and abilities that are not assigned to a category.</p>
                        </div>
                        {isCharacterOwner && (
                          <button
                            onClick={() => addSpell(null)}
                            className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                          >
                            + Add General Spell
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {activeSpellCategoryId && (
                  <div className="mb-6">
                    {renderFolderTree(spellFolders, {
                      editable: isCharacterOwner,
                      emptyLabel: `No subfolders in ${activeSpellCategory?.name || 'this category'} yet.`,
                      title: `${activeSpellCategory?.name || 'Category'} Subfolders`,
                      description: 'Subfolders organize this category only and do not appear in the category bar.',
                      addLabel: '+ Add Subfolder',
                      rootParentId: activeSpellCategoryId,
                      onAddRoot: () => addSpellFolder(activeSpellCategoryId),
                      onAddChild: (parentId) => addSpellFolder(parentId),
                      onMove: moveSpellFolder,
                      onUpdate: updateSpellFolder,
                      onRemove: removeSpellFolder,
                    })}
                  </div>
                  )}

                  {visibleSpellItems.length === 0 ? (
                    <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      {activeSpellCategoryId
                        ? `No spells in ${activeSpellCategory?.name || 'this category'} yet.`
                        : 'No general spells or abilities yet.'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {visibleSpellItems
                        .sort((a, b) => {
                          const orderA = getFolderOrderIndex(spellFolders, a.folderId);
                          const orderB = getFolderOrderIndex(spellFolders, b.folderId);
                          if (orderA !== orderB) return orderA - orderB;
                          return charSpells.findIndex(spell => spell.id === a.id) - charSpells.findIndex(spell => spell.id === b.id);
                        })
                        .map((spell, spellIndex, visibleSpells) => {
                        const collapsedAncestorId = getCollapsedFolderAncestor(spellFolders, collapsedSpellFolders, spell.folderId);
                        const effectiveFolderId = collapsedAncestorId ?? spell.folderId ?? null;
                        const previousCollapsedAncestorId = spellIndex > 0 ? getCollapsedFolderAncestor(spellFolders, collapsedSpellFolders, visibleSpells[spellIndex - 1].folderId) : null;
                        const previousFolderId = spellIndex > 0 ? (previousCollapsedAncestorId ?? visibleSpells[spellIndex - 1].folderId ?? null) : null;
                        const folderLabel = getFolderPathLabel(spellFolders, effectiveFolderId);
                        const folderDepth = getFolderDepth(spellFolders, effectiveFolderId);
                        const isFolderSectionCollapsed = !!collapsedAncestorId;
                        const shouldShowFolderHeader = !!folderLabel && effectiveFolderId !== activeSpellCategoryId;
                        return (
                        <React.Fragment key={spell.id}>
                        {shouldShowFolderHeader && previousFolderId !== effectiveFolderId && (
                          <div
                            className="relative rounded-lg border px-4 py-2 text-sm font-bold tracking-wide text-amber-100 flex items-center justify-between gap-3"
                            style={{
                              marginLeft: `${Math.max(0, folderDepth - 1) * 20}px`,
                              borderColor: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}55`,
                              background: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}18`,
                            }}
                          >
                            {folderDepth > 0 && (
                              <div
                                className="absolute -left-4 top-1/2 h-px w-4"
                                style={{ backgroundColor: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}88` }}
                              />
                            )}
                            <span>{folderLabel}</span>
                            <button
                              onClick={() => effectiveFolderId && setCollapsedSpellFolders(prev => prev.includes(effectiveFolderId) ? prev.filter(id => id !== effectiveFolderId) : [...prev, effectiveFolderId])}
                              className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer shrink-0"
                            >
                              {isFolderSectionCollapsed ? 'Show' : 'Collapse'}
                            </button>
                          </div>
                        )}
                        {!isFolderSectionCollapsed && (
                        <div className="relative" style={{ marginLeft: `${getFolderDepth(spellFolders, effectiveFolderId) * 20}px` }}>
                        {effectiveFolderId && (
                          <div
                            className="absolute -left-4 top-0 bottom-0 w-px"
                            style={{ background: `linear-gradient(to bottom, ${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}aa, ${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}22)` }}
                          />
                        )}
                        <div
                          id={`spell-${spell.id}`}
                          className="relative rounded-xl border p-4 shadow-lg flex flex-col gap-3"
                          style={{
                            borderColor: `${spell.color || '#7c3aed'}88`,
                            background: `linear-gradient(135deg, ${spell.color || '#7c3aed'}22, rgba(12, 10, 9, 0.72))`,
                            boxShadow: `0 8px 24px ${spell.color || '#7c3aed'}22`,
                          }}
                        >
                          {effectiveFolderId && (
                            <div
                              className="absolute -left-4 top-7 h-px w-4"
                              style={{ backgroundColor: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}88` }}
                            />
                          )}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span
                                className="inline-block h-3 w-3 rounded-full border border-white/30"
                                style={{ backgroundColor: spell.color || '#7c3aed' }}
                              />
                              <span className="text-xs uppercase tracking-[0.22em] text-stone-300">Spell Card</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => updateSpell(spell.id, current => ({ ...current, hidden: !current.hidden }))}
                                className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                              >
                                {spell.hidden ? 'Show' : 'Hide'}
                              </button>
                              <button
                                onClick={() => shareSpell(spell)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-sky-300 hover:text-sky-200 border border-sky-800/30 rounded hover:bg-sky-900/20 cursor-pointer"
                              >
                                <Share2 size={12} /> Share
                              </button>
                              <button
                                onClick={() => openHomebrewViewer('spell', spell.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-300 hover:text-indigo-200 border border-indigo-800/30 rounded hover:bg-indigo-900/20 cursor-pointer"
                              >
                                <Share2 size={12} /> Share Web
                              </button>
                              <button
                                onClick={() => exportCharacterEntry('spell', spell, spellFolders.find(folder => folder.id === spell.folderId)?.name || null)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-emerald-300 hover:text-emerald-200 border border-emerald-800/30 rounded hover:bg-emerald-900/20 cursor-pointer"
                              >
                                Export
                              </button>
                              <button
                                onClick={() => openSendToParty('spell', spell)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-cyan-300 hover:text-cyan-200 border border-cyan-800/30 rounded hover:bg-cyan-900/20 cursor-pointer"
                              >
                                Send to Party
                              </button>
                              {isCharacterOwner && (
                                <>
                                  <button
                                    onClick={() => moveSpell(spell.id, 'up')}
                                    disabled={spellIndex === 0}
                                  className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  <ArrowUp size={15} />
                                </button>
                                <button
                                  onClick={() => moveSpell(spell.id, 'down')}
                                  disabled={spellIndex === visibleSpells.length - 1}
                                  className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  <ArrowDown size={15} />
                                </button>
                                <button
                                  onClick={() => removeSpell(spell.id)}
                                  className="p-1 text-stone-500 hover:text-red-400 cursor-pointer"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-3 items-end">
                            {renderActionField('Spell Name', (
                              <input
                                type="text"
                                value={spell.name}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, name: e.target.value }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="Spell or ability name"
                              />
                            ), 'min-w-[220px] flex-1')}
                            {renderActionField('Level', (
                              <input
                                type="text"
                                value={spell.level}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, level: e.target.value }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="Level"
                              />
                            ), 'min-w-[140px]')}
                            {renderActionField('Color', (
                              <input
                                type="color"
                                value={spell.color || '#7c3aed'}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, color: e.target.value }))}
                                disabled={!isCharacterOwner}
                                className="h-10 w-14 bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer disabled:opacity-60"
                              />
                            ), 'min-w-[64px]')}
                            {renderActionField('Category', (
                              <select
                                value={spell.folderId ?? ''}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, folderId: e.target.value || null }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              >
                                <option value="">No folder</option>
                                {getFolderOptions(spellFolders).map(option => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            ), 'min-w-[200px]')}
                          </div>
                          {!spell.hidden && (
                          <>
                          <textarea
                            ref={(el) => { spellDescriptionRefs.current[spell.id] = el; }}
                              value={spell.description}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, description: e.target.value }))}
                              disabled={!isCharacterOwner}
                              placeholder="Description"
                              rows={expandedSpellDescriptions.includes(spell.id) ? 3 : 6}
                              className="w-full bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                            />
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleSpellDescription(spell.id)}
                              className="text-sm text-amber-300 hover:text-amber-200 cursor-pointer"
                            >
                              {expandedSpellDescriptions.includes(spell.id) ? 'Show More' : 'Hide'}
                            </button>
                          </div>

                          {renderHomebrewImageControls(
                            'spell',
                            spell.id,
                            spell.homebrewImageUrl,
                            spell.homebrewImageThumbUrl,
                            isCharacterOwner
                          )}

                          <div className="flex flex-wrap gap-3 items-end">
                            {renderActionField('Cost', (
                              <input
                                type="text"
                                value={spell.resourceCost}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, resourceCost: e.target.value }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="Cost"
                              />
                            ), 'w-[140px] flex-none')}
                            {renderActionField('Remaining', (
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={spell.usageRemaining}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, usageRemaining: sanitizeWholeNumberInput(e.target.value) }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="0"
                              />
                            ), 'w-[11ch] flex-none')}
                            {renderActionField('Max', (
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={spell.totalUsage}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, totalUsage: sanitizeWholeNumberInput(e.target.value) }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="0"
                              />
                            ), 'w-[11ch] flex-none')}
                            {renderActionField('Replenish On', (
                              <select
                                value={spell.replenishTrigger || 'custom'}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, replenishTrigger: e.target.value as CharacterReplenishTrigger }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                title="When this spell regains usage"
                              >
                                {REPLENISH_TRIGGER_OPTIONS.map(option => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            ), 'min-w-[150px]')}
                            {renderActionField('Gain', (
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={spell.replenishAmount || ''}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, replenishAmount: sanitizeWholeNumberInput(e.target.value) }))}
                                disabled={!isCharacterOwner}
                                className="bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                                placeholder="0"
                              />
                            ), 'w-[11ch] flex-none')}
                          </div>

                          {renderLocalVariablesEditor(
                            spell.localVariables,
                            (kind) => addSpellLocalVariable(spell.id, kind),
                            (variableIndex, updater) => updateSpellLocalVariable(spell.id, variableIndex, updater),
                            (variableIndex) => removeSpellLocalVariable(spell.id, variableIndex),
                            isCharacterOwner
                          )}

                          <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm font-bold text-stone-300">Spell Macros</label>
                              {isCharacterOwner && (
                                <button
                                  onClick={() => addSpellMacro(spell.id)}
                                  className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                >
                                  + Add Macro
                                </button>
                              )}
                            </div>
                            {(spell.macros || []).length === 0 ? (
                              <span className="text-[10px] text-stone-600 italic">No macros added.</span>
                            ) : (
                              <div className="space-y-2">
                                {(spell.macros || []).map((macro) => (
                                  <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                                    <input
                                      type="text"
                                      value={macro.name}
                                      onChange={(e) => updateSpellMacro(spell.id, macro.id, current => ({ ...current, name: e.target.value }))}
                                      disabled={!isCharacterOwner}
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                      placeholder="Spell macro name"
                                    />
                                    <input
                                      type="text"
                                      value={macro.formula}
                                      onChange={(e) => updateSpellMacro(spell.id, macro.id, current => ({ ...current, formula: e.target.value }))}
                                      disabled={!isCharacterOwner}
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
                                      placeholder="1d20 + @int_mod"
                                    />
                                    <button
                                      onClick={() => rollSpellMacro(spell, macro)}
                                      className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer"
                                    >
                                      <Dices size={12} /> Roll
                                    </button>
                                    {isCharacterOwner ? (
                                      <button
                                        onClick={() => removeSpellMacro(spell.id, macro.id)}
                                        className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end"
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    ) : (
                                      <div />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-sm font-bold text-stone-300">Actions</label>
                              {isCharacterOwner && (
                                <button
                                  onClick={() => addSpellAction(spell.id)}
                                  className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                >
                                  + Add Action
                                </button>
                              )}
                            </div>
                            {(spell.actions || []).length === 0 ? (
                              <span className="text-xs text-stone-600 italic">No actions added.</span>
                            ) : (
                              <div className="space-y-3">
                                {(spell.actions || []).map((action) => {
                                  const isExpanded = expandedSpellActionDescriptions.includes(action.id);
                                  return (
                                    <div key={action.id} className="rounded-lg border border-amber-800/15 bg-amber-950/10 p-3">
                                      <div className="flex flex-wrap gap-2 items-start mb-2">
                                        {renderActionField('Name', (
                                          <input
                                            type="text"
                                            value={action.name}
                                            onChange={(e) => updateSpellAction(spell.id, action.id, current => ({ ...current, name: e.target.value }))}
                                            disabled={!isCharacterOwner}
                                            placeholder="Action name"
                                            className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                          />
                                        ), 'min-w-[180px]')}
                                        {renderActionField('Cost', (
                                          <input
                                            type="text"
                                            value={action.cost}
                                            onChange={(e) => updateSpellAction(spell.id, action.id, current => ({ ...current, cost: e.target.value }))}
                                            disabled={!isCharacterOwner}
                                            placeholder="Cost"
                                            className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                          />
                                        ), 'min-w-[140px]')}
                                        {renderActionUsageControls(action, updater => updateSpellAction(spell.id, action.id, updater), isCharacterOwner)}
                                        <button
                                          onClick={() => shareSpellAction(spell, action)}
                                          className="inline-flex items-center gap-1 px-3 py-2 bg-sky-900/30 border border-sky-800/40 rounded text-sm text-sky-200 hover:bg-sky-900/50 cursor-pointer"
                                        >
                                          <Share2 size={14} /> Share
                                        </button>
                                        {isCharacterOwner && (
                                          <button
                                            onClick={() => removeSpellAction(spell.id, action.id)}
                                            className="p-2 text-stone-500 hover:text-red-400 cursor-pointer"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        )}
                                      </div>
                                      <textarea
                                        ref={(el) => { spellActionDescriptionRefs.current[action.id] = el; }}
                                        value={action.description}
                                        onChange={(e) => updateSpellAction(spell.id, action.id, current => ({ ...current, description: e.target.value }))}
                                        disabled={!isCharacterOwner}
                                        rows={isExpanded ? 2 : 6}
                                        placeholder="Action description"
                                        className="w-full bg-stone-900 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                                      />
                                      <button
                                        onClick={() => toggleSpellActionDescription(action.id)}
                                        className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer"
                                      >
                                        {isExpanded ? 'Show More' : 'Hide'}
                                      </button>
                                      <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                                        <div className="flex justify-between items-center mb-2">
                                          <label className="text-sm font-bold text-stone-300">Action Macros</label>
                                          {isCharacterOwner && (
                                            <button
                                              onClick={() => addSpellActionMacro(spell.id, action.id)}
                                              className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                            >
                                              + Add Macro
                                            </button>
                                          )}
                                        </div>
                                        {(action.macros || []).length === 0 ? (
                                          <span className="text-xs text-stone-600 italic">No macros added.</span>
                                        ) : (
                                          <div className="space-y-2">
                                            {(action.macros || []).map((macro) => (
                                              <div key={macro.id} className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto_auto] gap-2 items-center">
                                                <input
                                                  type="text"
                                                  value={macro.name}
                                                  onChange={(e) => updateSpellActionMacro(spell.id, action.id, macro.id, current => ({ ...current, name: e.target.value }))}
                                                  disabled={!isCharacterOwner}
                                                  className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                                />
                                                <input
                                                  type="text"
                                                  value={macro.formula}
                                                  onChange={(e) => updateSpellActionMacro(spell.id, action.id, macro.id, current => ({ ...current, formula: e.target.value }))}
                                                  disabled={!isCharacterOwner}
                                                  className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-sm text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
                                                />
                                                <button
                                                  onClick={() => rollSpellActionMacro(spell, action, macro)}
                                                  className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-xs font-bold cursor-pointer"
                                                >
                                                  <Dices size={12} /> Roll
                                                </button>
                                                {isCharacterOwner && (
                                                  <button
                                                    onClick={() => removeSpellActionMacro(spell.id, action.id, macro.id)}
                                                    className="text-stone-600 hover:text-red-400 cursor-pointer justify-self-end"
                                                  >
                                                    <Trash2 size={14} />
                                                  </button>
                                                )}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <div className="mt-3 rounded-lg border border-amber-800/10 bg-black/20 p-3">
                                        <div className="flex justify-between items-center mb-2">
                                          <label className="text-sm font-bold text-stone-300">Effects</label>
                                          {isCharacterOwner && (
                                            <div className="flex flex-wrap gap-2">
                                              <button
                                                onClick={() => addSpellActionEffect(spell.id, action.id)}
                                                className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                              >
                                                + Add Effect
                                              </button>
                                              <button
                                                onClick={() => importStatusApplyEffect(effect => updateSpellAction(spell.id, action.id, current => ({ ...current, effects: [...(current.effects || []), effect] })))}
                                                className="text-xs bg-indigo-900/20 hover:bg-indigo-900/40 px-2 py-1 rounded text-indigo-300 cursor-pointer"
                                              >
                                                + Add Status
                                              </button>
                                              <button
                                                onClick={() => updateSpellAction(spell.id, action.id, current => ({ ...current, effects: [...(current.effects || []), buildBarUpdateEffect()] }))}
                                                className="text-xs bg-cyan-900/20 hover:bg-cyan-900/40 px-2 py-1 rounded text-cyan-300 cursor-pointer"
                                              >
                                                + Bar Update
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                        {(action.effects || []).length === 0 ? (
                                          <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                                        ) : (
                                          <div className="space-y-2">
                                            {(action.effects || []).map((effect, effectIndex) => renderEffectEditorRow(
                                              effect,
                                              effectIndex,
                                              (index, updater) => updateSpellActionEffect(spell.id, action.id, index, updater),
                                              (index) => removeSpellActionEffect(spell.id, action.id, index),
                                              isCharacterOwner,
                                              'Target ID (e.g. str_mod)',
                                              'Value (e.g. +2)',
                                              spell.localVariables
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          </>
                          )}
                        </div>
                        </div>
                        )}
                        </React.Fragment>
                      )})}
                    </div>
                  )}
                </div>
                )}
          </div>
        </div>
    );
  }

  // ── Main List View ────────────────────────────────────────────────────────────

  if (embeddedMode) {
    return (
      <div className="w-full rounded-2xl border border-amber-800/35 bg-stone-950/45 p-8 text-center text-stone-400" style={{ fontFamily: "'IM Fell English', serif" }}>
        {embeddedCharacterId ? 'Loading selected character sheet...' : 'Add or select a character from the DM Tools rail.'}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6" style={{ fontFamily: "'IM Fell English', serif" }}>
      {renderBarTargetResolverModal()}
      {renderEffectTargetResolverModal()}
      {renderLocalInputModal()}
      {renderScriptValueTargetResolverModal()}
      {rollPopupResult && (
        <button
          type="button"
          onClick={dismissRollPopup}
          className="fixed bottom-5 right-5 z-[9999] w-[min(360px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-amber-400/55 bg-stone-950/95 text-left shadow-[0_18px_55px_rgba(0,0,0,0.55)] ring-1 ring-amber-200/10 backdrop-blur transition hover:border-amber-300"
        >
          <div className="flex items-center justify-between gap-3 border-b border-amber-800/30 bg-amber-900/25 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Dices size={17} className="shrink-0 text-amber-300" />
              <span className="truncate text-sm font-bold text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
                {rollPopupResult.macroName || 'Roll Result'}
              </span>
            </div>
            <span className="shrink-0 text-3xl font-black text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
              {rollPopupResult.total}
            </span>
          </div>
          <div className="space-y-2 px-4 py-3">
            <code className="block truncate rounded border border-stone-700/60 bg-black/35 px-2 py-1 text-xs text-stone-300">
              {rollPopupResult.formula}
            </code>
            {rollPopupResult.description && (
              <p className="line-clamp-2 text-sm italic text-stone-300">{rollPopupResult.description}</p>
            )}
            <div className="space-y-1">
              {rollPopupResult.steps.slice(0, 3).map((step, index) => (
                <div key={`${rollPopupResult.timestamp}-${index}`} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-stone-400">{step.label}</span>
                  <span className="font-mono font-bold text-amber-200">{step.value}</span>
                </div>
              ))}
              {rollPopupResult.steps.length > 3 && (
                <p className="text-xs text-stone-500">+{rollPopupResult.steps.length - 3} more step</p>
              )}
            </div>
          </div>
        </button>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-900/30 pb-4">
        <div>
          <h2 className="text-3xl font-bold text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>🛡️ Characters</h2>
          <p className="text-stone-400 text-sm mt-1">Build your roster of heroes. All data is saved securely.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreate}
            disabled={!userId || userId === 'guest'}
            title={!userId || userId === 'guest' ? 'Sign in to create a Firestore character.' : 'Create a new character'}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 text-sm cursor-pointer shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={16} /> Create Character
          </button>
          <button onClick={fetchAll} className="flex items-center gap-1.5 px-3 py-2 bg-stone-700/40 text-stone-300 rounded border border-stone-600/40 hover:bg-stone-700/60 text-sm cursor-pointer shadow-md">
            <RefreshCw size={14} /> Sync All
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 bg-amber-900/10 border border-amber-800/30 rounded-xl flex flex-col gap-4 shadow-lg select-none">
        <h3 className="text-sm font-bold text-amber-300 uppercase tracking-widest flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
          <Filter size={16} /> Advanced Filters & Searching
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-400">Search by Name</label>
            <div className="relative flex items-center bg-stone-900/80 border border-stone-700 rounded p-1">
              <Search size={16} className="text-stone-500 ml-2" />
              <input type="text" value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Type a name..." className="w-full bg-transparent px-2 py-1 text-sm text-amber-100 focus:outline-none placeholder-stone-700 font-serif" />
              {searchName && <button onClick={() => setSearchName('')} className="text-stone-600 hover:text-stone-300 p-1 cursor-pointer"><X size={14} /></button>}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-stone-400">Filter by Tag (Class or Race)</label>
            <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={handleAddTag} placeholder="Type tag + Enter..." className="w-full bg-stone-900/80 border border-stone-700 rounded px-3 py-1.5 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 placeholder-stone-700" />
          </div>
          <div className="flex flex-col justify-end">
            <button onClick={() => setShowOnlyFavs(!showOnlyFavs)} className={`flex items-center justify-center gap-2 h-[38px] px-4 border rounded text-xs font-bold tracking-wider cursor-pointer transition-all ${showOnlyFavs ? 'bg-amber-900/50 border-amber-500 text-amber-200' : 'bg-stone-900/50 border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-300'}`} style={{ fontFamily: "'Cinzel', serif" }}>
              <Star size={14} fill={showOnlyFavs ? 'currentColor' : 'none'} />
              <span>Only Favorites</span>
            </button>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={applyFilters} className="flex-1 flex items-center justify-center h-[38px] px-3 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-800/40 rounded text-xs text-amber-200 font-bold cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>Filter</button>
            <button onClick={clearFilters} className="flex-1 flex items-center justify-center h-[38px] px-3 bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded text-xs text-stone-300 font-bold cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>Clear</button>
          </div>
        </div>
        {filterTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-amber-800/20 pt-3">
            <span className="text-xs text-stone-500 self-center mr-1">Active Tags:</span>
            {filterTags.map(tag => (
              <button key={tag} onClick={() => removeTag(tag)} className="flex items-center gap-1 px-2 py-1 bg-amber-900/30 border border-amber-800/30 hover:border-red-500/50 rounded-md text-xs text-amber-300 hover:text-red-400 transition-all cursor-pointer font-mono">
                {tag} <X size={12} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Character List + Quick Editor */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-[500px]">
        {/* Character List */}
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-amber-800/40 bg-stone-950/40 p-5 h-[720px] flex flex-col overflow-hidden">
            <h3 className="text-lg text-amber-300 font-bold mb-4 flex flex-wrap items-center justify-between gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
              <span className="min-w-0">📜 Character List</span>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                {isAdmin && (
                  <span
                    className="text-[10px] bg-emerald-950/40 border border-emerald-700/50 text-emerald-200 px-2 py-0.5 rounded font-mono"
                    title={adminSource || 'Admin access'}
                  >
                    Admin
                  </span>
                )}
                <button
                  onClick={() => selectedCharacter && handleAddToBattleTracker(selectedCharacter.name)}
                  disabled={!selectedCharacter}
                  className="max-w-full px-2.5 py-1 text-[10px] rounded border border-blue-800/40 bg-blue-950/30 text-blue-200 hover:bg-blue-900/40 hover:border-blue-500/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed truncate"
                  title={selectedCharacter ? `Add ${selectedCharacter.name} to Battle Tracker` : 'Select a character first'}
                >
                  Add Selected to Battle Tracker
                </button>
                <span className="text-xs bg-amber-900/30 border border-amber-800/30 text-amber-400 px-2 py-0.5 rounded font-mono">
                  {filteredCharacters.length} / {characters.length}
                </span>
              </div>
            </h3>
            {filteredCharacters.length === 0 ? (
              <div className="text-stone-500 text-center py-16 border border-dashed border-stone-700 rounded-lg flex-1 flex items-center justify-center">
                No adventurers match your filters.
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 flex-1 overflow-y-auto overflow-x-hidden pr-1 auto-rows-min">
                {filteredCharacters.map((char) => {
                  const isSelected = selectedCharacter?.id === char.id;
                  const isFav = favoriteIds.includes(char.id);
                  const listPortraitUrl = getCharacterPortraitDisplayUrl(char);
                  return (
                    <div
                      key={char.id}
                      onClick={() => setSelectedCharacter(char)}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none group min-h-[88px] overflow-hidden ${isSelected ? 'bg-amber-900/30 border-amber-500/50 shadow-md ring-1 ring-inset ring-amber-500/30' : 'bg-black/20 border-stone-800/50 hover:bg-amber-950/10 hover:border-stone-700/60'}`}
                    >
                      <div className="flex min-w-0 items-center gap-4">
                        <div className={`w-11 h-11 rounded-lg border-2 flex items-center justify-center font-bold text-sm shrink-0 font-mono transition-all overflow-hidden ${isSelected ? 'border-amber-400 bg-amber-900/50 text-amber-200' : 'border-amber-700/30 bg-stone-900/60 text-amber-300/80'}`}>
                          {listPortraitUrl ? (
                            <img
                              src={listPortraitUrl}
                              alt={char.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const target = e.currentTarget;
                                target.style.display = 'none';
                                const fallback = target.nextElementSibling as HTMLElement | null;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span
                            style={{ display: listPortraitUrl ? 'none' : 'flex' }}
                            className="w-full h-full items-center justify-center"
                          >
                            {(char.name || '?').slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className={`text-base font-bold truncate ${isSelected ? 'text-amber-100' : 'text-amber-200/80 group-hover:text-amber-200'}`} style={{ fontFamily: "'Cinzel', serif" }}>
                            {char.name}
                            {char.visibility === 'public' && char.userId !== userId && (
                              <span className="ml-1.5 text-xs text-sky-400/70">🌐</span>
                            )}
                          </h4>
                          <p className="text-xs text-amber-600/70 italic truncate">
                            {char.race} • {char.className}
                          </p>
                          {isAdmin && (
                            <p className="text-[10px] text-stone-500 truncate">
                              Owner: {char.ownerEmail || char.userId || 'unclaimed'}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-1 shrink-0 self-start">
                        <button
                          onClick={(e) => handleToggleFav(e, char.id)}
                          className={`grid h-8 w-8 place-items-center rounded-full hover:bg-amber-800/20 transition-colors cursor-pointer ${isFav ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'}`}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star size={16} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                        {(isAdmin || canOwnCharacter(char) || canControlCharacter(char)) && (
                          <button
                            onClick={(e) => handleDelete(e, char.id)}
                            className="grid h-8 w-8 place-items-center text-stone-700 hover:text-red-400 opacity-0 group-hover:opacity-100 rounded-full hover:bg-red-950/20 transition-all cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Quick Editor */}
        <div className="rounded-xl border border-amber-800/40 bg-stone-950/40 p-5 h-[720px] overflow-y-auto">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg text-amber-300 font-bold" style={{ fontFamily: "'Cinzel', serif" }}>⚔️ Quick Editor</h3>
              {selectedCharacter && (
                <span className="text-xs font-mono text-amber-500/70">
                  ID: {selectedCharacter.id.slice(0, 8)} • {selectedAccessRole}
                </span>
              )}
            </div>

            {!selectedCharacter ? (
              <div className="text-stone-500 text-center py-16 flex items-center justify-center h-full italic">
                Select a character to edit.
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Name</label>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={!isCharacterOwner} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 disabled:opacity-60" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Race</label>
                  <input value={editRace} onChange={(e) => setEditRace(e.target.value)} disabled={!isCharacterOwner} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 disabled:opacity-60" placeholder="Human, Elf..." />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Vocation / Class</label>
                  <input value={editClass} onChange={(e) => setEditClass(e.target.value)} disabled={!isCharacterOwner} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 disabled:opacity-60" placeholder="Vanguard, Arcanist..." />
                </div>
                {/* Visibility Dropdown */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Visibility</label>
                  {isCharacterOwner ? (
                    <select
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value as 'private' | 'public')}
                      className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 cursor-pointer"
                    >
                      <option value="private">🔒 Private — only you can see this</option>
                      <option value="public">🌐 Public — everyone can see this</option>
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-stone-900 border border-stone-700 rounded-lg text-sm text-stone-400">
                      <span>{selectedCharacter.visibility === 'public' ? '🌐 Public' : '🔒 Private'}</span>
                      <span className="text-xs text-stone-600">(read only)</span>
                    </div>
                  )}
                </div>

                {(canTransferCharacterOwner || canManageControlAccess || canManageViewAccess) && (
                  <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/10 p-4">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h4 className="text-sm font-bold text-emerald-200" style={{ fontFamily: "'Cinzel', serif" }}>Character Access</h4>
                        <p className="text-xs text-stone-500">
                          Current owner: {selectedCharacter.ownerEmail || selectedCharacter.userId || 'unclaimed'}
                        </p>
                      </div>
                      <span className="text-[10px] text-emerald-300/70 font-mono">{userProfiles.length} users</span>
                    </div>
                    <div className="flex flex-col gap-2">
                      {canTransferCharacterOwner && (
                        <div className="rounded-lg border border-emerald-800/30 bg-black/25 p-3">
                          <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300/70 mb-1">Transfer Owner</label>
                          <div className="grid grid-cols-1 gap-2">
                            <select
                              value={ownerTransferUid}
                              onChange={(e) => setOwnerTransferUid(e.target.value)}
                              className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-emerald-500/50 cursor-pointer"
                            >
                              <option value="">Choose a Google user...</option>
                              {selectedCharacter.userId && !userProfiles.some((profile) => profile.uid === selectedCharacter.userId) && (
                                <option value={selectedCharacter.userId}>
                                  Current unknown user ({selectedCharacter.userId})
                                </option>
                              )}
                              {userProfiles.map((profile) => (
                                <option key={profile.uid} value={profile.uid}>
                                  {profile.email || profile.displayName || profile.uid} ({profile.uid.slice(0, 8)})
                                </option>
                              ))}
                            </select>
                            <input
                              value={ownerTransferUid}
                              onChange={(e) => setOwnerTransferUid(e.target.value)}
                              placeholder="Or paste Firebase UID manually..."
                              className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-amber-100 focus:outline-none focus:border-emerald-500/50 font-mono"
                            />
                            <button
                              onClick={handleTransferOwner}
                              disabled={!ownerTransferUid.trim() || ownerTransferUid === selectedCharacter.userId}
                              className="px-4 py-2 bg-emerald-900/40 border border-emerald-700/50 rounded-lg text-sm text-emerald-100 hover:bg-emerald-800/50 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                              style={{ fontFamily: "'Cinzel', serif" }}
                            >
                              Change Owner
                            </button>
                          </div>
                        </div>
                      )}
                      {canManageControlAccess && (
                        <div className="rounded-lg border border-sky-800/30 bg-black/25 p-3">
                          <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-sky-300/70 mb-1">Control Access</label>
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <select value={controlAccessUid} onChange={(e) => setControlAccessUid(e.target.value)} className="min-w-0 flex-1 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-sky-500/50 cursor-pointer">
                                <option value="">Choose user...</option>
                                {userProfiles.filter(profile => profile.uid !== selectedCharacter.userId && !(selectedCharacter.controlUserIds || []).includes(profile.uid)).map((profile) => (
                                  <option key={profile.uid} value={profile.uid}>{profile.email || profile.displayName || profile.uid}</option>
                                ))}
                              </select>
                              <button onClick={() => handleAddAccessUser('control')} disabled={!controlAccessUid.trim()} className="px-3 py-2 bg-sky-900/40 border border-sky-700/50 rounded-lg text-sm text-sky-100 hover:bg-sky-800/50 disabled:opacity-40">Add</button>
                            </div>
                            {(selectedCharacter.controlUserIds || []).length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {(selectedCharacter.controlUserIds || []).map((uid) => (
                                  <button key={uid} onClick={() => handleRemoveAccessUser('control', uid)} className="rounded-full border border-sky-700/40 bg-sky-950/40 px-2 py-1 text-xs text-sky-100 hover:border-red-500/60 hover:text-red-200" title="Remove control access">
                                    {getProfileLabel(uid)} ×
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {canManageViewAccess && (
                        <div className="rounded-lg border border-amber-800/30 bg-black/25 p-3">
                          <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300/70 mb-1">View Access</label>
                          <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                              <select value={viewAccessUid} onChange={(e) => setViewAccessUid(e.target.value)} className="min-w-0 flex-1 bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 cursor-pointer">
                                <option value="">Choose user...</option>
                                {userProfiles.filter(profile => profile.uid !== selectedCharacter.userId && !(selectedCharacter.viewUserIds || []).includes(profile.uid)).map((profile) => (
                                  <option key={profile.uid} value={profile.uid}>{profile.email || profile.displayName || profile.uid}</option>
                                ))}
                              </select>
                              <button onClick={() => handleAddAccessUser('view')} disabled={!viewAccessUid.trim()} className="px-3 py-2 bg-amber-900/40 border border-amber-700/50 rounded-lg text-sm text-amber-100 hover:bg-amber-800/50 disabled:opacity-40">Add</button>
                            </div>
                            {(selectedCharacter.viewUserIds || []).length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {(selectedCharacter.viewUserIds || []).map((uid) => (
                                  <button key={uid} onClick={() => handleRemoveAccessUser('view', uid)} className="rounded-full border border-amber-700/40 bg-amber-950/40 px-2 py-1 text-xs text-amber-100 hover:border-red-500/60 hover:text-red-200" title="Remove view access">
                                    {getProfileLabel(uid)} ×
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {ownerTransferStatus && (
                        <p className="text-xs text-emerald-200/80">{ownerTransferStatus}</p>
                      )}
                      {accessStatus && (
                        <p className="text-xs text-emerald-200/80">{accessStatus}</p>
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleCreateFromSelected}
                    disabled={!selectedCharacter || !userId || userId === 'guest' || (!isCharacterOwner && !canEditInventory)}
                    title={!userId || userId === 'guest' ? 'Sign in to create a Firestore character.' : 'Create a new character from this one'}
                    className="flex-1 px-4 py-2 bg-emerald-900/35 border border-emerald-800/40 rounded hover:bg-emerald-900/55 hover:border-emerald-500/70 text-emerald-200 transition-colors text-sm font-bold tracking-wider cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    <Plus size={16} /> Create From This
                  </button>
                  <button
                    onClick={handleSaveAll}
                    disabled={!canEditInventory && !isCharacterOwner}
                    className="flex-1 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 transition-colors text-sm font-bold tracking-wider cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    <Save size={16} /> Save
                  </button>
                </div>
              </div>
            )}
          </div>
          {selectedCharacter && (
            <div className="mt-6 border-t border-amber-800/20 pt-4">
              <button
                onClick={() => setIsViewingSheet(true)}
                className="w-full px-6 py-3 bg-amber-800/30 border-2 border-amber-700 rounded-md hover:bg-amber-800/50 text-amber-100 transition-all font-bold text-center text-base tracking-wider cursor-pointer shadow-lg hover:shadow-amber-900/30"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                📜 Load Character Sheet
              </button>
            </div>
          )}
        </div>
      </div>

      {renderDicePanel('main')}
    </div>
  );
};

export default Characters;
