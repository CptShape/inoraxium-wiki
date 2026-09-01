import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, BookOpen, FlaskConical, Shield, Sparkles } from 'lucide-react';
import { CharacterAction, CharacterData, CharacterGeneralItem, CharacterInventoryItem, CharacterSpell, CharacterStatus } from '../types/character';
import { loadCharacterById } from '../lib/firestore';
import { authProvider } from '../lib/auth';

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

const renderActionBlock = (action: CharacterAction) => (
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
    {(action.effects || []).length > 0 && (
      <div className="mt-4">
        <h5 className="text-xs font-bold uppercase tracking-[0.18em] text-amber-900/75 mb-2">Effects</h5>
        <div className="space-y-2">
          {(action.effects || []).map((effect, effectIndex) => (
            <div key={`${action.id}-effect-${effectIndex}`} className="flex flex-wrap items-center gap-2 text-sm text-stone-800">
              <span className="rounded-full border border-stone-700/15 bg-stone-100/70 px-2 py-1 font-mono text-emerald-800">
                {effect.targetId || 'unknown_target'}
              </span>
              <span className="font-mono text-amber-900">{effect.value || '0'}</span>
              <span className="text-xs uppercase tracking-[0.16em] text-stone-600">
                {(effect.active ?? true) ? 'Active' : 'Inactive'}
              </span>
            </div>
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

  return (
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] p-6 text-stone-900" style={parchmentBackground}>
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
                    {(viewerEntry.entry.actions || []).map(renderActionBlock)}
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
                        <div key={`${viewerEntry.entry.id}-effect-${index}`} className="flex flex-wrap items-center gap-2 text-[15px] text-stone-800">
                          <span className="rounded-full border border-stone-700/15 bg-stone-100/70 px-2 py-1 font-mono text-emerald-800">
                            {effect.targetId || 'unknown_target'}
                          </span>
                          <span className="font-mono text-amber-900">{effect.value || '0'}</span>
                          <span className="text-xs uppercase tracking-[0.16em] text-stone-600">
                            {(effect.active ?? true) ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </article>

            <aside className="space-y-6">
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
                      <div key={macro.id} className="rounded-xl border border-amber-900/15 bg-black/5 p-3">
                        <div className="font-bold text-amber-950">{macro.name || 'Unnamed Macro'}</div>
                        <code className="mt-1 block whitespace-pre-wrap break-words text-sm text-emerald-800">
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
