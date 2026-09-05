import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Trash2, Download, Upload, Copy, Dices, Zap, Edit3, Check, X, AlertTriangle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Modifier {
  id: string;
  name: string;
  value: string;
}

interface DiceMacro {
  id: string;
  name: string;
  formula: string;
}

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

interface DiceMacrosState {
  modifiers: Modifier[];
  macros: DiceMacro[];
  webhookUrl?: string;
  characterName?: string;
  autoSend?: boolean;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function resolveModifierValue(
  modifierId: string,
  modifiers: Modifier[],
  visited: Set<string> = new Set()
): number {
  if (visited.has(modifierId)) throw new Error(`Circular reference: ${modifierId}`);
  visited.add(modifierId);

  const mod = modifiers.find(m => m.id === modifierId);
  if (!mod) throw new Error(`Modifier "${modifierId}" not found`);

  const resolved = resolveFormula(mod.value, modifiers, visited);
  return resolved;
}

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

// Math function implementations
const MATH_FUNCTIONS: Record<string, (args: number[]) => number> = {
  max: (args) => Math.max(...args),
  min: (args) => Math.min(...args),
  round: (args) => Math.round(args[0]),
  roundup: (args) => Math.ceil(args[0]),
  rounddown: (args) => Math.floor(args[0]),
};

function evaluateMathFunctions(expr: string): string {
  let result = expr;
  let match = findFormulaFunctionCall(result, ['rounddown', 'roundup', 'round', 'max', 'min', 'if']);
  
  // Keep evaluating until no more functions are found
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
      // Recursively evaluate nested expressions
      const evaluatedArg = resolveBasicExpression(evaluateMathFunctions(argStr));
      args.push(evaluatedArg);
    }
    
    // Execute the math function
    const func = MATH_FUNCTIONS[funcName];
    if (!func) throw new Error(`Unknown function: ${funcName}`);
    
    const resultValue = func(args);
    
    // Replace the function call with its result
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

function resolveFormula(
  formula: string,
  modifiers: Modifier[],
  visited: Set<string> = new Set()
): number {
  let expr = formula.replace(/@([a-zA-Z0-9_-]+)/g, (_match, refId: string) => {
    const val = resolveModifierValue(refId, modifiers, new Set(visited));
    return val.toString();
  });

  // Evaluate all math functions first
  expr = evaluateMathFunctions(expr);

  // Then evaluate the basic arithmetic
  return resolveBasicExpression(expr);
}

interface DiceRoll {
  notation: string;
  rolls: number[];
  kept: number[];
  dropped: number[];
  sum: number;
}

function rollDice(notation: string): DiceRoll {
  const match = notation.match(/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i);
  if (!match) throw new Error(`Invalid dice: ${notation}`);

  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const keepMode = match[3] || null;
  const keepCount = parseInt(match[4] || '0', 10);

  if (count < 1 || count > 100) throw new Error(`Dice count 1-100`);
  if (sides < 2 || sides > 1000) throw new Error(`Dice sides 2-1000`);

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
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

function executeMacro(macro: DiceMacro, modifiers: Modifier[]): RollResult {
  const steps: RollStep[] = [];
  const formula = macro.formula.trim();

  // Split formula into tokens: dice, @refs, and everything else (operators/numbers)
  const parts = formula.split(/(\d*d\d+(?:kh|kl)?\d*|@[a-zA-Z0-9_-]+)/gi);
  const resolvedParts: string[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Dice notation?
    if (/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i.test(trimmed)) {
      const dice = rollDice(trimmed);
      const detail = dice.rolls.length > 1
        ? `[${dice.rolls.join(', ')}]${dice.dropped.length > 0 ? ` dropped [${dice.dropped.join(', ')}]` : ''}`
        : `${dice.sum}`;
      steps.push({ label: `🎲 ${trimmed}`, value: dice.sum, detail });
      resolvedParts.push(dice.sum.toString());
      continue;
    }

    // Modifier reference?
    const modMatch = trimmed.match(/^@([a-zA-Z0-9_-]+)$/);
    if (modMatch) {
      const modId = modMatch[1];
      try {
        const modValue = resolveModifierValue(modId, modifiers);
        const mod = modifiers.find(m => m.id === modId);
        steps.push({
          label: `📊 @${modId}`,
          value: modValue,
          detail: `${mod?.name || modId} = ${mod?.value || '?'} → ${modValue}`,
        });
        resolvedParts.push(modValue.toString());
      } catch (err: unknown) {
        steps.push({
          label: `❌ @${modId}`,
          value: 0,
          detail: err instanceof Error ? err.message : 'Unknown error',
        });
        resolvedParts.push('0');
      }
      continue;
    }

    // Operator / number / paren — pass through
    resolvedParts.push(trimmed);
  }

  // Evaluate final expression with math function support
  let total = 0;
  const resolvedFormula = resolvedParts.join(' ');
  try {
    // First evaluate any math functions in the resolved formula
    const withMathEvaluated = evaluateMathFunctions(resolvedFormula);
    const sanitized = withMathEvaluated.replace(/[^0-9+\-*/().\s]/g, '');
    const fn = new Function(`"use strict"; return (${sanitized});`);
    total = fn();
    if (typeof total !== 'number' || !isFinite(total)) total = 0;
    total = Math.round(total * 100) / 100;
  } catch {
    total = steps.reduce((sum, s) => sum + s.value, 0);
  }

  return { macroName: macro.name, formula: macro.formula, steps, total, timestamp: Date.now() };
}

async function sendToDiscord(webhookUrl: string, characterName: string, result: RollResult): Promise<string | null> {
  // We now hit our secure serverless backend which acts as a CORS proxy and message formatter.
  const endpointUrl = "https://ulunavir-vercel.vercel.app/api/send-dice";

  try {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webhookUrl,
        characterName,
        result
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return data.error || `Server error ${response.status}`;
    }
    
    return null; // success
  } catch (err) {
    console.error('Failed to connect to serverless API:', err);
    return `Server connection error. Ensure you are hosted on Vercel and the /api route is deployed.`;
  }
}

// ─── Local Storage ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'eldritch-grimoire-dice-macros';

function loadState(): DiceMacrosState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        modifiers: parsed.modifiers ?? [],
        macros: parsed.macros ?? [],
        webhookUrl: parsed.webhookUrl ?? '',
        characterName: parsed.characterName ?? '',
        autoSend: parsed.autoSend ?? false,
      };
    }
  } catch { /* ignore */ }
  // Default state with example math function demos
  return {
    modifiers: [
      { id: 'str', name: 'Strength', value: '5' },
      { id: 'dex', name: 'Dexterity', value: '3' },
      { id: 'con', name: 'Constitution', value: '4' },
      { id: 'prof', name: 'Proficiency', value: '2' },
      { id: 'half_str', name: 'Half Strength', value: 'round(@str / 2)' },
    ],
    macros: [
      { id: 'm1', name: 'Best Stat Attack', formula: '1d20 + max(@str, @dex) + @prof' },
      { id: 'm2', name: 'Safe Damage', formula: 'min(2d6 + @str, 12)' },
      { id: 'm3', name: 'Rounded Half CON', formula: '1d8 + round(@con / 2)' },
      { id: 'm4', name: 'Round Up Half Dex', formula: '1d6 + roundup(@dex / 2)' },
      { id: 'm5', name: 'Round Down Half STR', formula: '1d4 + rounddown(@str / 2)' },
    ],
    webhookUrl: '',
    characterName: '',
    autoSend: false,
  };
}

function saveState(state: DiceMacrosState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ─── Find nested modifier references ──────────────────────────────────────────

function findAllRefs(modId: string, modifiers: Modifier[], visited = new Set<string>()): Set<string> {
  const result = new Set<string>();
  if (visited.has(modId)) return result;
  visited.add(modId);
  const mod = modifiers.find(m => m.id === modId);
  if (!mod) return result;
  const refs = mod.value.matchAll(/@([a-zA-Z0-9_-]+)/g);
  for (const ref of refs) {
    result.add(ref[1]);
    findAllRefs(ref[1], modifiers, visited).forEach(id => result.add(id));
  }
  return result;
}

function getMacroRefs(macro: DiceMacro, modifiers: Modifier[]): Modifier[] {
  const ids = new Set<string>();
  const matches = macro.formula.matchAll(/@([a-zA-Z0-9_-]+)/g);
  for (const m of matches) {
    ids.add(m[1]);
    findAllRefs(m[1], modifiers).forEach(id => ids.add(id));
  }
  return modifiers.filter(m => ids.has(m.id));
}

// ─── Component ────────────────────────────────────────────────────────────────

export const DiceMacros: React.FC = () => {
  const [state, setState] = useState<DiceMacrosState>(loadState);
  const [rollResults, setRollResults] = useState<RollResult[]>([]);
  const [rollPopupResult, setRollPopupResult] = useState<RollResult | null>(null);
  const [editingModId, setEditingModId] = useState<string | null>(null);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modEditBuffer, setModEditBuffer] = useState<Partial<Modifier>>({});
  const [macroEditBuffer, setMacroEditBuffer] = useState<Partial<DiceMacro>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
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
  
  // Structured state for Quick Roll
  const [quickDice, setQuickDice] = useState<Record<number, number>>({});
  const [quickMod, setQuickMod] = useState<number>(0);
  const [quickAdv, setQuickAdv] = useState<number>(0); // positive = ADV level, negative = DIS level
  const [quickDescription, setQuickDescription] = useState('');

  // Get current formula string
  const getQuickRollFormula = useCallback((includeAdvText = true) => {
    const diceParts: string[] = [];
    const sidesList = Object.keys(quickDice).map(Number).filter(s => quickDice[s] > 0).sort((a, b) => b - a);
    
    for (const sides of sidesList) {
      diceParts.push(`${quickDice[sides]}d${sides}`);
    }
    
    let formula = diceParts.join(' + ');
    
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
  }, [quickDice, quickMod, quickAdv]);

  useEffect(() => { saveState(state); }, [state]);

  // ── Modifier helpers ───────────────────────────────────────────────────────

  const addModifier = () => {
    const id = `mod_${uid()}`;
    setState(prev => ({
      ...prev,
      modifiers: [...prev.modifiers, { id, name: 'New Modifier', value: '0' }],
    }));
  };

  const removeModifier = (id: string) => {
    setState(prev => ({ ...prev, modifiers: prev.modifiers.filter(m => m.id !== id) }));
  };

  const startEditMod = (mod: Modifier) => {
    setEditingModId(mod.id);
    setModEditBuffer({ ...mod });
  };

  const saveEditMod = () => {
    if (!editingModId || !modEditBuffer) return;
    const oldId = editingModId;
    const newId = modEditBuffer.id || oldId;
    setState(prev => {
      const newModifiers = prev.modifiers.map(m =>
        m.id === oldId ? { ...m, id: newId, name: modEditBuffer.name || m.name, value: modEditBuffer.value ?? m.value } : m
      );
      // Update macro formulas if id changed
      const newMacros = oldId !== newId
        ? prev.macros.map(macro => ({
            ...macro,
            formula: macro.formula.replace(new RegExp(`@${oldId}`, 'g'), `@${newId}`),
          }))
        : prev.macros;
      return { ...prev, modifiers: newModifiers, macros: newMacros };
    });
    setEditingModId(null);
    setModEditBuffer({});
  };

  const cancelEditMod = () => { setEditingModId(null); setModEditBuffer({}); };

  // ── Macro helpers ──────────────────────────────────────────────────────────

  const addMacro = () => {
    const id = `macro_${uid()}`;
    setState(prev => ({
      ...prev,
      macros: [...prev.macros, { id, name: 'New Macro', formula: '1d20' }],
    }));
  };

  const removeMacro = (id: string) => {
    setState(prev => ({ ...prev, macros: prev.macros.filter(m => m.id !== id) }));
  };

  const startEditMacro = (macro: DiceMacro) => {
    setEditingMacroId(macro.id);
    setMacroEditBuffer({ ...macro });
  };

  const saveEditMacro = () => {
    if (!editingMacroId || !macroEditBuffer) return;
    setState(prev => ({
      ...prev,
      macros: prev.macros.map(m =>
        m.id === editingMacroId
          ? { ...m, name: macroEditBuffer.name || m.name, formula: macroEditBuffer.formula || m.formula }
          : m
      ),
    }));
    setEditingMacroId(null);
    setMacroEditBuffer({});
  };

  const cancelEditMacro = () => { setEditingMacroId(null); setMacroEditBuffer({}); };

  // ── Rolling ────────────────────────────────────────────────────────────────

  const rollMacro = async (macro: DiceMacro) => {
    setError(null);
    try {
      const result = executeMacro(macro, state.modifiers);
      addRollResults(result);
      
      // Send to Discord if enabled
      if (state.autoSend) {
        const discordErr = await sendToDiscord(state.webhookUrl || '', state.characterName || '', result);
        if (discordErr) setError(`Discord: ${discordErr}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  const rollAllMacros = async () => {
    setError(null);
    try {
      const results = state.macros.map(m => executeMacro(m, state.modifiers));
      addRollResults([...results].reverse());
      
      // Send to Discord if enabled
      if (state.autoSend) {
        for (const result of results) {
          const discordErr = await sendToDiscord(state.webhookUrl || '', state.characterName || '', result);
          if (discordErr) {
            setError(`Discord: ${discordErr}`);
            break;
          }
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Roll failed');
    }
  };

  // ── Export / Import ────────────────────────────────────────────────────────

  const downloadJson = (data: unknown, filename: string) => {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAll = () => downloadJson(state, 'dice-macros.json');

  const exportMacro = (macro: DiceMacro) => {
    downloadJson({
      type: 'dice-macro-standalone',
      macro,
      modifiers: getMacroRefs(macro, state.modifiers),
    }, `macro-${macro.name.toLowerCase().replace(/\s+/g, '-')}.json`);
  };

  const copyShareLink = (macro: DiceMacro) => {
    const data = {
      type: 'dice-macro-standalone',
      macro,
      modifiers: getMacroRefs(macro, state.modifiers),
    };
    const encoded = btoa(JSON.stringify(data));
    const url = `${window.location.origin}${window.location.pathname}#dice-macro-import:${encoded}`;
    navigator.clipboard.writeText(url);
  };

  const importData = () => fileInputRef.current?.click();

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        if (data.type === 'dice-macro-standalone') {
          // Import standalone macro + its modifiers
          setState(prev => {
            const newMods = [...prev.modifiers];
            for (const mod of (data.modifiers || []) as Modifier[]) {
              const idx = newMods.findIndex(m => m.id === mod.id);
              if (idx >= 0) newMods[idx] = mod;
              else newMods.push(mod);
            }
            const newMacros = [...prev.macros];
            if (data.macro) {
              const idx = newMacros.findIndex(m => m.id === data.macro.id);
              if (idx >= 0) newMacros[idx] = data.macro;
              else newMacros.push(data.macro);
            }
            return { ...prev, modifiers: newMods, macros: newMacros };
          });
        } else {
          const imported = data as DiceMacrosState;
          if (imported.modifiers && imported.macros) setState(prev => ({ ...prev, ...imported }));
        }
      } catch {
        setError('Failed to import file. Invalid JSON.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Check URL for imported macro ───────────────────────────────────────────

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#dice-macro-import:')) {
      try {
        const data = JSON.parse(atob(hash.slice('#dice-macro-import:'.length)));
        if (data.type === 'dice-macro-standalone') {
          setState(prev => {
            const newMods = [...prev.modifiers];
            for (const mod of (data.modifiers || []) as Modifier[]) {
              const idx = newMods.findIndex(m => m.id === mod.id);
              if (idx >= 0) newMods[idx] = mod;
              else newMods.push(mod);
            }
            const newMacros = [...prev.macros];
            if (data.macro) {
              const idx = newMacros.findIndex(m => m.id === data.macro.id);
              if (idx >= 0) newMacros[idx] = data.macro;
              else newMacros.push(data.macro);
            }
            return { ...prev, modifiers: newMods, macros: newMacros };
          });
          window.history.pushState(null, '', window.location.pathname + window.location.search);
        }
      } catch { /* ignore */ }
    }
  }, []);

  // ── Preview resolved modifier value ────────────────────────────────────────

  const getModifierPreview = (mod: Modifier): { value: string; error: string | null } => {
    try {
      return { value: resolveModifierValue(mod.id, state.modifiers).toString(), error: null };
    } catch (err: unknown) {
      return { value: '?', error: err instanceof Error ? err.message : 'Error' };
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full" style={{ fontFamily: "'IM Fell English', serif" }}>
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
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h2 className="text-3xl font-bold text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>
            ⚄ Dice Macros
          </h2>
          <p className="text-stone-400 text-sm mt-1">
            Create modifiers and dice formulas. Use <code className="text-amber-300 bg-stone-800 px-1 rounded">@modifierId</code> to reference modifiers.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportAll} className="flex items-center gap-1.5 px-3 py-2 bg-amber-900/40 text-amber-300 rounded border border-amber-800/40 hover:bg-amber-900/60 transition-colors text-sm">
            <Download size={14} /> Export All
          </button>
          <button onClick={importData} className="flex items-center gap-1.5 px-3 py-2 bg-stone-700/40 text-stone-300 rounded border border-stone-600/40 hover:bg-stone-700/60 transition-colors text-sm">
            <Upload size={14} /> Import
          </button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileImport} className="hidden" />
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/40 rounded-lg flex items-center gap-2 text-red-300 text-sm">
          <AlertTriangle size={16} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X size={14} /></button>
        </div>
      )}

      {/* ─── Discord Settings ─────────────────────────────────────────────── */}
      <div className="mb-6 p-4 bg-indigo-900/20 border border-indigo-700/30 rounded-lg">
        <h3 className="text-lg text-indigo-300 mb-3 flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
          🔗 Discord Integration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-3 items-end">
          <div>
            <label className="block text-xs text-stone-400 mb-1">Webhook URL</label>
            <input
              type="url"
              value={state.webhookUrl || ''}
              onChange={e => setState(prev => ({ ...prev, webhookUrl: e.target.value }))}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-stone-200 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-400 mb-1">Character Name</label>
            <input
              type="text"
              value={state.characterName || ''}
              onChange={e => setState(prev => ({ ...prev, characterName: e.target.value }))}
              placeholder="Your character"
              className="w-full bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-amber-200 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none pb-1.5">
            <input
              type="checkbox"
              checked={state.autoSend || false}
              onChange={e => setState(prev => ({ ...prev, autoSend: e.target.checked }))}
              className="w-4 h-4 rounded border-stone-600 bg-stone-800 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-0"
            />
            <span className="text-sm text-indigo-200 whitespace-nowrap">Send to Discord</span>
          </label>
        </div>
        <p className="text-xs text-stone-500 mt-2">
          ⚙️ **Configurable Webhook:** Input your own D&D group's webhook URL. It will be sent securely to the Vercel serverless proxy to bypass CORS blocks and format the rich embed cards. 
          Saved locally in your browser.
        </p>
      </div>

      {/* ─── Quick Roll Section ───────────────────────────────────────────── */}
      <div className="mb-6 p-4 bg-amber-900/10 border border-amber-700/20 rounded-lg">
        <h3 className="text-lg text-amber-300 mb-3 flex items-center gap-2" style={{ fontFamily: "'Cinzel', serif" }}>
          🎯 Quick Roll
        </h3>

        {/* Dice buttons */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
          {[2, 4, 6, 8, 10, 12, 20, 100].map(sides => (
            <button
              key={sides}
              onClick={() => setQuickDice(prev => ({
                ...prev,
                [sides]: (prev[sides] || 0) + 1
              }))}
              className="py-2 bg-stone-800 border border-amber-700/40 rounded hover:bg-amber-900/30 hover:border-amber-500/60 text-amber-300 font-mono font-bold transition-all text-sm"
            >
              d{sides}
            </button>
          ))}
        </div>

        {/* Modifier buttons */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
          {[1, 3, 5].map(n => (
            <button
              key={`plus${n}`}
              onClick={() => setQuickMod(prev => prev + n)}
              className="py-2 bg-stone-800 border border-emerald-700/40 rounded hover:bg-emerald-900/30 hover:border-emerald-500/60 text-emerald-300 font-mono font-bold transition-all text-sm"
            >
              +{n}
            </button>
          ))}
          <button
            onClick={() => setQuickAdv(prev => prev < 0 ? 0 : prev + 1)}
            className="py-2 bg-stone-800 border border-blue-700/40 rounded hover:bg-blue-900/30 hover:border-blue-500/60 text-blue-300 font-mono font-bold transition-all text-xs flex flex-col items-center justify-center"
          >
            <span>ADV</span>
            {quickAdv > 0 && <span className="text-[9px] text-blue-200">x{quickAdv}</span>}
          </button>
          {[1, 3, 5].map(n => (
            <button
              key={`minus${n}`}
              onClick={() => setQuickMod(prev => prev - n)}
              className="py-2 bg-stone-800 border border-red-700/40 rounded hover:bg-red-900/30 hover:border-red-500/60 text-red-300 font-mono font-bold transition-all text-sm"
            >
              -{n}
            </button>
          ))}
          <button
            onClick={() => setQuickAdv(prev => prev > 0 ? 0 : prev - 1)}
            className="py-2 bg-stone-800 border border-purple-700/40 rounded hover:bg-purple-900/30 hover:border-purple-500/60 text-purple-300 font-mono font-bold transition-all text-xs flex flex-col items-center justify-center"
          >
            <span>DIS</span>
            {quickAdv < 0 && <span className="text-[9px] text-purple-200">x{Math.abs(quickAdv)}</span>}
          </button>
        </div>

        {/* Formula display */}
        <div className="mb-3">
          <label className="block text-xs text-stone-400 mb-1">Formula</label>
          <div className="bg-stone-800 border border-stone-600 rounded px-3 py-2 text-amber-200 font-mono min-h-[40px] flex items-center">
            {getQuickRollFormula() || <span className="text-stone-500">Click dice/modifiers above...</span>}
          </div>
        </div>

        {/* Description input */}
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

        {/* Roll & Clear buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => {
              const baseFormula = getQuickRollFormula(false);
              if (!baseFormula) return;
              setError(null);
              
              try {
                const rollsToKeep = Math.abs(quickAdv) + 1;
                const results: RollResult[] = [];
                
                // Roll multiple times if Advantage or Disadvantage is active
                for (let i = 0; i < rollsToKeep; i++) {
                  results.push(executeMacro({ id: 'quick', name: 'Quick Roll', formula: baseFormula }, state.modifiers));
                }
                
                // Determine best/worst result
                let selectedIdx = 0;
                let finalResultObj = results[0];
                
                for (let i = 1; i < results.length; i++) {
                  if (quickAdv > 0 && results[i].total > finalResultObj.total) {
                    finalResultObj = results[i];
                    selectedIdx = i;
                  } else if (quickAdv < 0 && results[i].total < finalResultObj.total) {
                    finalResultObj = results[i];
                    selectedIdx = i;
                  }
                }
                
                // Construct detailed combined steps for the log
                const combinedSteps: RollStep[] = [];
                results.forEach((r, idx) => {
                  combinedSteps.push({
                    label: `🔄 Attempt ${idx + 1}${idx === selectedIdx ? ' (Kept)' : ''}`,
                    value: r.total,
                    detail: r.steps.map(s => `${s.label.replace('🎲 ', '')}: ${s.value}`).join(', '),
                  });
                });
                
                combinedSteps.push({
                  label: quickAdv > 0 ? '🏆 Kept Highest' : (quickAdv < 0 ? '💀 Kept Lowest' : '⚡ Final Result'),
                  value: finalResultObj.total,
                  detail: `Formula: ${baseFormula}`
                });
                
                const finalResult: RollResult = {
                  macroName: `Quick Roll${quickAdv > 0 ? ` [Adv x${quickAdv}]` : (quickAdv < 0 ? ` [Dis x${Math.abs(quickAdv)}]` : '')}`,
                  formula: getQuickRollFormula(true),
                  steps: combinedSteps,
                  total: finalResultObj.total,
                  timestamp: Date.now(),
                  description: quickDescription.trim() || undefined
                };
                
                addRollResults(finalResult);
                
                if (state.autoSend) {
                  sendToDiscord(state.webhookUrl || '', state.characterName || '', finalResult).then(discordErr => {
                    if (discordErr) setError(`Discord: ${discordErr}`);
                  });
                }
              } catch (err: unknown) {
                setError(err instanceof Error ? err.message : 'Roll failed');
              }
            }}
            disabled={!getQuickRollFormula(false)}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-700/50 text-amber-200 rounded border border-amber-600/50 hover:bg-amber-700/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
          >
            <Dices size={14} /> Roll
          </button>
          <button
            onClick={() => {
              setQuickDice({});
              setQuickMod(0);
              setQuickAdv(0);
              setQuickDescription('');
            }}
            disabled={!getQuickRollFormula(false)}
            className="flex items-center gap-1.5 px-4 py-2 bg-stone-700/50 text-stone-300 rounded border border-stone-600/50 hover:bg-stone-700/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm"
          >
            <X size={14} /> Clear
          </button>
        </div>
      </div>

      {/* ─── Modifiers Section ────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>📊 Modifiers</h3>
          <button onClick={addModifier} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 transition-colors text-sm">
            <Plus size={14} /> Add Modifier
          </button>
        </div>

        {state.modifiers.length === 0 ? (
          <div className="text-stone-500 text-center py-8 border border-dashed border-stone-700 rounded-lg">
            No modifiers yet. Add one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {state.modifiers.map(mod => {
              const preview = getModifierPreview(mod);
              const isEditing = editingModId === mod.id;
              return (
                <div key={mod.id} className="flex items-center gap-3 p-3 bg-stone-900/60 border border-stone-700/50 rounded-lg group">
                  {isEditing ? (
                    <>
                      <div className="flex-1 grid grid-cols-[120px_1fr_1fr] gap-2">
                        <input value={modEditBuffer.name || ''} onChange={e => setModEditBuffer(b => ({ ...b, name: e.target.value }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-200 text-sm" placeholder="Display Name" />
                        <input value={modEditBuffer.id || ''} onChange={e => setModEditBuffer(b => ({ ...b, id: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-emerald-300 text-sm font-mono" placeholder="modifier-id" />
                        <input value={modEditBuffer.value || ''} onChange={e => setModEditBuffer(b => ({ ...b, value: e.target.value }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-200 text-sm font-mono" placeholder="Value or formula" />
                      </div>
                      <button onClick={saveEditMod} className="p-1.5 text-emerald-400 hover:text-emerald-300"><Check size={16} /></button>
                      <button onClick={cancelEditMod} className="p-1.5 text-stone-400 hover:text-stone-300"><X size={16} /></button>
                    </>
                  ) : (
                    <>
                      <div className="w-40 text-amber-200 font-medium truncate">{mod.name}</div>
                      <code className="text-emerald-400 text-sm bg-stone-800 px-2 py-0.5 rounded min-w-[80px] text-center">@{mod.id}</code>
                      <div className="flex-1 text-stone-400 text-sm font-mono truncate">{mod.value}</div>
                      <div className={`text-sm font-bold min-w-[50px] text-right ${preview.error ? 'text-red-400' : 'text-amber-300'}`} title={preview.error || ''}>
                        = {preview.value}
                      </div>
                      <button onClick={() => startEditMod(mod)} className="p-1.5 text-stone-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity"><Edit3 size={14} /></button>
                      <button onClick={() => removeModifier(mod.id)} className="p-1.5 text-stone-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Macros Section ───────────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>⚡ Dice Macros</h3>
          <div className="flex gap-2">
            {state.macros.length > 1 && (
              <button onClick={rollAllMacros} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-900/40 text-purple-300 rounded border border-purple-800/40 hover:bg-purple-900/60 transition-colors text-sm">
                <Zap size={14} /> Roll All
              </button>
            )}
            <button onClick={addMacro} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/40 text-emerald-300 rounded border border-emerald-800/40 hover:bg-emerald-900/60 transition-colors text-sm">
              <Plus size={14} /> Add Macro
            </button>
          </div>
        </div>

        {state.macros.length === 0 ? (
          <div className="text-stone-500 text-center py-8 border border-dashed border-stone-700 rounded-lg">
            No macros yet. Add one to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {state.macros.map(macro => {
              const isEditing = editingMacroId === macro.id;
              return (
                <div key={macro.id} className="flex items-center gap-3 p-3 bg-stone-900/60 border border-stone-700/50 rounded-lg group">
                  {isEditing ? (
                    <>
                      <div className="flex-1 grid grid-cols-[150px_1fr] gap-2">
                        <input value={macroEditBuffer.name || ''} onChange={e => setMacroEditBuffer(b => ({ ...b, name: e.target.value }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-200 text-sm" placeholder="Macro Name" />
                        <input value={macroEditBuffer.formula || ''} onChange={e => setMacroEditBuffer(b => ({ ...b, formula: e.target.value }))} className="bg-stone-800 border border-stone-600 rounded px-2 py-1 text-amber-200 text-sm font-mono" placeholder="Formula (e.g. 1d20 + @wisdom)" />
                      </div>
                      <button onClick={saveEditMacro} className="p-1.5 text-emerald-400 hover:text-emerald-300"><Check size={16} /></button>
                      <button onClick={cancelEditMacro} className="p-1.5 text-stone-400 hover:text-stone-300"><X size={16} /></button>
                    </>
                  ) : (
                    <>
                      <div className="w-40 text-amber-200 font-medium truncate">{macro.name}</div>
                      <code className="flex-1 text-purple-300 text-sm bg-stone-800 px-2 py-0.5 rounded font-mono truncate">{macro.formula}</code>
                      <button onClick={() => rollMacro(macro)} className="flex items-center gap-1 px-3 py-1 bg-amber-700/40 text-amber-200 rounded border border-amber-600/40 hover:bg-amber-700/60 transition-colors text-sm font-bold">
                        <Dices size={14} /> Roll
                      </button>
                      <button onClick={() => exportMacro(macro)} className="p-1.5 text-stone-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Export standalone"><Download size={14} /></button>
                      <button onClick={() => copyShareLink(macro)} className="p-1.5 text-stone-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity" title="Copy share link"><Copy size={14} /></button>
                      <button onClick={() => startEditMacro(macro)} className="p-1.5 text-stone-500 hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity"><Edit3 size={14} /></button>
                      <button onClick={() => removeMacro(macro.id)} className="p-1.5 text-stone-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Roll Results ─────────────────────────────────────────────────── */}
      <div ref={resultsRef}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xl text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>📜 Roll Results</h3>
          {rollResults.length > 0 && (
            <button onClick={() => setRollResults([])} className="text-sm text-stone-500 hover:text-stone-300 transition-colors">Clear All</button>
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
                    {result.steps.map((step, si) => (
                      <div key={si} className="flex items-center gap-2 text-sm">
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

      {/* ─── Syntax Help ──────────────────────────────────────────────────── */}
      <div className="mt-8 p-4 bg-stone-900/40 border border-stone-700/30 rounded-lg">
        <h4 className="text-amber-300 font-bold mb-2" style={{ fontFamily: "'Cinzel', serif" }}>📖 Syntax Reference</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-stone-400">
          <div>
            <p className="text-amber-400 font-bold mb-1">Dice Notation</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li><code className="text-purple-300">1d20</code> — Roll one 20-sided die</li>
              <li><code className="text-purple-300">2d6</code> — Roll two 6-sided dice</li>
              <li><code className="text-purple-300">4d6kh3</code> — Roll 4d6, keep highest 3</li>
              <li><code className="text-purple-300">2d20kl1</code> — Roll 2d20, keep lowest (disadvantage)</li>
              <li><code className="text-purple-300">2d20kh1</code> — Roll 2d20, keep highest (advantage)</li>
            </ul>
          </div>
          <div>
            <p className="text-amber-400 font-bold mb-1">Modifier References</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li><code className="text-emerald-300">@wisdom</code> — Use modifier with id "wisdom"</li>
              <li><code className="text-emerald-300">@str + @con</code> — Combine modifiers</li>
              <li><code className="text-emerald-300">@str * 1.5</code> — Math with modifiers</li>
            </ul>
            <p className="text-amber-400 font-bold mb-1 mt-3">Example Formulas</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li><code className="text-amber-200">1d20 + @wisdom</code> — Skill check</li>
              <li><code className="text-amber-200">2d20kh1 + @luck</code> — Advantage roll</li>
              <li><code className="text-amber-200">8d6 + @fire_power</code> — Damage roll</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiceMacros;
