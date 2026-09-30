import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronRight, ImageIcon, Search, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Chapter, TimelineEvent, TimelineFrontmatter, TimelineRange } from '../types';

interface TimelinePageProps {
  config: TimelineFrontmatter;
  onChapterSelect?: (chapterId: string, path?: string[] | null) => void;
  allChapters?: Chapter[];
}

interface TimelineImagePreview {
  src: string;
  alt: string;
}

interface TimelineEventGroup {
  year: number;
  events: TimelineEvent[];
}

interface TimelineEraSection {
  id: string;
  range: TimelineRange | null;
  groups: TimelineEventGroup[];
}

const defaultColor = '#f59e0b';

const findChapterPath = (chapters: Chapter[], targetId: string, path: string[] = []): string[] | null => {
  for (const chapter of chapters) {
    const nextPath = [...path, chapter.id];
    if (chapter.id === targetId) return nextPath;
    if (chapter.subChapters?.length) {
      const found = findChapterPath(chapter.subChapters, targetId, nextPath);
      if (found) return found;
    }
  }
  return null;
};

const safeColor = (value?: string): string => {
  const candidate = value?.trim() || '';
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(candidate)) return defaultColor;

  const source = candidate.slice(1);
  const expanded = source.length <= 4
    ? source.slice(0, 3).split('').map(character => `${character}${character}`).join('')
    : source.slice(0, 6);
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  if (luminance >= 0.18) return `#${expanded}`;

  const lift = (channel: number) => Math.round(channel + (255 - channel) * 0.45);
  return `rgb(${lift(red)}, ${lift(green)}, ${lift(blue)})`;
};

export const normalizeImgurImageUrl = (rawUrl?: string): string => {
  const value = rawUrl?.trim() || '';
  if (!value) return '';

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (host === 'i.imgur.com') return url.toString();
    if (host !== 'imgur.com' && host !== 'www.imgur.com') return url.toString();

    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.length || ['a', 'gallery'].includes(segments[0].toLowerCase())) return value;

    const fileName = segments[0];
    const match = fileName.match(/^([a-z0-9_-]+)(\.(?:avif|gif|jpe?g|png|webp))?$/i);
    if (!match) return value;
    return `https://i.imgur.com/${match[1]}${match[2] || '.png'}`;
  } catch {
    return value;
  }
};

const matchesRange = (event: TimelineEvent, range: TimelineRange): boolean => (
  event.year >= range.start && event.year <= range.end
);

export const getTimelineYearGap = (difference: number): number => {
  if (difference <= 0) return 0;
  if (difference === 1) return 20;
  return Math.min(116, Math.round(30 + Math.log10(difference) * 30));
};

const TimelineImage: React.FC<{
  src?: string;
  alt?: string;
  onOpen: (image: TimelineImagePreview) => void;
  compact?: boolean;
  eventPreview?: boolean;
}> = ({ src, alt, onOpen, compact = false, eventPreview = false }) => {
  const [failed, setFailed] = useState(false);
  const resolved = normalizeImgurImageUrl(src);

  useEffect(() => setFailed(false), [resolved]);
  if (!resolved || failed) return null;

  const label = alt?.trim() || 'Chronicle event image';
  const image = (
    <>
      <img
        src={resolved}
        alt={label}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`mx-auto block w-full object-contain transition-transform duration-300 group-hover:scale-[1.01] ${
          compact ? 'max-h-80' : eventPreview ? 'h-full max-h-64 md:max-h-72' : 'max-h-[28rem]'
        }`}
      />
      <span className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-black/70 text-amber-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <ImageIcon size={15} aria-hidden="true" />
      </span>
    </>
  );

  if (compact) {
    return (
      <span
        className="group relative my-3 block w-full cursor-zoom-in overflow-hidden rounded-md border border-amber-900/35 bg-black/35 text-left"
        onClick={() => onOpen({ src: resolved, alt: label })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen({ src: resolved, alt: label });
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open image: ${label}`}
      >
        {image}
      </span>
    );
  }

  if (eventPreview) {
    return (
      <button
        type="button"
        className="group relative block h-full min-h-40 w-full cursor-zoom-in overflow-hidden border-b border-amber-900/35 bg-black/40 text-left md:border-b-0 md:border-r"
        onClick={() => onOpen({ src: resolved, alt: label })}
        aria-label={`Open image: ${label}`}
      >
        {image}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="group relative block w-full overflow-hidden rounded-t-lg border border-amber-900/35 bg-black/35 text-left"
      onClick={() => onOpen({ src: resolved, alt: label })}
      aria-label={`Open image: ${label}`}
    >
      {image}
    </button>
  );
};

const TimelineMarkdown: React.FC<{
  value: string;
  onOpenImage: (image: TimelineImagePreview) => void;
}> = ({ value, onOpenImage }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      p: ({ children }) => <p className="mt-2 text-sm leading-6 text-stone-300 first:mt-0">{children}</p>,
      strong: ({ children }) => <strong className="font-semibold text-amber-100">{children}</strong>,
      em: ({ children }) => <em className="text-stone-200">{children}</em>,
      ul: ({ children }) => <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-300">{children}</ul>,
      ol: ({ children }) => <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-300">{children}</ol>,
      li: ({ children }) => <li className="leading-6">{children}</li>,
      blockquote: ({ children }) => <blockquote className="mt-3 border-l-2 border-amber-600/60 pl-3 text-amber-100/75">{children}</blockquote>,
      code: ({ children }) => <code className="rounded bg-black/35 px-1 py-0.5 font-mono text-xs text-cyan-200">{children}</code>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-cyan-300 underline decoration-cyan-700/60 underline-offset-2 hover:text-cyan-100"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </a>
      ),
      img: ({ src, alt }) => (
        <TimelineImage src={typeof src === 'string' ? src : ''} alt={alt || ''} compact onOpen={onOpenImage} />
      ),
      hr: () => <hr className="my-4 border-amber-900/35" />,
    }}
  >
    {value}
  </ReactMarkdown>
);

export const TimelinePage: React.FC<TimelinePageProps> = ({ config, onChapterSelect, allChapters = [] }) => {
  const ranges = config.ranges ?? [];
  const sortedEvents = useMemo(
    () => config.events
      .map((event, index) => ({ event, index }))
      .sort((left, right) => left.event.year - right.event.year || left.index - right.index)
      .map(({ event }) => event),
    [config.events],
  );
  const [query, setQuery] = useState('');
  const [activeRangeId, setActiveRangeId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<TimelineImagePreview | null>(null);

  useEffect(() => {
    if (!selectedImage) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedImage(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage]);

  const activeRange = ranges.find(range => range.id === activeRangeId) ?? null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEvents = useMemo(() => sortedEvents.filter((event) => {
    if (activeRange && !matchesRange(event, activeRange)) return false;
    if (!normalizedQuery) return true;
    const searchable = [event.title, event.description, event.year, ...(event.tags ?? [])]
      .filter(value => value !== undefined && value !== null)
      .join(' ')
      .toLocaleLowerCase();
    return searchable.includes(normalizedQuery);
  }), [activeRange, normalizedQuery, sortedEvents]);

  const groups = useMemo<TimelineEventGroup[]>(() => {
    const result: TimelineEventGroup[] = [];
    for (const event of filteredEvents) {
      const last = result[result.length - 1];
      if (last?.year === event.year) last.events.push(event);
      else result.push({ year: event.year, events: [event] });
    }
    return result;
  }, [filteredEvents]);

  const eraSections = useMemo<TimelineEraSection[]>(() => {
    const result: TimelineEraSection[] = [];
    for (const group of groups) {
      const range = ranges.find(candidate => group.year >= candidate.start && group.year <= candidate.end) ?? null;
      const sectionId = range?.id ?? 'unmapped';
      const previous = result[result.length - 1];
      if (previous?.id === sectionId) previous.groups.push(group);
      else result.push({ id: sectionId, range, groups: [group] });
    }
    return result;
  }, [groups, ranges]);

  const groupIndexByYear = useMemo(
    () => new Map(groups.map((group, index) => [group.year, index])),
    [groups],
  );

  const handleEventClick = (event: TimelineEvent) => {
    if (!event.goChapter) return;
    const path = findChapterPath(allChapters, event.goChapter) ?? [event.goChapter];
    onChapterSelect?.(event.goChapter, path);
    if (event.goChapterPart) {
      setTimeout(() => {
        const selector = `[data-part="${CSS.escape(event.goChapterPart || '')}"]`;
        document.querySelector<HTMLElement>(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 250);
    }
  };

  const span = Math.max(0, config.endYear - (config.startYear ?? 0));

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-amber-900/45 bg-[#100f0d]/90 shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
      <header className="border-b border-amber-900/35 bg-[#0c0d0d] px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase text-amber-500" style={{ fontFamily: "'Cinzel', serif", letterSpacing: '0.18em' }}>
              World Chronicle
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-amber-100 sm:text-3xl" style={{ fontFamily: "'Cinzel', serif" }}>
              A Timeline of Ages
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-amber-900/35 bg-amber-950/25 text-center">
            <div className="min-w-[82px] bg-black/25 px-3 py-2">
              <strong className="block text-sm text-amber-200">{sortedEvents.length}</strong>
              <span className="text-[10px] uppercase text-stone-500" style={{ letterSpacing: '0.12em' }}>Events</span>
            </div>
            <div className="min-w-[82px] bg-black/25 px-3 py-2">
              <strong className="block text-sm text-amber-200">{ranges.length}</strong>
              <span className="text-[10px] uppercase text-stone-500" style={{ letterSpacing: '0.12em' }}>Eras</span>
            </div>
            <div className="min-w-[82px] bg-black/25 px-3 py-2">
              <strong className="block text-sm text-amber-200">{span.toLocaleString()}</strong>
              <span className="text-[10px] uppercase text-stone-500" style={{ letterSpacing: '0.12em' }}>Years</span>
            </div>
          </div>
        </div>
      </header>

      <div className="border-b border-amber-900/30 bg-stone-950/55 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-stone-700 bg-black/30 px-3 text-stone-300 focus-within:border-amber-600 xl:w-72 xl:shrink-0">
            <Search size={16} className="shrink-0 text-stone-500" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the chronicle"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-stone-600"
              aria-label="Search chronicle events"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-stone-500 hover:text-stone-200" aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </label>

          <div className="flex min-w-0 flex-1 flex-wrap gap-2" aria-label="Filter by era">
            <button
              type="button"
              onClick={() => setActiveRangeId(null)}
              className={`min-h-10 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                activeRangeId === null
                  ? 'border-amber-500/70 bg-amber-950/55 text-amber-100'
                  : 'border-stone-700 bg-black/20 text-stone-400 hover:border-stone-500 hover:text-stone-200'
              }`}
            >
              All eras
            </button>
            {ranges.map((range) => {
              const selected = activeRangeId === range.id;
              const color = safeColor(range.color);
              return (
                <button
                  key={range.id}
                  type="button"
                  onClick={() => setActiveRangeId(selected ? null : range.id)}
                  className={`min-h-10 rounded-md border px-3 py-1.5 text-left transition-colors ${
                    selected ? 'bg-stone-800 text-white' : 'border-stone-700 bg-black/20 text-stone-300 hover:border-stone-500'
                  }`}
                  style={{ borderColor: selected ? color : undefined }}
                >
                  <span className="block text-xs font-semibold" style={{ fontFamily: "'Cinzel', serif" }}>{range.label}</span>
                  <span className="block text-[10px] text-stone-500">{range.start}–{range.end}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="px-4 py-7 sm:px-6 lg:px-8">
        {groups.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center border-y border-stone-800 py-10 text-center">
            <CalendarRange size={26} className="text-stone-600" aria-hidden="true" />
            <p className="mt-3 text-sm text-stone-400">No chronicle events match this view.</p>
            <button
              type="button"
              onClick={() => { setQuery(''); setActiveRangeId(null); }}
              className="mt-3 text-xs text-amber-400 hover:text-amber-200"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div>
            {eraSections.map((eraSection, eraSectionIndex) => {
              const eraColor = safeColor(eraSection.range?.color);
              const eraEventCount = eraSection.groups.reduce((total, group) => total + group.events.length, 0);
              const firstYear = eraSection.groups[0]?.year ?? 0;
              const lastYear = eraSection.groups[eraSection.groups.length - 1]?.year ?? firstYear;
              return (
                <section
                  key={`${eraSection.id}-${eraSectionIndex}`}
                  className="grid border-t border-stone-800/70 first:border-t-0 lg:grid-cols-[165px_minmax(0,1fr)]"
                >
                  <aside
                    className="border-l-4 bg-black/20 px-4 py-4 lg:px-5 lg:py-6"
                    style={{ borderLeftColor: eraColor }}
                  >
                    <div className="lg:sticky lg:top-4">
                      <span className="block text-[10px] uppercase text-stone-500" style={{ letterSpacing: '0.16em' }}>
                        Era
                      </span>
                      <h3 className="mt-1 text-sm font-semibold leading-snug" style={{ color: eraColor, fontFamily: "'Cinzel', serif" }}>
                        {eraSection.range?.label ?? 'Uncharted Years'}
                      </h3>
                      <p className="mt-2 text-[11px] text-stone-500">
                        {eraSection.range ? `${eraSection.range.start}–${eraSection.range.end}` : `${firstYear}–${lastYear}`}
                      </p>
                      <p className="mt-1 text-[10px] uppercase text-stone-600" style={{ letterSpacing: '0.1em' }}>
                        {eraEventCount} {eraEventCount === 1 ? 'event' : 'events'}
                      </p>
                    </div>
                  </aside>

                  <div className="relative px-0 py-5">
                    <div className="absolute bottom-0 left-[7px] top-0 border-l border-dashed border-amber-700/55 sm:left-[127px]" aria-hidden="true" />
                    {eraSection.groups.map((group) => {
                      const groupIndex = groupIndexByYear.get(group.year) ?? 0;
                      const previousYear = groups[groupIndex - 1]?.year;
                      const yearDifference = previousYear === undefined ? 0 : group.year - previousYear;
                      const spacing = groupIndex === 0 ? 0 : getTimelineYearGap(yearDifference);
                      return (
                        <div key={group.year} className="relative pl-9 sm:pl-[158px]" style={{ paddingTop: spacing }}>
                          {yearDifference > 1 && (
                            <span
                              className="absolute left-5 z-10 -translate-y-1/2 rounded border border-stone-700 bg-[#100f0d] px-2 py-1 text-[9px] uppercase text-stone-500 sm:left-[140px]"
                              style={{ top: Math.max(14, spacing / 2), letterSpacing: '0.08em' }}
                            >
                              {yearDifference.toLocaleString()} years later
                            </span>
                          )}
                          <div className="absolute left-0 top-[1px] hidden w-[108px] text-right sm:block" style={{ marginTop: spacing }}>
                            <strong className="block text-base text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>{group.year}</strong>
                          </div>
                          <span
                            className="absolute left-0 top-[7px] h-[15px] w-[15px] rounded-full border-2 border-[#100f0d] bg-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.45)] sm:left-[120px]"
                            style={{ marginTop: spacing }}
                            aria-hidden="true"
                          />
                          <div className="mb-2 flex items-center gap-2 sm:hidden">
                            <strong className="text-sm text-amber-200" style={{ fontFamily: "'Cinzel', serif" }}>{group.year}</strong>
                          </div>

                          <div className="space-y-3">
                            {group.events.map((event) => {
                              const color = safeColor(event.color);
                              const eventRanges = ranges.filter(range => matchesRange(event, range));
                              const titleClass = event.size === 'lg' && !event.image ? 'text-lg' : event.size === 'sm' ? 'text-sm' : 'text-base';
                              return (
                                <article
                                  key={event.id}
                                  className={`overflow-hidden rounded-lg border border-stone-800 bg-[#171615] shadow-[0_8px_24px_rgba(0,0,0,0.16)] ${
                                    event.image ? 'grid md:grid-cols-[minmax(160px,30%)_minmax(0,1fr)]' : ''
                                  }`}
                                  style={{ borderLeftWidth: 3, borderLeftColor: color }}
                                >
                                  {event.image && (
                                    <TimelineImage
                                      src={event.image}
                                      alt={event.imageAlt || event.title}
                                      onOpen={setSelectedImage}
                                      eventPreview
                                    />
                                  )}
                                  <div className="min-w-0 p-4 sm:p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <h3 className={`break-words font-semibold leading-snug ${titleClass}`} style={{ color, fontFamily: "'Cinzel', serif" }}>
                                          {event.title}
                                        </h3>
                                        {(eventRanges.length > 0 || (event.tags?.length ?? 0) > 0) && (
                                          <div className="mt-2 flex flex-wrap gap-1.5">
                                            {eventRanges.map(range => (
                                              <button
                                                key={range.id}
                                                type="button"
                                                onClick={() => setActiveRangeId(range.id)}
                                                className="rounded border border-stone-700 bg-black/25 px-2 py-1 text-[10px] uppercase text-stone-400 hover:text-stone-200"
                                                style={{ letterSpacing: '0.08em' }}
                                              >
                                                {range.label}
                                              </button>
                                            ))}
                                            {(event.tags ?? []).map(tag => (
                                              <span key={tag} className="rounded border border-cyan-950/80 bg-cyan-950/25 px-2 py-1 text-[10px] text-cyan-300/80">
                                                {tag}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <span className="rounded border border-amber-900/40 bg-black/30 px-2 py-1 text-[10px] text-amber-500 sm:hidden">
                                        {event.year}
                                      </span>
                                    </div>

                                    {event.description && <div className="mt-3"><TimelineMarkdown value={event.description} onOpenImage={setSelectedImage} /></div>}

                                    {event.goChapter && (
                                      <button
                                        type="button"
                                        onClick={() => handleEventClick(event)}
                                        className="mt-4 inline-flex items-center gap-1.5 border-t border-amber-900/25 pt-3 text-xs font-semibold text-amber-400 hover:text-amber-200"
                                      >
                                        Open chapter
                                        <ChevronRight size={14} aria-hidden="true" />
                                      </button>
                                    )}
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

      {selectedImage && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={selectedImage.alt}
          onClick={() => setSelectedImage(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-md border border-white/15 bg-black/65 text-white hover:bg-stone-800"
            onClick={() => setSelectedImage(null)}
            aria-label="Close image"
          >
            <X size={20} />
          </button>
          <img
            src={selectedImage.src}
            alt={selectedImage.alt}
            referrerPolicy="no-referrer"
            className="max-h-[92vh] max-w-[94vw] object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};
