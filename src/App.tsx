import React, { useEffect, useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { ContentView } from './components/ContentView';
import { VisualPageEditor } from './components/VisualPageEditor';
import { HomebrewViewer, HomebrewViewerEntityType } from './components/HomebrewViewer';
import { HomebrewLibraryViewer, HomebrewLibraryCategory } from './components/HomebrewLibraryViewer';
import { HomebrewCharacterSheetViewer } from './components/HomebrewCharacterSheetViewer';
import { gameSystems } from './data/gameSystems';
import { Chapter, GameSystemId } from './types';

// styles
import './data/inoraxium/styles/tableRow.css';
import './data/inoraxium/styles/runic-table.css';
import './data/inoraxium/styles/dwarven-table.css';
import './data/inoraxium/styles/elven-table.css';
import './data/inoraxium/styles/dragon-table.css';
import './data/inoraxium/styles/necromancer-table.css';
import './data/inoraxium/styles/monster-stat-block.css';
import './data/inoraxium/styles/scroll-table.css';
import './data/inoraxium/styles/spell-card.css';
import './data/inoraxium/styles/header.css';
import './data/inoraxium/styles/draconic-table.css';
import './data/inoraxium/styles/burglar-table.css';
import './data/inoraxium/styles/hobbit-hoard-table.css';
import './data/inoraxium/styles/hobbit-thief-table.css';
import './data/inoraxium/styles/titanborn-table.css';
import './data/inoraxium/styles/orc-table.css';
import './styles/visual-editor.css';

// ─── URL Hash Utilities ──────────────────────────────────────────────
// Hash format: #chapter-id/sub-chapter-id/deep-chapter-id
// Mythology:   #mythology/zeus  (god profile)
// Timeline:    #chronicle       (normal chapter)

function getHashPath(): string[] | null {
  const hash = window.location.hash.slice(1); // remove '#'
  if (!hash) return null;
  return hash.split('/').map(s => s.trim()).filter(Boolean);
}

function setHashPath(path: string[]) {
  const hash = '#' + path.join('/');
  if (window.location.hash !== hash) {
    window.history.pushState(null, '', hash);
  }
}

function clearHash() {
  if (window.location.hash) {
    window.history.pushState(null, '', window.location.pathname + window.location.search);
  }
}
// ─────────────────────────────────────────────────────────────────────

interface HomebrewViewerRoute {
  entityType: HomebrewViewerEntityType;
  characterId: string;
  entryId: string;
}

interface HomebrewLibraryRoute {
  category: HomebrewLibraryCategory;
  characterId: string;
}

interface HomebrewCharacterSheetRoute {
  characterId: string;
}

function App() {
  const [currentSystem, setCurrentSystem] = useState<GameSystemId>('inoraxium');
  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    new Set(gameSystems.inoraxium.defaultExpandedChapters)
  );
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [breadcrumbPath, setBreadcrumbPath] = useState<string[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [homebrewViewerRoute, setHomebrewViewerRoute] = useState<HomebrewViewerRoute | null>(null);
  const [homebrewLibraryRoute, setHomebrewLibraryRoute] = useState<HomebrewLibraryRoute | null>(null);
  const [homebrewCharacterSheetRoute, setHomebrewCharacterSheetRoute] = useState<HomebrewCharacterSheetRoute | null>(null);

  const systemDefinition = gameSystems[currentSystem];
  const chapters = systemDefinition.chapters;
  const allChapters = systemDefinition.allChapters;

  // Helper function to find a chapter by ID recursively
  const findChapterById = useCallback((chapters: Chapter[], id: string): Chapter | null => {
    for (const chapter of chapters) {
      if (chapter.id === id || chapter.aliases?.includes(id)) return chapter;
      if (chapter.subChapters) {
        const found = findChapterById(chapter.subChapters, id);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Helper to find the path (array of IDs) from root to a target chapter
  const findChapterPath = useCallback((chapters: Chapter[], targetId: string, currentPath: string[] = []): string[] | null => {
    for (const chapter of chapters) {
      const newPath = [...currentPath, chapter.id];
      if (chapter.id === targetId) return newPath;
      if (chapter.subChapters) {
        const found = findChapterPath(chapter.subChapters, targetId, newPath);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Get active chapter content
  const activeChapter = activeChapterId ? findChapterById(allChapters, activeChapterId) : null;

  // Resolve prevChapter and nextChapter IDs into actual Chapter objects
  const prevChapter = activeChapter?.prevChapter
    ? findChapterById(allChapters, activeChapter.prevChapter)
    : null;
  const nextChapter = activeChapter?.nextChapter
    ? findChapterById(allChapters, activeChapter.nextChapter)
    : null;

  const handleChapterSelect = useCallback((chapterId: string, path: string[] | null = null) => {
    setIsEditorOpen(false);
    setHomebrewViewerRoute(null);
    setHomebrewLibraryRoute(null);
    setHomebrewCharacterSheetRoute(null);
    setActiveChapterId(chapterId);

    // If a full path is provided (from ContentView card click or timeline event), use it
    let fullPath = path;

    // If only the ID is provided (from Sidebar), compute the full path
    if (!fullPath) {
      fullPath = findChapterPath(chapters, chapterId) || findChapterPath(allChapters, chapterId) || [chapterId];
    }
    
    setBreadcrumbPath(fullPath);
    // Update breadcrumb with titles
    const titles = fullPath.map(id => {
      const ch = findChapterById(allChapters, id);
      return ch?.title || id;
    });
    setBreadcrumb(titles);

    // Update URL hash
    setHashPath(fullPath);
  }, [allChapters, chapters, findChapterById, findChapterPath]);

  const handleToggleExpand = (chapterId: string) => {
    setExpandedChapters(prev => {
      const newSet = new Set(prev);
      if (newSet.has(chapterId)) {
        newSet.delete(chapterId);
      } else {
        newSet.add(chapterId);
      }
      return newSet;
    });
  };

  const resetSystemState = useCallback((systemId: GameSystemId) => {
    setIsEditorOpen(false);
    setHomebrewViewerRoute(null);
    setHomebrewLibraryRoute(null);
    setHomebrewCharacterSheetRoute(null);
    setActiveChapterId(null);
    setBreadcrumb([]);
    setBreadcrumbPath([]);
    setExpandedChapters(new Set(gameSystems[systemId].defaultExpandedChapters));
    clearHash();
  }, []);

  const handleToggleSystem = useCallback(() => {
    setCurrentSystem(prev => {
      const nextSystem = prev === 'inoraxium' ? 'horaghfus' : 'inoraxium';
      resetSystemState(nextSystem);
      return nextSystem;
    });
  }, [resetSystemState]);

  // Navigate from a hash path (array of IDs)
  const navigateFromHashPath = useCallback((path: string[]) => {
    if (path.length === 0) {
      setHomebrewViewerRoute(null);
      setHomebrewLibraryRoute(null);
      setHomebrewCharacterSheetRoute(null);
      setActiveChapterId(null);
      setBreadcrumb([]);
      setBreadcrumbPath([]);
      return;
    }

    if (path[0] === 'homebrew-viewer') {
      const entityType = path[1] as HomebrewViewerEntityType | undefined;
      const characterId = path[2] ? decodeURIComponent(path[2]) : '';
      const entryId = path[3] ? decodeURIComponent(path[3]) : '';
      const isSupportedEntity =
        entityType === 'general-item'
        || entityType === 'inventory-item'
        || entityType === 'spell'
        || entityType === 'status';

      if (isSupportedEntity && characterId && entryId) {
        setHomebrewViewerRoute({ entityType, characterId, entryId });
        setHomebrewLibraryRoute(null);
        setHomebrewCharacterSheetRoute(null);
        setActiveChapterId(null);
        setBreadcrumb(['Homebrew Viewer']);
        setBreadcrumbPath(path);
        return;
      }
    }

    if (path[0] === 'homebrew-library') {
      const category = path[1] as HomebrewLibraryCategory | undefined;
      const characterId = path[2] ? decodeURIComponent(path[2]) : '';
      const isSupportedCategory =
        category === 'general-items'
        || category === 'inventory'
        || category === 'statuses'
        || category === 'spells';

      if (isSupportedCategory && characterId) {
        setHomebrewViewerRoute(null);
        setHomebrewLibraryRoute({ category, characterId });
        setHomebrewCharacterSheetRoute(null);
        setActiveChapterId(null);
        setBreadcrumb(['Homebrew Library']);
        setBreadcrumbPath(path);
        return;
      }
    }

    if (path[0] === 'homebrew-character-sheet') {
      const characterId = path[1] ? decodeURIComponent(path[1]) : '';

      if (characterId) {
        setHomebrewViewerRoute(null);
        setHomebrewLibraryRoute(null);
        setHomebrewCharacterSheetRoute({ characterId });
        setActiveChapterId(null);
        setBreadcrumb(['Homebrew Character Sheet']);
        setBreadcrumbPath(path);
        return;
      }
    }

    setHomebrewViewerRoute(null);
    setHomebrewLibraryRoute(null);
    setHomebrewCharacterSheetRoute(null);

    const targetId = path[path.length - 1];
    const chapter = findChapterById(allChapters, targetId);

    if (chapter) {
      // Standard chapter navigation
      setActiveChapterId(targetId);
      setBreadcrumbPath(path);
      const titles = path.map(id => {
        const ch = findChapterById(allChapters, id);
        return ch?.title || id;
      });
      setBreadcrumb(titles);
      // Expand all parent chapters in sidebar
      const visiblePath = findChapterPath(chapters, targetId);
      visiblePath?.slice(0, -1).forEach(parentId => {
        setExpandedChapters(prev => new Set([...prev, parentId]));
      });
    } else {
      // Chapter not found — check if this is a special sub-route
      // e.g. #mythology/zeus where "zeus" is a god, not a chapter
      const rootChapter = findChapterById(allChapters, path[0]);
      if (rootChapter) {
        // The root chapter exists — treat the extra segments as sub-content
        // (mythology god profiles, etc.)
        setActiveChapterId(path[0]);
        setBreadcrumbPath(path);
        const titles = [rootChapter.title];
        // Add extra path segments as-is to breadcrumb
        for (let i = 1; i < path.length; i++) {
          titles.push(path[i]);
        }
        setBreadcrumb(titles);
        // Expand the visible root chapter when this chapter also exists in the sidebar tree.
        const visiblePath = findChapterPath(chapters, path[0]);
        visiblePath?.forEach(id => {
          setExpandedChapters(prev => new Set([...prev, id]));
        });
      } else {
        // Nothing found — clear to main menu
        setActiveChapterId(null);
        setBreadcrumb([]);
        setBreadcrumbPath([]);
        setHomebrewViewerRoute(null);
        setHomebrewLibraryRoute(null);
        setHomebrewCharacterSheetRoute(null);
        clearHash();
      }
    }
  }, [allChapters, chapters, findChapterById, findChapterPath]);

  // Initialize from URL hash on mount
  useEffect(() => {
    const hashPath = getHashPath();
    if (hashPath) {
      navigateFromHashPath(hashPath);
    }
  }, [navigateFromHashPath, currentSystem]);

  // Listen for browser back/forward (hashchange)
  useEffect(() => {
    const handleHashChange = () => {
      const hashPath = getHashPath();
      if (hashPath) {
        navigateFromHashPath(hashPath);
      } else {
        // Hash was cleared — go back to main menu
        setActiveChapterId(null);
        setBreadcrumb([]);
        setBreadcrumbPath([]);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [navigateFromHashPath]);

  // Expand all parents of active chapter
  React.useEffect(() => {
    if (activeChapterId) {
      const expandParents = (tree: Chapter[], targetId: string, parents: string[] = []): boolean => {
        for (const chapter of tree) {
          if (chapter.id === targetId) {
            parents.forEach(p => setExpandedChapters(prev => new Set([...prev, p])));
            return true;
          }
          if (chapter.subChapters) {
            if (expandParents(chapter.subChapters, targetId, [...parents, chapter.id])) {
              return true;
            }
          }
        }
        return false;
      };
      expandParents(chapters, activeChapterId);
    }
  }, [activeChapterId, chapters]);

  return (
    <div className={`theme-${currentSystem} flex h-screen bg-stone-900 text-amber-100 leather-bg`}>
      <Sidebar
        chapters={chapters}
        activeChapterId={activeChapterId}
        expandedChapters={expandedChapters}
        onChapterSelect={handleChapterSelect}
        onToggleExpand={handleToggleExpand}
        currentSystem={currentSystem}
        currentSystemName={systemDefinition.name}
        onToggleSystem={handleToggleSystem}
        onClearSelection={() => {
          setIsEditorOpen(false);
          setHomebrewViewerRoute(null);
          setHomebrewLibraryRoute(null);
          setHomebrewCharacterSheetRoute(null);
          setActiveChapterId(null);
          setBreadcrumb([]);
          setBreadcrumbPath([]);
          clearHash();
        }}
        breadcrumb={breadcrumb}
        onOpenEditor={() => {
          setIsEditorOpen(true);
          setHomebrewViewerRoute(null);
          setHomebrewLibraryRoute(null);
          setHomebrewCharacterSheetRoute(null);
          clearHash();
        }}
        isEditorOpen={isEditorOpen}
      />
      {isEditorOpen ? (
        <VisualPageEditor currentSystem={currentSystem} onExit={() => setIsEditorOpen(false)} />
      ) : homebrewViewerRoute ? (
        <HomebrewViewer
          entityType={homebrewViewerRoute.entityType}
          characterId={homebrewViewerRoute.characterId}
          entryId={homebrewViewerRoute.entryId}
          onBack={() => window.history.back()}
        />
      ) : homebrewLibraryRoute ? (
        <HomebrewLibraryViewer
          category={homebrewLibraryRoute.category}
          characterId={homebrewLibraryRoute.characterId}
          onBack={() => window.history.back()}
        />
      ) : homebrewCharacterSheetRoute ? (
        <HomebrewCharacterSheetViewer
          characterId={homebrewCharacterSheetRoute.characterId}
          onBack={() => window.history.back()}
        />
      ) : (
        <ContentView
          activeChapter={activeChapter}
          breadcrumb={breadcrumb}
          onChapterSelect={handleChapterSelect}
          parentPath={breadcrumbPath}
          prevChapter={prevChapter}
          nextChapter={nextChapter}
          allChapters={allChapters}
        />
      )}
    </div>
  );
}

export default App;
