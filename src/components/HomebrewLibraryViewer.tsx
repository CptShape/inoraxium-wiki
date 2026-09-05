import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Dices, FolderOpen, ImageIcon, Layers3, Search, Shield, Sparkles } from 'lucide-react';
import {
  CharacterAction,
  CharacterBar,
  CharacterDiceMacro,
  CharacterData,
  CharacterEntryFolder,
  CharacterGeneralItem,
  CharacterInventoryItem,
  CharacterLocalVariable,
  CharacterSpell,
  CharacterStatus,
  CustomAttribute,
  SkillAttribute,
  StatusEffect,
} from '../types/character';
import { loadCharacterById, loadUserDiceSettings, saveCharacter, UserDiceSettings } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { getPixhostDirectImageUrl, isDirectImageUrl } from '../lib/pixhost';

export type HomebrewLibraryCategory = 'general-items' | 'inventory' | 'statuses' | 'spells';

interface HomebrewLibraryViewerProps {
  category: HomebrewLibraryCategory;
  characterId: string;
  onBack?: () => void;
}

type LibraryEntry =
  | { kind: 'general-item'; entry: CharacterGeneralItem; folderLabel: string; folderId?: string | null; folderColor?: string }
  | { kind: 'inventory-item'; entry: CharacterInventoryItem; folderLabel: string; folderId?: string | null; folderColor?: string }
  | { kind: 'spell'; entry: CharacterSpell; folderLabel: string; folderId?: string | null; folderColor?: string }
  | { kind: 'status'; entry: CharacterStatus; folderLabel: string; folderId?: string | null; folderColor?: string };

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

interface FolderGroup {
  key: string;
  label: string;
  depth: number;
  color?: string;
  entries: LibraryEntry[];
}

interface LibraryFilterTab {
  id: string;
  label: string;
  color?: string;
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
  if (type === 'custom') return duration || 'No duration';
  const label = statusDurationLabels[type] || 'Duration';
  return `${duration || '0'} ${label}${duration === '1' ? '' : 's'}`;
};

const parchmentBackground = {
  backgroundImage:
    "radial-gradient(circle at top left, rgba(120,53,15,0.12), transparent 35%), linear-gradient(180deg, rgba(245,232,197,0.98) 0%, rgba(235,219,184,0.98) 100%)",
};

const sectionClass =
  'rounded-2xl border border-amber-900/20 bg-white/45 p-5 shadow-[0_18px_36px_rgba(68,38,17,0.12)] backdrop-blur-[1px]';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const getBarMode = (bar: CharacterBar) => bar.mode || 'default';

const evalFormula = (
  formula: string,
  context: Record<string, number>,
  localContext: Record<string, number> = {},
): number => {
  if (!formula) return 0;
  const expr = formula
    .replace(/@@([a-zA-Z0-9_-]+)/g, (_match, id) => String(localContext[id] ?? 0))
    .replace(/(^|[^@])@([a-zA-Z0-9_-]+)/g, (_match, prefix, id) => `${prefix}${context[id] ?? 0}`)
    .replace(/roundup/g, 'Math.ceil')
    .replace(/rounddown/g, 'Math.floor')
    .replace(/round/g, 'Math.round')
    .replace(/max/g, 'Math.max')
    .replace(/min/g, 'Math.min');

  try {
    const result = new Function(`"use strict"; return (${expr});`)();
    return typeof result === 'number' && Number.isFinite(result) ? Math.round(result * 100) / 100 : 0;
  } catch {
    return 0;
  }
};

const rollDice = (notation: string): DiceRoll => {
  const match = notation.match(/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i);
  if (!match) throw new Error(`Invalid dice notation: ${notation}`);
  const count = parseInt(match[1] || '1', 10);
  const sides = parseInt(match[2], 10);
  const keepMode = match[3]?.toLowerCase();
  const keepCount = match[4] ? parseInt(match[4], 10) : 0;
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

const categoryMeta: Record<HomebrewLibraryCategory, { title: string; subtitle: string; accent: string; icon: React.ReactNode }> = {
  'general-items': {
    title: 'General Items Library',
    subtitle: 'All shared consumables, keys, and misc items in one compact catalogue.',
    accent: '#9a6a31',
    icon: <Layers3 size={18} />,
  },
  inventory: {
    title: 'Inventory',
    subtitle: 'Character inventory with item images, folders, rarity, quantity, and quick details.',
    accent: '#7c4b1f',
    icon: <Shield size={18} />,
  },
  statuses: {
    title: 'Statuses',
    subtitle: 'Condition cards for the current character, collected into one browseable board.',
    accent: '#b45309',
    icon: <Sparkles size={18} />,
  },
  spells: {
    title: 'Spells',
    subtitle: 'Folder-organized spell cards for quick browsing and handoff.',
    accent: '#6b21a8',
    icon: <BookOpen size={18} />,
  },
};

const rarityColors: Record<string, string> = {
  common: '#78716c',
  uncommon: '#16a34a',
  rare: '#2563eb',
  epic: '#9333ea',
  legendary: '#d97706',
  mythical: '#dc2626',
  unique: '#0891b2',
};

const getEntryName = (entry: LibraryEntry) => entry.entry.name || 'Unnamed Entry';

const getEntryAccentColor = (entry: LibraryEntry): string => {
  if (entry.kind === 'spell') return entry.entry.color || '#6b21a8';
  if (entry.kind === 'status') return entry.entry.color || '#b45309';
  if ('rarity' in entry.entry) return rarityColors[entry.entry.rarity || 'common'] || rarityColors.common;
  return '#9a6a31';
};

const getEntryImageUrl = (entry: LibraryEntry['entry']): string => (
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

const getEntryThumbUrl = (entry: LibraryEntry['entry']): string => (
  'homebrewImageThumbUrl' in entry && typeof entry.homebrewImageThumbUrl === 'string' && entry.homebrewImageThumbUrl
    ? entry.homebrewImageThumbUrl
    : getEntryImageUrl(entry)
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

const getFolderInfo = (folderId: string | null | undefined, folders: CharacterEntryFolder[]) => {
  if (!folderId) return { key: 'root', label: 'Unfoldered', depth: 0, color: undefined as string | undefined };

  const segments: CharacterEntryFolder[] = [];
  let current = folders.find((folder) => folder.id === folderId) || null;
  while (current) {
    const currentFolder: CharacterEntryFolder = current;
    segments.unshift(currentFolder);
    current = currentFolder.parentId ? folders.find((folder) => folder.id === currentFolder.parentId) || null : null;
  }

  return {
    key: folderId,
    label: segments.map((segment) => segment.name || 'Untitled Folder').join(' / ') || 'Unfoldered',
    depth: Math.max(0, segments.length - 1),
    color: segments[segments.length - 1]?.color,
  };
};

const isFolderWithin = (
  folderId: string | null | undefined,
  targetFolderId: string,
  folders: CharacterEntryFolder[],
): boolean => {
  let currentId = folderId || null;
  while (currentId) {
    if (currentId === targetFolderId) return true;
    const folder = folders.find((item) => item.id === currentId);
    currentId = folder?.parentId || null;
  }
  return false;
};

const getSearchHaystack = (entry: LibraryEntry): string => {
  const base = [
    entry.entry.name,
    'description' in entry.entry ? entry.entry.description : '',
    entry.folderLabel,
  ];

  if ('rarity' in entry.entry) base.push(entry.entry.rarity || '');
  if ('level' in entry.entry) base.push(entry.entry.level || '');
  if ('duration' in entry.entry) base.push(formatStatusDuration(entry.entry));

  return base.join(' ').toLowerCase();
};

const buildFolderGroups = (entries: LibraryEntry[]): FolderGroup[] => {
  const groups = new Map<string, FolderGroup>();

  entries.forEach((entry) => {
    const groupKey = `${entry.folderLabel}-${entry.kind}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.entries.push(entry);
      return;
    }

    groups.set(groupKey, {
      key: groupKey,
      label: entry.folderLabel,
      depth: entry.folderLabel.includes(' / ') ? entry.folderLabel.split(' / ').length - 1 : 0,
      color: entry.folderColor,
      entries: [entry],
    });
  });

  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
};

const renderEffectPill = (
  effect: StatusEffect,
  index: number,
  canApplyStatuses = false,
  onApplyStatus?: (effect: StatusEffect) => void,
) => {
  if (effect.effectType === 'status') {
    return (
      <div key={`effect-${index}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-900/15 bg-violet-100/40 px-3 py-2 text-sm text-stone-800">
        <button
          type="button"
          onClick={() => onApplyStatus?.(effect)}
          disabled={!canApplyStatuses || !effect.statusEntry}
          className="rounded-lg border border-violet-800/30 bg-violet-100/70 px-3 py-1.5 text-xs font-bold text-violet-950 transition hover:bg-violet-200/80 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Apply
        </button>
        <span className="font-bold text-violet-950">Status:</span> {effect.statusName || effect.targetId || 'Imported status'}
      </div>
    );
  }

  if (effect.effectType === 'bar-update') {
    return (
      <div key={`effect-${index}`} className="rounded-xl border border-sky-900/15 bg-sky-100/45 px-3 py-2 text-sm text-stone-800">
        <span className="font-bold text-sky-950">Bar:</span> {effect.targetId || effect.barUpdateDescription || 'Target bar'} {effect.value || '0'}
      </div>
    );
  }

  return (
    <div key={`effect-${index}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-700/10 bg-stone-100/55 px-3 py-2 text-sm text-stone-800">
      <span className="rounded-full border border-stone-700/15 bg-white/65 px-2 py-1 font-mono text-emerald-800">
        {effect.targetLabel || effect.targetId || 'unknown_target'}
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
  <div key={action.id} className="rounded-xl border border-amber-900/15 bg-black/5 p-4">
    <div className="mb-2 flex flex-wrap items-center gap-3">
      <h4 className="text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
        {action.name || 'Unnamed Action'}
      </h4>
      {action.cost && (
        <span className="rounded-full border border-amber-900/20 bg-amber-100/70 px-2.5 py-1 text-xs uppercase tracking-[0.18em] text-amber-900">
          Cost: {action.cost}
        </span>
      )}
      {(action.usageRemaining || action.maxUsage) && (
        <span className="rounded-full border border-stone-700/15 bg-stone-100/75 px-2.5 py-1 text-xs uppercase tracking-[0.18em] text-stone-700">
          Uses: {action.usageRemaining || '0'} / {action.maxUsage || '—'}
        </span>
      )}
    </div>
    {action.description && (
      <p className="whitespace-pre-wrap text-[15px] leading-7 text-stone-800">{action.description}</p>
    )}
    {(action.macros || []).length > 0 && (
      <div className="mt-4 space-y-2">
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
    )}
    {(action.effects || []).length > 0 && (
      <div className="mt-4 space-y-2">
        {(action.effects || []).map((effect, effectIndex) => renderEffectPill(effect, effectIndex, canApplyStatuses, onApplyStatus))}
      </div>
    )}
  </div>
);

export const HomebrewLibraryViewer: React.FC<HomebrewLibraryViewerProps> = ({
  category,
  characterId,
  onBack,
}) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);
  const [activeFilterId, setActiveFilterId] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
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
          setError('This character could not be found, or you do not have access to it.');
        } else {
          setCharacter(loadedCharacter);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error(err);
        setError('Failed to load this homebrew library.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [characterId, userId]);

  const meta = categoryMeta[category];

  useEffect(() => {
    setActiveFilterId('all');
    setSearchTerm('');
    setSelectedEntryKey(null);
  }, [category, characterId]);

  const entries = useMemo<LibraryEntry[]>(() => {
    if (!character) return [];

    if (category === 'general-items') {
      return (character.generalItems || []).map((entry) => ({
        kind: 'general-item',
        entry,
        folderLabel: 'General Items',
        folderId: null,
        folderColor: '#9a6a31',
      }));
    }

    if (category === 'inventory') {
      const generalEntries: LibraryEntry[] = (character.generalItems || []).map((entry) => ({
        kind: 'general-item',
        entry,
        folderLabel: 'General Items',
        folderId: null,
        folderColor: '#9a6a31',
      }));
      const inventoryEntries: LibraryEntry[] = (character.inventory || []).map((entry) => {
        const folder = getFolderInfo(entry.folderId, character.inventoryFolders || []);
        return { kind: 'inventory-item', entry, folderLabel: folder.label, folderId: entry.folderId || null, folderColor: folder.color };
      });
      return [...generalEntries, ...inventoryEntries];
    }

    if (category === 'spells') {
      return (character.spells || []).map((entry) => {
        const folder = getFolderInfo(entry.folderId, character.spellFolders || []);
        return { kind: 'spell', entry, folderLabel: folder.label, folderId: entry.folderId || null, folderColor: folder.color };
      });
    }

    return (character.statuses || []).map((entry) => {
      const folder = getFolderInfo(entry.folderId, character.statusFolders || []);
      return { kind: 'status', entry, folderLabel: folder.label, folderId: entry.folderId || null, folderColor: folder.color };
    });
  }, [category, character]);

  const filterTabs = useMemo<LibraryFilterTab[]>(() => {
    if (!character) return [{ id: 'all', label: 'All', color: meta.accent }];

    const tabs: LibraryFilterTab[] = [{ id: 'all', label: 'All', color: meta.accent }];

    if (category === 'inventory') {
      if ((character.generalItems || []).length > 0) {
        tabs.push({ id: 'general-items', label: 'General Items', color: '#9a6a31' });
      }
      (character.inventoryFolders || [])
        .filter((folder) => !folder.parentId && !folder.hidden)
        .forEach((folder) => tabs.push({ id: `folder:${folder.id}`, label: folder.name || 'Untitled Folder', color: folder.color }));
      if ((character.inventory || []).some((entry) => !entry.folderId)) {
        tabs.push({ id: 'unfoldered', label: 'Unfoldered', color: '#78716c' });
      }
    } else if (category === 'spells') {
      tabs.push({ id: 'unfoldered', label: 'General Spells', color: '#6b21a8' });
      (character.spellFolders || [])
        .filter((folder) => !folder.parentId && !folder.hidden)
        .forEach((folder) => tabs.push({ id: `folder:${folder.id}`, label: folder.name || 'Untitled Folder', color: folder.color }));
    } else if (category === 'statuses') {
      tabs.push({ id: 'unfoldered', label: 'General Statuses', color: '#b45309' });
      (character.statusFolders || [])
        .filter((folder) => !folder.parentId && !folder.hidden)
        .forEach((folder) => tabs.push({ id: `folder:${folder.id}`, label: folder.name || 'Untitled Folder', color: folder.color }));
    }

    return tabs;
  }, [category, character, meta.accent]);

  const visibleEntries = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const folders =
      category === 'inventory'
        ? character?.inventoryFolders || []
        : category === 'spells'
          ? character?.spellFolders || []
          : category === 'statuses'
            ? character?.statusFolders || []
            : [];

    return entries.filter((entry) => {
      if (activeFilterId === 'general-items' && entry.kind !== 'general-item') return false;
      if (activeFilterId === 'unfoldered' && entry.folderId) return false;
      if (activeFilterId.startsWith('folder:')) {
        const folderId = activeFilterId.slice('folder:'.length);
        if (entry.kind === 'general-item' || !isFolderWithin(entry.folderId, folderId, folders)) return false;
      }
      if (normalizedSearch && !getSearchHaystack(entry).includes(normalizedSearch)) return false;
      return true;
    });
  }, [activeFilterId, category, character?.inventoryFolders, character?.spellFolders, character?.statusFolders, entries, searchTerm]);

  const groups = useMemo(() => buildFolderGroups(visibleEntries), [visibleEntries]);

  useEffect(() => {
    setSelectedEntryKey((current) => {
      if (current && visibleEntries.some((entry) => `${entry.kind}:${entry.entry.id}` === current)) return current;
      const first = visibleEntries[0];
      return first ? `${first.kind}:${first.entry.id}` : null;
    });
  }, [visibleEntries]);

  const selectedEntry = visibleEntries.find((entry) => `${entry.kind}:${entry.entry.id}` === selectedEntryKey) || null;
  const canControlCharacter = !!character && (
    !character.userId
    || character.userId === 'guest'
    || (!!userId && (character.userId === userId || (character.controlUserIds || []).includes(userId)))
  );

  const getCharacterContext = useCallback((): Record<string, number> => {
    if (!character) return {};
    const context: Record<string, number> = {};
    const mainAttributes = character.mainAttributes || [];
    const allAttributes: Array<CustomAttribute | SkillAttribute> = [
      ...mainAttributes,
      ...(character.secondaryAttributes || []),
      ...(character.skills || []),
      ...(character.otherAttributes || []),
      ...(character.resistances || []),
    ];
    allAttributes.forEach((attribute) => {
      if (attribute.id) context[attribute.id] = evalFormula(attribute.value || '0', context);
    });
    mainAttributes.forEach((attribute) => {
      if (attribute.id) context[`${attribute.id}_mod`] = Math.floor(((context[attribute.id] ?? 0) - 10) / 2);
    });
    (character.bars || []).forEach((bar) => {
      if (!bar.id) return;
      context[`${bar.id}_current`] = evalFormula(bar.currentValue || '0', context);
      if (getBarMode(bar) === 'resource') {
        context[`${bar.id}_reset`] = evalFormula(bar.resetValue || '0', context);
      } else {
        context[`${bar.id}_max`] = evalFormula(bar.maxValue || '0', context);
      }
    });
    return context;
  }, [character]);

  const getLocalVariableContext = useCallback((variables?: CharacterLocalVariable[], globalContext: Record<string, number> = {}) => {
    const localContext: Record<string, number> = {};
    (variables || []).forEach((variable) => {
      if (!variable.id || variable.kind === 'input') return;
      localContext[variable.id] = variable.kind === 'resource'
        ? Number.parseFloat(variable.value || '0') || 0
        : evalFormula(variable.value || '0', globalContext, localContext);
    });
    return localContext;
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

  const executeMacro = useCallback((macro: CharacterDiceMacro, context: Record<string, number>, localContext: Record<string, number>): RollResult => {
    const steps: RollStep[] = [];
    const resolvedParts: string[] = [];
    (macro.formula || '').split(/(\d*d\d+(?:kh|kl)?\d*|@@[a-zA-Z0-9_-]+|@[a-zA-Z0-9_-]+)/gi).forEach((part) => {
      const trimmed = part.trim();
      if (!trimmed) return;
      if (/^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/i.test(trimmed)) {
        const dice = rollDice(trimmed);
        steps.push({ label: trimmed, value: dice.sum, detail: dice.rolls.join(', ') });
        resolvedParts.push(String(dice.sum));
        return;
      }
      const localMatch = trimmed.match(/^@@([a-zA-Z0-9_-]+)$/);
      if (localMatch) {
        const value = localContext[localMatch[1]] ?? 0;
        steps.push({ label: `@@${localMatch[1]}`, value });
        resolvedParts.push(String(value));
        return;
      }
      const globalMatch = trimmed.match(/^@([a-zA-Z0-9_-]+)$/);
      if (globalMatch) {
        const value = context[globalMatch[1]] ?? 0;
        steps.push({ label: `@${globalMatch[1]}`, value });
        resolvedParts.push(String(value));
        return;
      }
      resolvedParts.push(trimmed);
    });
    return {
      macroName: macro.name || 'Roll',
      formula: macro.formula || '',
      steps,
      total: evalFormula(resolvedParts.join(' '), {}, {}),
      timestamp: Date.now(),
    };
  }, []);

  const rollMacro = useCallback(async (macro: CharacterDiceMacro, localVariables?: CharacterLocalVariable[], namePrefix?: string, description?: string) => {
    const context = getCharacterContext();
    const localContext = await getLocalVariableContextWithInputs(
      localVariables,
      context,
      macro.formula || '',
      `${namePrefix || macro.name || 'Roll'} Input Values`,
    );
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

  const applyStatusEffect = useCallback(async (effect: StatusEffect) => {
    if (!character || !canControlCharacter || effect.effectType !== 'status' || !effect.statusEntry) return;
    const newStatus: CharacterStatus = {
      id: `st_${uid()}`,
      name: effect.statusEntry.name || effect.statusName || 'Imported Status',
      duration: effect.statusEntry.duration || '',
      durationType: effect.statusEntry.durationType || 'custom',
      durationEndBehavior: effect.statusEntry.durationEndBehavior || 'delete',
      maxDuration: effect.statusEntry.maxDuration || '',
      replenishTrigger: effect.statusEntry.replenishTrigger || 'custom',
      replenishAmount: effect.statusEntry.replenishAmount || '',
      description: effect.statusEntry.description || '',
      effects: effect.statusEntry.effects || [],
      actions: effect.statusEntry.actions || [],
      localVariables: effect.statusEntry.localVariables || [],
      scripts: effect.statusEntry.scripts || [],
      active: true,
      color: effect.statusEntry.color || '#f59e0b',
      hidden: false,
      folderId: effect.statusFolderId || null,
    };
    const nextCharacter = { ...character, statuses: [...(character.statuses || []), newStatus] };
    setCharacter(nextCharacter);
    const saveResult = await saveCharacter(nextCharacter);
    setActionMessage(saveResult.localSaved || saveResult.remoteSaved ? 'Status applied to character.' : 'Status could not be saved.');
  }, [canControlCharacter, character]);

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

  const renderCard = (entry: LibraryEntry) => {
    const thumbUrl = getEntryThumbUrl(entry.entry);
    const accentColor = getEntryAccentColor(entry);
    const isSelected = selectedEntryKey === `${entry.kind}:${entry.entry.id}`;
    const isItem = entry.kind === 'general-item' || entry.kind === 'inventory-item';
    const isSpell = entry.kind === 'spell';
    const isStatus = entry.kind === 'status';

    return (
      <button
        key={`${entry.kind}-${entry.entry.id}`}
        onClick={() => setSelectedEntryKey(`${entry.kind}:${entry.entry.id}`)}
        className={`rounded-xl border px-3 py-3 text-left shadow-sm transition-all cursor-pointer ${
          isSelected
            ? 'bg-amber-100/80 ring-2 ring-amber-700/15'
            : 'bg-white/55 hover:bg-white/75'
        }`}
        style={{
          borderColor: `${accentColor}80`,
          boxShadow: isSelected
            ? `0 0 0 1px ${accentColor}55 inset, 0 12px 24px rgba(68,38,17,0.12)`
            : `0 0 0 1px ${accentColor}18 inset, 0 8px 18px rgba(68,38,17,0.08)`,
          backgroundImage: `linear-gradient(90deg, ${accentColor}16, transparent 42%)`,
        }}
      >
        <div className="grid grid-cols-[52px_1fr] gap-3">
          <div
            className="grid h-[52px] w-[52px] place-items-center overflow-hidden rounded-lg border bg-amber-100/45"
            style={{ borderColor: `${accentColor}55`, color: accentColor }}
          >
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={getEntryName(entry)}
                className="h-full w-full object-cover"
                onError={(event) => {
                  const fallbackUrl = getEntryImageUrl(entry.entry);
                  if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                    event.currentTarget.src = fallbackUrl;
                  }
                }}
              />
            ) : (
              <ImageIcon size={18} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                {getEntryName(entry)}
              </h3>
              {isItem && (
                <span
                  className="shrink-0 rounded-full border bg-amber-100/70 px-2 py-1 text-[11px] uppercase tracking-[0.18em]"
                  style={{ borderColor: `${accentColor}40`, color: accentColor }}
                >
                  x{(entry.entry as CharacterGeneralItem | CharacterInventoryItem).quantity}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-stone-700">
              {isItem && <span style={{ color: accentColor }}>{(entry.entry as CharacterGeneralItem | CharacterInventoryItem).rarity || 'common'}</span>}
              {entry.kind === 'inventory-item' && (entry.entry as CharacterInventoryItem).equipped ? <span className="text-amber-900">Equipped</span> : null}
              {isSpell && <span>{(entry.entry as CharacterSpell).level || 'Level ?'}</span>}
              {isStatus && <span>{formatStatusDuration(entry.entry as CharacterStatus)}</span>}
            </div>
          </div>
        </div>
      </button>
    );
  };

  const renderDetail = () => {
    if (!selectedEntry) {
      return (
        <aside className={`${sectionClass} sticky top-6 h-fit text-center text-stone-600`}>
          Select something from the left to preview it here.
        </aside>
      );
    }

    const entry = selectedEntry.entry;
    const imageUrl = getEntryImageUrl(entry);
    const thumbUrl = getEntryThumbUrl(entry);

    return (
      <aside className={`${sectionClass} sticky top-6 h-fit max-h-[calc(100vh-3rem)] overflow-y-auto`}>
        {thumbUrl && (
          <a href={imageUrl || thumbUrl} target="_blank" rel="noreferrer" className="mb-5 block overflow-hidden rounded-2xl border border-amber-900/20 bg-amber-100/45">
            <img
              src={thumbUrl}
              alt={getEntryName(selectedEntry)}
              className="max-h-[460px] w-full object-cover"
              onError={(event) => {
                if (imageUrl && event.currentTarget.src !== imageUrl) {
                  event.currentTarget.src = imageUrl;
                }
              }}
            />
          </a>
        )}

        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
          {selectedEntry.kind.replace('-', ' ')}
        </div>
        <h2 className="text-4xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
          {getEntryName(selectedEntry)}
        </h2>

        {'description' in entry && entry.description ? (
          <p className="mt-4 whitespace-pre-wrap rounded-xl border border-amber-900/15 bg-white/35 p-4 text-[16px] leading-8 text-stone-800">
            {entry.description}
          </p>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-amber-900/15 bg-white/25 p-4 text-stone-600">
            No description has been written for this entry yet.
          </p>
        )}

        <section className="mt-5 rounded-xl border border-amber-900/15 bg-black/5 p-4">
          <h3 className="mb-3 text-xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Details</h3>
          <div className="space-y-2 text-[15px] leading-7 text-stone-800">
            <div><span className="font-bold text-amber-950">Folder:</span> {selectedEntry.folderLabel}</div>
            {'quantity' in entry && <div><span className="font-bold text-amber-950">Quantity:</span> {entry.quantity}</div>}
            {'rarity' in entry && entry.rarity && <div><span className="font-bold text-amber-950">Rarity:</span> {entry.rarity}</div>}
            {'equipped' in entry && <div><span className="font-bold text-amber-950">Equipped:</span> {entry.equipped ? 'Yes' : 'No'}</div>}
            {'level' in entry && <div><span className="font-bold text-amber-950">Level:</span> {entry.level || '—'}</div>}
            {'resourceCost' in entry && <div><span className="font-bold text-amber-950">Cost:</span> {entry.resourceCost || '—'}</div>}
            {'usageRemaining' in entry && (
              <div><span className="font-bold text-amber-950">Usage:</span> {entry.usageRemaining || '—'}{'totalUsage' in entry ? ` / ${entry.totalUsage || '—'}` : ''}</div>
            )}
            {'duration' in entry && <div><span className="font-bold text-amber-950">Duration:</span> {formatStatusDuration(entry)}</div>}
            {'active' in entry && <div><span className="font-bold text-amber-950">Active:</span> {entry.active === false ? 'No' : 'Yes'}</div>}
          </div>
        </section>

        {'actions' in entry && (entry.actions || []).length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Actions</h3>
            <div className="space-y-3">
              {(entry.actions || []).map(action => renderActionBlock(
                action,
                'localVariables' in entry ? entry.localVariables : undefined,
                canControlCharacter,
                rollMacro,
                (effect) => void applyStatusEffect(effect),
              ))}
            </div>
          </section>
        )}

        {'effects' in entry && (entry.effects || []).length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Effects</h3>
            <div className="space-y-2">
              {(entry.effects || []).map((effect, index) => renderEffectPill(effect, index, canControlCharacter, (entryEffect) => void applyStatusEffect(entryEffect)))}
            </div>
          </section>
        )}

        {'macros' in entry && (entry.macros || []).length > 0 && (
          <section className="mt-5">
            <h3 className="mb-3 text-xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Macros</h3>
            <div className="space-y-3">
              {(entry.macros || []).map((macro) => (
                <div key={macro.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-900/15 bg-black/5 p-3">
                  <button
                    type="button"
                    onClick={() => rollMacro(
                      macro,
                      'localVariables' in entry ? entry.localVariables : undefined,
                      getEntryName(selectedEntry),
                      'description' in entry ? entry.description : undefined,
                    )}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/25 bg-amber-100/75 px-3 py-1.5 text-xs font-bold text-amber-950 transition hover:bg-amber-200/70"
                  >
                    <Dices size={14} /> Roll
                  </button>
                  <div className="font-bold text-amber-950">{macro.name || 'Unnamed Macro'}</div>
                  <code className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-emerald-800">{macro.formula}</code>
                </div>
              ))}
            </div>
          </section>
        )}
      </aside>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] px-4 py-6 text-stone-900 xl:px-6" style={parchmentBackground}>
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
      <div className="mx-auto w-full max-w-none 2xl:max-w-[1900px]">
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
          <div className={`${sectionClass} text-center text-lg text-stone-700`}>Loading homebrew library...</div>
        ) : error ? (
          <div className={`${sectionClass} text-center text-lg text-rose-900`}>{error}</div>
        ) : (
          <div className="space-y-6">
            <section className={`${sectionClass} relative overflow-hidden`}>
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{ background: `linear-gradient(90deg, ${meta.accent}, transparent)` }}
              />
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
                {meta.icon}
                {meta.title}
              </div>
              <h1 className="text-4xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{meta.title}</h1>
              <p className="mt-3 text-[16px] leading-8 text-stone-800">{meta.subtitle}</p>
            </section>

            {(filterTabs.length > 1 || category === 'inventory' || category === 'spells') && (
              <div className="sticky top-4 z-20 rounded-2xl border border-stone-950/20 bg-stone-950/88 p-3 shadow-[0_16px_34px_rgba(68,38,17,0.22)] backdrop-blur-md">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap gap-2 py-0.5">
                    {filterTabs.map((tab) => {
                      const isActive = activeFilterId === tab.id;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => setActiveFilterId(tab.id)}
                          className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-bold leading-none tracking-wide transition-all cursor-pointer ${
                            isActive
                              ? 'bg-white/10 text-amber-50 shadow-[0_0_18px_rgba(251,191,36,0.16)]'
                              : 'bg-black/25 text-stone-300 hover:bg-white/10 hover:text-amber-100'
                          }`}
                          style={{
                            borderColor: tab.color || meta.accent,
                            boxShadow: isActive ? `0 0 0 1px ${tab.color || meta.accent}55 inset` : undefined,
                            fontFamily: "'Cinzel', serif",
                          }}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {(category === 'inventory' || category === 'spells') && (
                    <label className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-amber-900/25 bg-black/35 px-3 py-2 text-sm text-amber-100 md:max-w-sm">
                      <Search size={16} className="shrink-0 text-amber-300/75" />
                      <input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder={`Search ${category === 'inventory' ? 'items' : 'spells'}...`}
                        className="min-w-0 flex-1 bg-transparent text-amber-50 placeholder:text-stone-500 focus:outline-none"
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px] 2xl:grid-cols-[minmax(0,1fr)_520px]">
              <main className="space-y-6">

              {groups.length === 0 ? (
                <section className={`${sectionClass} text-center text-lg text-stone-700`}>
                  {entries.length === 0 ? 'Nothing to show here yet.' : 'No entries match this filter.'}
                </section>
              ) : groups.map((group) => (
                <section key={group.key} className={sectionClass}>
                  <div
                    className="mb-4 flex items-center gap-2 text-amber-950"
                    style={{ paddingLeft: `${group.depth * 18}px` }}
                  >
                    <FolderOpen size={18} style={{ color: group.color || meta.accent }} />
                    <h2 className="text-2xl" style={{ fontFamily: "'Cinzel', serif" }}>{group.label}</h2>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {group.entries.map((entry) => renderCard(entry))}
                  </div>
                </section>
              ))}
            </main>
            {renderDetail()}
          </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomebrewLibraryViewer;
