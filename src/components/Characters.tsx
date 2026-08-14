import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Star, Trash2, Save, ArrowLeft, Shield, Wand2, RefreshCw, Search, X, Filter, Settings, Dices, Zap, Edit3, Check, AlertTriangle, ArrowUp, ArrowDown, Share2 } from 'lucide-react';
import { CharacterAction, CharacterAttributeSectionColumns, CharacterAttributeSectionModes, CharacterBar, CharacterData, CharacterDiceMacro, CharacterDisplayStat, CharacterEntryFolder, CharacterGeneralItem, CharacterInventoryItem, CharacterSpell, CustomAttribute, CharacterStatus, SkillAttribute, StatusEffect } from '../types/character';
import { DEFAULT_CHARACTER_SYNC_SHEET_ID, DEFAULT_CHARACTER_SYNC_TAB_NAME, syncCharacterSheet } from '../lib/characterSheetSync';

function evalCharFormula(formula: string, context: Record<string, number>): number {
  if (!formula) return 0;
  
  let expr = formula.replace(/@([a-zA-Z0-9_-]+)/g, (match, refId) => {
    return (context[refId] ?? 0).toString();
  });

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
import { loadCharacters, saveCharacter, saveCharacterInventory, deleteCharacterFromDB, loadFavorites, loadUserDiceSettings, saveUserDiceSettings, toggleFavorite as toggleFavoriteDB, UserDiceSettings, reloadCharacterFromFirestore } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { addCombatantToBattleTracker } from '../lib/battleTracker';

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
  mainAttributes: CustomAttribute[];
  secondaryAttributes: CustomAttribute[];
  skills: SkillAttribute[];
  otherAttributes: CustomAttribute[];
  bars: CharacterBar[];
  modifierFormula: string;
  attributeSectionColumns: Required<CharacterAttributeSectionColumns>;
}

type AttributeCalculationType = NonNullable<CustomAttribute['calculationType']>;

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
  bars: 'all',
};

const DEFAULT_ATTRIBUTE_SECTION_COLUMNS: Required<CharacterAttributeSectionColumns> = {
  display: 3,
  main: 2,
  secondary: 2,
  skills: 2,
  other: 2,
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

const MATH_FUNCTIONS: Record<string, (args: number[]) => number> = {
  max: (args) => Math.max(...args),
  min: (args) => Math.min(...args),
  round: (args) => Math.round(args[0]),
  roundup: (args) => Math.ceil(args[0]),
  rounddown: (args) => Math.floor(args[0]),
};

function evaluateMathFunctions(expr: string): string {
  const functionRegex = /(max|min|round|roundup|rounddown)\s*\(\s*([^()]+)\s*\)/i;
  let result = expr;
  let match;

  while ((match = result.match(functionRegex))) {
    const funcName = match[1].toLowerCase();
    const argsString = match[2];
    const argStrings = argsString.split(',').map(s => s.trim());
    const args: number[] = [];

    for (const argStr of argStrings) {
      args.push(resolveBasicExpression(evaluateMathFunctions(argStr)));
    }

    const func = MATH_FUNCTIONS[funcName];
    if (!func) throw new Error(`Unknown function: ${funcName}`);
    const resultValue = func(args);
    const startIndex = match.index ?? 0;
    result = result.slice(0, startIndex) + resultValue.toString() + result.slice(startIndex + match[0].length);
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
  existingIds: Set<string>
): RollResult {
  const steps: RollStep[] = [];
  const formula = macro.formula.trim();
  const parts = formula.split(/(\d*d\d+(?:kh|kl)?\d*|@[a-zA-Z0-9_-]+)/gi);
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

export const Characters: React.FC = () => {
  const [userId, setUserId] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [filteredCharacters, setFilteredCharacters] = useState<CharacterData[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<CharacterData | null>(null);
  const [isViewingSheet, setIsViewingSheet] = useState(false);

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
  const [displayStats, setDisplayStats] = useState<CharacterDisplayStat[]>([]);
  const [displaySlotStates, setDisplaySlotStates] = useState<Record<string, 'unlocked' | 'locked' | 'blocked'>>({});
  const [attributeSectionModes, setAttributeSectionModes] = useState<Required<CharacterAttributeSectionModes>>(DEFAULT_ATTRIBUTE_SECTION_MODES);
  const [attributeSectionColumns, setAttributeSectionColumns] = useState<Required<CharacterAttributeSectionColumns>>(DEFAULT_ATTRIBUTE_SECTION_COLUMNS);
  const [openAttributeHistoryId, setOpenAttributeHistoryId] = useState<string | null>(null);
  const [openDisplayColorStatId, setOpenDisplayColorStatId] = useState<string | null>(null);
  const [openAttributeOptionsId, setOpenAttributeOptionsId] = useState<string | null>(null);
  const [displayLayoutMode, setDisplayLayoutMode] = useState(false);
  const [draggingDisplayStatId, setDraggingDisplayStatId] = useState<string | null>(null);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<{ tone: 'idle' | 'success' | 'error'; message: string } | null>(null);
  const [isSheetSyncing, setIsSheetSyncing] = useState(false);
  const [charTags, setCharTags] = useState<string[]>([]);
  const [charTagInput, setCharTagInput] = useState('');
  
  const [mainAttrs, setMainAttrs] = useState<CustomAttribute[]>([]);
  const [secondaryAttrs, setSecondaryAttrs] = useState<CustomAttribute[]>([]);
  const [skills, setSkills] = useState<SkillAttribute[]>([]);
  const [otherAttrs, setOtherAttrs] = useState<CustomAttribute[]>([]);
  const [bars, setBars] = useState<CharacterBar[]>([]);
  const [charStatuses, setCharStatuses] = useState<CharacterStatus[]>([]);
  const [expandedStatusDescriptions, setExpandedStatusDescriptions] = useState<string[]>([]);
  const [charGeneralItems, setCharGeneralItems] = useState<CharacterGeneralItem[]>([]);
  const [expandedGeneralItemDescriptions, setExpandedGeneralItemDescriptions] = useState<string[]>([]);
  const [charInventory, setCharInventory] = useState<CharacterInventoryItem[]>([]);
  const [inventoryFolders, setInventoryFolders] = useState<CharacterEntryFolder[]>([]);
  const [collapsedInventoryFolders, setCollapsedInventoryFolders] = useState<string[]>([]);
  const [collapsedInventoryItems, setCollapsedInventoryItems] = useState<string[]>([]);
  const [expandedInventoryDescriptions, setExpandedInventoryDescriptions] = useState<string[]>([]);
  const [expandedInventoryActionDescriptions, setExpandedInventoryActionDescriptions] = useState<string[]>([]);
  const [collapsedSheetQuickRoll, setCollapsedSheetQuickRoll] = useState(false);
  const [charSpells, setCharSpells] = useState<CharacterSpell[]>([]);
  const [spellFolders, setSpellFolders] = useState<CharacterEntryFolder[]>([]);
  const [collapsedSpellFolders, setCollapsedSpellFolders] = useState<string[]>([]);
  const [expandedSpellDescriptions, setExpandedSpellDescriptions] = useState<string[]>([]);
  const [expandedSpellActionDescriptions, setExpandedSpellActionDescriptions] = useState<string[]>([]);
  const [expandedBackstory, setExpandedBackstory] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState(false);
  const [showPortraitPicker, setShowPortraitPicker] = useState(false);
  const [modFormula, setModFormula] = useState<string>('rounddown((@value - 10) / 2)');
  const [showModOptions, setShowModOptions] = useState<boolean>(false);
  const [sheetDiceMacros, setSheetDiceMacros] = useState<CharacterDiceMacro[]>(DEFAULT_CHARACTER_DICE_STATE.macros);
  const [mainDiceState, setMainDiceState] = useState<UserDiceSettings>(DEFAULT_CHARACTER_DICE_STATE);
  const [rollResults, setRollResults] = useState<RollResult[]>([]);
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
  const historyCloseTimeoutRef = useRef<number | null>(null);

  // ── Auth & Data ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return authProvider.onAuthChange((state) => setUserId(state.uid));
  }, []);

  const fetchAll = async () => {
    const chars = await loadCharacters(userId);
    setCharacters(chars);
    const favs = await loadFavorites(userId);
    setFavoriteIds(favs);
    if (chars.length > 0 && !selectedCharacter) setSelectedCharacter(chars[0]);
  };

  useEffect(() => { fetchAll(); }, [userId]);

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
      setPortraitUrl(selectedCharacter.portraitUrl || '');
      setPortraitImportUrl(selectedCharacter.portraitUrl || '');
      setPortraitLoadError(false);
      setDisplayStats(selectedCharacter.displayStats || []);
      setDisplaySlotStates(selectedCharacter.displaySlotStates || {});
      setAttributeSectionModes({ ...DEFAULT_ATTRIBUTE_SECTION_MODES, ...(selectedCharacter.attributeSectionModes || {}) });
      setAttributeSectionColumns({ ...DEFAULT_ATTRIBUTE_SECTION_COLUMNS, ...(selectedCharacter.attributeSectionColumns || {}) });
      setCharTags(selectedCharacter.tags || []);
      setMainAttrs(selectedCharacter.mainAttributes || []);
      setSecondaryAttrs(selectedCharacter.secondaryAttributes || []);
      setSkills(selectedCharacter.skills || []);
      setOtherAttrs(selectedCharacter.otherAttributes || []);
      setBars(selectedCharacter.bars || []);
      setSheetDiceMacros(selectedCharacter.diceMacros || DEFAULT_CHARACTER_DICE_STATE.macros);
      setCharStatuses(selectedCharacter.statuses || []);
      setCharGeneralItems(selectedCharacter.generalItems || []);
      setCharInventory(selectedCharacter.inventory || []);
      setInventoryFolders(selectedCharacter.inventoryFolders || []);
      setCollapsedInventoryFolders(selectedCharacter.collapsedInventoryFolderIds || []);
      setCollapsedSheetQuickRoll(selectedCharacter.collapsedSheetQuickRoll ?? false);
      setCharSpells(selectedCharacter.spells || []);
      setSpellFolders(selectedCharacter.spellFolders || []);
      setCollapsedSpellFolders(selectedCharacter.collapsedSpellFolderIds || []);
      setCollapsedInventoryItems((selectedCharacter.inventory || []).filter(item => item.hidden).map(item => item.id));
      setModFormula(selectedCharacter.modifierFormula || 'Math.floor((@value - 10) / 2)');
    }
  }, [selectedCharacter]);

  useEffect(() => {
    if (!selectedCharacter) return;
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
    setExpandedStatusDescriptions([]);
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

  const handleImportAttributePresetFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Partial<CharacterAttributePreset>;
      setMainAttrs(Array.isArray(parsed.mainAttributes) ? parsed.mainAttributes : []);
      setSecondaryAttrs(Array.isArray(parsed.secondaryAttributes) ? parsed.secondaryAttributes : []);
      setSkills(Array.isArray(parsed.skills) ? parsed.skills : []);
      setOtherAttrs(Array.isArray(parsed.otherAttributes) ? parsed.otherAttributes : []);
      setBars(Array.isArray(parsed.bars) ? parsed.bars : []);
      setAttributeSectionColumns({
        ...DEFAULT_ATTRIBUTE_SECTION_COLUMNS,
        ...(parsed.attributeSectionColumns || {}),
      });
      if (typeof parsed.modifierFormula === 'string' && parsed.modifierFormula.trim()) {
        setModFormula(parsed.modifierFormula);
      }
    } catch {
      window.alert('Invalid preset JSON file.');
    }
  };

  const getCharacterContext = () => {
    const context: Record<string, number> = {};
    const baseAttrs = [...(mainAttrs || []), ...(secondaryAttrs || []), ...(otherAttrs || [])];
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
        (status.effects || []).forEach(effect => {
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
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

        (item.effects || []).forEach(effect => {
          if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext);
            if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
            effectBuckets[effect.targetId].push(effVal);
          }
        });

        (item.actions || []).forEach(action => {
          (action.effects || []).forEach(effect => {
            if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
              const effVal = evalCharFormula(effect.value || '0', sourceContext);
              if (!effectBuckets[effect.targetId]) effectBuckets[effect.targetId] = [];
              effectBuckets[effect.targetId].push(effVal);
            }
          });
        });
      });

      (charSpells || []).forEach(spell => {
        (spell.actions || []).forEach(action => {
          (action.effects || []).forEach(effect => {
            if ((effect.active ?? true) && effect.targetId && targetIds.includes(effect.targetId)) {
              const effVal = evalCharFormula(effect.value || '0', sourceContext);
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
        context[`${bar.id}_max`] = 0;
        context[`${bar.id}_current`] = 0;
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
        const baseValue = evalCharFormula(skill.value || '0', {
          ...previousContext,
          ...withModItemEffects,
        });
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
          allValuesWithEffects[`${bar.id}_max`] = evalCharFormula(bar.maxValue || '0', {
            ...previousContext,
            ...allValuesWithEffects,
          });
          allValuesWithEffects[`${bar.id}_current`] = evalCharFormula(bar.currentValue || '0', {
            ...previousContext,
            ...allValuesWithEffects,
          });
        }
      });

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
    [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs].forEach((attr) => {
      if (attr.id) ids.add(attr.id);
    });
    mainAttrs.forEach((attr) => {
      if (attr.id) ids.add(`${attr.id}_mod`);
    });
    bars.forEach((bar) => {
      if (bar.id) {
        ids.add(`${bar.id}_max`);
        ids.add(`${bar.id}_current`);
      }
    });
    return ids;
  };

  const isCharacterOwner = !!selectedCharacter && (selectedCharacter.userId === userId || !selectedCharacter.userId);
  const canEditInventory = !!selectedCharacter && (isCharacterOwner || selectedCharacter.visibility === 'public');

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

  const addInventoryItem = () => {
    setCharInventory(prev => [
      ...prev,
      {
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
        hidden: false,
        folderId: null,
      },
    ]);
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
      effects: [...(item.effects || []), { id: `eff_${uid()}`, targetId: '', value: '0', active: true }],
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

  const addGeneralItem = () => {
    setCharGeneralItems(prev => [
      ...prev,
      { id: `gen_${uid()}`, name: 'New General Item', description: '', quantity: 1, rarity: 'common' },
    ]);
  };

  const updateGeneralItem = (itemId: string, updater: (item: CharacterGeneralItem) => CharacterGeneralItem) => {
    setCharGeneralItems(prev => prev.map(item => item.id === itemId ? updater(item) : item));
  };

  const removeGeneralItem = (itemId: string) => {
    setCharGeneralItems(prev => prev.filter(item => item.id !== itemId));
    setExpandedGeneralItemDescriptions(prev => prev.filter(id => id !== itemId));
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
    const message = [
      `**${item.name || 'Unnamed General Item'}**`,
      `Rarity: ${INVENTORY_RARITY_STYLES[item.rarity || 'common'].label}`,
      `Quantity: ${item.quantity}`,
      item.description ? `Description: ${item.description}` : '',
    ].filter(Boolean).join('\n');
    const discordErr = await sendMessageToDiscord(webhookUrl, selectedCharacter?.name || editName || 'Character Sheet', message);
    if (discordErr) setDiceError(`Discord: ${discordErr}`);
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

  const getAllSheetAttributes = () => [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs];

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

    [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs].forEach((attr) => {
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
      if (Number.isFinite(currentValue)) {
        values[`${bar.id}_current`] = currentValue;
      }
      if (Number.isFinite(maxValue)) {
        values[`${bar.id}_max`] = maxValue;
      }
    });

    return values;
  };

  const exportAttributePreset = () => {
    const payload: CharacterAttributePreset = {
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      skills,
      otherAttributes: otherAttrs,
      bars,
      modifierFormula: modFormula,
      attributeSectionColumns,
    };
    const serialized = JSON.stringify(payload, null, 2);
    const blob = new Blob([serialized], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(editName || 'character').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase()}-attributes.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importAttributePreset = () => {
    attributeImportInputRef.current?.click();
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
      actions: [...(item.actions || []), { id: `act_${uid()}`, name: 'New Action', description: '', cost: '', usageRemaining: '', macros: [], effects: [] }],
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
      effects: [...(current.effects || []), { id: `eff_${uid()}`, targetId: '', value: '0', active: true }],
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
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${item.name}: ${action.name || 'Action'}: ${macro.name}` },
        context,
        ids
      );
      result.description = action.description || item.description || undefined;
      setRollResults(prev => [result, ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const addSpell = () => {
    setCharSpells(prev => [
      ...prev,
      {
        id: `spell_${uid()}`,
        name: 'New Spell',
        description: '',
        level: 'Cantrip',
        resourceCost: '1 AP',
        usageRemaining: '',
        totalUsage: '',
        magicSchool: '',
        color: '#7c3aed',
        macros: [],
        hidden: false,
        folderId: null,
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
      actions: [...(spell.actions || []), { id: `act_${uid()}`, name: 'New Action', description: '', cost: '', usageRemaining: '', macros: [], effects: [] }],
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
      effects: [...(current.effects || []), { id: `eff_${uid()}`, targetId: '', value: '0', active: true }],
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
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${spell.name}: ${action.name || 'Action'}: ${macro.name}` },
        context,
        ids
      );
      result.description = action.description || spell.description || undefined;
      setRollResults(prev => [result, ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

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

  const addMacro = (mode: 'sheet' | 'main') => {
    const id = `macro_${uid()}`;
    setMacrosForMode(mode, prev => [...prev, { id, name: 'New Macro', formula: '1d20' }]);
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
      setRollResults(prev => [result, ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

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
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${item.name}: ${macro.name}` },
        context,
        ids
      );
      result.description = item.description || undefined;
      setRollResults(prev => [result, ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

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
      const ids = getCharacterReferenceIds();
      const result = executeCharacterMacro(
        { ...macro, name: `${spell.name}: ${macro.name}` },
        context,
        ids
      );
      result.description = spell.description || undefined;
      setRollResults(prev => [result, ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

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
      setRollResults(prev => [result, ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

      const activeDiceState = getDiceStateForMode('sheet');
      if (activeDiceState.autoSend) {
        const discordErr = await sendToDiscord(activeDiceState.webhookUrl || '', selectedCharacter?.name || editName, result);
        if (discordErr) setDiceError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setDiceError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollAllCharacterMacros = async (mode: 'sheet' | 'main') => {
    setDiceError(null);
    try {
      const context = getCharacterContext();
      const ids = getCharacterReferenceIds();
      const activeDiceState = getDiceStateForMode(mode);
      const results = activeDiceState.macros.map((macro) => executeCharacterMacro(macro, context, ids));
      setRollResults(prev => [...results.reverse(), ...prev]);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

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

  const renderDicePanel = (mode: 'sheet' | 'main') => {
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

                    setRollResults(prev => [finalResult, ...prev]);
                    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);

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

          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xl text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>⚡ Dice Macros</h3>
              <div className="flex gap-2">
                {activeDiceState.macros.length > 1 && (
                  <button onClick={() => rollAllCharacterMacros(mode)} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/40 text-purple-300 rounded border border-purple-800/40 hover:bg-purple-900/60 transition-colors text-sm cursor-pointer">
                    <Zap size={14} /> Roll All
                  </button>
                )}
                <button onClick={() => addMacro(mode)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 transition-colors text-sm cursor-pointer">
                  <Plus size={14} /> Add Macro
                </button>
              </div>
            </div>

            {activeDiceState.macros.length === 0 ? (
              <div className="text-stone-500 text-center py-8 border border-dashed border-stone-700 rounded-lg">
                No macros yet. Add one to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {activeDiceState.macros.map(macro => {
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
                          <button onClick={() => rollCharacterMacro(macro, mode)} className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-sm font-bold cursor-pointer">
                            <Dices size={14} /> Roll
                          </button>
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

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
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
      userId: userId || 'guest',
      bio: '',
      backstory: '',
      notes: '',
        portraitUrl: '',
        displayStats: [],
        displaySlotStates: {},
        attributeSectionModes: DEFAULT_ATTRIBUTE_SECTION_MODES,
      attributeSectionColumns: DEFAULT_ATTRIBUTE_SECTION_COLUMNS,
      skills: [],
      generalItems: [],
      inventoryFolders: [],
      spellFolders: [],
      createdAt: Date.now(),
    };
    await saveCharacter(newChar);
    setCharacters([...characters, newChar]);
    setSelectedCharacter(newChar);
  };

  const handleSaveAll = async () => {
    if (!selectedCharacter) return;

    if (!isCharacterOwner) {
      if (!canEditInventory) return;
      await saveCharacterInventory(selectedCharacter.id, charInventory, inventoryFolders, collapsedInventoryFolders, charGeneralItems, userId);
      const updated = { ...selectedCharacter, generalItems: charGeneralItems, inventory: charInventory, inventoryFolders, collapsedInventoryFolderIds: collapsedInventoryFolders };
      setCharacters(prev => prev.map(c => (c.id === selectedCharacter.id ? { ...c, generalItems: charGeneralItems, inventory: charInventory, inventoryFolders, collapsedInventoryFolderIds: collapsedInventoryFolders } : c)));
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
      tags: charTags,
      displayStats,
      displaySlotStates,
      attributeSectionModes,
      attributeSectionColumns,
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      skills,
      otherAttributes: otherAttrs,
      bars,
      diceMacros: sheetDiceMacros,
      statuses: charStatuses,
      generalItems: charGeneralItems,
      inventory: charInventory,
      inventoryFolders,
      collapsedInventoryFolderIds: collapsedInventoryFolders,
      collapsedSheetQuickRoll,
      spells: charSpells,
      spellFolders,
      collapsedSpellFolderIds: collapsedSpellFolders,
      modifierFormula: modFormula,
    };
    await saveCharacter(updated);
    setCharacters(characters.map(c => (c.id === updated.id ? updated : c)));
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

  const handleAddToBattleTracker = (characterName: string) => {
    addCombatantToBattleTracker(characterName);
  };

  const renderFolderTree = (
    folders: CharacterEntryFolder[],
    options: {
      editable: boolean;
      emptyLabel: string;
      onAddRoot: () => void;
      onAddChild: (parentId: string) => void;
      onMove: (folderId: string, direction: 'up' | 'down') => void;
      onUpdate: (folderId: string, updater: (folder: CharacterEntryFolder) => CharacterEntryFolder) => void;
      onRemove: (folderId: string) => void;
    }
  ) => {
    const renderNodes = (parentId: string | null = null, depth = 0): React.ReactNode => {
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
                  <option value="">Root</option>
                  {getFolderOptions(folders)
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
              {renderNodes(folder.id, depth + 1)}
            </div>
          ))}
        </div>
      );
    };

    return (
      <div className="mb-6 rounded-xl border border-amber-800/20 bg-black/20 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-lg font-bold text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>Folders</h4>
            <p className="text-sm text-stone-500">Nested categories with color and show/hide controls.</p>
          </div>
          {options.editable && (
            <button
              onClick={options.onAddRoot}
              className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-sm text-amber-200 hover:bg-amber-900/60 cursor-pointer"
            >
              + Add Folder
            </button>
          )}
        </div>
        {folders.length === 0 ? (
          <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
            {options.emptyLabel}
          </div>
        ) : renderNodes()}
      </div>
    );
  };

  // ── Full Character Sheet ─────────────────────────────────────────────────────

    if (isViewingSheet && selectedCharacter) {
      const finalContext = getCharacterContext();
      const attributeEffectHistory: Record<string, Array<{ label: string; value: number; sourceAnchorId?: string }>> = {};
      const pushAttributeHistory = (targetId: string, label: string, value: number, sourceAnchorId?: string) => {
        if (!targetId || !Number.isFinite(value) || Math.abs(value) < 0.0001) return;
        if (!attributeEffectHistory[targetId]) attributeEffectHistory[targetId] = [];
        attributeEffectHistory[targetId].push({ label, value, sourceAnchorId });
      };

      [...mainAttrs, ...secondaryAttrs, ...skills, ...otherAttrs].forEach((attr) => {
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
        (status.effects || []).forEach((effect) => {
          if (!(effect.active ?? true) || !effect.targetId) return;
          const effectValue = evalCharFormula(effect.value || '0', finalContext);
          pushAttributeHistory(effect.targetId, `${status.name || 'Status'} effect`, effectValue, `status-${status.id}`);
        });
      });

      (charInventory || []).forEach((item) => {
        if (!item.equipped) return;
        (item.effects || []).forEach((effect) => {
          if (!(effect.active ?? true) || !effect.targetId) return;
          const effectValue = evalCharFormula(effect.value || '0', finalContext);
          pushAttributeHistory(effect.targetId, `${item.name || 'Item'} effect`, effectValue, `inventory-item-${item.id}`);
        });
        (item.actions || []).forEach((action) => {
          (action.effects || []).forEach((effect) => {
            if (!(effect.active ?? true) || !effect.targetId) return;
            const effectValue = evalCharFormula(effect.value || '0', finalContext);
            pushAttributeHistory(effect.targetId, `${item.name || 'Item'} / ${action.name || 'Action'}`, effectValue, `inventory-item-${item.id}`);
          });
        });
      });

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
      bars.filter(bar => bar.favorite).forEach((bar) => {
        favoriteDisplayMap.set(bar.id, {
          id: bar.id,
          name: bar.name || getReferenceDisplayName(bar.id),
          value: `${finalContext[`${bar.id}_current`] ?? 0}/${finalContext[`${bar.id}_max`] ?? 0}`,
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

    const renderAttributeSection = (
      title: string,
      items: (CustomAttribute | SkillAttribute)[],
      setItems: React.Dispatch<React.SetStateAction<any[]>>,
      idPrefix: string,
      options?: { skillMode?: boolean; sectionKey: keyof CharacterAttributeSectionModes }
    ) => (
      <div className="mb-8">
        <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
          <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>{title}</h3>
          <div className="flex items-center gap-2">
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
                  ? { id: `${idPrefix}_${Date.now().toString(36)}`, name: 'New Skill', value: '0', proficiencyMode: 'none' }
                  : { id: `${idPrefix}_${Date.now().toString(36)}`, name: 'New Attribute', value: '10' },
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
            .map((attr, idx, filteredItems) => {
            const actualIndex = items.findIndex(item => item.id === attr.id);
            const evalVal = finalContext[attr.id] || 0;
            const displayValue = formatAttributeOutput(attr.id, evalVal);
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
                  <span className="text-lg font-bold font-mono text-amber-200">{displayValue}</span>
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
        <input
          ref={attributeImportInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportAttributePresetFile}
          className="hidden"
        />
        <div className="sticky top-3 z-30 mb-6 border border-amber-700/40 bg-stone-950/88 backdrop-blur-md rounded-2xl px-4 py-3 shadow-[0_12px_30px_rgba(0,0,0,0.32)]">
          <div className="flex flex-wrap justify-between items-center gap-3">
          <button onClick={() => setIsViewingSheet(false)} className="flex items-center gap-2 text-amber-500 hover:text-amber-300 font-bold tracking-wider cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>
            <ArrowLeft size={20} /> Back to List
          </button>
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

        <div className="space-y-8">
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
                    onError={() => setPortraitLoadError(true)}
                  />
                ) : (
                  editClass.toLowerCase().includes('arcanist') || editClass.toLowerCase().includes('mage') ? '🔮' : '⚔️'
                )}
              </div>
              <h2 className="text-3xl font-bold text-amber-200 mb-1 text-center" style={{ fontFamily: "'Cinzel', serif" }}>{editName}</h2>
              <p className="text-amber-500/70 text-lg mb-4 italic text-center">{editRace} • {editClass}</p>

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
                <button
                  onClick={() => setCollapsedSheetQuickRoll(prev => !prev)}
                  className="px-3 py-1.5 text-xs text-emerald-100 border border-emerald-700/40 rounded hover:bg-emerald-900/20 cursor-pointer"
                >
                  {collapsedSheetQuickRoll ? 'Show' : 'Collapse'}
                </button>
              </div>
              {!collapsedSheetQuickRoll && renderDicePanel('sheet')}
            </div>
          </div>

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
              {/* 1. Main Attributes */}
              <div className="mb-8">
                <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Main Attributes
                  </h3>
                  <div className="flex items-center gap-2">
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
                  {mainAttrs.filter(attr => attributeSectionModes.main === 'all' || attr.favorite).map((attr, idx, filteredMainAttrs) => {
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

                {renderAttributeSection('✦ Secondary Attributes', secondaryAttrs, setSecondaryAttrs, 'sec', { sectionKey: 'secondary' })}
                {renderAttributeSection('✦ Skills', skills, setSkills, 'skill', { skillMode: true, sectionKey: 'skills' })}
                {renderAttributeSection('✦ Other Attributes', otherAttrs, setOtherAttrs, 'other', { sectionKey: 'other' })}

                <div className="mb-4">
                  <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                    <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                      ✦ Bars
                    </h3>
                    <div className="flex items-center gap-2">
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
                        onClick={() => setBars([...bars, { id: `bar_${Date.now().toString(36)}`, name: 'New Bar', currentValue: '0', maxValue: '100', color: '#f59e0b' }])}
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
                    {bars.filter(bar => attributeSectionModes.bars === 'all' || bar.favorite).map((bar, idx, filteredBars) => {
                      const actualIndex = bars.findIndex(item => item.id === bar.id);
                      const rawMax = finalContext[`${bar.id}_max`] || 0;
                      const rawCurrent = finalContext[`${bar.id}_current`] || 0;
                      const safeMax = rawMax > 0 ? rawMax : 0;
                      const clampedCurrent = safeMax > 0 ? Math.min(Math.max(rawCurrent, 0), safeMax) : 0;
                      const percent = safeMax > 0 ? Math.round((clampedCurrent / safeMax) * 100) : 0;

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
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-500 mb-1">Max Value</label>
                              <input
                                type="text"
                                value={bar.maxValue}
                                onChange={(e) => {
                                  const next = [...bars];
                                  next[actualIndex].maxValue = e.target.value;
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
                              <span>{clampedCurrent} / {safeMax}</span>
                              <span>%{percent}</span>
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
                                %{percent}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}
                </div>
              </div>
            </div>

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
                    <button
                      onClick={() => setCharStatuses([...charStatuses, { id: `st_${Date.now().toString(36)}`, name: 'New Status', duration: '1 round', description: '', effects: [], color: '#f59e0b', hidden: false }])}
                      className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                    >
                      + Add Status
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {charStatuses.map((status, idx) => (
                    <div id={`status-${status.id}`} key={status.id} className="rounded-xl p-4 shadow-lg flex flex-col gap-3 border" style={{ background: `linear-gradient(135deg, ${(status.color || '#f59e0b')}22, rgba(69, 26, 3, 0.18))`, borderColor: `${status.color || '#f59e0b'}55` }}>
                      <div className="flex items-center justify-between gap-3">
                        <input
                          type="text"
                          value={status.name}
                          onChange={(e) => {
                            const next = [...charStatuses];
                            next[idx].name = e.target.value;
                            setCharStatuses(next);
                          }}
                          className="bg-transparent text-base font-bold text-amber-200 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-40"
                        />
                        <input
                          type="text"
                          value={status.duration}
                          onChange={(e) => {
                            const next = [...charStatuses];
                            next[idx].duration = e.target.value;
                            setCharStatuses(next);
                          }}
                          className="bg-stone-900/40 border border-stone-800/40 rounded px-2 py-1 text-xs text-amber-500 w-24 focus:outline-none"
                          placeholder="Duration"
                        />
                        <input
                          type="color"
                          value={status.color || '#f59e0b'}
                          onChange={(e) => {
                            const next = [...charStatuses];
                            next[idx].color = e.target.value;
                            setCharStatuses(next);
                          }}
                          className="h-9 w-12 rounded border border-stone-700 bg-stone-900/60 px-1 py-1 cursor-pointer"
                        />
                        <button
                          onClick={() => {
                            const next = [...charStatuses];
                            next[idx].hidden = !next[idx].hidden;
                            setCharStatuses(next);
                          }}
                          className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                        >
                          {status.hidden ? 'Show' : 'Hide'}
                        </button>
                        <button
                          onClick={() => setCharStatuses(charStatuses.filter((_, i) => i !== idx))}
                          className="text-stone-600 hover:text-red-400 cursor-pointer ml-auto"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {!status.hidden && (
                      <>
                      <textarea
                        ref={(el) => { statusDescriptionRefs.current[status.id] = el; }}
                        value={status.description}
                        onChange={(e) => {
                          const next = [...charStatuses];
                          next[idx].description = e.target.value;
                          setCharStatuses(next);
                        }}
                        placeholder="Description of the status"
                        rows={expandedStatusDescriptions.includes(status.id) ? 6 : 2}
                        className="w-full bg-stone-900/60 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none"
                      />
                      <button
                        onClick={() => toggleStatusDescription(status.id)}
                        className="text-base text-amber-300 hover:text-amber-200 cursor-pointer self-start"
                      >
                        {expandedStatusDescriptions.includes(status.id) ? 'Hide' : 'Show More'}
                      </button>
                      <button
                        onClick={() => openHomebrewViewer('status', status.id)}
                        className="inline-flex items-center gap-1 text-sm text-sky-300 hover:text-sky-200 cursor-pointer self-start"
                      >
                        <Share2 size={14} /> Share Web
                      </button>

                      {/* Effects area */}
                      <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-base font-bold text-stone-300">Effects</label>
                          <button
                            onClick={() => {
                              const next = [...charStatuses];
                              next[idx].effects = [...(next[idx].effects || []), { id: `eff_${uid()}`, targetId: '', value: '0', active: true }];
                              setCharStatuses(next);
                            }}
                            className="text-sm bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300"
                          >
                            + Add Effect
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(status.effects || []).map((effect, effIdx) => (
                            <div key={effIdx} className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const next = [...charStatuses];
                                  next[idx].effects[effIdx].active = !(next[idx].effects[effIdx].active ?? true);
                                  setCharStatuses(next);
                                }}
                                className={`px-2 py-1 rounded border text-sm cursor-pointer ${(effect.active ?? true) ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-stone-900/40 border-stone-700/40 text-stone-400'}`}
                              >
                                {(effect.active ?? true) ? 'On' : 'Off'}
                              </button>
                              <input
                                type="text"
                                value={effect.targetId}
                                onChange={(e) => {
                                  const next = [...charStatuses];
                                  next[idx].effects[effIdx].targetId = e.target.value;
                                  setCharStatuses(next);
                                }}
                                placeholder="Target ID (e.g. wis_mod)"
                                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-400 font-mono focus:outline-none w-1/2"
                              />
                              <input
                                type="text"
                                value={effect.value}
                                onChange={(e) => {
                                  const next = [...charStatuses];
                                  next[idx].effects[effIdx].value = e.target.value;
                                  setCharStatuses(next);
                                }}
                                placeholder="Value (e.g. -2)"
                                className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none w-1/4"
                              />
                              <button
                                onClick={() => {
                                  const next = [...charStatuses];
                                  next[idx].effects = next[idx].effects.filter((_, i) => i !== effIdx);
                                  setCharStatuses(next);
                                }}
                                className="text-stone-600 hover:text-red-400 cursor-pointer ml-auto"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          {(status.effects || []).length === 0 && <span className="text-[10px] text-stone-600 italic">No effects added.</span>}
                        </div>
                      </div>
                      </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

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
                      {canEditInventory && (
                        <button
                          onClick={addInventoryItem}
                          className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                        >
                          + Add Item
                        </button>
                      )}
                    </div>
                  </div>

                  {!canEditInventory && (
                    <div className="mb-3 text-sm text-stone-500 italic">
                      Inventory can be edited by the owner, or by anyone when the character is public.
                    </div>
                  )}

                  {renderFolderTree(inventoryFolders, {
                    editable: canEditInventory,
                    emptyLabel: 'No inventory folders yet.',
                    onAddRoot: () => addInventoryFolder(),
                    onAddChild: (parentId) => addInventoryFolder(parentId),
                    onMove: moveInventoryFolder,
                    onUpdate: updateInventoryFolder,
                    onRemove: removeInventoryFolder,
                  })}

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
                        {charGeneralItems.map((item) => {
                          const isExpanded = expandedGeneralItemDescriptions.includes(item.id);
                          const rarityKey = item.rarity || 'common';
                          const rarityStyle = INVENTORY_RARITY_STYLES[rarityKey];
                          return (
                            <div key={item.id} className={`rounded-lg border p-3 flex flex-col gap-2 ${rarityStyle.card}`}>
                              <div className="flex flex-wrap items-center gap-2">
                                <input
                                  type="text"
                                  value={item.name}
                                  onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, name: e.target.value }))}
                                  disabled={!canEditInventory}
                                  className="min-w-[180px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                  placeholder="Potion of Healing"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  value={item.quantity}
                                  onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, quantity: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                  disabled={!canEditInventory}
                                  className="w-24 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                />
                                <select
                                  value={rarityKey}
                                  onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, rarity: e.target.value as CharacterGeneralItem['rarity'] }))}
                                  disabled={!canEditInventory}
                                  className="min-w-[140px] bg-stone-900/60 border border-stone-800 rounded px-2 py-2 text-xs text-amber-100 focus:outline-none disabled:opacity-60"
                                >
                                  {INVENTORY_RARITIES.map((rarity) => (
                                    <option key={rarity} value={rarity}>
                                      {INVENTORY_RARITY_STYLES[rarity].label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  onClick={() => toggleGeneralItemDescription(item.id)}
                                  className="px-2 py-1 text-xs text-amber-300 hover:text-amber-200 border border-amber-800/30 rounded cursor-pointer"
                                >
                                  {isExpanded ? 'Hide' : 'Show'}
                                </button>
                                <button
                                  onClick={() => shareGeneralItem(item)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-sky-900/30 border border-sky-800/40 rounded text-xs text-sky-200 hover:bg-sky-900/50 cursor-pointer"
                                >
                                  <Share2 size={13} /> Share
                                </button>
                                <button
                                  onClick={() => openHomebrewViewer('general-item', item.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-900/30 border border-indigo-800/40 rounded text-xs text-indigo-200 hover:bg-indigo-900/50 cursor-pointer"
                                >
                                  <Share2 size={13} /> Share Web
                                </button>
                                {canEditInventory && (
                                  <button
                                    onClick={() => removeGeneralItem(item.id)}
                                    className="p-1.5 text-stone-500 hover:text-red-400 cursor-pointer"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </div>
                              {isExpanded && (
                                <textarea
                                  ref={(el) => { generalItemDescriptionRefs.current[item.id] = el; }}
                                  value={item.description}
                                  onChange={(e) => updateGeneralItem(item.id, current => ({ ...current, description: e.target.value }))}
                                  disabled={!canEditInventory}
                                  rows={4}
                                  placeholder="Description"
                                  className="w-full bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {charInventory.length === 0 ? (
                    <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      No inventory items yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {charInventory
                        .filter(item => isFolderVisible(inventoryFolders, item.folderId))
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
                        return (
                        <React.Fragment key={item.id}>
                        {folderLabel && previousFolderId !== effectiveFolderId && (
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

                          <div className="flex flex-wrap gap-3 items-start">
                            <input
                              type="text"
                              value={item.name}
                              onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, name: e.target.value }))}
                              disabled={!canEditInventory}
                              className="min-w-[220px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Item name"
                            />
                            <div className="min-w-[170px] flex-1 sm:flex-none grid grid-cols-[1fr_auto] gap-2">
                              <input
                                type="number"
                                min={0}
                                value={item.quantity}
                                onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, quantity: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                                disabled={!canEditInventory}
                                className="min-w-0 w-full bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60 font-mono"
                                placeholder="Qty"
                              />
                              <button
                                onClick={() => canEditInventory && updateInventoryItem(item.id, current => ({ ...current, equipped: !current.equipped, status: !current.equipped ? 'equipped' : (current.status === 'equipped' ? 'unequipped' : current.status) }))}
                                disabled={!canEditInventory}
                                className={`px-2 rounded border transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${item.equipped ? 'bg-amber-400/20 border-amber-300/60 text-amber-100 shadow-[0_0_14px_rgba(251,191,36,0.35)]' : 'bg-stone-900/60 border-stone-700 text-stone-400 hover:text-amber-200'}`}
                                title={item.equipped ? 'Unequip item' : 'Equip item'}
                              >
                                <Shield size={15} />
                              </button>
                            </div>
                            <input
                              type="text"
                              value={item.status}
                              onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, status: e.target.value }))}
                              disabled={!canEditInventory}
                              className="min-w-[180px] flex-1 sm:flex-none bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="unequipped"
                            />
                            <select
                              value={rarityKey}
                              onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, rarity: e.target.value as CharacterInventoryItem['rarity'] }))}
                              disabled={!canEditInventory}
                              className="min-w-[180px] flex-1 sm:flex-none bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            >
                              {INVENTORY_RARITIES.map((rarity) => (
                                <option key={rarity} value={rarity}>
                                  {INVENTORY_RARITY_STYLES[rarity].label}
                                </option>
                              ))}
                            </select>
                            <select
                              value={item.folderId ?? ''}
                              onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, folderId: e.target.value || null }))}
                              disabled={!canEditInventory}
                              className="min-w-[200px] flex-1 sm:flex-none bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            >
                              <option value="">No folder</option>
                              {getFolderOptions(inventoryFolders).map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
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
                              rows={isDescriptionExpanded ? 6 : 2}
                              className="w-full bg-stone-900/60 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                            />
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => toggleInventoryDescription(item.id)}
                                className="text-base text-amber-300 hover:text-amber-200 cursor-pointer"
                              >
                                {isDescriptionExpanded ? 'Hide' : 'Show More'}
                              </button>
                              <button
                                onClick={() => shareInventoryItem(item)}
                                className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
                              >
                                <Share2 size={12} /> Share
                              </button>
                              <button
                                onClick={() => openHomebrewViewer('inventory-item', item.id)}
                                className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 cursor-pointer"
                              >
                                <Share2 size={12} /> Share Web
                              </button>
                            </div>
                          </div>

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
                                        <input
                                          type="text"
                                          value={action.name}
                                          onChange={(e) => updateInventoryAction(item.id, action.id, current => ({ ...current, name: e.target.value }))}
                                          disabled={!canEditInventory}
                                          placeholder="Action name"
                                          className="min-w-[180px] bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                        />
                                        <input
                                          type="text"
                                          value={action.cost}
                                          onChange={(e) => updateInventoryAction(item.id, action.id, current => ({ ...current, cost: e.target.value }))}
                                          disabled={!canEditInventory}
                                          placeholder="Cost"
                                          className="min-w-[140px] bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                        />
                                        <input
                                          type="text"
                                          value={action.usageRemaining}
                                          onChange={(e) => updateInventoryAction(item.id, action.id, current => ({ ...current, usageRemaining: e.target.value }))}
                                          disabled={!canEditInventory}
                                          placeholder="Remaining usage"
                                          className="min-w-[160px] bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                        />
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
                                        rows={isExpanded ? 6 : 2}
                                        placeholder="Action description"
                                        className="w-full bg-stone-900 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                                      />
                                      <button
                                        onClick={() => toggleInventoryActionDescription(action.id)}
                                        className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer"
                                      >
                                        {isExpanded ? 'Hide' : 'Show More'}
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
                                            <button
                                              onClick={() => addInventoryActionEffect(item.id, action.id)}
                                              className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                            >
                                              + Add Effect
                                            </button>
                                          )}
                                        </div>
                                        {(action.effects || []).length === 0 ? (
                                          <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                                        ) : (
                                          <div className="space-y-2">
                                            {(action.effects || []).map((effect, effectIndex) => (
                                              <div key={`${action.id}-effect-${effectIndex}`} className="grid grid-cols-1 md:grid-cols-[auto_1fr_140px_auto] gap-2 items-center">
                                                <button
                                                  onClick={() => updateInventoryActionEffect(item.id, action.id, effectIndex, current => ({ ...current, active: !(current.active ?? true) }))}
                                                  className={`h-8 min-w-[3.5rem] px-2 rounded border text-xs font-bold cursor-pointer justify-self-start ${(effect.active ?? true) ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-stone-900/40 border-stone-700/40 text-stone-400'}`}
                                                >
                                                  {(effect.active ?? true) ? 'On' : 'Off'}
                                                </button>
                                                <input
                                                  type="text"
                                                  value={effect.targetId}
                                                  onChange={(e) => updateInventoryActionEffect(item.id, action.id, effectIndex, current => ({ ...current, targetId: e.target.value }))}
                                                  disabled={!canEditInventory}
                                                  placeholder="Target ID (e.g. str_mod)"
                                                  className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-400 font-mono focus:outline-none disabled:opacity-60"
                                                />
                                                <input
                                                  type="text"
                                                  value={effect.value}
                                                  onChange={(e) => updateInventoryActionEffect(item.id, action.id, effectIndex, current => ({ ...current, value: e.target.value }))}
                                                  disabled={!canEditInventory}
                                                  placeholder="Value (e.g. +2)"
                                                  className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                                />
                                                {canEditInventory ? (
                                                  <button
                                                    onClick={() => removeInventoryActionEffect(item.id, action.id, effectIndex)}
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
                                <button
                                  onClick={() => addInventoryEffect(item.id)}
                                  className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                >
                                  + Add Effect
                                </button>
                              )}
                            </div>
                            {(item.effects || []).length === 0 ? (
                              <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                            ) : (
                              <div className="space-y-2">
                                {(item.effects || []).map((effect, effectIndex) => (
                                  <div key={`${item.id}-effect-${effectIndex}`} className="grid grid-cols-1 md:grid-cols-[auto_1fr_140px_auto] gap-2 items-center">
                                    <button
                                      onClick={() => updateInventoryEffect(item.id, effectIndex, current => ({ ...current, active: !(current.active ?? true) }))}
                                      className={`h-8 min-w-[3.5rem] px-2 rounded border text-xs font-bold cursor-pointer justify-self-start ${(effect.active ?? true) ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-stone-900/40 border-stone-700/40 text-stone-400'}`}
                                    >
                                      {(effect.active ?? true) ? 'On' : 'Off'}
                                    </button>
                                    <input
                                      type="text"
                                      value={effect.targetId}
                                      onChange={(e) => updateInventoryEffect(item.id, effectIndex, current => ({ ...current, targetId: e.target.value }))}
                                      disabled={!canEditInventory}
                                      placeholder="Target ID (e.g. str_mod)"
                                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-400 font-mono focus:outline-none disabled:opacity-60"
                                    />
                                    <input
                                      type="text"
                                      value={effect.value}
                                      onChange={(e) => updateInventoryEffect(item.id, effectIndex, current => ({ ...current, value: e.target.value }))}
                                      disabled={!canEditInventory}
                                      placeholder="Value (e.g. +2)"
                                      className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                    />
                                    {canEditInventory ? (
                                      <button
                                        onClick={() => removeInventoryEffect(item.id, effectIndex)}
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
                      {isCharacterOwner && (
                        <button
                          onClick={addSpell}
                          className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                        >
                          + Add Spell
                        </button>
                      )}
                    </div>
                  </div>

                  {!isCharacterOwner && (
                    <div className="mb-3 text-sm text-stone-500 italic">
                      Only the character owner can edit spells and abilities.
                    </div>
                  )}

                  {renderFolderTree(spellFolders, {
                    editable: isCharacterOwner,
                    emptyLabel: 'No spell folders yet.',
                    onAddRoot: () => addSpellFolder(),
                    onAddChild: (parentId) => addSpellFolder(parentId),
                    onMove: moveSpellFolder,
                    onUpdate: updateSpellFolder,
                    onRemove: removeSpellFolder,
                  })}

                  {charSpells.length === 0 ? (
                    <div className="text-sm text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      No spells or abilities yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {charSpells
                        .filter(spell => isFolderVisible(spellFolders, spell.folderId))
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
                        const isFolderSectionCollapsed = !!collapsedAncestorId;
                        return (
                        <React.Fragment key={spell.id}>
                        {getFolderPathLabel(spellFolders, effectiveFolderId) && previousFolderId !== effectiveFolderId && (
                          <div
                            className="relative rounded-lg border px-4 py-2 text-sm font-bold tracking-wide text-amber-100 flex items-center justify-between gap-3"
                            style={{
                              marginLeft: `${Math.max(0, getFolderDepth(spellFolders, effectiveFolderId) - 1) * 20}px`,
                              borderColor: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}55`,
                              background: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}18`,
                            }}
                          >
                            {getFolderDepth(spellFolders, effectiveFolderId) > 0 && (
                              <div
                                className="absolute -left-4 top-1/2 h-px w-4"
                                style={{ backgroundColor: `${spellFolders.find(folder => folder.id === effectiveFolderId)?.color || '#7c3aed'}88` }}
                              />
                            )}
                            <span>{getFolderPathLabel(spellFolders, effectiveFolderId)}</span>
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
                            {isCharacterOwner && (
                              <div className="flex items-center gap-1">
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
                              </div>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-3 items-start">
                            <input
                              type="text"
                              value={spell.name}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, name: e.target.value }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[220px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-base text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Spell or ability name"
                            />
                            <input
                              type="text"
                              value={spell.level}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, level: e.target.value }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[140px] flex-1 sm:flex-none bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Level"
                            />
                            <input
                              type="text"
                              value={spell.magicSchool}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, magicSchool: e.target.value }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[180px] flex-1 sm:flex-none bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Magic school"
                            />
                            <div className="flex items-center gap-2 min-w-[150px]">
                              <label className="text-xs text-stone-300 whitespace-nowrap">Color</label>
                              <input
                                type="color"
                                value={spell.color || '#7c3aed'}
                                onChange={(e) => updateSpell(spell.id, current => ({ ...current, color: e.target.value }))}
                                disabled={!isCharacterOwner}
                                className="h-10 w-14 bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer disabled:opacity-60"
                              />
                            </div>
                            <button
                              onClick={() => updateSpell(spell.id, current => ({ ...current, hidden: !current.hidden }))}
                              className="px-2 py-1 text-xs text-amber-200 border border-amber-800/40 rounded hover:bg-amber-900/20 cursor-pointer"
                            >
                              {spell.hidden ? 'Show' : 'Hide'}
                            </button>
                            <select
                              value={spell.folderId ?? ''}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, folderId: e.target.value || null }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[200px] flex-1 sm:flex-none bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                            >
                              <option value="">No folder</option>
                              {getFolderOptions(spellFolders).map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {!spell.hidden && (
                          <>
                          <textarea
                            ref={(el) => { spellDescriptionRefs.current[spell.id] = el; }}
                              value={spell.description}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, description: e.target.value }))}
                              disabled={!isCharacterOwner}
                              placeholder="Description"
                              rows={expandedSpellDescriptions.includes(spell.id) ? 6 : 3}
                              className="w-full bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                            />
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleSpellDescription(spell.id)}
                              className="text-sm text-amber-300 hover:text-amber-200 cursor-pointer"
                            >
                              {expandedSpellDescriptions.includes(spell.id) ? 'Hide' : 'Show More'}
                            </button>
                            <button
                              onClick={() => shareSpell(spell)}
                              className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
                            >
                              <Share2 size={12} /> Share
                            </button>
                            <button
                              onClick={() => openHomebrewViewer('spell', spell.id)}
                              className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 cursor-pointer"
                            >
                              <Share2 size={12} /> Share Web
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <input
                              type="text"
                              value={spell.resourceCost}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, resourceCost: e.target.value }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[170px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Resource cost"
                            />
                            <input
                              type="text"
                              value={spell.usageRemaining}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, usageRemaining: e.target.value }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[160px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Usage remaining"
                            />
                            <input
                              type="text"
                              value={spell.totalUsage}
                              onChange={(e) => updateSpell(spell.id, current => ({ ...current, totalUsage: e.target.value }))}
                              disabled={!isCharacterOwner}
                              className="min-w-[160px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
                              placeholder="Total usage"
                            />
                          </div>

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
                                        <input
                                          type="text"
                                          value={action.name}
                                          onChange={(e) => updateSpellAction(spell.id, action.id, current => ({ ...current, name: e.target.value }))}
                                          disabled={!isCharacterOwner}
                                          placeholder="Action name"
                                          className="min-w-[180px] bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                        />
                                        <input
                                          type="text"
                                          value={action.cost}
                                          onChange={(e) => updateSpellAction(spell.id, action.id, current => ({ ...current, cost: e.target.value }))}
                                          disabled={!isCharacterOwner}
                                          placeholder="Cost"
                                          className="min-w-[140px] bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                        />
                                        <input
                                          type="text"
                                          value={action.usageRemaining}
                                          onChange={(e) => updateSpellAction(spell.id, action.id, current => ({ ...current, usageRemaining: e.target.value }))}
                                          disabled={!isCharacterOwner}
                                          placeholder="Remaining usage"
                                          className="min-w-[160px] bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none disabled:opacity-60"
                                        />
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
                                        rows={isExpanded ? 6 : 2}
                                        placeholder="Action description"
                                        className="w-full bg-stone-900 border border-stone-800 rounded px-4 py-3 text-base text-amber-100 focus:outline-none resize-none disabled:opacity-60"
                                      />
                                      <button
                                        onClick={() => toggleSpellActionDescription(action.id)}
                                        className="mt-2 text-base text-amber-300 hover:text-amber-200 cursor-pointer"
                                      >
                                        {isExpanded ? 'Hide' : 'Show More'}
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
                                            <button
                                              onClick={() => addSpellActionEffect(spell.id, action.id)}
                                              className="text-xs bg-amber-900/20 hover:bg-amber-900/40 px-2 py-1 rounded text-amber-300 cursor-pointer"
                                            >
                                              + Add Effect
                                            </button>
                                          )}
                                        </div>
                                        {(action.effects || []).length === 0 ? (
                                          <span className="text-[10px] text-stone-600 italic">No effects added.</span>
                                        ) : (
                                          <div className="space-y-2">
                                            {(action.effects || []).map((effect, effectIndex) => (
                                              <div key={`${action.id}-effect-${effectIndex}`} className="grid grid-cols-1 md:grid-cols-[auto_1fr_140px_auto] gap-2 items-center">
                                                <button
                                                  onClick={() => updateSpellActionEffect(spell.id, action.id, effectIndex, current => ({ ...current, active: !(current.active ?? true) }))}
                                                  className={`h-8 min-w-[3.5rem] px-2 rounded border text-xs font-bold cursor-pointer justify-self-start ${(effect.active ?? true) ? 'bg-emerald-900/30 border-emerald-700/40 text-emerald-300' : 'bg-stone-900/40 border-stone-700/40 text-stone-400'}`}
                                                >
                                                  {(effect.active ?? true) ? 'On' : 'Off'}
                                                </button>
                                                <input
                                                  type="text"
                                                  value={effect.targetId}
                                                  onChange={(e) => updateSpellActionEffect(spell.id, action.id, effectIndex, current => ({ ...current, targetId: e.target.value }))}
                                                  disabled={!isCharacterOwner}
                                                  placeholder="Target ID (e.g. str_mod)"
                                                  className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-emerald-400 font-mono focus:outline-none disabled:opacity-60"
                                                />
                                                <input
                                                  type="text"
                                                  value={effect.value}
                                                  onChange={(e) => updateSpellActionEffect(spell.id, action.id, effectIndex, current => ({ ...current, value: e.target.value }))}
                                                  disabled={!isCharacterOwner}
                                                  placeholder="Value (e.g. +2)"
                                                  className="bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 font-mono focus:outline-none disabled:opacity-60"
                                                />
                                                {isCharacterOwner ? (
                                                  <button
                                                    onClick={() => removeSpellActionEffect(spell.id, action.id, effectIndex)}
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
          </div>
        </div>
      </div>
    );
  }

  // ── Main List View ────────────────────────────────────────────────────────────

  return (
    <div className="w-full flex flex-col gap-6" style={{ fontFamily: "'IM Fell English', serif" }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-amber-900/30 pb-4">
        <div>
          <h2 className="text-3xl font-bold text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>🛡️ Characters</h2>
          <p className="text-stone-400 text-sm mt-1">Build your roster of heroes. All data is saved securely.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleCreate} className="flex items-center gap-1.5 px-4 py-2 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 text-sm cursor-pointer shadow-md">
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
            <h3 className="text-lg text-amber-300 font-bold mb-4 flex items-center justify-between" style={{ fontFamily: "'Cinzel', serif" }}>
              <span>📜 Character List</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectedCharacter && handleAddToBattleTracker(selectedCharacter.name)}
                  disabled={!selectedCharacter}
                  className="px-2.5 py-1 text-[10px] rounded border border-blue-800/40 bg-blue-950/30 text-blue-200 hover:bg-blue-900/40 hover:border-blue-500/60 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 flex-1 overflow-y-auto pr-1 auto-rows-min">
                {filteredCharacters.map((char) => {
                  const isSelected = selectedCharacter?.id === char.id;
                  const isFav = favoriteIds.includes(char.id);
                  return (
                    <div
                      key={char.id}
                      onClick={() => setSelectedCharacter(char)}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all select-none group min-h-[88px] ${isSelected ? 'bg-amber-900/30 border-amber-500/50 shadow-md ring-1 ring-inset ring-amber-500/30' : 'bg-black/20 border-stone-800/50 hover:bg-amber-950/10 hover:border-stone-700/60'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-11 h-11 rounded-lg border-2 flex items-center justify-center font-bold text-sm shrink-0 font-mono transition-all overflow-hidden ${isSelected ? 'border-amber-400 bg-amber-900/50 text-amber-200' : 'border-amber-700/30 bg-stone-900/60 text-amber-300/80'}`}>
                          {char.portraitUrl ? (
                            <img
                              src={char.portraitUrl}
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
                            style={{ display: char.portraitUrl ? 'none' : 'flex' }}
                            className="w-full h-full items-center justify-center"
                          >
                            {(char.name || '?').slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <h4 className={`text-base font-bold truncate ${isSelected ? 'text-amber-100' : 'text-amber-200/80 group-hover:text-amber-200'}`} style={{ fontFamily: "'Cinzel', serif" }}>
                            {char.name}
                            {char.visibility === 'public' && char.userId !== userId && (
                              <span className="ml-1.5 text-xs text-sky-400/70">🌐</span>
                            )}
                          </h4>
                          <p className="text-xs text-amber-600/70 italic truncate">
                            {char.race} • {char.className}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={(e) => handleToggleFav(e, char.id)}
                          className={`p-1.5 rounded-full hover:bg-amber-800/20 transition-colors cursor-pointer ${isFav ? 'text-amber-400' : 'text-stone-600 hover:text-stone-400'}`}
                          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star size={16} fill={isFav ? 'currentColor' : 'none'} />
                        </button>
                        {(char.userId === userId || !char.userId) && (
                          <button
                            onClick={(e) => handleDelete(e, char.id)}
                            className="p-1.5 text-stone-700 hover:text-red-400 opacity-0 group-hover:opacity-100 rounded-full hover:bg-red-950/20 transition-all cursor-pointer"
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
                  ID: {selectedCharacter.id.slice(0, 8)} • {selectedCharacter.userId === userId ? 'Owner' : 'Viewer'}
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
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Race</label>
                  <input value={editRace} onChange={(e) => setEditRace(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" placeholder="Human, Elf..." />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Vocation / Class</label>
                  <input value={editClass} onChange={(e) => setEditClass(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" placeholder="Vanguard, Arcanist..." />
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
                      <span className="text-xs text-stone-600">(read only — owner only)</span>
                    </div>
                  )}
                </div>

                <div className="mt-2 flex gap-2">
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
