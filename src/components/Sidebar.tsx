import React from 'react';
import { BookOpen } from 'lucide-react';
import { Chapter, GameSystemId } from '../types';
import { ChapterTree } from './ChapterTree';
import { LoginButton } from './LoginButton';

interface SidebarProps {
  chapters: Chapter[];
  activeChapterId: string | null;
  expandedChapters: Set<string>;
  onChapterSelect: (chapterId: string, path?: string[] | null) => void;
  onToggleExpand: (chapterId: string) => void;
  currentSystem: GameSystemId;
  currentSystemName: string;
  onToggleSystem: () => void;
  onClearSelection?: () => void;
  breadcrumb: string[];
  onOpenEditor: () => void;
  isEditorOpen: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  chapters,
  activeChapterId,
  expandedChapters,
  onChapterSelect,
  onToggleExpand,
  currentSystem,
  currentSystemName,
  onToggleSystem,
  onClearSelection,
  breadcrumb,
  onOpenEditor,
  isEditorOpen,
}) => {
  const nextSystemName = currentSystem === 'inoraxium' ? 'Horaghfus' : 'Inoraxium';

  return (
    <div className="w-80 bg-stone-900/70 border-r-2 border-amber-800 p-6 shadow-xl shadow-black/30 backdrop-blur-sm overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="text-center mb-6 pb-6 border-b border-amber-800/50">
        <button
          onClick={onClearSelection}
          className="flex items-center justify-center mb-3 w-full group cursor-pointer"
        >
          <BookOpen className="w-10 h-10 text-amber-400 mr-2 group-hover:text-amber-300 transition-colors" />
          <h1 className="text-2xl font-bold text-amber-400 group-hover:text-amber-300 transition-colors" style={{ fontFamily: "'Cinzel', serif" }}>
            Eldritch Grimoire
          </h1>
        </button>
        <p className="text-amber-600 italic text-sm" style={{ fontFamily: "'IM Fell English', serif" }}>
          {currentSystemName} Rulebook System
        </p>
      </div>

      {/* Breadcrumb Navigation */}
      {breadcrumb.length > 0 && (
        <div className="mb-4 p-3 bg-amber-900/20 rounded-lg border border-amber-800/30">
          <p className="text-xs text-amber-500 mb-1" style={{ fontFamily: "'IM Fell English', serif" }}>
            📍 Current Path:
          </p>
          <p className="text-amber-300 text-sm" style={{ fontFamily: "'IM Fell English', serif" }}>
            {breadcrumb.join(' → ')}
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto space-y-1 pr-2">
        <ChapterTree
          chapters={chapters}
          activeChapterId={activeChapterId}
          expandedChapters={expandedChapters}
          depth={0}
          onChapterSelect={onChapterSelect}
          onToggleExpand={onToggleExpand}
          path={[]}
        />
      </nav>

      {/* Action Buttons */}
      <div className="mt-6 pt-4 border-t border-amber-800/50 space-y-3">
        <button
          onClick={onToggleSystem}
          className="w-full p-3 bg-gradient-to-r from-amber-800/40 to-amber-700/40 border-2 border-amber-700 rounded-lg text-amber-200 hover:from-amber-800/60 hover:to-amber-700/60 transition-all duration-300 shadow-lg hover:shadow-amber-900/30 flex items-center justify-center gap-2"
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          🔄 Switch to {nextSystemName}
        </button>
        
        <div className="text-center text-amber-600 text-xs" style={{ fontFamily: "'IM Fell English', serif" }}>
          <p>Current system: {currentSystemName}</p>
          <p>🔮 Click chapters to expand</p>
          <p>✨ Navigate through the lore</p>
        </div>
      </div>
      {/* Login */}
      <div className="mt-3 pt-3 border-t border-amber-800/40">
        <LoginButton />
      </div>
    </div>
  );
};
