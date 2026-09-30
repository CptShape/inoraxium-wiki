import YAML from 'yaml';
import { ParsedMarkdownContent, TimelineEvent, TimelineFrontmatter, TimelineRange } from '../types';

export const parseMarkdownContent = (text: string): ParsedMarkdownContent => {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = text.match(frontmatterRegex);
  
  if (!match) {
    return {
      frontmatter: {},
      body: text,
    };
  }
  
  const yamlContent = match[1];
  const body = match[2];
  
  try {
    const frontmatter = YAML.parse(yamlContent) as Record<string, unknown>;
    return { 
      frontmatter: frontmatter ?? {}, 
      body 
    };
  } catch {
    return { frontmatter: {}, body };
  }
};

export const isTimelineFrontmatter = (
  frontmatter: Record<string, unknown>
): boolean => {
  if (frontmatter.pageType === 'timeline') return true;
  if (frontmatter.timeline === true) return true;
  return false;
};

export const getTimelineConfig = (
  frontmatter: Record<string, unknown>
): TimelineFrontmatter | null => {
  if (!isTimelineFrontmatter(frontmatter)) return null;

  if (!Array.isArray(frontmatter.events)) return null;

  const finiteNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const text = (value: unknown): string | undefined => (
    typeof value === 'string' && value.trim() ? value.trim() : undefined
  );
  const record = (value: unknown): Record<string, unknown> | null => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  );
  const uniqueId = (candidate: string, used: Set<string>): string => {
    const base = candidate || 'timeline-entry';
    let resolved = base;
    let suffix = 2;
    while (used.has(resolved)) resolved = `${base}-${suffix++}`;
    used.add(resolved);
    return resolved;
  };

  const eventIds = new Set<string>();
  const events = frontmatter.events.flatMap((value, index): TimelineEvent[] => {
    const source = record(value);
    const year = finiteNumber(source?.year);
    if (!source || year === null) return [];

    const rawSize = text(source.size);
    const size = rawSize === 'sm' || rawSize === 'md' || rawSize === 'lg' ? rawSize : undefined;
    const tags = Array.isArray(source.tags)
      ? [...new Set(source.tags.map(text).filter((tag): tag is string => Boolean(tag)))]
      : undefined;
    const fallbackId = `event-${year}-${index + 1}`;

    return [{
      id: uniqueId(text(source.id) || fallbackId, eventIds),
      year,
      title: text(source.title) || 'Untitled event',
      description: text(source.description),
      image: text(source.image),
      imageAlt: text(source.imageAlt),
      tags: tags?.length ? tags : undefined,
      color: text(source.color),
      size,
      goChapter: text(source.goChapter),
      goChapterPart: text(source.goChapterPart),
    }];
  });

  const rangeIds = new Set<string>();
  const ranges = (Array.isArray(frontmatter.ranges) ? frontmatter.ranges : []).flatMap((value, index): TimelineRange[] => {
    const source = record(value);
    const first = finiteNumber(source?.start);
    const second = finiteNumber(source?.end);
    if (!source || first === null || second === null) return [];
    const start = Math.min(first, second);
    const end = Math.max(first, second);
    return [{
      id: uniqueId(text(source.id) || `era-${start}-${index + 1}`, rangeIds),
      label: text(source.label) || 'Unnamed era',
      start,
      end,
      color: text(source.color),
    }];
  });

  const explicitStart = finiteNumber(frontmatter.startYear);
  const explicitEnd = finiteNumber(frontmatter.endYear);
  const knownYears = [
    ...events.map(event => event.year),
    ...ranges.flatMap(range => [range.start, range.end]),
  ];
  const startYear = explicitStart ?? (knownYears.length ? Math.min(0, ...knownYears) : 0);
  const derivedEnd = knownYears.length ? Math.max(startYear, ...knownYears) : startYear;
  const endYear = Math.max(startYear, explicitEnd ?? derivedEnd);
  const rawScale = finiteNumber(frontmatter.scale) ?? 10;

  return {
    pageType: 'timeline',
    timeline: true,
    startYear,
    endYear,
    scale: Math.min(100, Math.max(1, rawScale)),
    events,
    ranges,
  };
};
