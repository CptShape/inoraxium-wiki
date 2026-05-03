import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Star, Trash2, Save, ArrowLeft, Shield, Wand2, RefreshCw, Search, X, Filter, Settings, Dices, Zap, Edit3, Check, AlertTriangle, ArrowUp, ArrowDown, Share2 } from 'lucide-react';
import { CharacterBar, CharacterData, CharacterDiceMacro, CharacterDisplayStat, CharacterInventoryItem, CharacterSpell, CustomAttribute, CharacterStatus, StatusEffect } from '../types/character';

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
import { loadCharacters, saveCharacter, saveCharacterInventory, deleteCharacterFromDB, loadFavorites, loadUserDiceSettings, saveUserDiceSettings, toggleFavorite as toggleFavoriteDB, UserDiceSettings } from '../lib/firestore';
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
  otherAttributes: CustomAttribute[];
  bars: CharacterBar[];
  modifierFormula: string;
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
  const [editVisibility, setEditVisibility] = useState<'private' | 'public'>('private');
  const [backstory, setBackstory] = useState('');
  const [notes, setNotes] = useState('');
  const [portraitUrl, setPortraitUrl] = useState('');
  const [portraitImportUrl, setPortraitImportUrl] = useState('');
  const [portraitLoadError, setPortraitLoadError] = useState(false);
  const [displayStats, setDisplayStats] = useState<CharacterDisplayStat[]>([]);
  const [charTags, setCharTags] = useState<string[]>([]);
  const [charTagInput, setCharTagInput] = useState('');
  
  const [mainAttrs, setMainAttrs] = useState<CustomAttribute[]>([]);
  const [secondaryAttrs, setSecondaryAttrs] = useState<CustomAttribute[]>([]);
  const [otherAttrs, setOtherAttrs] = useState<CustomAttribute[]>([]);
  const [bars, setBars] = useState<CharacterBar[]>([]);
  const [charStatuses, setCharStatuses] = useState<CharacterStatus[]>([]);
  const [charInventory, setCharInventory] = useState<CharacterInventoryItem[]>([]);
  const [expandedInventoryDescriptions, setExpandedInventoryDescriptions] = useState<string[]>([]);
  const [charSpells, setCharSpells] = useState<CharacterSpell[]>([]);
  const [expandedSpellDescriptions, setExpandedSpellDescriptions] = useState<string[]>([]);
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
  const inventoryDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const spellDescriptionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const backstoryRef = useRef<HTMLTextAreaElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const attributeImportInputRef = useRef<HTMLInputElement | null>(null);

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
      setEditVisibility(selectedCharacter.visibility ?? 'private');
      setBackstory(selectedCharacter.backstory ?? selectedCharacter.bio ?? '');
      setNotes(selectedCharacter.notes || '');
      setPortraitUrl(selectedCharacter.portraitUrl || '');
      setPortraitImportUrl(selectedCharacter.portraitUrl || '');
      setPortraitLoadError(false);
      setDisplayStats(selectedCharacter.displayStats || []);
      setCharTags(selectedCharacter.tags || []);
      setMainAttrs(selectedCharacter.mainAttributes || []);
      setSecondaryAttrs(selectedCharacter.secondaryAttributes || []);
      setOtherAttrs(selectedCharacter.otherAttributes || []);
      setBars(selectedCharacter.bars || []);
      setSheetDiceMacros(selectedCharacter.diceMacros || DEFAULT_CHARACTER_DICE_STATE.macros);
      setCharStatuses(selectedCharacter.statuses || []);
      setCharInventory(selectedCharacter.inventory || []);
      setCharSpells(selectedCharacter.spells || []);
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
    setExpandedInventoryDescriptions([]);
    setExpandedSpellDescriptions([]);
    setExpandedBackstory(false);
    setExpandedNotes(false);
    setShowPortraitPicker(false);
  }, [selectedCharacter]);

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
      setOtherAttrs(Array.isArray(parsed.otherAttributes) ? parsed.otherAttributes : []);
      setBars(Array.isArray(parsed.bars) ? parsed.bars : []);
      if (typeof parsed.modifierFormula === 'string' && parsed.modifierFormula.trim()) {
        setModFormula(parsed.modifierFormula);
      }
    } catch {
      window.alert('Invalid preset JSON file.');
    }
  };

  const getCharacterContext = () => {
    const context: Record<string, number> = {};
    const allAttrs = [...(mainAttrs || []), ...(secondaryAttrs || []), ...(otherAttrs || [])];
    const mainAttrIds = (mainAttrs || []).map(a => a.id).filter(Boolean);
    const attrIds = allAttrs.map(a => a.id).filter(Boolean);
    const modIds = mainAttrIds.map(id => `${id}_mod`);

    const applyStatusEffects = (
      targetIds: string[],
      baseValues: Record<string, number>,
      sourceContext: Record<string, number>
    ) => {
      const nextValues = { ...baseValues };

      (charStatuses || []).forEach(status => {
        (status.effects || []).forEach(effect => {
          if (effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext);
            nextValues[effect.targetId] = (nextValues[effect.targetId] || 0) + effVal;
          }
        });
      });

      return nextValues;
    };

    const applyInventoryEffects = (
      targetIds: string[],
      baseValues: Record<string, number>,
      sourceContext: Record<string, number>
    ) => {
      const nextValues = { ...baseValues };

      (charInventory || []).forEach(item => {
        if (!item.equipped) return;

        (item.effects || []).forEach(effect => {
          if (effect.targetId && targetIds.includes(effect.targetId)) {
            const effVal = evalCharFormula(effect.value || '0', sourceContext);
            nextValues[effect.targetId] = (nextValues[effect.targetId] || 0) + effVal;
          }
        });
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

      allAttrs.forEach(attr => {
        if (attr.id) {
          nextContext[attr.id] = evalCharFormula(attr.value || '0', previousContext);
        }
      });

      const attributesWithStatuses = applyStatusEffects(
        attrIds,
        nextContext,
        { ...previousContext, ...nextContext }
      );

      const attributesWithItemEffects = applyInventoryEffects(
        attrIds,
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

      (bars || []).forEach(bar => {
        if (bar.id) {
          withModItemEffects[`${bar.id}_max`] = evalCharFormula(bar.maxValue || '0', {
            ...previousContext,
            ...withModItemEffects,
          });
          withModItemEffects[`${bar.id}_current`] = evalCharFormula(bar.currentValue || '0', {
            ...previousContext,
            ...withModItemEffects,
          });
        }
      });

      const nextKeys = new Set([...Object.keys(context), ...Object.keys(withModItemEffects)]);
      let hasChanged = false;

      nextKeys.forEach((key) => {
        const prevValue = previousContext[key] ?? 0;
        const nextValue = withModItemEffects[key] ?? 0;
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
    [...mainAttrs, ...secondaryAttrs, ...otherAttrs].forEach((attr) => {
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
      },
    ]);
  };

  const updateInventoryItem = (itemId: string, updater: (item: CharacterInventoryItem) => CharacterInventoryItem) => {
    setCharInventory(prev => prev.map(item => item.id === itemId ? updater(item) : item));
  };

  const removeInventoryItem = (itemId: string) => {
    setCharInventory(prev => prev.filter(item => item.id !== itemId));
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
      effects: [...(item.effects || []), { targetId: '', value: '0' }],
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

  const addDisplayStat = () => {
    setDisplayStats(prev => [...prev, { id: `display_${uid()}`, referenceId: '' }]);
  };

  const updateDisplayStat = (statId: string, referenceId: string) => {
    setDisplayStats(prev => prev.map(stat => stat.id === statId ? { ...stat, referenceId } : stat));
  };

  const removeDisplayStat = (statId: string) => {
    setDisplayStats(prev => prev.filter(stat => stat.id !== statId));
  };

  const exportAttributePreset = () => {
    const payload: CharacterAttributePreset = {
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      otherAttributes: otherAttrs,
      bars,
      modifierFormula: modFormula,
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
      visibility: 'private',
      userId: userId || 'guest',
      bio: '',
      backstory: '',
      notes: '',
      portraitUrl: '',
      displayStats: [],
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
      await saveCharacterInventory(selectedCharacter.id, charInventory, userId);
      const updated = { ...selectedCharacter, inventory: charInventory };
      setCharacters(prev => prev.map(c => (c.id === selectedCharacter.id ? { ...c, inventory: charInventory } : c)));
      setSelectedCharacter(updated);
      return;
    }

    const updated: CharacterData = {
      ...selectedCharacter,
      name: editName.trim() || selectedCharacter.name,
      race: editRace.trim() || selectedCharacter.race,
      className: editClass.trim() || selectedCharacter.className,
      visibility: editVisibility,
      bio: backstory,
      backstory,
      notes,
      portraitUrl,
      tags: charTags,
      displayStats,
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      otherAttributes: otherAttrs,
      bars,
      diceMacros: sheetDiceMacros,
      statuses: charStatuses,
      inventory: charInventory,
      spells: charSpells,
      modifierFormula: modFormula,
    };
    await saveCharacter(updated);
    setCharacters(characters.map(c => (c.id === updated.id ? updated : c)));
    setSelectedCharacter(updated);
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

  const handleAddToBattleTracker = (e: React.MouseEvent, characterName: string) => {
    e.stopPropagation();
    addCombatantToBattleTracker(characterName);
  };

  // ── Full Character Sheet ─────────────────────────────────────────────────────

  if (isViewingSheet && selectedCharacter) {
    const finalContext = getCharacterContext();
    const renderAttributeSection = (
      title: string,
      items: CustomAttribute[],
      setItems: React.Dispatch<React.SetStateAction<CustomAttribute[]>>,
      idPrefix: string
    ) => (
      <div className="mb-8">
        <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
          <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
            {title}
          </h3>
          <button
            onClick={() => setItems([...items, { id: `${idPrefix}_${Date.now().toString(36)}`, name: 'New Attribute', value: '10' }])}
            className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
          >
            + Add
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {items.map((attr, idx) => {
            const evalVal = finalContext[attr.id] || 0;

            return (
              <div key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-3 flex flex-col gap-2 shadow-lg">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={attr.name}
                    onChange={(e) => {
                      const next = [...items];
                      next[idx].name = e.target.value;
                      setItems(next);
                    }}
                    className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                  />
                  <input
                    type="text"
                    value={attr.id}
                    onChange={(e) => {
                      const next = [...items];
                      next[idx].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                      setItems(next);
                    }}
                    className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-16"
                    placeholder="id"
                  />
                  <button
                    onClick={() => setItems(items.filter((_, i) => i !== idx))}
                    className="text-stone-600 hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-end">
                  <input
                    type="text"
                    value={attr.value}
                    onChange={(e) => {
                      const next = [...items];
                      next[idx].value = e.target.value;
                      setItems(next);
                    }}
                    className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 w-24 focus:outline-none mr-auto"
                  />
                  <span className="text-lg font-bold font-mono text-amber-200">{evalVal}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );

    return (
      <div className="w-full bg-stone-900/50 p-6 rounded-2xl border border-amber-800/40 shadow-xl animate-fade-in" style={{ fontFamily: "'IM Fell English', serif" }}>
        <input
          ref={attributeImportInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportAttributePresetFile}
          className="hidden"
        />
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-amber-800/40">
          <button onClick={() => setIsViewingSheet(false)} className="flex items-center gap-2 text-amber-500 hover:text-amber-300 font-bold tracking-wider cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>
            <ArrowLeft size={20} /> Back to List
          </button>
          <div className="flex gap-3">
            {/* Visibility dropdown — only owner can change */}
            {isCharacterOwner ? (
              <select
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as 'private' | 'public')}
                className="bg-stone-900 border border-stone-700 rounded px-3 py-2 text-sm text-amber-200 focus:outline-none focus:border-amber-500/50 cursor-pointer"
              >
                <option value="private">🔒 Private</option>
                <option value="public">🌐 Public</option>
              </select>
            ) : (
              <span className="flex items-center gap-1 px-3 py-2 text-sm text-stone-400 border border-stone-700/30 rounded">
                {selectedCharacter.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
              </span>
            )}
            <button onClick={handleSaveAll} disabled={!canEditInventory && !isCharacterOwner} className="flex items-center gap-2 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              <Save size={16} /> Save
            </button>
          </div>
        </div>

        <div className="space-y-8">
          <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] pointer-events-none"></div>
            <div className="relative z-10">
              <div
                onClick={() => isCharacterOwner && setShowPortraitPicker(prev => !prev)}
                className={`w-28 h-28 rounded-full border-2 border-amber-500/50 bg-amber-950/40 mx-auto flex items-center justify-center text-5xl mb-4 shadow-xl overflow-hidden ${isCharacterOwner ? 'cursor-pointer hover:border-amber-300/80' : ''}`}
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
                  {isCharacterOwner && (
                    <button
                      onClick={addDisplayStat}
                      className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                    >
                      + Add Entry
                    </button>
                  )}
                </div>
                {displayStats.length === 0 ? (
                  <div className="text-xs text-stone-500 italic">No custom display attributes yet.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {displayStats.map((stat) => (
                      <div key={stat.id} className="rounded-xl border border-amber-700/20 bg-gradient-to-br from-amber-950/30 to-black/20 p-3 shadow-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="text"
                            value={stat.referenceId}
                            onChange={(e) => updateDisplayStat(stat.id, e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                            disabled={!isCharacterOwner}
                            placeholder="str_mod"
                            className="flex-1 bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-xs font-mono text-emerald-400 focus:outline-none disabled:opacity-60"
                          />
                          {isCharacterOwner && (
                            <button
                              onClick={() => removeDisplayStat(stat.id)}
                              className="text-stone-500 hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-amber-500 mb-1 truncate">
                          {getReferenceDisplayName(stat.referenceId)}
                        </p>
                        <p className="text-[10px] font-mono text-emerald-400/80 mb-2 break-all">
                          @{stat.referenceId || 'unset'}
                        </p>
                        <p className="text-3xl font-bold text-amber-200 font-mono break-all leading-none">
                          {stat.referenceId ? (finalContext[stat.referenceId] ?? 0) : '--'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Backstory</label>
                  <textarea
                    ref={backstoryRef}
                    value={backstory}
                    onChange={(e) => setBackstory(e.target.value)}
                    rows={expandedBackstory ? 8 : 4}
                    className="w-full bg-stone-900 border border-stone-800 rounded-lg p-3 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 font-serif resize-none"
                    placeholder="The legend begins here..."
                  />
                  <button onClick={() => setExpandedBackstory(prev => !prev)} className="mt-2 text-xs text-amber-300 hover:text-amber-200 cursor-pointer">
                    {expandedBackstory ? 'Hide' : 'Show More'}
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Notes</label>
                  <textarea
                    ref={notesRef}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={expandedNotes ? 8 : 4}
                    className="w-full bg-stone-900 border border-stone-800 rounded-lg p-3 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 font-serif resize-none"
                    placeholder="Session notes, reminders, secrets..."
                  />
                  <button onClick={() => setExpandedNotes(prev => !prev)} className="mt-2 text-xs text-amber-300 hover:text-amber-200 cursor-pointer">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {mainAttrs.map((attr, idx) => {
                    const evalVal = finalContext[attr.id] || 0;
                    const modVal = finalContext[`${attr.id}_mod`] || 0;

                    return (
                      <div key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-3 flex flex-col gap-2 shadow-lg">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={attr.name}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[idx].name = e.target.value;
                              setMainAttrs(next);
                            }}
                            className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                          />
                          <input
                            type="text"
                            value={attr.id}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[idx].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                              setMainAttrs(next);
                            }}
                            className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-16"
                            placeholder="id"
                          />
                          <button
                            onClick={() => setMainAttrs(mainAttrs.filter((_, i) => i !== idx))}
                            className="text-stone-600 hover:text-red-400 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={attr.value}
                            onChange={(e) => {
                              const next = [...mainAttrs];
                              next[idx].value = e.target.value;
                              setMainAttrs(next);
                            }}
                            className="bg-stone-900/60 border border-stone-800 rounded px-2 py-1 text-sm font-mono text-amber-100 w-24 focus:outline-none"
                          />
                          <div className="flex flex-col items-end">
                            <span className="text-lg font-bold font-mono text-amber-200">{evalVal}</span>
                            <span className="text-xs font-mono font-bold bg-amber-900/40 px-2 py-0.5 rounded text-amber-400">
                              {modVal >= 0 ? `+${modVal}` : modVal}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

                {renderAttributeSection('✦ Secondary Attributes', secondaryAttrs, setSecondaryAttrs, 'sec')}
                {renderAttributeSection('✦ Other Attributes', otherAttrs, setOtherAttrs, 'other')}

                <div className="mb-4">
                  <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                    <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                      ✦ Bars
                    </h3>
                    <button
                    onClick={() => setBars([...bars, { id: `bar_${Date.now().toString(36)}`, name: 'New Bar', currentValue: '0', maxValue: '100', color: '#f59e0b' }])}
                      className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                    >
                      + Add
                    </button>
                  </div>

                  <div className="space-y-4">
                    {bars.map((bar, idx) => {
                      const rawMax = finalContext[`${bar.id}_max`] || 0;
                      const rawCurrent = finalContext[`${bar.id}_current`] || 0;
                      const safeMax = rawMax > 0 ? rawMax : 0;
                      const clampedCurrent = safeMax > 0 ? Math.min(Math.max(rawCurrent, 0), safeMax) : 0;
                      const percent = safeMax > 0 ? Math.round((clampedCurrent / safeMax) * 100) : 0;

                      return (
                        <div key={idx} className="bg-amber-950/20 border border-amber-800/20 rounded-xl p-4 flex flex-col gap-3 shadow-lg">
                          <div className="flex items-center justify-between gap-2">
                            <input
                              type="text"
                              value={bar.name}
                              onChange={(e) => {
                                const next = [...bars];
                                next[idx].name = e.target.value;
                                setBars(next);
                              }}
                              className="bg-transparent text-sm font-bold text-amber-300 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-32"
                            />
                            <input
                              type="text"
                              value={bar.id}
                              onChange={(e) => {
                                const next = [...bars];
                                next[idx].id = e.target.value.replace(/[^a-zA-Z0-9_-]/g, '');
                                setBars(next);
                              }}
                              className="bg-transparent text-xs font-mono text-emerald-400 focus:outline-none border-b border-transparent focus:border-amber-600/50 w-24"
                              placeholder="id"
                            />
                            <button
                              onClick={() => setBars(bars.filter((_, i) => i !== idx))}
                              className="text-stone-600 hover:text-red-400 cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[11px] font-bold uppercase tracking-wider text-amber-500 mb-1">Current Value</label>
                              <input
                                type="text"
                                value={bar.currentValue}
                                onChange={(e) => {
                                  const next = [...bars];
                                  next[idx].currentValue = e.target.value;
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
                                  next[idx].maxValue = e.target.value;
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
                                  next[idx].color = e.target.value;
                                  setBars(next);
                                }}
                                className="w-full h-[34px] bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer"
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
                </div>
              </div>
            </div>

            <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                  <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                    ✦ Statuses & Effects
                  </h3>
                  <button
                    onClick={() => setCharStatuses([...charStatuses, { id: `st_${Date.now().toString(36)}`, name: 'New Status', duration: '1 round', description: '', effects: [] }])}
                    className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                  >
                    + Add Status
                  </button>
                </div>

                <div className="space-y-4">
                  {charStatuses.map((status, idx) => (
                    <div key={status.id} className="bg-amber-950/10 border border-amber-800/20 rounded-xl p-4 shadow-lg flex flex-col gap-3">
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
                        <button
                          onClick={() => setCharStatuses(charStatuses.filter((_, i) => i !== idx))}
                          className="text-stone-600 hover:text-red-400 cursor-pointer ml-auto"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      
                      <textarea
                        value={status.description}
                        onChange={(e) => {
                          const next = [...charStatuses];
                          next[idx].description = e.target.value;
                          setCharStatuses(next);
                        }}
                        placeholder="Description of the status"
                        rows={2}
                        className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1.5 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none"
                      />

                      {/* Effects area */}
                      <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                        <div className="flex justify-between items-center mb-2">
                          <label className="text-xs font-bold text-stone-400">Effects</label>
                          <button
                            onClick={() => {
                              const next = [...charStatuses];
                              next[idx].effects = [...(next[idx].effects || []), { targetId: '', value: '0' }];
                              setCharStatuses(next);
                            }}
                            className="text-[10px] bg-amber-900/20 hover:bg-amber-900/40 px-2 py-0.5 rounded text-amber-300"
                          >
                            + Add Effect
                          </button>
                        </div>
                        <div className="space-y-2">
                          {(status.effects || []).map((effect, effIdx) => (
                            <div key={effIdx} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={effect.targetId}
                                onChange={(e) => {
                                  const next = [...charStatuses];
                                  next[idx].effects[effIdx].targetId = e.target.value;
                                  setCharStatuses(next);
                                }}
                                placeholder="Target ID (e.g. wis_mod)"
                                className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-emerald-400 font-mono focus:outline-none w-1/2"
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
                                className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 font-mono focus:outline-none w-1/4"
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
                    </div>
                  ))}
                </div>

                <div className="mt-8 pt-6 border-t border-amber-800/20">
                  <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                        ✦ Inventory
                      </h3>
                      <p className="text-xs text-stone-500 mt-1">
                        Use item macros with character attribute IDs like <code className="font-mono text-emerald-400">@str_mod</code> or <code className="font-mono text-emerald-400">@hp_current</code>.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
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
                    <div className="mb-3 text-xs text-stone-500 italic">
                      Inventory can be edited by the owner, or by anyone when the character is public.
                    </div>
                  )}

                  {charInventory.length === 0 ? (
                    <div className="text-xs text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      No inventory items yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {charInventory.map((item, itemIndex) => {
                        const rarityKey = item.rarity || 'common';
                        const rarityStyle = INVENTORY_RARITY_STYLES[rarityKey];
                        const isDescriptionExpanded = expandedInventoryDescriptions.includes(item.id);
                        return (
                        <div key={item.id} className={`border rounded-xl p-4 shadow-lg flex flex-col gap-3 transition-all ${rarityStyle.card} ${item.equipped ? 'ring-1 ring-amber-300/40 shadow-amber-300/10' : ''}`}>
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
                            {canEditInventory ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => moveInventoryItem(item.id, 'up')}
                                  disabled={itemIndex === 0}
                                  className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  <ArrowUp size={15} />
                                </button>
                                <button
                                  onClick={() => moveInventoryItem(item.id, 'down')}
                                  disabled={itemIndex === charInventory.length - 1}
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
                              </div>
                            ) : null}
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
                          </div>

                          <div className="space-y-2">
                            <textarea
                              ref={(el) => { inventoryDescriptionRefs.current[item.id] = el; }}
                              value={item.description}
                              onChange={(e) => updateInventoryItem(item.id, current => ({ ...current, description: e.target.value }))}
                              disabled={!canEditInventory}
                              placeholder="Description, lore, notes..."
                              rows={isDescriptionExpanded ? 6 : 2}
                              className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1.5 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                            />
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => toggleInventoryDescription(item.id)}
                                className="text-xs text-amber-300 hover:text-amber-200 cursor-pointer"
                              >
                                {isDescriptionExpanded ? 'Hide' : 'Show More'}
                              </button>
                              <button
                                onClick={() => shareInventoryItem(item)}
                                className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
                              >
                                <Share2 size={12} /> Share
                              </button>
                            </div>
                          </div>

                          <div className="bg-black/20 p-3 rounded-lg border border-amber-800/10">
                            <div className="flex justify-between items-center mb-2">
                              <label className="text-xs font-bold text-stone-400">Item Macros</label>
                              {canEditInventory && (
                                <button
                                  onClick={() => addInventoryMacro(item.id)}
                                  className="text-[10px] bg-amber-900/20 hover:bg-amber-900/40 px-2 py-0.5 rounded text-amber-300 cursor-pointer"
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
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 focus:outline-none disabled:opacity-60"
                                      placeholder="Attack Roll"
                                    />
                                    <input
                                      type="text"
                                      value={macro.formula}
                                      onChange={(e) => updateInventoryMacro(item.id, macro.id, current => ({ ...current, formula: e.target.value }))}
                                      disabled={!canEditInventory}
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
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
                              <label className="text-xs font-bold text-stone-400">
                                Effects {item.equipped ? '(Active)' : '(Inactive until equipped)'}
                              </label>
                              {canEditInventory && (
                                <button
                                  onClick={() => addInventoryEffect(item.id)}
                                  className="text-[10px] bg-amber-900/20 hover:bg-amber-900/40 px-2 py-0.5 rounded text-amber-300 cursor-pointer"
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
                                  <div key={`${item.id}-effect-${effectIndex}`} className="grid grid-cols-1 md:grid-cols-[1fr_140px_auto] gap-2 items-center">
                                    <input
                                      type="text"
                                      value={effect.targetId}
                                      onChange={(e) => updateInventoryEffect(item.id, effectIndex, current => ({ ...current, targetId: e.target.value }))}
                                      disabled={!canEditInventory}
                                      placeholder="Target ID (e.g. str_mod)"
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-emerald-400 font-mono focus:outline-none disabled:opacity-60"
                                    />
                                    <input
                                      type="text"
                                      value={effect.value}
                                      onChange={(e) => updateInventoryEffect(item.id, effectIndex, current => ({ ...current, value: e.target.value }))}
                                      disabled={!canEditInventory}
                                      placeholder="Value (e.g. +2)"
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 font-mono focus:outline-none disabled:opacity-60"
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
                        </div>
                      )})}
                    </div>
                  )}
                </div>

                <div className="mt-8 pt-6 border-t border-amber-800/20">
                  <div className="flex items-center justify-between border-b border-amber-800/30 pb-2 mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                        ✦ Spells & Abilities
                      </h3>
                      <p className="text-xs text-stone-500 mt-1">
                        Add spell details, choose a card color, and attach macros that can reference character attribute IDs.
                      </p>
                    </div>
                    {isCharacterOwner && (
                      <button
                        onClick={addSpell}
                        className="px-2 py-1 bg-amber-900/40 border border-amber-800/40 rounded text-xs text-amber-200 hover:bg-amber-900/60 cursor-pointer"
                      >
                        + Add Spell
                      </button>
                    )}
                  </div>

                  {!isCharacterOwner && (
                    <div className="mb-3 text-xs text-stone-500 italic">
                      Only the character owner can edit spells and abilities.
                    </div>
                  )}

                  {charSpells.length === 0 ? (
                    <div className="text-xs text-stone-500 italic border border-dashed border-stone-700 rounded-lg px-3 py-4 text-center">
                      No spells or abilities yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {charSpells.map((spell) => (
                        <div
                          key={spell.id}
                          className="rounded-xl border p-4 shadow-lg flex flex-col gap-3"
                          style={{
                            borderColor: `${spell.color || '#7c3aed'}88`,
                            background: `linear-gradient(135deg, ${spell.color || '#7c3aed'}22, rgba(12, 10, 9, 0.72))`,
                            boxShadow: `0 8px 24px ${spell.color || '#7c3aed'}22`,
                          }}
                        >
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
                                  disabled={charSpells[0]?.id === spell.id}
                                  className="p-1 text-stone-500 hover:text-amber-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                                >
                                  <ArrowUp size={15} />
                                </button>
                                <button
                                  onClick={() => moveSpell(spell.id, 'down')}
                                  disabled={charSpells[charSpells.length - 1]?.id === spell.id}
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
                              className="min-w-[220px] flex-1 bg-stone-900/60 border border-stone-800 rounded px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 disabled:opacity-60"
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
                                className="h-10 w-full bg-stone-900/60 border border-stone-800 rounded px-1 py-1 cursor-pointer disabled:opacity-60"
                              />
                            </div>
                          </div>

                          <textarea
                            ref={(el) => { spellDescriptionRefs.current[spell.id] = el; }}
                            value={spell.description}
                            onChange={(e) => updateSpell(spell.id, current => ({ ...current, description: e.target.value }))}
                            disabled={!isCharacterOwner}
                            placeholder="Description"
                            rows={expandedSpellDescriptions.includes(spell.id) ? 6 : 3}
                            className="w-full bg-stone-900/60 border border-stone-800 rounded px-2 py-1.5 text-xs text-amber-100 focus:outline-none focus:border-amber-500/40 resize-none disabled:opacity-60"
                          />
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleSpellDescription(spell.id)}
                              className="text-xs text-amber-300 hover:text-amber-200 cursor-pointer"
                            >
                              {expandedSpellDescriptions.includes(spell.id) ? 'Hide' : 'Show More'}
                            </button>
                            <button
                              onClick={() => shareSpell(spell)}
                              className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200 cursor-pointer"
                            >
                              <Share2 size={12} /> Share
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
                              <label className="text-xs font-bold text-stone-400">Spell Macros</label>
                              {isCharacterOwner && (
                                <button
                                  onClick={() => addSpellMacro(spell.id)}
                                  className="text-[10px] bg-amber-900/20 hover:bg-amber-900/40 px-2 py-0.5 rounded text-amber-300 cursor-pointer"
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
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-amber-100 focus:outline-none disabled:opacity-60"
                                      placeholder="Spell macro name"
                                    />
                                    <input
                                      type="text"
                                      value={macro.formula}
                                      onChange={(e) => updateSpellMacro(spell.id, macro.id, current => ({ ...current, formula: e.target.value }))}
                                      disabled={!isCharacterOwner}
                                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-emerald-300 font-mono focus:outline-none disabled:opacity-60"
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
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {renderDicePanel('sheet')}
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
              <span className="text-xs bg-amber-900/30 border border-amber-800/30 text-amber-400 px-2 py-0.5 rounded font-mono">
                {filteredCharacters.length} / {characters.length}
              </span>
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
                        <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center font-bold text-sm shrink-0 font-mono transition-all ${isSelected ? 'border-amber-400 bg-amber-900/50 text-amber-200' : 'border-amber-700/30 bg-stone-900/60 text-amber-300/80'}`}>
                          {(char.name || '?').slice(0, 2).toUpperCase()}
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
                          onClick={(e) => handleAddToBattleTracker(e, char.name)}
                          className="px-2 py-1 text-[10px] rounded border border-blue-800/40 bg-blue-950/30 text-blue-200 hover:bg-blue-900/40 hover:border-blue-500/60 transition-colors cursor-pointer"
                          title="Add to Battle Tracker"
                        >
                          Add to Battle Tracker
                        </button>
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
