import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, FolderOpen, Layers3, Shield, Sparkles } from 'lucide-react';
import { CharacterData, CharacterEntryFolder, CharacterGeneralItem, CharacterInventoryItem, CharacterSpell, CharacterStatus } from '../types/character';
import { loadCharacterById } from '../lib/firestore';
import { authProvider } from '../lib/auth';

export type HomebrewLibraryCategory = 'general-items' | 'inventory' | 'statuses' | 'spells';

interface HomebrewLibraryViewerProps {
  category: HomebrewLibraryCategory;
  characterId: string;
  onBack?: () => void;
}

interface FolderGroup<T> {
  key: string;
  label: string;
  depth: number;
  color?: string;
  entries: T[];
}

const statusDurationLabels: Record<string, string> = {
  custom: 'Custom',
  round: 'Round',
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

const categoryMeta: Record<HomebrewLibraryCategory, { title: string; subtitle: string; accent: string; icon: React.ReactNode }> = {
  'general-items': {
    title: 'General Items Library',
    subtitle: 'All shared consumables, keys, and misc items in one compact catalogue.',
    accent: '#9a6a31',
    icon: <Layers3 size={18} />,
  },
  inventory: {
    title: 'Inventory Library',
    subtitle: 'Organized item listing with folder structure, rarity, quantity, and quick links.',
    accent: '#7c4b1f',
    icon: <Shield size={18} />,
  },
  statuses: {
    title: 'Statuses Library',
    subtitle: 'Condition cards for the current character, collected into one browseable board.',
    accent: '#b45309',
    icon: <Sparkles size={18} />,
  },
  spells: {
    title: 'Spells & Abilities Library',
    subtitle: 'Folder-organized spell cards for quick browsing and handoff.',
    accent: '#6b21a8',
    icon: <BookOpen size={18} />,
  },
};

const openViewerTab = (entityType: 'general-item' | 'inventory-item' | 'spell' | 'status', characterId: string, entryId: string) => {
  const targetUrl = `${window.location.origin}${window.location.pathname}#homebrew-viewer/${entityType}/${encodeURIComponent(characterId)}/${encodeURIComponent(entryId)}`;
  window.open(targetUrl, '_blank', 'noopener,noreferrer');
};

const buildFolderGroups = <T extends { folderId?: string | null }>(
  entries: T[],
  folders: CharacterEntryFolder[],
): FolderGroup<T>[] => {
  const buildPath = (folderId: string | null | undefined) => {
    if (!folderId) return { key: 'root', label: 'Unfoldered', depth: 0, color: undefined };

    const segments: CharacterEntryFolder[] = [];
    let current = folders.find((folder) => folder.id === folderId) || null;
    while (current) {
      const currentFolder: CharacterEntryFolder = current;
      segments.unshift(currentFolder);
      current = currentFolder.parentId ? folders.find((folder) => folder.id === currentFolder.parentId) || null : null;
    }

    return {
      key: folderId,
      label: segments.map((segment) => segment.name || 'Untitled Folder').join(' / '),
      depth: Math.max(0, segments.length - 1),
      color: segments[segments.length - 1]?.color,
    };
  };

  const groups = new Map<string, FolderGroup<T>>();

  entries.forEach((entry) => {
    const path = buildPath(entry.folderId);
    const existing = groups.get(path.key);
    if (existing) {
      existing.entries.push(entry);
      return;
    }

    groups.set(path.key, {
      key: path.key,
      label: path.label,
      depth: path.depth,
      color: path.color,
      entries: [entry],
    });
  });

  return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }));
};

export const HomebrewLibraryViewer: React.FC<HomebrewLibraryViewerProps> = ({
  category,
  characterId,
  onBack,
}) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [character, setCharacter] = useState<CharacterData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => authProvider.onAuthChange((state) => setUserId(state.uid)), []);

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

  const content = useMemo(() => {
    if (!character) return null;

    if (category === 'general-items') {
      return {
        groups: [
          {
            key: 'general-items',
            label: 'General Items',
            depth: 0,
            color: '#9a6a31',
            entries: character.generalItems || [],
          },
        ],
      };
    }

    if (category === 'inventory') {
      return {
        groups: buildFolderGroups<CharacterInventoryItem>(character.inventory || [], character.inventoryFolders || []),
      };
    }

    if (category === 'spells') {
      return {
        groups: buildFolderGroups<CharacterSpell>(character.spells || [], character.spellFolders || []),
      };
    }

    return {
      groups: [
        {
          key: 'statuses',
          label: 'Statuses',
          depth: 0,
          color: '#b45309',
          entries: character.statuses || [],
        },
      ],
    };
  }, [category, character]);

  const renderCard = (entry: CharacterGeneralItem | CharacterInventoryItem | CharacterSpell | CharacterStatus) => {
    if (category === 'general-items') {
      const item = entry as CharacterGeneralItem;
      return (
        <button
          key={item.id}
          onClick={() => openViewerTab('general-item', characterId, item.id)}
          className="rounded-xl border border-amber-900/15 bg-white/55 px-4 py-3 text-left shadow-sm hover:bg-white/75 hover:border-amber-700/40 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{item.name || 'Unnamed Item'}</h3>
            <span className="rounded-full border border-amber-900/15 bg-amber-100/70 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-900">
              x{item.quantity}
            </span>
          </div>
          <div className="mt-2 text-sm text-stone-700">{item.rarity || 'common'}</div>
        </button>
      );
    }

    if (category === 'inventory') {
      const item = entry as CharacterInventoryItem;
      return (
        <button
          key={item.id}
          onClick={() => openViewerTab('inventory-item', characterId, item.id)}
          className="rounded-xl border border-amber-900/15 bg-white/55 px-4 py-3 text-left shadow-sm hover:bg-white/75 hover:border-amber-700/40 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{item.name || 'Unnamed Item'}</h3>
            <span className="rounded-full border border-amber-900/15 bg-amber-100/70 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-900">
              x{item.quantity}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-stone-700">
            <span>{item.rarity || 'common'}</span>
            {item.equipped ? <span className="text-amber-900">Equipped</span> : null}
          </div>
        </button>
      );
    }

    if (category === 'spells') {
      const spell = entry as CharacterSpell;
      return (
        <button
          key={spell.id}
          onClick={() => openViewerTab('spell', characterId, spell.id)}
          className="rounded-xl border border-amber-900/15 bg-white/55 px-4 py-3 text-left shadow-sm hover:bg-white/75 hover:border-amber-700/40 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{spell.name || 'Unnamed Spell'}</h3>
            <span className="rounded-full border border-violet-900/15 bg-violet-100/70 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-violet-900">
              {spell.level || 'Level ?'}
            </span>
          </div>
          <div className="mt-2 text-sm text-stone-700">{spell.magicSchool || 'No school'}</div>
        </button>
      );
    }

    const status = entry as CharacterStatus;
    return (
      <button
        key={status.id}
        onClick={() => openViewerTab('status', characterId, status.id)}
        className="rounded-xl border border-amber-900/15 bg-white/55 px-4 py-3 text-left shadow-sm hover:bg-white/75 hover:border-amber-700/40 cursor-pointer"
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-bold text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{status.name || 'Unnamed Status'}</h3>
          <span className="rounded-full border border-amber-900/15 bg-amber-100/70 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-amber-900">
            {formatStatusDuration(status)}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] p-6 text-stone-900" style={parchmentBackground}>
      <div className="mx-auto max-w-6xl">
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

        {isLoading ? (
          <div className={`${sectionClass} text-center text-lg text-stone-700`}>Loading homebrew library...</div>
        ) : error ? (
          <div className={`${sectionClass} text-center text-lg text-rose-900`}>{error}</div>
        ) : !content ? (
          <div className={`${sectionClass} text-center text-lg text-stone-700`}>Nothing to show here yet.</div>
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

            {content.groups.map((group) => (
              <section key={group.key} className={sectionClass}>
                <div
                  className="mb-4 flex items-center gap-2 text-amber-950"
                  style={{ paddingLeft: `${group.depth * 18}px` }}
                >
                  <FolderOpen size={18} style={{ color: group.color || meta.accent }} />
                  <h2 className="text-2xl" style={{ fontFamily: "'Cinzel', serif" }}>{group.label}</h2>
                </div>
                {group.entries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-amber-900/15 bg-white/25 px-4 py-6 text-center text-stone-600">
                    No entries in this section yet.
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {group.entries.map((entry) => renderCard(entry))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HomebrewLibraryViewer;
