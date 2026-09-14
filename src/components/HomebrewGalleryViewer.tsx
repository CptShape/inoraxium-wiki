import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ImageIcon, X } from 'lucide-react';
import { CharacterData, CharacterGalleryImage } from '../types/character';
import { authProvider } from '../lib/auth';
import { loadCharacterById, subscribeCharacterById } from '../lib/firestore';
import { getCachedHomebrewCharacter, setCachedHomebrewCharacter } from '../lib/homebrewCharacterCache';
import { getPixhostDirectImageUrl, isDirectImageUrl } from '../lib/pixhost';
import { HomebrewPageNav } from './HomebrewPageNav';
import { QuickTools } from './QuickTools';

interface HomebrewGalleryViewerProps {
  characterId: string;
  onBack?: () => void;
}

const parchmentBackground = {
  backgroundImage:
    "radial-gradient(circle at top left, rgba(120,53,15,0.12), transparent 35%), linear-gradient(180deg, rgba(245,232,197,0.98) 0%, rgba(235,219,184,0.98) 100%)",
};

const sectionClass =
  'rounded-2xl border border-amber-900/20 bg-white/45 p-6 shadow-[0_18px_36px_rgba(68,38,17,0.12)] backdrop-blur-[1px]';

const SPECIAL_GALLERY_TAGS = new Set(['main', 'splash-art', 'token']);

const getGalleryDisplayUrl = (image: CharacterGalleryImage): string => {
  const imageUrl = image.url || '';
  const thumbUrl = image.thumbUrl || '';
  if (imageUrl && isDirectImageUrl(imageUrl)) return imageUrl;
  return thumbUrl ? getPixhostDirectImageUrl(imageUrl || thumbUrl, thumbUrl) : imageUrl;
};

const getGalleryThumbUrl = (image: CharacterGalleryImage): string => (
  image.thumbUrl ? getPixhostDirectImageUrl(image.url || image.thumbUrl, image.thumbUrl) : getGalleryDisplayUrl(image)
);

export const HomebrewGalleryViewer: React.FC<HomebrewGalleryViewerProps> = ({ characterId, onBack }) => {
  const [userId, setUserId] = useState<string | null>(authProvider.getUid());
  const [character, setCharacterState] = useState<CharacterData | null>(() => getCachedHomebrewCharacter(characterId));
  const [isLoading, setIsLoading] = useState(() => !getCachedHomebrewCharacter(characterId));
  const [error, setError] = useState<string | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<CharacterGalleryImage | null>(null);
  const [tagFilters, setTagFilters] = useState<Record<string, 'include' | 'exclude'>>({});

  const setCharacter = (nextCharacter: CharacterData | null) => {
    setCharacterState(nextCharacter);
    if (nextCharacter) setCachedHomebrewCharacter(nextCharacter);
  };

  useEffect(() => authProvider.onAuthChange((state) => setUserId(state.uid)), []);

  useEffect(() => {
    const cachedCharacter = getCachedHomebrewCharacter(characterId);
    if (cachedCharacter) setCharacter(cachedCharacter);
    setIsLoading(!cachedCharacter);
    setError(null);

    const unsubscribe = subscribeCharacterById(
      characterId,
      userId,
      (loadedCharacter) => {
        if (!loadedCharacter) {
          setError('This homebrew gallery could not be found, or you do not have access to this character.');
          setIsLoading(false);
          return;
        }
        setCharacter(loadedCharacter);
        setIsLoading(false);
      },
      () => {
        setError('Failed to load this homebrew gallery.');
        setIsLoading(false);
      },
    );

    loadCharacterById(characterId, userId).then((loadedCharacter) => {
      if (!loadedCharacter) return;
      setCharacter(loadedCharacter);
      setIsLoading(false);
    }).catch(() => undefined);

    return unsubscribe;
  }, [characterId, userId]);

  const galleryImages = useMemo(() => (
    (character?.gallery || [])
      .filter(image => image.url || image.thumbUrl)
      .slice()
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
  ), [character?.gallery]);

  const galleryTags = useMemo(() => {
    const tagMap = new Map<string, string>();
    galleryImages.forEach((image) => {
      (image.tags || []).forEach((tag) => {
        const normalized = tag.trim();
        const key = normalized.toLowerCase();
        if (!normalized || SPECIAL_GALLERY_TAGS.has(key) || tagMap.has(key)) return;
        tagMap.set(key, normalized);
      });
    });
    return Array.from(tagMap.values()).sort((left, right) => left.localeCompare(right));
  }, [galleryImages]);

  const filteredGalleryImages = useMemo(() => {
    const includedTags = Object.entries(tagFilters)
      .filter(([, mode]) => mode === 'include')
      .map(([tag]) => tag.toLowerCase());
    const excludedTags = Object.entries(tagFilters)
      .filter(([, mode]) => mode === 'exclude')
      .map(([tag]) => tag.toLowerCase());

    return galleryImages.filter((image) => {
      const tags = (image.tags || []).map(tag => tag.toLowerCase());
      if (excludedTags.some(tag => tags.includes(tag))) return false;
      if (includedTags.length > 0 && !includedTags.some(tag => tags.includes(tag))) return false;
      return true;
    });
  }, [galleryImages, tagFilters]);

  const cycleTagFilter = (tag: string) => {
    setTagFilters((current) => {
      const key = tag.toLowerCase();
      const mode = current[key];
      const next = { ...current };
      if (!mode) {
        next[key] = 'include';
      } else if (mode === 'include') {
        next[key] = 'exclude';
      } else {
        delete next[key];
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#efe2bd] py-6 pl-4 pr-24 text-stone-900 xl:pl-6" style={parchmentBackground}>
        <div className={sectionClass}>Loading homebrew gallery...</div>
      </div>
    );
  }

  if (error || !character) {
    return (
      <div className="flex-1 overflow-y-auto bg-[#efe2bd] py-6 pl-4 pr-24 text-stone-900 xl:pl-6" style={parchmentBackground}>
        <div className={sectionClass}>
          <button
            type="button"
            onClick={onBack}
            className="mb-4 inline-flex items-center gap-2 rounded-xl border border-amber-900/20 bg-white/50 px-4 py-2 text-sm font-bold text-amber-950 transition hover:bg-amber-100/70"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="text-rose-900">{error || 'Character could not be loaded.'}</div>
        </div>
      </div>
    );
  }

  const canControlCharacter = (
    !character.userId
    || character.userId === 'guest'
    || (!!userId && (character.userId === userId || (character.controlUserIds || []).includes(userId)))
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[#efe2bd] py-6 pl-4 pr-24 text-stone-900 xl:pl-6" style={parchmentBackground}>
      <QuickTools character={character} canControl={canControlCharacter} userId={userId} onCharacterUpdated={setCharacter} />
      {fullscreenImage && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setFullscreenImage(null)}
        >
          <button
            type="button"
            onClick={() => setFullscreenImage(null)}
            className="absolute right-5 top-5 inline-grid h-11 w-11 place-items-center rounded-xl border border-white/20 bg-black/45 text-white transition hover:bg-white/10"
            title="Close"
          >
            <X size={22} />
          </button>
          <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
            <img
              src={getGalleryDisplayUrl(fullscreenImage)}
              alt={fullscreenImage.label || character.name || 'Gallery image'}
              className="max-h-[92vh] max-w-[94vw] object-contain"
              onError={(event) => {
                const fallbackUrl = fullscreenImage.thumbUrl || fullscreenImage.url;
                if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                  event.currentTarget.src = fallbackUrl;
                }
              }}
            />
            {fullscreenImage.label && (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/45 px-4 py-2 text-center text-sm font-bold text-white">
                {fullscreenImage.label}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <HomebrewPageNav characterId={character.id} currentPage="gallery" />
        <header className={sectionClass}>
          <button
            type="button"
            onClick={onBack}
            className="mb-5 inline-flex items-center gap-2 rounded-xl border border-amber-900/20 bg-white/50 px-4 py-2 text-sm font-bold text-amber-950 transition hover:bg-amber-100/70"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-900/20 bg-amber-100/60 px-3 py-1 text-xs uppercase tracking-[0.24em] text-amber-950">
                <ImageIcon size={14} /> Gallery
              </div>
              <h1 className="text-4xl text-amber-950" style={{ fontFamily: "'Cinzel', serif" }}>
                {character.name || 'Character'} Images
              </h1>
            </div>
            <div className="rounded-full border border-amber-900/15 bg-white/50 px-4 py-2 text-sm font-bold text-amber-950">
              {filteredGalleryImages.length} / {galleryImages.length} image{galleryImages.length === 1 ? '' : 's'}
            </div>
          </div>
        </header>

        <section className={sectionClass}>
          {galleryTags.length > 0 && (
            <div className="mb-5 rounded-2xl border border-amber-900/15 bg-white/35 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-amber-950/70" style={{ fontFamily: "'Cinzel', serif" }}>
                Tags
              </div>
              <div className="flex flex-wrap gap-2">
                {galleryTags.map((tag) => {
                  const mode = tagFilters[tag.toLowerCase()];
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => cycleTagFilter(tag)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                        mode === 'include'
                          ? 'border-emerald-700/50 bg-emerald-100 text-emerald-950'
                          : mode === 'exclude'
                            ? 'border-rose-700/50 bg-rose-100 text-rose-950'
                            : 'border-amber-900/15 bg-white/65 text-stone-700 hover:border-amber-700/35 hover:text-amber-950'
                      }`}
                      title={mode === 'include' ? 'Showing this tag' : mode === 'exclude' ? 'Hiding this tag' : 'Neutral'}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {galleryImages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-amber-900/25 bg-white/35 px-5 py-12 text-center text-stone-600">
              No gallery images yet.
            </div>
          ) : filteredGalleryImages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-amber-900/25 bg-white/35 px-5 py-12 text-center text-stone-600">
              No images match the selected tags.
            </div>
          ) : (
            <div className="columns-1 gap-4 sm:columns-2 xl:columns-3 2xl:columns-4">
              {filteredGalleryImages.map((image) => {
                const thumbUrl = getGalleryThumbUrl(image);
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => setFullscreenImage(image)}
                    className="mb-4 block w-full break-inside-avoid overflow-hidden rounded-2xl border border-amber-900/20 bg-black/5 text-left shadow-[0_12px_28px_rgba(68,38,17,0.10)] transition hover:-translate-y-0.5 hover:border-amber-700/35 hover:shadow-[0_18px_36px_rgba(68,38,17,0.16)]"
                    title={image.label || 'Open image'}
                  >
                    <img
                      src={thumbUrl}
                      alt={image.label || character.name || 'Gallery image'}
                      className="h-auto w-full"
                      loading="lazy"
                      onError={(event) => {
                        const fallbackUrl = getGalleryDisplayUrl(image);
                        if (fallbackUrl && event.currentTarget.src !== fallbackUrl) {
                          event.currentTarget.src = fallbackUrl;
                        }
                      }}
                    />
                    {(image.label || (image.tags || []).length > 0) && (
                      <div className="space-y-2 px-3 py-3">
                        {image.label && (
                          <div className="text-sm font-bold text-amber-950">{image.label}</div>
                        )}
                        {(image.tags || []).filter(tag => !SPECIAL_GALLERY_TAGS.has(tag.toLowerCase())).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {(image.tags || [])
                              .filter(tag => !SPECIAL_GALLERY_TAGS.has(tag.toLowerCase()))
                              .map((tag) => (
                              <span key={tag} className="rounded-full border border-amber-900/15 bg-white/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-stone-600">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default HomebrewGalleryViewer;
