import React from 'react';

export type HomebrewPageId = 'characters' | 'overview' | 'gallery' | 'inventory' | 'spells' | 'statuses' | 'attributes';

interface HomebrewPageNavProps {
  characterId?: string | null;
  currentPage: HomebrewPageId;
}

const navItems: Array<{ id: HomebrewPageId; label: string }> = [
  { id: 'characters', label: 'Characters' },
  { id: 'overview', label: 'Overview' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'spells', label: 'Spells' },
  { id: 'statuses', label: 'Statuses' },
  { id: 'attributes', label: 'Attributes' },
];

const getHash = (pageId: HomebrewPageId, characterId?: string | null) => {
  if (pageId === 'characters' || !characterId) return '#homebrew-characters';
  if (pageId === 'overview') return `#homebrew-character-sheet/${encodeURIComponent(characterId)}`;
  if (pageId === 'gallery') return `#homebrew-gallery/${encodeURIComponent(characterId)}`;
  if (pageId === 'attributes') return `#homebrew-character-sheet/${encodeURIComponent(characterId)}/attributes`;
  return `#homebrew-library/${pageId}/${encodeURIComponent(characterId)}`;
};

export const HomebrewPageNav: React.FC<HomebrewPageNavProps> = ({ characterId, currentPage }) => (
  <div className="sticky top-4 z-30 rounded-2xl border border-amber-900/25 bg-[#24140d]/95 p-2 shadow-[0_16px_34px_rgba(68,38,17,0.22)] backdrop-blur-md">
    <div className="flex flex-wrap justify-center gap-2">
      {navItems.map((item) => {
        const disabled = item.id !== 'characters' && !characterId;
        const isActive = currentPage === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!disabled) window.location.hash = getHash(item.id, characterId);
            }}
            disabled={disabled}
            className={`rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
              isActive
                ? 'border-amber-300/60 bg-amber-100/15 text-amber-100'
                : 'border-amber-200/15 bg-black/20 text-stone-300 hover:border-amber-300/45 hover:text-amber-100'
            }`}
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  </div>
);

export default HomebrewPageNav;
