import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Star, Trash2, Save, ArrowLeft, Shield, Wand2, RefreshCw, Search, X, Filter, Settings, Dices, Zap, Edit3, Check, AlertTriangle } from 'lucide-react';
import { CharacterBar, CharacterData, CharacterDiceMacro, CustomAttribute, CharacterStatus, StatusEffect } from '../types/character';

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
import { loadCharacters, saveCharacter, deleteCharacterFromDB, loadFavorites, loadUserDiceSettings, saveUserDiceSettings, toggleFavorite as toggleFavoriteDB, UserDiceSettings } from '../lib/firestore';
import { authProvider } from '../lib/auth';

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

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const DEFAULT_CHARACTER_DICE_STATE: CharacterDiceState = {
  macros: [
    { id: 'macro_1', name: 'Attack Roll', formula: '1d20 + @level' },
    { id: 'macro_2', name: 'Damage Roll', formula: '1d8 + @level' },
  ],
  webhookUrl: '',
  autoSend: false,
};

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
  const [editLevel, setEditLevel] = useState(1);
  const [editName, setEditName] = useState('');
  const [editRace, setEditRace] = useState('');
  const [editClass, setEditClass] = useState('');
  const [editVisibility, setEditVisibility] = useState<'private' | 'public'>('private');
  const [attributes, setAttributes] = useState<Record<string, number>>({ STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 });
  const [bio, setBio] = useState('');
  const [charTags, setCharTags] = useState<string[]>([]);
  const [charTagInput, setCharTagInput] = useState('');
  
  const [mainAttrs, setMainAttrs] = useState<CustomAttribute[]>([]);
  const [secondaryAttrs, setSecondaryAttrs] = useState<CustomAttribute[]>([]);
  const [otherAttrs, setOtherAttrs] = useState<CustomAttribute[]>([]);
  const [bars, setBars] = useState<CharacterBar[]>([]);
  const [charStatuses, setCharStatuses] = useState<CharacterStatus[]>([]);
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
      setEditLevel(selectedCharacter.level);
      setEditName(selectedCharacter.name);
      setEditRace(selectedCharacter.race);
      setEditClass(selectedCharacter.className);
      setEditVisibility(selectedCharacter.visibility ?? 'private');
      setAttributes(selectedCharacter.attributes || { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 });
      setBio(selectedCharacter.bio || '');
      setCharTags(selectedCharacter.tags || []);
      setMainAttrs(selectedCharacter.mainAttributes || []);
      setSecondaryAttrs(selectedCharacter.secondaryAttributes || []);
      setOtherAttrs(selectedCharacter.otherAttributes || []);
      setBars(selectedCharacter.bars || []);
      setSheetDiceMacros(selectedCharacter.diceMacros || DEFAULT_CHARACTER_DICE_STATE.macros);
      setCharStatuses(selectedCharacter.statuses || []);
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
  }, [selectedCharacter]);

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

  const getCharacterContext = () => {
    const context: Record<string, number> = { level: editLevel };
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
      const nextContext: Record<string, number> = { level: editLevel };

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

      mainAttrIds.forEach(attrId => {
        const attrValue = attributesWithStatuses[attrId] || 0;
        const formula = (modFormula || 'Math.floor((@value - 10) / 2)').replace(/@value/g, attrValue.toString());
        attributesWithStatuses[`${attrId}_mod`] = evalCharFormula(formula, {
          ...previousContext,
          ...attributesWithStatuses,
        });
      });

      const withModStatuses = applyStatusEffects(
        modIds,
        attributesWithStatuses,
        { ...previousContext, ...attributesWithStatuses }
      );

      (bars || []).forEach(bar => {
        if (bar.id) {
          withModStatuses[`${bar.id}_max`] = evalCharFormula(bar.maxValue || '0', {
            ...previousContext,
            ...withModStatuses,
          });
          withModStatuses[`${bar.id}_current`] = evalCharFormula(bar.currentValue || '0', {
            ...previousContext,
            ...withModStatuses,
          });
        }
      });

      const nextKeys = new Set([...Object.keys(context), ...Object.keys(withModStatuses), 'level']);
      let hasChanged = false;

      nextKeys.forEach((key) => {
        const prevValue = previousContext[key] ?? 0;
        const nextValue = key === 'level' ? editLevel : (withModStatuses[key] ?? 0);
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
    const ids = new Set<string>(['level']);
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
      level: 1,
      race: 'Human',
      className: 'Vanguard',
      visibility: 'private',
      userId: userId || 'guest',
      attributes: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      bio: '',
      createdAt: Date.now(),
    };
    await saveCharacter(newChar);
    setCharacters([...characters, newChar]);
    setSelectedCharacter(newChar);
  };

  const handleSavePreview = async () => {
    if (!selectedCharacter) return;
    const updated: CharacterData = {
      ...selectedCharacter,
      level: editLevel,
      name: editName.trim() || selectedCharacter.name,
      race: editRace.trim() || selectedCharacter.race,
      className: editClass.trim() || selectedCharacter.className,
      visibility: editVisibility,
      attributes,
      bio,
      tags: charTags,
      mainAttributes: mainAttrs,
      secondaryAttributes: secondaryAttrs,
      otherAttributes: otherAttrs,
      bars,
      diceMacros: sheetDiceMacros,
      statuses: charStatuses,
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
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-amber-800/40">
          <button onClick={() => setIsViewingSheet(false)} className="flex items-center gap-2 text-amber-500 hover:text-amber-300 font-bold tracking-wider cursor-pointer" style={{ fontFamily: "'Cinzel', serif" }}>
            <ArrowLeft size={20} /> Back to List
          </button>
          <div className="flex gap-3">
            {/* Visibility dropdown — only owner can change */}
            {selectedCharacter.userId === userId ? (
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
            <button onClick={handleSavePreview} className="flex items-center gap-2 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 text-sm cursor-pointer">
              <Save size={16} /> Save Changes
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left: Identity */}
          <div className="md:col-span-1 border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/dark-leather.png')] pointer-events-none"></div>
            <div className="relative z-10">
              <div className="w-24 h-24 rounded-full border-2 border-amber-500/50 bg-amber-950/40 mx-auto flex items-center justify-center text-5xl mb-4 shadow-xl">
                {editClass.toLowerCase().includes('arcanist') || editClass.toLowerCase().includes('mage') ? '🔮' : '⚔️'}
              </div>
              <h2 className="text-3xl font-bold text-amber-200 mb-1 text-center" style={{ fontFamily: "'Cinzel', serif" }}>{editName}</h2>
              <p className="text-amber-500/70 text-lg mb-4 italic text-center">{editRace} • {editClass}</p>

              <div className="flex justify-around items-center bg-amber-950/30 border border-amber-800/20 p-3 rounded-xl mb-6">
                <div className="text-center">
                  <p className="text-xs text-amber-600 tracking-wider">LEVEL</p>
                  <p className="text-2xl font-bold text-amber-300 font-mono">{editLevel}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-amber-600 tracking-wider">HP MAX</p>
                  <p className="text-2xl font-bold text-amber-300 font-mono">{editLevel * 10 + Math.floor((attributes.CON - 10) / 2)}</p>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-500 mb-2">Backstory / Notes</label>
                <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={6} className="w-full bg-stone-900 border border-stone-800 rounded-lg p-3 text-sm text-amber-100 focus:outline-none focus:border-amber-500/40 font-serif resize-none" placeholder="The legend begins here..." />
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

          {/* Right: Attributes */}
          <div className="md:col-span-2 flex flex-col gap-6">
            <div className="border border-amber-800/30 bg-black/20 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/parchment.png')] pointer-events-none"></div>
              <div className="relative z-10">
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
                      onClick={() => setBars([...bars, { id: `bar_${Date.now().toString(36)}`, name: 'New Bar', currentValue: '0', maxValue: '100' }])}
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

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-amber-400 font-mono">
                              <span>{clampedCurrent} / {safeMax}</span>
                              <span>%{percent}</span>
                            </div>
                            <div className="relative h-6 rounded-full border border-amber-800/30 bg-stone-950/80 overflow-hidden">
                              <div
                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-700 to-amber-400 transition-all"
                                style={{ width: `${percent}%` }}
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
                          {char.level}
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Level</label>
                    <input type="number" min={1} max={30} value={editLevel} onChange={(e) => setEditLevel(parseInt(e.target.value, 10) || 1)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50 font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Race</label>
                    <input value={editRace} onChange={(e) => setEditRace(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" placeholder="Human, Elf..." />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Vocation / Class</label>
                  <input value={editClass} onChange={(e) => setEditClass(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-amber-500/50" placeholder="Vanguard, Arcanist..." />
                </div>

                {/* Visibility Dropdown */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">Visibility</label>
                  {selectedCharacter.userId === userId || !selectedCharacter.userId ? (
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
                    onClick={handleSavePreview}
                    className="flex-1 px-4 py-2 bg-amber-900/40 border border-amber-800/40 rounded hover:bg-amber-900/60 hover:border-amber-500/80 text-amber-200 transition-colors text-sm font-bold tracking-wider cursor-pointer flex items-center justify-center gap-2"
                    style={{ fontFamily: "'Cinzel', serif" }}
                  >
                    <Save size={16} /> Save Basics
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
