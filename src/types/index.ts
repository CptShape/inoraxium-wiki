// Recursive Chapter interface for infinite nesting
export interface Chapter {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  // Either inline markdown text or a source-relative .md path,
  // e.g. "src/data/chapters/kinships/elves/sun-elves.md"
  // Markdown files support GitHub-flavored markdown and inline HTML.
  content: string;
  subChapters?: Chapter[]; // Recursive - sub-chapters are also Chapter type
  prevChapter?: string;
  nextChapter?: string;
  // Width percentage for the content container (1 = 100%, 0.5 = 50%)
  // Defaults to 0.5
  width?: number;
}

export interface TimelineEvent {
  id: string;
  year: number;
  title: string;
  description?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  goChapter?: string;
  goChapterPart?: string;
}

export interface TimelineRange {
  id: string;
  label: string;
  start: number;
  end: number;
  color?: string;
}

export interface TimelineFrontmatter {
  pageType?: 'timeline';
  timeline?: boolean;
  startYear?: number;
  endYear: number;
  scale?: number;
  events: TimelineEvent[];
  ranges?: TimelineRange[];
}

export interface ParsedMarkdownContent {
  frontmatter: Record<string, unknown>;
  body: string;
}

export type ViewMode = 'chapters' | 'markdown';

export type GameSystemId = 'inoraxium' | 'horaghfus';
