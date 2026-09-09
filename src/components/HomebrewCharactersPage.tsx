import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, Star, UserRound } from 'lucide-react';
import { CharacterData } from '../types/character';
import { authProvider } from '../lib/auth';
import { loadCharacters, loadFavorites, toggleFavorite as toggleFavoriteDB } from '../lib/firestore';
import { getPixhostDirectImageUrl, isDirectImageUrl } from '../lib/pixhost';
import { HomebrewPageNav } from './HomebrewPageNav';
import { setCachedHomebrewCharacter } from '../lib/homebrewCharacterCache';

interface HomebrewCharactersPageProps {
  onBack?: () => void;
}

const parchmentBackground = {
  backgroundImage:
    "radial-gradient(circle at top left, rgba(120,53,15,0.12), transparent 35%), linear-gradient(180deg, rgba(245,232,197,0.98) 0%, rgba(235,219,184,0.98) 100%)",
};

const sectionClass =
  'rounded-2xl border border-amber-900/20 bg-white/45 p-6 shadow-[0_18px_36px_rgba(68,38,17,0.12)] backdrop-blur-[1px]';

const getCharacterPortraitUrl = (character: CharacterData) => {
  const mainImage = (character.gallery || []).find((image) => image.tags?.includes('main')) || character.gallery?.[0];
  const rawUrl = character.portraitUrl || mainImage?.url || '';
  if (!rawUrl) return '';
  return isDirectImageUrl(rawUrl) ? rawUrl : getPixhostDirectImageUrl(rawUrl) || rawUrl;
};

const parseSearch = (query: string) => {
  const tags = Array.from(query.matchAll(/"([^"]+)"/g))
    .map(match => match[1].trim().toLowerCase())
    .filter(Boolean);
  const text = query.replace(/"([^"]+)"/g, ' ').trim().toLowerCase();
  return { tags, text };
};

const getFilterStorageKey = (userId: string | null) => `homebrewCharactersFilters:${userId || 'guest'}`;

const loadStoredFilters = (userId: string | null) => {
  try {
    const raw = window.localStorage.getItem(getFilterStorageKey(userId));
    if (!raw) return { searchTerm: '', showOnlyFavorites: false };
    const parsed = JSON.parse(raw) as Partial<{ searchTerm: string; showOnlyFavorites: boolean }>;
    return {
      searchTerm: typeof parsed.searchTerm === 'string' ? parsed.searchTerm : '',
      showOnlyFavorites: parsed.showOnlyFavorites === true,
    };
  } catch {
    return { searchTerm: '', showOnlyFavorites: false };
  }
};

export const HomebrewCharactersPage: React.FC<HomebrewCharactersPageProps> = ({ onBack }) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [characters, setCharacters] = useState<CharacterData[]>([]);
  const [searchTerm, setSearchTerm] = useState(() => loadStoredFilters(authProvider.getUid()).searchTerm);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(() => loadStoredFilters(authProvider.getUid()).showOnlyFavorites);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => authProvider.onAuthChange((state) => setUserId(state.uid)), []);

  useEffect(() => {
    const stored = loadStoredFilters(userId);
    setSearchTerm(stored.searchTerm);
    setShowOnlyFavorites(stored.showOnlyFavorites);
  }, [userId]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setError(null);
    loadCharacters(userId, false)
      .then((loaded) => {
        if (!isMounted) return;
        loaded.forEach(setCachedHomebrewCharacter);
        setCharacters(loaded.sort((left, right) => (left.name || '').localeCompare(right.name || '')));
      })
      .catch((err) => {
        console.error(err);
        if (isMounted) setError('Characters could not be loaded.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    let isMounted = true;
    loadFavorites(userId)
      .then((ids) => {
        if (isMounted) setFavoriteIds(ids);
      })
      .catch(() => {
        if (isMounted) setFavoriteIds([]);
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    window.localStorage.setItem(getFilterStorageKey(userId), JSON.stringify({ searchTerm, showOnlyFavorites }));
  }, [searchTerm, showOnlyFavorites, userId]);

  const filteredCharacters = useMemo(() => {
    const { tags, text } = parseSearch(searchTerm);
    return characters.filter((character) => {
      if (showOnlyFavorites && !favoriteIds.includes(character.id)) return false;
      const characterTags = (character.tags || []).map(tag => tag.toLowerCase());
      if (tags.length > 0 && !tags.every(tag => characterTags.includes(tag))) return false;
      if (!text) return true;
      const haystack = [
        character.name,
        character.race,
        character.className,
        character.visibility,
        ...(character.tags || []),
      ].join(' ').toLowerCase();
      return haystack.includes(text);
    });
  }, [characters, favoriteIds, searchTerm, showOnlyFavorites]);

  const toggleFavorite = async (characterId: string) => {
    const isFavorite = favoriteIds.includes(characterId);
    const isNowFavorite = await toggleFavoriteDB(userId, characterId, isFavorite);
    setFavoriteIds(prev => (
      isNowFavorite
        ? Array.from(new Set([...prev, characterId]))
        : prev.filter(id => id !== characterId)
    ));
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] p-6 pr-24 text-stone-900" style={parchmentBackground}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => (onBack ? onBack() : window.history.back())}
            className="inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-white/45 px-4 py-2 text-sm text-amber-950 hover:bg-white/65 cursor-pointer"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="rounded-full border border-amber-900/20 bg-white/45 px-4 py-2 text-sm text-stone-700">
            Homebrew Characters
          </div>
        </div>

        <HomebrewPageNav currentPage="characters" />

        <section className={`${sectionClass} relative overflow-hidden`}>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-800 via-amber-600 to-transparent" />
          <div className="mb-3 inline-flex rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
            Characters
          </div>
          <h1 className="text-5xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>Characters</h1>
          <p className="mt-3 text-[16px] leading-7 text-stone-700">
            Pick a visible character, then use the anchored bar to move through their Overview, Inventory, Spells, Statuses, and Attributes.
          </p>
          <label className="mt-5 flex items-center gap-2 rounded-2xl border border-amber-900/20 bg-white/60 px-4 py-3 text-stone-700">
            <Search size={18} className="text-amber-900/70" />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder='Search characters, or use "party" for tag search...'
              className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 placeholder:text-stone-500 focus:outline-none"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowOnlyFavorites(prev => !prev)}
              className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition ${
                showOnlyFavorites
                  ? 'border-amber-500/55 bg-amber-300/25 text-amber-950'
                  : 'border-amber-900/15 bg-white/45 text-stone-700 hover:bg-white/65'
              }`}
            >
              <Star size={16} fill={showOnlyFavorites ? 'currentColor' : 'none'} />
              Favorites
            </button>
            <span className="text-sm text-stone-600">
              {filteredCharacters.length} / {characters.length}
            </span>
          </div>
        </section>

        {isLoading ? (
          <div className={`${sectionClass} text-center text-lg text-stone-700`}>Loading characters...</div>
        ) : error ? (
          <div className={`${sectionClass} text-center text-lg text-rose-900`}>{error}</div>
        ) : filteredCharacters.length === 0 ? (
          <div className={`${sectionClass} text-center text-stone-600`}>No matching characters found.</div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredCharacters.map((character) => {
              const portraitUrl = getCharacterPortraitUrl(character);
              return (
                <article
                  key={character.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setCachedHomebrewCharacter(character);
                    window.location.hash = `#homebrew-character-sheet/${encodeURIComponent(character.id)}`;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setCachedHomebrewCharacter(character);
                      window.location.hash = `#homebrew-character-sheet/${encodeURIComponent(character.id)}`;
                    }
                  }}
                  className="group relative cursor-pointer rounded-2xl border border-amber-900/20 bg-white/50 p-4 text-left shadow-[0_18px_36px_rgba(68,38,17,0.12)] transition hover:-translate-y-0.5 hover:bg-white/70 hover:shadow-[0_24px_44px_rgba(68,38,17,0.16)]"
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void toggleFavorite(character.id);
                    }}
                    className={`absolute right-3 top-3 inline-grid h-9 w-9 place-items-center rounded-lg border transition ${
                      favoriteIds.includes(character.id)
                        ? 'border-amber-500/55 bg-amber-300/35 text-amber-900'
                        : 'border-amber-900/15 bg-white/60 text-stone-500 hover:text-amber-900'
                    }`}
                    title={favoriteIds.includes(character.id) ? 'Remove favorite' : 'Add favorite'}
                  >
                    <Star size={17} fill={favoriteIds.includes(character.id) ? 'currentColor' : 'none'} />
                  </button>
                  <div className="grid grid-cols-[76px_1fr] gap-4">
                    <div className="grid h-[76px] w-[76px] place-items-center overflow-hidden rounded-2xl border border-amber-900/20 bg-amber-100/55 text-amber-900">
                      {portraitUrl ? (
                        <img src={portraitUrl} alt={character.name} className="h-full w-full object-cover" />
                      ) : (
                        <UserRound size={30} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-2xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                        {character.name || 'Unnamed Character'}
                      </h2>
                      <p className="mt-1 truncate text-sm text-stone-700">
                        {character.race || 'Unknown Race'} / {character.className || 'Unknown Class'}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(character.tags || []).slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded-full border border-amber-900/15 bg-amber-100/55 px-2 py-0.5 text-[11px] text-amber-950">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
};

export default HomebrewCharactersPage;
