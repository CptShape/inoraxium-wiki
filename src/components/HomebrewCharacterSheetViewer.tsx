import React, { useEffect, useState } from 'react';
import { ArrowLeft, Backpack, FlaskConical, Sparkles, UserRound } from 'lucide-react';
import { CharacterData } from '../types/character';
import { loadCharacterById } from '../lib/firestore';
import { authProvider } from '../lib/auth';
import { HomebrewLibraryCategory } from './HomebrewLibraryViewer';

interface HomebrewCharacterSheetViewerProps {
  characterId: string;
  onBack?: () => void;
}

const parchmentBackground = {
  backgroundImage:
    "radial-gradient(circle at top left, rgba(120,53,15,0.12), transparent 35%), linear-gradient(180deg, rgba(245,232,197,0.98) 0%, rgba(235,219,184,0.98) 100%)",
};

const sectionClass =
  'rounded-2xl border border-amber-900/20 bg-white/45 p-6 shadow-[0_18px_36px_rgba(68,38,17,0.12)] backdrop-blur-[1px]';

const openLibrary = (category: HomebrewLibraryCategory, characterId: string) => {
  window.location.hash = `#homebrew-library/${category}/${encodeURIComponent(characterId)}`;
};

export const HomebrewCharacterSheetViewer: React.FC<HomebrewCharacterSheetViewerProps> = ({
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
        setError('Failed to load this homebrew character sheet.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [characterId, userId]);

  const libraryCards: Array<{
    category: HomebrewLibraryCategory;
    title: string;
    subtitle: string;
    count: number;
    icon: React.ReactNode;
    accent: string;
  }> = [
    {
      category: 'inventory',
      title: 'Inventory',
      subtitle: 'Items, general items, images, rarity, quantity, and details.',
      count: (character?.generalItems?.length || 0) + (character?.inventory?.length || 0),
      icon: <Backpack size={28} />,
      accent: '#7c4b1f',
    },
    {
      category: 'spells',
      title: 'Spells',
      subtitle: 'Spells, abilities, resource costs, actions, and effects.',
      count: character?.spells?.length || 0,
      icon: <Sparkles size={28} />,
      accent: '#6b21a8',
    },
    {
      category: 'statuses',
      title: 'Statuses',
      subtitle: 'Conditions, timers, active states, actions, and effects.',
      count: character?.statuses?.length || 0,
      icon: <FlaskConical size={28} />,
      accent: '#b45309',
    },
  ];

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
            Homebrew Character Sheet
          </div>
        </div>

        {isLoading ? (
          <div className={`${sectionClass} text-center text-lg text-stone-700`}>Loading character sheet...</div>
        ) : error ? (
          <div className={`${sectionClass} text-center text-lg text-rose-900`}>{error}</div>
        ) : character ? (
          <div className="space-y-6">
            <section className={`${sectionClass} relative overflow-hidden`}>
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-800 via-amber-600 to-transparent" />
              <div className="grid gap-6 md:grid-cols-[140px_1fr] md:items-center">
                <div className="grid h-32 w-32 place-items-center overflow-hidden rounded-3xl border border-amber-900/25 bg-amber-100/45 text-amber-900 shadow-inner">
                  {character.portraitUrl ? (
                    <img src={character.portraitUrl} alt={character.name} className="h-full w-full object-cover" />
                  ) : (
                    <UserRound size={48} />
                  )}
                </div>
                <div>
                  <div className="mb-3 inline-flex rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
                    Homebrew Character Sheet
                  </div>
                  <h1 className="text-5xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                    {character.name || 'Unnamed Character'}
                  </h1>
                  <p className="mt-3 text-xl italic text-stone-700" style={{ fontFamily: "'IM Fell English', serif" }}>
                    {character.race || 'Unknown Race'} • {character.className || 'Unknown Class'}
                  </p>
                  {character.tags && character.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {character.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-amber-900/15 bg-white/45 px-3 py-1 text-xs text-amber-950">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-5 md:grid-cols-3">
              {libraryCards.map((card) => (
                <button
                  key={card.category}
                  onClick={() => openLibrary(card.category, character.id)}
                  className="group rounded-2xl border border-amber-900/20 bg-white/45 p-6 text-left shadow-[0_18px_36px_rgba(68,38,17,0.12)] transition-all hover:-translate-y-0.5 hover:bg-white/65 hover:shadow-[0_24px_44px_rgba(68,38,17,0.16)] cursor-pointer"
                >
                  <div className="mb-5 inline-grid h-14 w-14 place-items-center rounded-2xl border border-amber-900/15 bg-white/55" style={{ color: card.accent }}>
                    {card.icon}
                  </div>
                  <h2 className="text-3xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>{card.title}</h2>
                  <p className="mt-3 min-h-[72px] text-[15px] leading-6 text-stone-700">{card.subtitle}</p>
                  <div className="mt-5 flex items-center justify-between border-t border-amber-900/15 pt-4 text-sm text-amber-950">
                    <span>{card.count} entries</span>
                    <span className="transition-transform group-hover:translate-x-1">Open →</span>
                  </div>
                </button>
              ))}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default HomebrewCharacterSheetViewer;
