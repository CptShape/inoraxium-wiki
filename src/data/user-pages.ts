import { Chapter, GameSystemId } from '../types';

export interface UserPageRegistryEntry {
  workspaceId: string;
  workspaceTitle: string;
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
  content: string;
  system: GameSystemId;
  parentId?: string;
  sidebarVisible: boolean;
  order?: string;
  width?: number | string;
}

export interface UserPageRegistry {
  version: number;
  pages: UserPageRegistryEntry[];
}

interface RegistryMeta {
  order: string;
  parentId?: string;
}

const cloneChapter = (chapter: Chapter): Chapter => ({
  ...chapter,
  subChapters: chapter.subChapters?.map(cloneChapter),
});

const parseWidth = (value?: number | string) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const createChapterFromRegistryEntry = (entry: UserPageRegistryEntry): Chapter => ({
  id: entry.id,
  title: entry.title,
  subtitle: entry.subtitle || undefined,
  icon: entry.icon || undefined,
  content: entry.content,
  width: parseWidth(entry.width),
  subChapters: [],
});

const findChapterById = (chapters: Chapter[], targetId: string): Chapter | null => {
  for (const chapter of chapters) {
    if (chapter.id === targetId) return chapter;
    if (chapter.subChapters) {
      const found = findChapterById(chapter.subChapters, targetId);
      if (found) return found;
    }
  }

  return null;
};

const attachToTree = (chapters: Chapter[], parentId: string, child: Chapter) => {
  const parent = findChapterById(chapters, parentId);
  if (!parent) return false;

  parent.subChapters = [...(parent.subChapters ?? []), child];
  return true;
};

const sortChaptersByRegistryOrder = (chapters: Chapter[], metaById: Map<string, RegistryMeta>) => {
  chapters.sort((left, right) => {
    const leftMeta = metaById.get(left.id);
    const rightMeta = metaById.get(right.id);

    if (!leftMeta && !rightMeta) return 0;
    if (!leftMeta) return -1;
    if (!rightMeta) return 1;

    const leftNumber = Number(leftMeta.order);
    const rightNumber = Number(rightMeta.order);
    const leftIsNumber = Number.isFinite(leftNumber);
    const rightIsNumber = Number.isFinite(rightNumber);

    if (leftIsNumber && rightIsNumber) {
      return leftNumber - rightNumber;
    }

    return leftMeta.order.localeCompare(rightMeta.order, undefined, { numeric: true, sensitivity: 'base' });
  });

  chapters.forEach((chapter) => {
    if (chapter.subChapters && chapter.subChapters.length > 0) {
      sortChaptersByRegistryOrder(chapter.subChapters, metaById);
    }
  });
};

const mergeEntriesIntoTree = (
  baseChapters: Chapter[],
  entries: UserPageRegistryEntry[],
  includeEntry: (entry: UserPageRegistryEntry) => boolean
) => {
  const tree = baseChapters.map(cloneChapter);
  const relevantEntries = entries.filter(includeEntry);
  const metaById = new Map<string, RegistryMeta>();
  const nodeById = new Map<string, Chapter>();
  const roots: Chapter[] = [];

  relevantEntries.forEach((entry) => {
    nodeById.set(entry.id, createChapterFromRegistryEntry(entry));
    metaById.set(entry.id, {
      order: entry.order?.trim() || '',
      parentId: entry.parentId?.trim() || undefined,
    });
  });

  relevantEntries.forEach((entry) => {
    const node = nodeById.get(entry.id);
    if (!node) return;

    const parentId = entry.parentId?.trim();

    if (parentId && nodeById.has(parentId)) {
      const parentNode = nodeById.get(parentId);
      parentNode!.subChapters = [...(parentNode!.subChapters ?? []), node];
      return;
    }

    if (parentId && attachToTree(tree, parentId, node)) {
      return;
    }

    roots.push(node);
  });

  sortChaptersByRegistryOrder(roots, metaById);
  roots.forEach((root) => {
    if (root.subChapters && root.subChapters.length > 0) {
      sortChaptersByRegistryOrder(root.subChapters, metaById);
    }
  });

  return [...tree, ...roots];
};

export const mergeUserPageRegistry = (
  baseVisibleChapters: Chapter[],
  baseAllChapters: Chapter[],
  registry: UserPageRegistry,
  system: GameSystemId
) => {
  const entries = registry.pages.filter((entry) => entry.system === system);

  return {
    chapters: mergeEntriesIntoTree(baseVisibleChapters, entries, (entry) => entry.sidebarVisible),
    allChapters: mergeEntriesIntoTree(baseAllChapters, entries, () => true),
  };
};

