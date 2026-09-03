import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Chapter } from '../types';
import MarkdownRenderer, { PartInfo } from './MarkdownRenderer';
import MythologyHub from './mythology/MythologyHub';
import { allGods } from '../data/inoraxium/worldbuilding-handbook/mythology/gods';
import { BattleTracker } from './BattleTracker';
import { WorldMap } from './WorldMap';
import Characters from './Characters';
import AssetCreatorPage from './AssetCreatorPage';
import SessionPage from './SessionPage';
import CampaignsPage from './CampaignsPage';

interface WorkspaceFolderNode {
  id: string;
  name: string;
  children: WorkspaceFolderNode[];
  pages: Chapter[];
}

interface ContentViewProps {
  activeChapter: Chapter | null;
  breadcrumb: string[];
  onChapterSelect?: (chapterId: string, path?: string[] | null) => void;
  parentPath?: string[];
  prevChapter?: Chapter | null;
  nextChapter?: Chapter | null;
  allChapters?: Chapter[];
}

export const ContentView: React.FC<ContentViewProps> = ({
  activeChapter,
  breadcrumb,
  onChapterSelect,
  parentPath = [],
  prevChapter = null,
  nextChapter = null,
  allChapters = [],
}) => {
  // ── Part navigation state ────────────────────────────────────────────────
  const [parts, setParts] = useState<PartInfo[]>([]);
  const [activePartIndex, setActivePartIndex] = useState(0);

  // ── Copy link feedback ──────────────────────────────────────────────────
  const [linkCopied, setLinkCopied] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'content' | 'tags' | 'folders'>('content');
  const [selectedWorkspaceTag, setSelectedWorkspaceTag] = useState<string | null>(null);
  const [expandedWorkspaceFolders, setExpandedWorkspaceFolders] = useState<Set<string>>(new Set());

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // The scrollable wrapper — this is what we scroll, NOT window
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // The rendered markdown div — we query [data-part] elements inside it
  const markdownContentRef = useRef<HTMLDivElement | null>(null);

  // Track whether a programmatic scroll is happening so we don't fight it
  const isScrollingTo = useRef(false);

  // Called by MarkdownRenderer once it has painted its DOM nodes
  const handlePartsFound = useCallback((found: PartInfo[]) => {
    setParts(found);
    setActivePartIndex(0);
  }, []);

  // Scroll the scrollable container to bring a [data-part] element into view
  const scrollToPart = useCallback((index: number) => {
    if (index < 0 || index >= parts.length) return;

    const partId = parts[index].id;
    const target = markdownContentRef.current?.querySelector(`[data-part="${partId}"]`) as HTMLElement | null;
    const container = scrollContainerRef.current;

    if (!target || !container) return;

    // Mark that we're doing a programmatic scroll
    isScrollingTo.current = true;

    // Get the element's position relative to the scrollable container
    const containerTop = container.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const offset = targetTop - containerTop + container.scrollTop - 16; // 16px breathing room

    container.scrollTo({ top: offset, behavior: 'smooth' });
    setActivePartIndex(index);

    // Clear the flag after the scroll animation finishes
    setTimeout(() => {
      isScrollingTo.current = false;
    }, 600);
  }, [parts]);

  // ── Scroll tracking ──────────────────────────────────────────────────────
  // Listen to scroll events on the container and update activePartIndex
  // based on which [data-part] section is currently closest to the top.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const contentDiv = markdownContentRef.current;
    if (!container || !contentDiv || parts.length === 0) return;

    const handleScroll = () => {
      // Don't fight programmatic scrolls
      if (isScrollingTo.current) return;

      const containerTop = container.getBoundingClientRect().top;
      // Threshold: the "active" part is the one whose top is closest to
      // the top of the container (with some offset for the navigator bar)
      const threshold = containerTop + 80;

      const partElements = parts
        .map((p) => contentDiv.querySelector(`[data-part="${p.id}"]`) as HTMLElement | null)
        .filter(Boolean) as HTMLElement[];

      if (partElements.length === 0) return;

      // Find the last part element whose top has scrolled above the threshold
      let closestIndex = 0;
      for (let i = 0; i < partElements.length; i++) {
        const elTop = partElements[i].getBoundingClientRect().top;
        if (elTop <= threshold) {
          closestIndex = i;
        } else {
          break;
        }
      }

      setActivePartIndex(closestIndex);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [parts]);

  // ── Cross-chapter linking ────────────────────────────────────────────────
  // Called when a link with data-go-chapter is clicked inside the markdown.
  // Navigates to the target chapter and optionally scrolls to a data-part.
  const handleCrossChapterLink = useCallback((chapterId: string, partId?: string) => {
    const flattenChapters = (chapters: Chapter[]): Chapter[] => {
      const result: Chapter[] = [];
      for (const chapter of chapters) {
        result.push(chapter);
        if (chapter.subChapters) {
          result.push(...flattenChapters(chapter.subChapters));
        }
      }
      return result;
    };

    const flatChapters = flattenChapters(allChapters);

    const findChapterById = (chapters: Chapter[], id: string): Chapter | null => {
      for (const ch of chapters) {
        if (ch.id === id || ch.aliases?.includes(id)) return ch;
        if (ch.subChapters) {
          const found = findChapterById(ch.subChapters, id);
          if (found) return found;
        }
      }
      return null;
    };

    const activeWorkspaceId = activeChapter?.userPageMeta?.workspaceId;
    const workspaceScopedMatch = activeWorkspaceId
      ? flatChapters.find(
          (chapter) =>
            chapter.userPageMeta?.workspaceId === activeWorkspaceId &&
            (chapter.id === chapterId || chapter.aliases?.includes(chapterId))
        ) ?? null
      : null;

    const targetChapter = workspaceScopedMatch ?? findChapterById(allChapters, chapterId);
    if (!targetChapter) return;

    // Navigate to the chapter
    onChapterSelect?.(targetChapter.id, [targetChapter.id]);

    // If a part was specified, scroll to it after the chapter loads
    if (partId) {
      const tryScrollToPart = () => {
        const container = scrollContainerRef.current;
        if (!container) {
          setTimeout(tryScrollToPart, 100);
          return;
        }

        // Wait for ReactMarkdown to render
        setTimeout(() => {
          const target = markdownContentRef.current?.querySelector(`[data-part="${partId}"]`) as HTMLElement | null;
          if (!target) {
            setTimeout(tryScrollToPart, 100);
            return;
          }

          const containerTop = container.getBoundingClientRect().top;
          const targetTop = target.getBoundingClientRect().top;
          const offset = targetTop - containerTop + container.scrollTop - 16;

          isScrollingTo.current = true;
          container.scrollTo({ top: offset, behavior: 'smooth' });

          setTimeout(() => {
            isScrollingTo.current = false;
          }, 600);
        }, 150);
      };

      setTimeout(tryScrollToPart, 200);
    }
  }, [activeChapter?.userPageMeta?.workspaceId, allChapters, onChapterSelect]);

  const workspaceId = activeChapter?.userPageMeta?.workspaceId || null;
  const isWorkspaceMain = activeChapter?.userPageMeta?.isWorkspaceMain === true;
  const workspacePages = React.useMemo(
    () =>
      workspaceId
        ? allChapters.filter((chapter) => chapter.userPageMeta?.workspaceId === workspaceId && !chapter.userPageMeta?.isFolder)
        : [],
    [allChapters, workspaceId]
  );

  const workspaceTagMap = React.useMemo(() => {
    const map = new Map<string, Chapter[]>();
    workspacePages.forEach((chapter) => {
      (chapter.userPageMeta?.tags ?? []).forEach((tag) => {
        const normalizedTag = tag.trim();
        if (!normalizedTag) return;
        const list = map.get(normalizedTag) ?? [];
        list.push(chapter);
        map.set(normalizedTag, list);
      });
    });
    return new Map(
      Array.from(map.entries()).sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: 'base' }))
    );
  }, [workspacePages]);

  const workspaceFolderTree = React.useMemo<WorkspaceFolderNode[]>(() => {
    const root: WorkspaceFolderNode[] = [];

    const ensureNode = (container: WorkspaceFolderNode[], key: string, name: string) => {
      const existing = container.find((item) => item.id === key);
      if (existing) return existing;
      const next: WorkspaceFolderNode = { id: key, name, children: [], pages: [] };
      container.push(next);
      return next;
    };

    workspacePages.forEach((chapter) => {
      const folderPath = chapter.userPageMeta?.folderPath?.trim() || '';
      if (!folderPath) return;

      const segments = folderPath.split('/').filter(Boolean);
      let level = root;
      let currentPath = '';
      let lastNode: WorkspaceFolderNode | null = null;

      for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const node = ensureNode(level, currentPath, segment);
        lastNode = node;
        level = node.children;
      }

      if (lastNode) {
        lastNode.pages.push(chapter);
      }
    });

    const sortNode = (node: WorkspaceFolderNode) => {
      node.children.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
      node.pages.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));
      node.children.forEach(sortNode);
    };

    root.forEach(sortNode);
    return root.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  }, [workspacePages]);

  const renderWorkspaceFolderNode = (node: WorkspaceFolderNode, depth = 0): React.ReactNode => {
    const isExpanded = expandedWorkspaceFolders.has(node.id);
    return (
      <div key={node.id} className="space-y-2">
        <button
          onClick={() =>
            setExpandedWorkspaceFolders((prev) => {
              const next = new Set(prev);
              if (next.has(node.id)) {
                next.delete(node.id);
              } else {
                next.add(node.id);
              }
              return next;
            })
          }
          className="flex w-full items-center gap-2 rounded-lg border border-amber-800/20 bg-amber-950/10 px-3 py-2 text-left text-amber-300 hover:bg-amber-900/20"
          style={{ paddingLeft: `${depth * 14 + 12}px`, fontFamily: "'Cinzel', serif" }}
        >
          <span className="text-xs">{isExpanded ? '▾' : '▸'}</span>
          <span>{node.name}</span>
        </button>
        {isExpanded && (
          <div className="space-y-2">
            {node.pages.map((page) => (
              <button
                key={page.id}
                onClick={() => onChapterSelect?.(page.id, [page.id])}
                className="flex w-full items-center rounded-lg border border-stone-800 bg-black/20 px-3 py-2 text-left text-sm text-amber-100 hover:border-amber-700/40 hover:bg-amber-950/10"
                style={{ paddingLeft: `${depth * 14 + 34}px`, fontFamily: "'IM Fell English', serif" }}
              >
                {page.title}
              </button>
            ))}
            {node.children.map((child) => renderWorkspaceFolderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Reset parts whenever the chapter changes
  useEffect(() => {
    setParts([]);
    setActivePartIndex(0);
    setWorkspaceTab('content');
    setSelectedWorkspaceTag(null);
    setExpandedWorkspaceFolders(new Set());
    // Scroll back to top on chapter change
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeChapter?.id]);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!activeChapter) {
    return (
      <div className="flex-1 p-12 overflow-y-auto bg-stone-800/30 flex items-center justify-center">
        <div className="text-center text-amber-400 max-w-lg">
          <div className="text-7xl mb-6">📖</div>
          <h2
            className="text-4xl font-bold mb-4 text-amber-300"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            Welcome, Adventurer
          </h2>
          <p
            className="text-xl text-amber-600 leading-relaxed"
            style={{ fontFamily: "'IM Fell English', serif" }}
          >
            Select a chapter from the tome to begin your journey through the Eldritch Grimoire.
          </p>
          <div className="mt-8 text-amber-800 text-4xl">✦ ✦ ✦</div>
        </div>
      </div>
    );
  }

  const hasParts = parts.length > 0;
  const currentPart = parts[activePartIndex];
  const prevPart = activePartIndex > 0 ? parts[activePartIndex - 1] : null;
  const nextPart = activePartIndex < parts.length - 1 ? parts[activePartIndex + 1] : null;

  // Whether to show the chapter-level navigator (always shown if any prev/next exists)
  const hasChapterNav = prevChapter !== null || nextChapter !== null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-stone-800/30">

      {/* ── Part Navigator Bar ─────────────────────────────────────────────
           Shown only when the current markdown contains [data-part] anchors  */}
      {hasParts && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-3 border-b border-amber-800/50 bg-stone-900/80 backdrop-blur-sm">

          {/* Previous */}
          <button
            onClick={() => scrollToPart(activePartIndex - 1)}
            disabled={!prevPart}
            className="flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-300 disabled:opacity-25 disabled:cursor-not-allowed transition-colors min-w-0"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <ChevronLeft size={16} className="shrink-0" />
            <span className="hidden sm:inline truncate max-w-[140px]">{prevPart ? prevPart.label : '—'}</span>
          </button>

          {/* Current section pill + dot indicators */}
          <div className="flex items-center gap-3 flex-1 justify-center min-w-0">
            {/* Dot indicators */}
            <div className="flex items-center gap-1.5">
              {parts.map((_, i) => (
                <button
                  key={i}
                  onClick={() => scrollToPart(i)}
                  className={`rounded-full transition-all duration-300 ${
                    i === activePartIndex
                      ? 'w-3 h-3 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
                      : 'w-2 h-2 bg-amber-800 hover:bg-amber-600'
                  }`}
                  title={parts[i].label}
                />
              ))}
            </div>

            <span
              className="text-amber-300 font-bold text-sm tracking-wide px-3 py-1 rounded bg-amber-900/30 border border-amber-800/50 truncate max-w-[200px]"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              {currentPart.label}
            </span>
          </div>

          {/* Next */}
          <button
            onClick={() => scrollToPart(activePartIndex + 1)}
            disabled={!nextPart}
            className="flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-300 disabled:opacity-25 disabled:cursor-not-allowed transition-colors min-w-0"
            style={{ fontFamily: "'Cinzel', serif" }}
          >
            <span className="hidden sm:inline truncate max-w-[140px]">{nextPart ? nextPart.label : '—'}</span>
            <ChevronRight size={16} className="shrink-0" />
          </button>

        </div>
      )}

      {/* ── Chapter Navigator Bar ──────────────────────────────────────────
           Always shown when prevChapter or nextChapter is defined.
           Shows prev/next chapter names; missing ones display "—".          */}
      {hasChapterNav && (
        <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-3 border-b border-amber-800/40 bg-stone-900/60 backdrop-blur-sm">

          {/* Previous Chapter */}
          {prevChapter ? (
            <button
              onClick={() => onChapterSelect?.(prevChapter.id, [prevChapter.id])}
              className="flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-300 transition-colors min-w-0 group"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              <ChevronLeft size={16} className="shrink-0 group-hover:-translate-x-0.5 transition-transform" />
              <span className="hidden sm:inline truncate max-w-[160px]">{prevChapter.title}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-amber-800/50 min-w-0">
              <ChevronLeft size={16} className="shrink-0" />
              <span className="hidden sm:inline">—</span>
            </div>
          )}

          {/* Center label */}
          <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
            <span className="text-amber-700 text-xs tracking-widest uppercase" style={{ fontFamily: "'Cinzel', serif" }}>
              Chapter Navigation
            </span>
            <span className="text-amber-800/40">✦</span>
            <span className="text-amber-300 font-bold text-sm truncate max-w-[200px]" style={{ fontFamily: "'Cinzel', serif" }}>
              {activeChapter.title}
            </span>
          </div>

          {/* Next Chapter */}
          {nextChapter ? (
            <button
              onClick={() => onChapterSelect?.(nextChapter.id, [nextChapter.id])}
              className="flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-300 transition-colors min-w-0 group"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              <span className="hidden sm:inline truncate max-w-[160px]">{nextChapter.title}</span>
              <ChevronRight size={16} className="shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-amber-800/50 min-w-0">
              <span className="hidden sm:inline">—</span>
              <ChevronRight size={16} className="shrink-0" />
            </div>
          )}

        </div>
      )}

      {/* ── Scrollable content ────────────────────────────────────────────── */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div 
          className="mx-auto px-12 py-10 transition-all duration-300"
          style={{ width: `${(activeChapter.width ?? 0.5) * 100}%`, minWidth: '320px' }}
        >

          {/* ── Breadcrumb + Share Link ────────────────────────────────────── */}
          {breadcrumb.length > 0 && (
            <div className="mb-6 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                {breadcrumb.map((crumb, i) => (
                  <React.Fragment key={i}>
                    <span
                      className={`text-sm ${i === breadcrumb.length - 1 ? 'text-amber-300' : 'text-amber-600'}`}
                      style={{ fontFamily: "'IM Fell English', serif" }}
                    >
                      {crumb}
                    </span>
                    {i < breadcrumb.length - 1 && (
                      <span className="text-amber-700 text-sm">›</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
              <button
                onClick={handleCopyLink}
                className={`text-xs transition-colors flex items-center gap-1 px-2 py-1 rounded border ${
                  linkCopied
                    ? 'text-green-400 border-green-700/50 bg-green-900/20'
                    : 'text-amber-700 hover:text-amber-400 border-amber-800/30 hover:border-amber-600/50'
                }`}
                style={{ fontFamily: "'IM Fell English', serif" }}
                title="Copy link to clipboard"
              >
                {linkCopied ? '✓ Copied!' : '🔗 Copy Link'}
              </button>
            </div>
          )}

          {/* ── Chapter header ─────────────────────────────────────────────── */}
          <div className="mb-8 pb-6 border-b-2 border-amber-800/60">
            <div className="flex items-center gap-3 mb-2">
              {activeChapter.icon && (
                <span className="text-4xl">{activeChapter.icon}</span>
              )}
              <h1
                className="text-5xl font-bold text-amber-400"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                {activeChapter.title}
              </h1>
            </div>
            {activeChapter.subtitle && (
              <p
                className="text-xl text-amber-600 italic mt-1"
                style={{ fontFamily: "'IM Fell English', serif" }}
              >
                {activeChapter.subtitle}
              </p>
            )}
          </div>

          {isWorkspaceMain && (
            <div className="mb-8 rounded-2xl border border-amber-800/30 bg-stone-900/45 p-4">
              <div className="mb-4 flex flex-wrap gap-2">
                {(['content', 'tags', 'folders'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setWorkspaceTab(tab)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
                      workspaceTab === tab
                        ? 'border-amber-500/50 bg-amber-900/30 text-amber-100'
                        : 'border-stone-700 bg-stone-900 text-stone-400 hover:border-amber-800/40 hover:text-amber-200'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {workspaceTab === 'tags' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {workspaceTagMap.size === 0 ? (
                      <p className="text-sm text-stone-500">No tags found in this workspace.</p>
                    ) : (
                      Array.from(workspaceTagMap.keys()).map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setSelectedWorkspaceTag(tag)}
                          className={`rounded-full border px-3 py-1 text-xs ${
                            selectedWorkspaceTag === tag
                              ? 'border-amber-500/50 bg-amber-900/30 text-amber-100'
                              : 'border-amber-800/30 bg-amber-950/10 text-amber-300 hover:bg-amber-900/20'
                          }`}
                        >
                          #{tag}
                        </button>
                      ))
                    )}
                  </div>
                  {selectedWorkspaceTag && workspaceTagMap.has(selectedWorkspaceTag) && (
                    <div className="space-y-2">
                      <p className="text-sm text-amber-400" style={{ fontFamily: "'Cinzel', serif" }}>
                        Pages tagged with `{selectedWorkspaceTag}`
                      </p>
                      {workspaceTagMap.get(selectedWorkspaceTag)!.map((page) => (
                        <button
                          key={`${selectedWorkspaceTag}-${page.id}`}
                          onClick={() => onChapterSelect?.(page.id, [page.id])}
                          className="block w-full rounded-lg border border-stone-800 bg-black/20 px-3 py-2 text-left text-amber-100 hover:border-amber-700/40 hover:bg-amber-950/10"
                        >
                          {page.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {workspaceTab === 'folders' && (
                <div className="space-y-3">
                  {workspaceFolderTree.length === 0 ? (
                    <p className="text-sm text-stone-500">No folder structure found for this workspace.</p>
                  ) : (
                    workspaceFolderTree.map((node) => renderWorkspaceFolderNode(node))
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Mythology Module (special chapter) ─────────────────────────── */}
          {activeChapter.content === 'mythology' ? (
            <div className="-mx-4 -mb-6">
              <MythologyHub
                gods={allGods}
                initialGodId={
                  parentPath.length > 1 && parentPath[0] === 'mythology'
                    ? parentPath[parentPath.length - 1]
                    : undefined
                }
                onGodNavigate={(godId) => {
                  if (godId) {
                    onChapterSelect?.('mythology', ['mythology', godId]);
                  } else {
                    onChapterSelect?.('mythology', ['mythology']);
                  }
                }}
              />
            </div>
          ) : null}

          {/* ── Battle Tracker (special chapter) ────────────────────────────── */}
          {activeChapter.content === 'battle-tracker' ? (
            <div className="-mx-4 -mb-6">
              <BattleTracker />
            </div>
          ) : null}

          {/* ── World Map (special chapter) ───────────────────────────────── */}
          {activeChapter.content === 'world-map' ? (
            <div className="-mx-4 -mb-6">
              <WorldMap />
            </div>
          ) : null}

          {/* ── Characters Module (special chapter) ───────────────────────── */}
          {activeChapter.content === 'characters' ? (
            <div className="-mx-4 -mb-6">
              <Characters />
            </div>
          ) : null}

          {/* ── Session Module (special chapter) ──────────────────────────── */}
          {activeChapter.content === 'session' ? (
            <div className="-mx-4 -mb-6">
              <SessionPage />
            </div>
          ) : null}

          {/* ── Campaigns Module (special chapter) ───────────────────────── */}
          {activeChapter.content === 'campaigns' ? (
            <div className="-mx-4 -mb-6">
              <CampaignsPage />
            </div>
          ) : null}

          {/* ── Asset Creator (special chapter) ───────────────────────────── */}
          {activeChapter.content === 'asset-creator' ? (
            <div className="-mx-4 -mb-6">
              <AssetCreatorPage />
            </div>
          ) : null}

          {/* ── Markdown content ───────────────────────────────────────────── */}
          {workspaceTab === 'content' && activeChapter.content && activeChapter.content !== 'mythology' && activeChapter.content !== 'battle-tracker' && activeChapter.content !== 'world-map' && activeChapter.content !== 'characters' && activeChapter.content !== 'session' && activeChapter.content !== 'campaigns' && activeChapter.content !== 'asset-creator' && (
            <div style={{ fontFamily: "'IM Fell English', serif" }}>
              <MarkdownRenderer
                path={activeChapter.content}
                onPartsFound={handlePartsFound}
                contentRef={markdownContentRef}
                onCrossChapterLink={handleCrossChapterLink}
                allChapters={allChapters}
                onChapterSelect={onChapterSelect}
              />
            </div>
          )}

          {/* ── Sub-chapter preview cards ──────────────────────────────────── */}
          {activeChapter.subChapters && activeChapter.subChapters.length > 0 && (
            <div className="mt-10 pt-6 border-t border-amber-800/40">
              <h3
                className="text-xl font-bold text-amber-500 mb-4"
                style={{ fontFamily: "'Cinzel', serif" }}
              >
                Sections within this Chapter
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeChapter.subChapters.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => onChapterSelect?.(sub.id, [...parentPath, sub.id])}
                    className="p-4 bg-amber-900/20 border border-amber-800/40 rounded-lg hover:border-amber-600/60 hover:bg-amber-900/30 transition-all text-left group cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      {sub.icon && <span className="text-lg">{sub.icon}</span>}
                      <span
                        className="text-amber-300 font-semibold group-hover:text-amber-200 transition-colors"
                        style={{ fontFamily: "'Cinzel', serif" }}
                      >
                        {sub.title}
                      </span>
                      <span className="ml-auto text-amber-700 group-hover:text-amber-500 transition-colors">→</span>
                    </div>
                    {sub.subtitle && (
                      <p className="text-amber-600 text-sm italic" style={{ fontFamily: "'IM Fell English', serif" }}>
                        {sub.subtitle}
                      </p>
                    )}
                    {sub.subChapters && sub.subChapters.length > 0 && (
                      <p className="text-amber-700 text-xs mt-1">
                        {sub.subChapters.length} sub-section{sub.subChapters.length > 1 ? 's' : ''}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-12 text-center text-amber-800/40 text-2xl select-none">✦ ✦ ✦</div>
        </div>
      </div>
    </div>
  );
};
