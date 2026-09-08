import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AlertTriangle, BookOpen, Dices, FlaskConical, Shield, Sparkles } from 'lucide-react';
import { CharacterAction, CharacterData, CharacterDiceMacro, CharacterGeneralItem, CharacterInventoryItem, CharacterLocalVariable, CharacterSpell, CharacterStatus, StatusEffect } from '../types/character';
import { loadCharacterById, loadUserDiceSettings, saveCharacter, UserDiceSettings } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { buildCharacterFormulaContext, buildLocalVariableContext, evalCharacterFormula } from '../lib/characterContext';
import { getPixhostDirectImageUrl, isDirectImageUrl } from '../lib/pixhost';
import { QuickTools } from './QuickTools';

export type HomebrewViewerEntityType = 'general-item' | 'inventory-item' | 'spell' | 'status';

interface HomebrewViewerProps {
  entityType: HomebrewViewerEntityType;
  characterId: string;
  entryId: string;
  onBack?: () => void;
}

type ViewerEntry =
  | { kind: 'general-item'; entry: CharacterGeneralItem }
  | { kind: 'inventory-item'; entry: CharacterInventoryItem }
  | { kind: 'spell'; entry: CharacterSpell }
  | { kind: 'status'; entry: CharacterStatus };

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

interface DiceRoll {
  notation: string;
  rolls: number[];
  kept: number[];
  dropped: number[];
  sum: number;
}

const statusDurationLabels: Record<string, string> = {
  custom: 'Custom',
  round: 'Round',
  battle: 'Battle',
  'short-rest': 'Short Rest',
  'long-rest': 'Long Rest',
  minute: 'Minute',
};

const formatStatusDuration = (status: Partial<CharacterStatus>): string => {
  const duration = status.duration || '';
  const type = status.durationType || 'custom';
  if (type === 'custom') return duration || '—';
  const label = statusDurationLabels[type] || 'Duration';
  return `${duration || '0'} ${label}${duration === '1' ? '' : 's'}`;
};

const parchmentBackground = {
  backgroundImage:
    "radial-gradient(circle at top left, rgba(120,53,15,0.12), transparent 35%), linear-gradient(180deg, rgba(245,232,197,0.98) 0%, rgba(235,219,184,0.98) 100%)",
};

const viewerSectionClass =
  'rounded-2xl border border-amber-900/20 bg-white/45 p-5 shadow-[0_18px_36px_rgba(68,38,17,0.12)] backdrop-blur-[1px]';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const rollDice = (notation: string): DiceRoll => {
  const match = notation.match(/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i);
  if (!match) throw new Error(`Invalid dice notation: ${notation}`);

  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const keepMode = match[3]?.toLowerCase();
  const keepCount = match[4] ? parseInt(match[4], 10) : 0;
  if (count < 1 || count > 100) throw new Error('Dice count 1-100');
  if (sides < 2 || sides > 1000) throw new Error('Dice sides 2-1000');

  const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
  let kept = [...rolls];
  let dropped: number[] = [];
  if (keepMode && keepCount > 0 && keepCount < count) {
    const indexed = rolls.map((value, index) => ({ value, index }));
    indexed.sort((left, right) => keepMode === 'kh' ? right.value - left.value : left.value - right.value);
    const keptIndices = new Set(indexed.slice(0, keepCount).map(item => item.index));
    kept = rolls.filter((_value, index) => keptIndices.has(index));
    dropped = rolls.filter((_value, index) => !keptIndices.has(index));
  }

  return { notation, rolls, kept, dropped, sum: kept.reduce((sum, value) => sum + value, 0) };
};

const getEntityMeta = (kind: HomebrewViewerEntityType) => {
  switch (kind) {
    case 'general-item':
      return { label: 'Item', icon: <Shield size={18} />, accent: '#8b5e34' };
    case 'inventory-item':
      return { label: 'Item', icon: <Shield size={18} />, accent: '#7c4b1f' };
    case 'spell':
      return { label: 'Spell', icon: <Sparkles size={18} />, accent: '#6b21a8' };
    case 'status':
      return { label: 'Status', icon: <FlaskConical size={18} />, accent: '#b45309' };
  }
};

const getHomebrewImageUrl = (entry: ViewerEntry['entry']): string => (
  (() => {
    const imageUrl = 'homebrewImageUrl' in entry && typeof entry.homebrewImageUrl === 'string'
      ? entry.homebrewImageUrl
      : '';
    const thumbUrl = 'homebrewImageThumbUrl' in entry && typeof entry.homebrewImageThumbUrl === 'string'
      ? entry.homebrewImageThumbUrl
      : '';
    if (imageUrl && isDirectImageUrl(imageUrl)) return imageUrl;
    return thumbUrl ? getPixhostDirectImageUrl(imageUrl || thumbUrl, thumbUrl) : imageUrl;
  })()
);

const getHomebrewImageThumbUrl = (entry: ViewerEntry['entry']): string => (
  'homebrewImageThumbUrl' in entry && typeof entry.homebrewImageThumbUrl === 'string'
    ? entry.homebrewImageThumbUrl
    : getHomebrewImageUrl(entry)
);

const sendToDiscord = async (webhookUrl: string, characterName: string, result: RollResult): Promise<string | null> => {
  try {
    const response = await fetch('https://ulunavir-vercel.vercel.app/api/send-dice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookUrl, characterName, result }),
    });
    const data = await response.json().catch(() => ({}));
    return response.ok ? null : data.error || `Server error ${response.status}`;
  } catch {
    return 'Server connection error. Ensure the API route is deployed.';
  }
};

const renderStatusEffect = (
  effect: StatusEffect,
  key: string,
  canApplyStatuses: boolean,
  onApplyStatus: (effect: StatusEffect) => void,
) => {
  if (effect.effectType === 'status') {
    return (
      <div key={key} className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
        <button
          type="button"
          onClick={() => onApplyStatus(effect)}
          disabled={!canApplyStatuses || !effect.statusEntry}
          className="rounded-lg border border-indigo-800/30 bg-indigo-100/65 px-3 py-1.5 text-xs font-bold text-indigo-900 transition hover:bg-indigo-200/70 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Apply
        </button>
        <span className="font-bold text-indigo-950">{effect.statusName || effect.statusEntry?.name || 'Imported Status'}</span>
        {!canApplyStatuses && (
          <span className="text-xs italic text-stone-500">Control access needed</span>
        )}
      </div>
    );
  }

  if (effect.effectType === 'bar-update') {
    return (
      <div key={key} className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
        <span className="rounded-full border border-sky-700/15 bg-sky-100/70 px-2 py-1 font-mono text-sky-800">
          {effect.targetId || 'target_bar'}
        </span>
        <span className="font-mono text-amber-900">{effect.value || '0'}</span>
      </div>
    );
  }

  return (
    <div key={key} className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
      <span className="rounded-full border border-stone-700/15 bg-stone-100/70 px-2 py-1 font-mono text-emerald-800">
        {effect.targetId || 'unknown_target'}
      </span>
      <span className="font-mono text-amber-900">{effect.value || '0'}</span>
      <span className="text-xs uppercase tracking-[0.16em] text-stone-600">
        {(effect.active ?? true) ? 'Active' : 'Inactive'}
      </span>
    </div>
  );
};

const renderActionBlock = (
  action: CharacterAction,
  localVariables: CharacterLocalVariable[] | undefined,
  canApplyStatuses: boolean,
  onRollMacro: (macro: CharacterDiceMacro, localVariables?: CharacterLocalVariable[], namePrefix?: string, description?: string) => void,
  onApplyStatus: (effect: StatusEffect) => void,
) => (
  <div
    key={action.id}
    className="rounded-xl border border-amber-900/15 bg-black/5 p-4"
  >
    <div className="flex flex-wrap items-center gap-3 mb-2">
      <h4 className="text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
        {action.name || 'Unnamed Action'}
      </h4>
      {action.cost && (
        <span className="rounded-full border border-amber-900/20 bg-amber-100/70 px-2.5 py-1 text-xs uppercase tracking-[0.18em] text-amber-900">
          Cost: {action.cost}
        </span>
      )}
      {action.usageRemaining && (
        <span className="rounded-full border border-stone-700/15 bg-stone-100/75 px-2.5 py-1 text-xs uppercase tracking-[0.18em] text-stone-700">
          Uses: {action.usageRemaining}
        </span>
      )}
    </div>
    {action.description && (
      <p className="whitespace-pre-wrap text-[15px] leading-7 text-stone-800">{action.description}</p>
    )}
    {(action.macros || []).length > 0 && (
      <div className="mt-4">
        <h5 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-amber-900/75">Macros</h5>
        <div className="space-y-2">
          {(action.macros || []).map((macro) => (
            <div key={macro.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-900/15 bg-white/35 p-2">
              <button
                type="button"
                onClick={() => onRollMacro(macro, localVariables, action.name || 'Action', action.description || undefined)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/25 bg-amber-100/75 px-3 py-1.5 text-xs font-bold text-amber-950 transition hover:bg-amber-200/70"
              >
                <Dices size={14} /> Roll
              </button>
              <span className="font-bold text-amber-950">{macro.name || 'Unnamed Macro'}</span>
              <code className="min-w-0 flex-1 truncate text-sm text-emerald-800">{macro.formula}</code>
            </div>
          ))}
        </div>
      </div>
    )}
    {(action.effects || []).length > 0 && (
      <div className="mt-4">
        <h5 className="text-xs font-bold uppercase tracking-[0.18em] text-amber-900/75 mb-2">Effects</h5>
        <div className="space-y-2">
          {(action.effects || []).map((effect, effectIndex) => (
            renderStatusEffect(effect, `${action.id}-effect-${effectIndex}`, canApplyStatuses, onApplyStatus)
          ))}
        </div>
      </div>
    )}
  </div>
);

export const HomebrewViewer: React.FC<HomebrewViewerProps> = ({
  entityType,
  characterId,
  entryId,
  onBack,
}) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [diceSettings, setDiceSettings] = useState<UserDiceSettings>({ macros: [], webhookUrl: '', autoSend: false });
  const [rollPopupResult, setRollPopupResult] = useState<RollResult | null>(null);
  const [localInputRequest, setLocalInputRequest] = useState<{ title: string; variables: CharacterLocalVariable[]; resolve: (values: Record<string, number> | null) => void } | null>(null);
  const [localInputDrafts, setLocalInputDrafts] = useState<Record<string, string>>({});
  const [localInputError, setLocalInputError] = useState('');
  const rollPopupTimeoutRef = useRef<number | null>(null);

  useEffect(() => authProvider.onAuthChange((state) => setUserId(state.uid)), []);

  useEffect(() => {
    loadUserDiceSettings(userId).then(setDiceSettings);
  }, [userId]);

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

  useEffect(() => () => {
    if (rollPopupTimeoutRef.current) window.clearTimeout(rollPopupTimeoutRef.current);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);

    loadCharacterById(characterId, userId)
      .then((loadedCharacter) => {
        if (!isMounted) return;
        if (!loadedCharacter) {
          setCharacter(null);
          setError('This homebrew entry could not be found, or you do not have access to this character.');
        } else {
          setCharacter(loadedCharacter);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error(err);
        setError('Failed to load this homebrew entry.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [characterId, userId]);

  const viewerEntry = useMemo<ViewerEntry | null>(() => {
    if (!character) return null;
    switch (entityType) {
      case 'general-item': {
        const entry = (character.generalItems || []).find((item) => item.id === entryId);
        return entry ? { kind: 'general-item', entry } : null;
      }
      case 'inventory-item': {
        const entry = (character.inventory || []).find((item) => item.id === entryId);
        return entry ? { kind: 'inventory-item', entry } : null;
      }
      case 'spell': {
        const entry = (character.spells || []).find((spell) => spell.id === entryId);
        return entry ? { kind: 'spell', entry } : null;
      }
      case 'status': {
        const entry = (character.statuses || []).find((status) => status.id === entryId);
        return entry ? { kind: 'status', entry } : null;
      }
      default:
        return null;
    }
  }, [character, entityType, entryId]);

  const meta = getEntityMeta(entityType);
  const canControlCharacter = !!character && (
    !character.userId
    || character.userId === 'guest'
    || (!!userId && (character.userId === userId || (character.controlUserIds || []).includes(userId)))
  );

  const getCharacterContext = useCallback((): Record<string, number> => {
    return buildCharacterFormulaContext(character);
  }, [character]);

  const getLocalVariableContext = useCallback((
    variables: CharacterLocalVariable[] | undefined,
    globalContext: Record<string, number>,
  ): Record<string, number> => {
    return buildLocalVariableContext(variables, globalContext);
  }, []);

  const requestLocalInputValues = useCallback((
    variables: CharacterLocalVariable[],
    title = 'Input Values',
  ): Promise<Record<string, number> | null> => (
    new Promise((resolve) => {
      setLocalInputDrafts(variables.reduce<Record<string, string>>((drafts, variable) => {
        drafts[variable.id] = '0';
        return drafts;
      }, {}));
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
  ), []);

  const getLocalVariableContextWithInputs = useCallback(async (
    variables: CharacterLocalVariable[] | undefined,
    globalContext: Record<string, number>,
    formula: string,
    title = 'Input Values',
  ): Promise<Record<string, number> | null> => {
    const normalizedVariables = variables || [];
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
    return { ...localContext, ...inputValues };
  }, [getLocalVariableContext, requestLocalInputValues]);

  const executeMacro = useCallback((
    macro: CharacterDiceMacro,
    context: Record<string, number>,
    localContext: Record<string, number> = {},
  ): RollResult => {
    const steps: RollStep[] = [];
    const parts = (macro.formula || '').trim().split(/(\d*d\d+(?:kh|kl)?\d*|@@[a-zA-Z0-9_-]+|@[a-zA-Z0-9_-]+)/gi);
    const resolvedParts: string[] = [];

    parts.forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      if (/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i.test(trimmed)) {
        const dice = rollDice(trimmed);
        steps.push({
          label: trimmed,
          value: dice.sum,
          detail: dice.rolls.length > 1 ? `[${dice.rolls.join(', ')}]` : `${dice.sum}`,
        });
        resolvedParts.push(String(dice.sum));
        return;
      }
      const localRef = trimmed.match(/^@@([a-zA-Z0-9_-]+)$/);
      if (localRef) {
        const value = localContext[localRef[1]] ?? 0;
        steps.push({ label: `@@${localRef[1]}`, value, detail: `${localRef[1]} = ${value}` });
        resolvedParts.push(String(value));
        return;
      }
      const globalRef = trimmed.match(/^@([a-zA-Z0-9_-]+)$/);
      if (globalRef) {
        const value = context[globalRef[1]] ?? 0;
        steps.push({ label: `@${globalRef[1]}`, value, detail: `${globalRef[1]} = ${value}` });
        resolvedParts.push(String(value));
        return;
      }
      resolvedParts.push(trimmed);
    });

    const total = evalCharacterFormula(resolvedParts.join(' '), {}, {});
    return {
      macroName: macro.name || 'Roll',
      formula: macro.formula || '',
      steps,
      total,
      timestamp: Date.now(),
    };
  }, []);

  const rollMacro = useCallback(async (
    macro: CharacterDiceMacro,
    localVariables?: CharacterLocalVariable[],
    namePrefix?: string,
    description?: string,
  ) => {
    setActionMessage(null);
    const context = getCharacterContext();
    const localContext = await getLocalVariableContextWithInputs(localVariables, context, macro.formula || '', `${namePrefix || macro.name || 'Roll'} Input Values`);
    if (!localContext) return;
    const result = executeMacro(
      { ...macro, name: namePrefix ? `${namePrefix}: ${macro.name || 'Roll'}` : macro.name },
      context,
      localContext,
    );
    result.description = description || undefined;
    showRollPopup(result);
    if (diceSettings.autoSend) {
      const discordErr = await sendToDiscord(diceSettings.webhookUrl || '', character?.name || characterId, result);
      setActionMessage(discordErr ? `Discord: ${discordErr}` : null);
    }
  }, [character?.name, characterId, diceSettings.autoSend, diceSettings.webhookUrl, executeMacro, getCharacterContext, getLocalVariableContextWithInputs, showRollPopup]);

  const buildAppliedStatus = useCallback((template: Partial<CharacterStatus>, folderId: string | null): CharacterStatus => ({
    id: `st_${uid()}`,
    name: template.name || 'Imported Status',
    duration: template.duration || '',
    durationType: template.durationType || 'custom',
    durationEndBehavior: template.durationEndBehavior || 'delete',
    maxDuration: template.maxDuration || '',
    replenishTrigger: template.replenishTrigger || 'custom',
    replenishAmount: template.replenishAmount || '',
    description: template.description || '',
    effects: (template.effects || []) as StatusEffect[],
    actions: (template.actions || []) as CharacterAction[],
    localVariables: (template.localVariables || []) as CharacterLocalVariable[],
    scripts: template.scripts || [],
    active: true,
    color: template.color || '#f59e0b',
    hidden: template.hidden ?? false,
    folderId,
  }), []);

  const applyStatusEffect = useCallback(async (effect: StatusEffect) => {
    if (!character || !canControlCharacter || effect.effectType !== 'status' || !effect.statusEntry) return;
    const nextCharacter = {
      ...character,
      statuses: [
        ...(character.statuses || []),
        buildAppliedStatus(effect.statusEntry as Partial<CharacterStatus>, effect.statusFolderId || null),
      ],
    };
    setCharacter(nextCharacter);
    const result = await saveCharacter(nextCharacter);
    setActionMessage(result.remoteSaved || result.localSaved ? 'Status applied to character.' : 'Status could not be saved.');
  }, [buildAppliedStatus, canControlCharacter, character]);

  const submitLocalInputs = () => {
    if (!localInputRequest) return;
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
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] p-6 pr-24 text-stone-900" style={parchmentBackground}>
      <QuickTools character={character} canControl={canControlCharacter} onCharacterUpdated={setCharacter} />
      {rollPopupResult && (
        <button
          type="button"
          onClick={dismissRollPopup}
          className="fixed bottom-5 right-5 z-[9999] w-[min(360px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-amber-500/60 bg-stone-950/95 text-left shadow-[0_18px_55px_rgba(0,0,0,0.55)] ring-1 ring-amber-200/10 backdrop-blur transition hover:border-amber-300"
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
      {localInputRequest && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-700/50 bg-stone-950 p-5 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
            <h3 className="text-lg font-bold text-cyan-100" style={{ fontFamily: "'Cinzel', serif" }}>
              {localInputRequest.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">
              This roll needs temporary local input values.
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
                      setLocalInputDrafts(prev => ({ ...prev, [variable.id]: event.target.value.replace(',', '.').replace(/[^\d.-]/g, '') }));
                      setLocalInputError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitLocalInputs();
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
                onClick={submitLocalInputs}
                className="rounded-lg border border-cyan-500/60 bg-cyan-900/40 px-4 py-2 text-sm font-bold text-cyan-100 transition hover:bg-cyan-800/55"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                Roll
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-white/45 px-4 py-2 text-sm text-amber-950 hover:bg-white/65 cursor-pointer"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="rounded-full border border-amber-900/20 bg-white/45 px-4 py-2 text-sm text-stone-700">
            Source Character: <span className="font-bold text-amber-950">{character?.name || characterId}</span>
          </div>
        </div>
        {actionMessage && (
          <div className="mb-4 rounded-xl border border-emerald-900/20 bg-emerald-100/65 px-4 py-3 text-sm font-semibold text-emerald-950">
            {actionMessage}
          </div>
        )}

        {isLoading ? (
          <div className={`${viewerSectionClass} text-center text-lg text-stone-700`}>Loading homebrew entry...</div>
        ) : error ? (
          <div className={`${viewerSectionClass} flex items-start gap-3 text-rose-900`}>
            <AlertTriangle className="mt-1" size={20} />
            <div>
              <h2 className="text-xl font-bold" style={{ fontFamily: "'Cinzel', serif" }}>Unable to Load</h2>
              <p className="mt-2 text-[15px] leading-7">{error}</p>
            </div>
          </div>
        ) : !viewerEntry ? (
          <div className={`${viewerSectionClass} text-center text-lg text-stone-700`}>
            This entry no longer exists on the source character.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <article className={`${viewerSectionClass} relative overflow-hidden`}>
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: `linear-gradient(90deg, ${meta.accent}, transparent)` }}
              />
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
                    {meta.icon}
                    {meta.label}
                  </div>
                  <h1 className="text-4xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                    {viewerEntry.entry.name || `Unnamed ${meta.label}`}
                  </h1>
                </div>
              </div>

              {'description' in viewerEntry.entry && viewerEntry.entry.description ? (
                <div className="rounded-xl border border-amber-900/15 bg-white/35 p-4">
                  <p className="whitespace-pre-wrap text-[16px] leading-8 text-stone-800">
                    {viewerEntry.entry.description}
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-amber-900/15 bg-white/25 p-4 text-stone-600">
                  No description has been written for this entry yet.
                </div>
              )}

              {'actions' in viewerEntry.entry && (viewerEntry.entry.actions || []).length > 0 && (
                <section className="mt-6">
                  <div className="mb-3 flex items-center gap-2 text-amber-950">
                    <BookOpen size={18} />
                    <h2 className="text-2xl" style={{ fontFamily: "'Cinzel', serif" }}>Actions</h2>
                  </div>
                  <div className="space-y-3">
                    {(viewerEntry.entry.actions || []).map(action => renderActionBlock(
                      action,
                      'localVariables' in viewerEntry.entry ? viewerEntry.entry.localVariables : undefined,
                      canControlCharacter,
                      (macro, localVariables, namePrefix, description) => void rollMacro(macro, localVariables, namePrefix, description),
                      (effect) => void applyStatusEffect(effect),
                    ))}
                  </div>
                </section>
              )}

              {'effects' in viewerEntry.entry && (viewerEntry.entry.effects || []).length > 0 && (
                <section className="mt-6">
                  <div className="mb-3 flex items-center gap-2 text-amber-950">
                    <FlaskConical size={18} />
                    <h2 className="text-2xl" style={{ fontFamily: "'Cinzel', serif" }}>Effects</h2>
                  </div>
                  <div className="rounded-xl border border-amber-900/15 bg-black/5 p-4">
                    <div className="space-y-2">
                      {(viewerEntry.entry.effects || []).map((effect, index) => (
                        renderStatusEffect(effect, `${viewerEntry.entry.id}-effect-${index}`, canControlCharacter, (entryEffect) => void applyStatusEffect(entryEffect))
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </article>

            <aside className="space-y-6">
              {getHomebrewImageThumbUrl(viewerEntry.entry) && (
                <section className={`${viewerSectionClass} overflow-hidden p-0`}>
                  <a href={getHomebrewImageUrl(viewerEntry.entry) || getHomebrewImageThumbUrl(viewerEntry.entry)} target="_blank" rel="noreferrer">
                    <img
                      src={getHomebrewImageThumbUrl(viewerEntry.entry)}
                      alt={viewerEntry.entry.name || meta.label}
                      className="max-h-[420px] w-full object-cover"
                      onError={(event) => {
                        const fallbackUrl = getHomebrewImageUrl(viewerEntry.entry);
                        if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                          event.currentTarget.src = fallbackUrl;
                        }
                      }}
                    />
                  </a>
                </section>
              )}

              <section className={viewerSectionClass}>
                <h2 className="mb-4 text-2xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                  Homebrew Details
                </h2>
                <div className="space-y-3 text-[15px] leading-7 text-stone-800">
                  {'quantity' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Quantity:</span> {viewerEntry.entry.quantity}</div>
                  )}
                  {'rarity' in viewerEntry.entry && viewerEntry.entry.rarity && (
                    <div><span className="font-bold text-amber-950">Rarity:</span> {viewerEntry.entry.rarity}</div>
                  )}
                  {'status' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Status:</span> {viewerEntry.entry.status || '—'}</div>
                  )}
                  {'equipped' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Equipped:</span> {viewerEntry.entry.equipped ? 'Yes' : 'No'}</div>
                  )}
                  {'level' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Level:</span> {viewerEntry.entry.level || '—'}</div>
                  )}
                  {'magicSchool' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">School:</span> {viewerEntry.entry.magicSchool || '—'}</div>
                  )}
                  {'resourceCost' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Resource Cost:</span> {viewerEntry.entry.resourceCost || '—'}</div>
                  )}
                  {'usageRemaining' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Usage:</span> {viewerEntry.entry.usageRemaining || '—'}{'totalUsage' in viewerEntry.entry ? ` / ${viewerEntry.entry.totalUsage || '—'}` : ''}</div>
                  )}
                  {'duration' in viewerEntry.entry && (
                    <div><span className="font-bold text-amber-950">Duration:</span> {formatStatusDuration(viewerEntry.entry)}</div>
                  )}
                </div>
              </section>

              {'macros' in viewerEntry.entry && (viewerEntry.entry.macros || []).length > 0 && (
                <section className={viewerSectionClass}>
                  <h2 className="mb-4 text-2xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                    Macros
                  </h2>
                  <div className="space-y-3">
                    {(viewerEntry.entry.macros || []).map((macro) => (
                      <div key={macro.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-900/15 bg-black/5 p-3">
                        <button
                          type="button"
                          onClick={() => void rollMacro(
                            macro,
                            'localVariables' in viewerEntry.entry ? viewerEntry.entry.localVariables : undefined,
                            viewerEntry.entry.name || meta.label,
                            'description' in viewerEntry.entry ? viewerEntry.entry.description : undefined,
                          )}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/25 bg-amber-100/75 px-3 py-1.5 text-xs font-bold text-amber-950 transition hover:bg-amber-200/70"
                        >
                          <Dices size={14} /> Roll
                        </button>
                        <div className="font-bold text-amber-950">{macro.name || 'Unnamed Macro'}</div>
                        <code className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-emerald-800">
                          {macro.formula}
                        </code>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomebrewViewer;
