import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Chapter } from '../types';
import MarkdownRenderer, { PartInfo } from './MarkdownRenderer';
import MythologyHub from './mythology/MythologyHub';
import { allGods } from '../data/worldbuilding-handbook/mythology/gods';
import { BattleTracker } from './BattleTracker';
import { DiceMacros } from './DiceMacros';
import { MessageSender } from './MessageSender';
import { WorldMap } from './WorldMap';

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
    // Find the target chapter recursively
    const findChapterById = (chapters: Chapter[], id: string): Chapter | null => {
      for (const ch of chapters) {
        if (ch.id === id) return ch;
        if (ch.subChapters) {
          const found = findChapterById(ch.subChapters, id);
          if (found) return found;
        }
      }
      return null;
    };

    const targetChapter = findChapterById(allChapters, chapterId);
    if (!targetChapter) return;

    // Navigate to the chapter
    onChapterSelect?.(chapterId, [chapterId]);

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
  }, [allChapters, onChapterSelect]);

  // Reset parts whenever the chapter changes
  useEffect(() => {
    setParts([]);
    setActivePartIndex(0);
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

          {/* ── Dice Macros (special chapter) ──────────────────────────────── */}
          {activeChapter.content === 'dice-macros' ? (
            <div className="-mx-4 -mb-6">
              <DiceMacros />
            </div>
          ) : null}

          {/* ── Message Sender (special chapter) ───────────────────────────── */}
          {activeChapter.content === 'message-sender' ? (
            <div className="-mx-4 -mb-6">
              <MessageSender />
            </div>
          ) : null}

          {/* ── World Map (special chapter) ───────────────────────────────── */}
          {activeChapter.content === 'world-map' ? (
            <div className="-mx-4 -mb-6">
              <WorldMap />
            </div>
          ) : null}

          {/* ── Markdown content ───────────────────────────────────────────── */}
          {activeChapter.content && activeChapter.content !== 'mythology' && activeChapter.content !== 'battle-tracker' && activeChapter.content !== 'dice-macros' && activeChapter.content !== 'message-sender' && activeChapter.content !== 'world-map' && (
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
