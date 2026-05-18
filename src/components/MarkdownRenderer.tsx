import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { Chapter } from '../types';
import { getTimelineConfig, parseMarkdownContent } from '../utils/markdownContent';
import { TimelinePage } from './TimelinePage';
import Infobox, { InfoboxData, parseInfoboxMarkup, renderInfoboxRichText } from './Infobox';

export interface PartInfo {
  id: string;
  label: string;
}

interface MarkdownRendererProps {
  /**
   * Either:
   * - inline markdown text
   * - or a source-relative .md path such as "src/data/chapters/kinships/elves/sun-elves.md"
   */
  path: string;
  /** Called after the markdown renders and [data-part] anchors are found in the DOM */
  onPartsFound?: (parts: PartInfo[]) => void;
  /** Forwarded ref so the parent can scroll into this container */
  contentRef?: React.RefObject<HTMLDivElement | null>;
  /** Called when a cross-chapter link (data-go-chapter) is clicked */
  onCrossChapterLink?: (chapterId: string, partId?: string) => void;
  /** Full chapter tree for timeline event navigation */
  allChapters?: Chapter[];
  /** Standard chapter selection callback */
  onChapterSelect?: (chapterId: string, path?: string[] | null) => void;
  /** Optional asset preview map used by the page editor */
  assetMap?: Record<string, string>;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; text: string };

const markdownModules = (import.meta as any).glob(
  ['../data/**/*.md'],
  { query: '?raw', import: 'default' }
);

const imageModules = (import.meta as any).glob(
  ['../**/*.{png,jpg,jpeg,webp,avif,gif,svg}'],
  { eager: true, import: 'default' }
) as Record<string, string>;

const normalizeMarkdownPath = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('src/')) {
    return `../${trimmed.slice('src/'.length)}`;
  }
  if (trimmed.startsWith('../data/')) {
    return trimmed;
  }
  return trimmed;
};

const looksLikeMarkdownFilePath = (value: string) => {
  const trimmed = value.trim();
  return trimmed.endsWith('.md') && !trimmed.includes('\n');
};

const devMarkdownUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('src/')) {
    return null;
  }

  const basePath = `/${trimmed}`;
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}raw`;
};

type MarkdownSegment =
  | { type: 'markdown'; content: string }
  | { type: 'infobox'; markup: string };

const TableStyleContext = React.createContext(false);

const splitMarkdownWithInfoboxes = (source: string): MarkdownSegment[] => {
  const segments: MarkdownSegment[] = [];
  const pattern = /<infobox\b[\s\S]*?<\/infobox>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'markdown',
        content: source.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'infobox',
      markup: match[0],
    });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < source.length) {
    segments.push({
      type: 'markdown',
      content: source.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: 'markdown', content: source }];
};

const slugifyLinkTarget = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const preprocessWikiSyntax = (source: string) => {
  let next = source.replace(/!\[\[([^\]]+)\]\]/g, (_match, target) => {
    const trimmed = String(target).trim();
    return `<img src="${trimmed}" alt="${trimmed}" />`;
  });

  next = next.replace(/\[\[([^\]|#]+?)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g, (_match, rawTarget, rawPart, rawAlias) => {
    const target = slugifyLinkTarget(String(rawTarget));
    const part = rawPart ? String(rawPart).trim() : '';
    const alias = rawAlias ? String(rawAlias).trim() : String(rawTarget).trim();

    return `<a href="#" data-go-chapter="${target}"${part ? ` data-go-chapter-part="${part}"` : ''}>${alias}</a>`;
  });

  next = next.replace(/\|\|(.+?)\|\|/g, (_match, content) => `<spoiler-text>${content}</spoiler-text>`);

  return next;
};

const resolveContentAssetPath = (
  value?: string,
  assetMap?: Record<string, string>,
  currentMarkdownPath?: string
) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (assetMap?.[trimmed]) return assetMap[trimmed];
  if (/^(https?:)?\/\//.test(trimmed) || trimmed.startsWith('/')) return trimmed;
  if (trimmed.startsWith('src/')) {
    const normalized = `../${trimmed.slice('src/'.length)}`;
    return imageModules[normalized] ?? trimmed;
  }
  if (currentMarkdownPath && trimmed.startsWith('assets/')) {
    const pageDirectory = currentMarkdownPath.slice(0, currentMarkdownPath.lastIndexOf('/'));
    const siblingAssetPath = `${pageDirectory}/${trimmed}`;
    if (imageModules[siblingAssetPath]) {
      return imageModules[siblingAssetPath];
    }
    const workspaceDirectory = pageDirectory.slice(0, pageDirectory.lastIndexOf('/'));
    const workspaceAssetPath = `${workspaceDirectory}/${trimmed}`;
    if (imageModules[workspaceAssetPath]) {
      return imageModules[workspaceAssetPath];
    }
  }
  const basename = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  const basenameMatches = Object.entries(imageModules).filter(([modulePath]) => modulePath.endsWith(`/${basename}`));
  if (basenameMatches.length === 1) {
    return basenameMatches[0][1];
  }
  return imageModules[trimmed] ?? trimmed;
};

const RESERVED_FRONTMATTER_KEYS = new Set([
  'title',
  'subtitle',
  'image',
  'layout',
  'infobox',
  'tags',
  'id',
  'system',
  'parentId',
  'sidebarVisible',
  'hiddenButLinkable',
  'order',
  'width',
  'folder',
  'pageType',
  'timeline',
  'startYear',
  'endYear',
  'scale',
  'events',
  'ranges',
]);

const stringifyFrontmatterValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => stringifyFrontmatterValue(item)).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value);
};

const normalizeFrontmatterImages = (value: unknown): InfoboxData['image'] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (Array.isArray(item) && item.length > 0) {
          return {
            src: String(item[0]),
            caption: item.length > 1 ? String(item[1]) : undefined,
          };
        }
        if (item && typeof item === 'object') {
          const typedItem = item as Record<string, unknown>;
          if (typeof typedItem.src === 'string') {
            return {
              src: typedItem.src,
              caption: typeof typedItem.caption === 'string' ? typedItem.caption : undefined,
            };
          }
          if (typeof typedItem.path === 'string') {
            return {
              src: typedItem.path,
              caption: typeof typedItem.caption === 'string' ? typedItem.caption : undefined,
            };
          }
        }
        return String(item);
      })
      .filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return undefined;
};

const buildInfoboxFromFrontmatter = (frontmatter: Record<string, unknown>): InfoboxData | null => {
  if (frontmatter.infobox === false) {
    return null;
  }

  const title = typeof frontmatter.title === 'string' && frontmatter.title.trim()
    ? frontmatter.title.trim()
    : null;

  const layoutRules = Array.isArray(frontmatter.layout) ? frontmatter.layout : [];
  const aliasMap = new Map<string, string>();
  const headerAboveMap = new Map<string, string>();
  const headerBelowMap = new Map<string, string>();
  const groupRules: Array<{ keys: string[] }> = [];

  layoutRules.forEach((rule) => {
    if (!rule || typeof rule !== 'object') return;
    const typedRule = rule as Record<string, unknown>;
    if (typedRule.type === 'alias' && Array.isArray(typedRule.keys) && typeof typedRule.text === 'string') {
      typedRule.keys.forEach((key) => aliasMap.set(String(key), typedRule.text as string));
    }
    if (typedRule.type === 'group' && Array.isArray(typedRule.keys)) {
      groupRules.push({
        keys: typedRule.keys.map((key) => String(key)),
      });
    }
    if (typedRule.type === 'header' && typeof typedRule.text === 'string') {
      if (typeof typedRule.above === 'string') {
        headerAboveMap.set(typedRule.above, typedRule.text);
      }
      if (typeof typedRule.below === 'string') {
        headerBelowMap.set(typedRule.below, typedRule.text);
      }
    }
  });

  const fieldEntries = Object.entries(frontmatter)
    .filter(([key]) => !RESERVED_FRONTMATTER_KEYS.has(key))
    .map(([key, value]) => ({
      key,
      label: aliasMap.get(key) || key.replace(/[_-]+/g, ' '),
      value: preprocessWikiSyntax(stringifyFrontmatterValue(value)),
    }))
    .filter((entry) => entry.value.trim().length > 0);
  const fieldEntryMap = new Map(fieldEntries.map((entry) => [entry.key, entry]));
  const consumedKeys = new Set<string>();

  if (!title && fieldEntries.length === 0 && !frontmatter.image) {
    return null;
  }

  const defaultSectionTitle =
    typeof frontmatter.infobox === 'string' && frontmatter.infobox.trim() ? frontmatter.infobox.trim() : 'Overview';
  const sections: InfoboxData['sections'] = [];
  let currentSection: InfoboxData['sections'][number] = {
    title: defaultSectionTitle,
    color: 'rgb(var(--theme-700-rgb) / 0.92)',
    titleColor: '#ffffff',
    entryBackgroundColor: '#ffffff',
    labelColor: '#000000',
    valueColor: '#000000',
    defaultOpen: true,
    entries: [],
  };

  const pushSectionIfNeeded = () => {
    if (currentSection.entries.length > 0) {
      sections.push(currentSection);
    }
  };

  fieldEntries.forEach((entry) => {
    if (consumedKeys.has(entry.key)) {
      return;
    }

    const aboveHeader = headerAboveMap.get(entry.key);
    if (aboveHeader) {
      pushSectionIfNeeded();
      currentSection = { ...currentSection, title: aboveHeader, entries: [] };
    }

    const matchingGroup = groupRules.find((rule) => rule.keys.includes(entry.key) && rule.keys.every((key) => fieldEntryMap.has(key)));

    if (matchingGroup) {
      currentSection.entries.push({
        label: '',
        value: '',
        columns: matchingGroup.keys.map((key) => {
          const groupEntry = fieldEntryMap.get(key)!;
          return {
            label: groupEntry.label,
            value: groupEntry.value,
          };
        }),
      });
      matchingGroup.keys.forEach((key) => consumedKeys.add(key));
    } else {
      currentSection.entries.push({
        label: entry.label,
        value: entry.value,
      });
      consumedKeys.add(entry.key);
    }

    const belowHeader = headerBelowMap.get(entry.key);
    if (belowHeader) {
      pushSectionIfNeeded();
      currentSection = { ...currentSection, title: belowHeader, entries: [] };
    }
  });

  pushSectionIfNeeded();

  return {
    title: preprocessWikiSyntax(title || 'Untitled Page'),
    image: normalizeFrontmatterImages(frontmatter.image),
    titleTextColor: '#ffffff',
    sections,
  };
};

// ── Helper: check if an element has a custom class from raw HTML ──────────────
const hasCustomClass = (className?: string): boolean => {
  return !!className && className.trim().length > 0;
};

// ── Component overrides factory ─────────────────────────────────────────────
// Creates component overrides with access to the cross-chapter link callback.
const createComponents = (
  onCrossChapterLink?: (chapterId: string, partId?: string) => void,
  assetMap?: Record<string, string>,
  currentMarkdownPath?: string
): Components & Record<string, React.ElementType> => ({
  h1: ({ children, className, ...props }) => (
    <h1
      className={hasCustomClass(className) ? className! : "text-4xl font-bold text-amber-300 mt-8 mb-4 leading-tight"}
      style={hasCustomClass(className) ? undefined : { fontFamily: "'Cinzel', serif" }}
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, className, ...props }) => (
    <h2
      className={hasCustomClass(className) ? className! : "text-3xl font-bold text-amber-300 mt-7 mb-3 leading-snug"}
      style={hasCustomClass(className) ? undefined : { fontFamily: "'Cinzel', serif" }}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }) => (
    <h3
      className={hasCustomClass(className) ? className! : "text-2xl font-semibold text-amber-400 mt-6 mb-3"}
      style={hasCustomClass(className) ? undefined : { fontFamily: "'Cinzel', serif" }}
      {...props}
    >
      {children}
    </h3>
  ),
  h4: ({ children, className, ...props }) => (
    <h4
      className={hasCustomClass(className) ? className! : "text-xl font-semibold text-amber-400 mt-5 mb-2"}
      style={hasCustomClass(className) ? undefined : { fontFamily: "'Cinzel', serif" }}
      {...props}
    >
      {children}
    </h4>
  ),
  h5: ({ children, className, ...props }) => (
    <h5
      className={hasCustomClass(className) ? className! : "text-lg font-semibold text-amber-500 mt-4 mb-2"}
      style={hasCustomClass(className) ? undefined : { fontFamily: "'Cinzel', serif" }}
      {...props}
    >
      {children}
    </h5>
  ),
  h6: ({ children, className, ...props }) => (
    <h6
      className={hasCustomClass(className) ? className! : "text-base font-semibold text-amber-500 mt-3 mb-1"}
      style={hasCustomClass(className) ? undefined : { fontFamily: "'Cinzel', serif" }}
      {...props}
    >
      {children}
    </h6>
  ),
  p: ({ children, className, ...props }) => (
    <p className={hasCustomClass(className) ? className! : "text-amber-100 leading-relaxed mb-3"} {...props}>
      {children}
    </p>
  ),
  strong: ({ children, className, ...props }) => (
    <strong className={hasCustomClass(className) ? className! : "text-amber-300 font-bold"} {...props}>
      {children}
    </strong>
  ),
  em: ({ children, className, ...props }) => (
    <em className={hasCustomClass(className) ? className! : "text-amber-400 italic"} {...props}>
      {children}
    </em>
  ),
  a: ({ href, children, className, ...props }: any) => {
    const goChapter = props['data-go-chapter'];
    const goChapterPart = props['data-go-chapter-part'];

    if (goChapter && onCrossChapterLink) {
      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCrossChapterLink(goChapter, goChapterPart || undefined);
          }}
          className={hasCustomClass(className) ? className! : "text-amber-400 underline hover:text-amber-200 transition-colors cursor-pointer"}
          {...props}
        >
          {children}
        </a>
      );
    }

    return (
      <a
        href={href}
        className={hasCustomClass(className) ? className! : "text-amber-400 underline hover:text-amber-200 transition-colors"}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  code: ({ children, className, ...props }) => {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <pre className="bg-stone-900 border border-amber-900/40 rounded-lg p-4 my-4 overflow-x-auto">
          <code className={`text-amber-200 text-sm font-mono ${className ?? ''}`} {...props}>{children}</code>
        </pre>
      );
    }
    return (
      <code
        className={hasCustomClass(className) ? className! : "bg-stone-800 text-amber-300 rounded px-1.5 py-0.5 text-sm font-mono"}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
  ul: ({ children, className, ...props }) => (
    <ul className={hasCustomClass(className) ? className! : "list-disc list-inside space-y-1 mb-3 text-amber-100 ml-4"} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }) => (
    <ol className={hasCustomClass(className) ? className! : "list-decimal list-inside space-y-1 mb-3 text-amber-100 ml-4"} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li className={hasCustomClass(className) ? className! : "text-amber-100 leading-relaxed"} {...props}>
      {children}
    </li>
  ),
  hr: () => <hr className="border-t-2 border-amber-800/50 my-6" />,
  blockquote: ({ children, className, ...props }) => (
    <blockquote
      className={hasCustomClass(className) ? className! : "border-l-4 border-amber-600 pl-4 my-4 italic text-amber-300 bg-amber-950/20 py-2 pr-2 rounded-r"}
      {...props}
    >
      {children}
    </blockquote>
  ),

  // ── Table components ─────────────────────────────────────────────────────
  table: ({ children, className, ...props }) => {
    if (hasCustomClass(className)) {
      return (
        <div className="overflow-x-auto my-4">
          <TableStyleContext.Provider value={true}>
            <table className={className!} {...props}>{children}</table>
          </TableStyleContext.Provider>
        </div>
      );
    }
    return (
      <div className="overflow-x-auto my-4">
        <TableStyleContext.Provider value={false}>
          <table className="w-full border-collapse text-sm" {...props}>{children}</table>
        </TableStyleContext.Provider>
      </div>
    );
  },
  thead: ({ children, className, ...props }) => {
    const isCustomTable = React.useContext(TableStyleContext);
    const resolvedClassName = hasCustomClass(className)
      ? className!
      : isCustomTable
        ? undefined
        : "bg-amber-900/40";

    return <thead className={resolvedClassName} {...props}>{children}</thead>;
  },
  tbody: ({ children, className, ...props }) => {
    const isCustomTable = React.useContext(TableStyleContext);
    const resolvedClassName = hasCustomClass(className)
      ? className!
      : isCustomTable
        ? undefined
        : "divide-y divide-amber-900/30";

    return <tbody className={resolvedClassName} {...props}>{children}</tbody>;
  },
  tr: ({ children, className, ...props }) => {
    const isCustomTable = React.useContext(TableStyleContext);
    const resolvedClassName = hasCustomClass(className)
      ? className!
      : isCustomTable
        ? undefined
        : "hover:bg-amber-900/10 transition-colors";

    return <tr className={resolvedClassName} {...props}>{children}</tr>;
  },
  th: ({ children, className, ...props }) => {
    const isCustomTable = React.useContext(TableStyleContext);
    const resolvedClassName = hasCustomClass(className)
      ? className!
      : isCustomTable
        ? undefined
        : "text-left text-amber-300 font-bold px-3 py-2 border-b-2 border-amber-700/50";

    return (
      <th
        className={resolvedClassName}
        style={hasCustomClass(className) || isCustomTable ? undefined : { fontFamily: "'Cinzel', serif" }}
        {...props}
      >
        {children}
      </th>
    );
  },
  td: ({ children, className, ...props }) => {
    const isCustomTable = React.useContext(TableStyleContext);
    const resolvedClassName = hasCustomClass(className)
      ? className!
      : isCustomTable
        ? undefined
        : "text-amber-100 px-3 py-2";

    return <td className={resolvedClassName} {...props}>{children}</td>;
  },
  img: ({ src, alt, className, ...props }) => (
    <img
      src={resolveContentAssetPath(src, assetMap, currentMarkdownPath)}
      alt={alt ?? ''}
      className={className ?? 'my-4 rounded-lg max-w-full'}
      {...props}
    />
  ),
  'spoiler-text': ({ children }) => {
    const [revealed, setRevealed] = React.useState(false);
    return (
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        className={`rounded px-1.5 py-0.5 transition-colors ${revealed ? 'bg-stone-700 text-amber-100' : 'bg-stone-950 text-stone-950 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)]'}`}
      >
        {children}
      </button>
    );
  },

  // ── Generic elements ─────────────────────────────────────────────────────
  div: ({ className, children, ...props }) => (
    <div className={className ?? ''} {...props}>
      {children}
    </div>
  ),
  span: ({ className, children, ...props }) => (
    <span className={className ?? ''} {...props}>
      {children}
    </span>
  ),
  section: ({ className, children, ...props }) => (
    <section className={className ?? ''} {...props}>
      {children}
    </section>
  ),
});

const createInfoboxComponents = (
  onCrossChapterLink?: (chapterId: string, partId?: string) => void,
  assetMap?: Record<string, string>,
  currentMarkdownPath?: string
): Components => ({
  p: ({ children, className, ...props }) => (
    <p className={className ?? 'mb-0 text-inherit leading-relaxed'} {...props}>
      {children}
    </p>
  ),
  strong: ({ children, className, ...props }) => (
    <strong className={className ?? 'font-bold text-inherit'} {...props}>
      {children}
    </strong>
  ),
  em: ({ children, className, ...props }) => (
    <em className={className ?? 'italic text-inherit'} {...props}>
      {children}
    </em>
  ),
  ul: ({ children, className, ...props }) => (
    <ul className={className ?? 'mb-0 list-disc pl-4 text-inherit'} {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, className, ...props }) => (
    <ol className={className ?? 'mb-0 list-decimal pl-4 text-inherit'} {...props}>
      {children}
    </ol>
  ),
  li: ({ children, className, ...props }) => (
    <li className={className ?? 'text-inherit'} {...props}>
      {children}
    </li>
  ),
  a: ({ href, children, className, ...props }: any) => {
    const goChapter = props['data-go-chapter'];
    const goChapterPart = props['data-go-chapter-part'];

    if (goChapter && onCrossChapterLink) {
      return (
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCrossChapterLink(goChapter, goChapterPart || undefined);
          }}
          className={className ?? 'underline transition-colors cursor-pointer text-inherit'}
          {...props}
        >
          {children}
        </a>
      );
    }

    return (
      <a
        href={href}
        className={className ?? 'underline transition-colors text-inherit'}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt, className, ...props }) => (
    <img
      src={resolveContentAssetPath(src, assetMap, currentMarkdownPath)}
      alt={alt ?? ''}
      className={className ?? 'my-2 rounded-lg max-w-full'}
      {...props}
    />
  ),
});

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  path,
  onPartsFound,
  contentRef,
  onCrossChapterLink,
  allChapters = [],
  onChapterSelect,
  assetMap,
}) => {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const normalizedPath = useMemo(() => normalizeMarkdownPath(path), [path]);
  const internalRef = useRef<HTMLDivElement>(null);
  const divRef = (contentRef ?? internalRef) as React.RefObject<HTMLDivElement | null>;

  // Memoize components so they only recreate when the callback changes
  const components = useMemo(
    () => createComponents(onCrossChapterLink, assetMap, normalizedPath),
    [assetMap, normalizedPath, onCrossChapterLink]
  );
  const infoboxComponents = useMemo(
    () => createInfoboxComponents(onCrossChapterLink, assetMap, normalizedPath),
    [assetMap, normalizedPath, onCrossChapterLink]
  );

  // Load the markdown file or use inline text
  useEffect(() => {
    if (!path?.trim()) {
      setState({ status: 'error', message: 'No content provided.' });
      return;
    }

    if (!looksLikeMarkdownFilePath(path)) {
      setState({ status: 'success', text: path });
      return;
    }

    const loader = markdownModules[normalizedPath] as undefined | (() => Promise<string>);

    if (!loader) {
      setState({
        status: 'error',
        message: `Could not resolve markdown file: ${path}`,
      });
      return;
    }

    setState({ status: 'loading' });

    if (import.meta.env.DEV) {
      const sourceUrl = devMarkdownUrl(path);

      if (sourceUrl) {
        fetch(sourceUrl, { cache: 'no-store' })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`Failed to fetch ${path}: ${response.status}`);
            }

            return response.text();
          })
          .then((text) => setState({ status: 'success', text }))
          .catch((error: Error) => {
            setState({ status: 'error', message: error.message || `Failed to load ${path}` });
          });
        return;
      }
    }

    loader()
      .then((text) => setState({ status: 'success', text }))
      .catch((error: Error) => {
        setState({ status: 'error', message: error.message || `Failed to load ${path}` });
      });
  }, [path, normalizedPath]);

  const parsedContent = useMemo(() => {
    if (state.status !== 'success') return null;
    return parseMarkdownContent(state.text);
  }, [state]);

  const timelineConfig = useMemo(() => {
    if (!parsedContent) return null;
    return getTimelineConfig(parsedContent.frontmatter);
  }, [parsedContent]);

  const contentSegments = useMemo(() => {
    if (state.status !== 'success') return [];
    return splitMarkdownWithInfoboxes(preprocessWikiSyntax(parsedContent?.body ?? state.text));
  }, [parsedContent, state]);

  const frontmatterInfobox = useMemo(() => {
    if (!parsedContent) return null;
    return buildInfoboxFromFrontmatter(parsedContent.frontmatter);
  }, [parsedContent]);

  // After the markdown has rendered into the DOM, find [data-part] anchors.
  // Timeline pages do not use the in-page part navigator for now.
  useEffect(() => {
    if (state.status !== 'success') return;
    if (!onPartsFound) return;

    if (timelineConfig) {
      onPartsFound([]);
      return;
    }

    const timer = setTimeout(() => {
      if (!divRef.current) return;
      const elements = Array.from(divRef.current.querySelectorAll('[data-part]'));
      const parts: PartInfo[] = elements.map((el) => ({
        id: el.getAttribute('data-part') ?? '',
        label: el.textContent?.trim() ?? '',
      }));
      onPartsFound(parts);
    }, 80);

    return () => clearTimeout(timer);
  }, [state, onPartsFound, timelineConfig]);

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-20 text-amber-400 animate-pulse">
        <span style={{ fontFamily: "'Cinzel', serif" }}>Loading ancient scrolls…</span>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="bg-red-950/30 border border-red-800/50 rounded-lg p-6 my-4 text-red-300">
        <p className="font-bold mb-1" style={{ fontFamily: "'Cinzel', serif" }}>
          ⚠ Scroll Not Found
        </p>
        <p className="text-sm font-mono">{state.message}</p>
        <p className="text-xs text-red-400 mt-2">
          Use a source-relative path like{' '}
          <code className="bg-red-900/30 px-1 rounded">src/data/chapters/kinships/elves/sun-elves.md</code> or pass inline markdown directly.
        </p>
      </div>
    );
  }

  if (timelineConfig) {
    return (
      <div ref={divRef}>
        <TimelinePage
          config={timelineConfig}
          allChapters={allChapters}
          onChapterSelect={onChapterSelect}
        />
      </div>
    );
  }

  return (
    <div ref={divRef}>
      {frontmatterInfobox && (
        <Infobox
          data={frontmatterInfobox}
          assetMap={assetMap}
          pagePath={normalizedPath}
          renderRichText={(content, className) => renderInfoboxRichText(preprocessWikiSyntax(content), infoboxComponents, className)}
        />
      )}
      {contentSegments.map((segment, index) => {
        if (segment.type === 'infobox') {
          const infoboxData = parseInfoboxMarkup(segment.markup);
          if (!infoboxData) {
            return null;
          }

          return (
            <Infobox
              key={`infobox-${index}`}
              data={infoboxData}
              assetMap={assetMap}
              pagePath={normalizedPath}
              renderRichText={(content, className) => renderInfoboxRichText(content, infoboxComponents, className)}
            />
          );
        }

        if (!segment.content.trim()) {
          return null;
        }

        return (
          <ReactMarkdown
            key={`markdown-${index}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={components}
          >
            {segment.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};

export default MarkdownRenderer;
