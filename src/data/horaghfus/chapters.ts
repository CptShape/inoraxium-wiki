import { Chapter } from '../../types';
import { worldbuildingHandbookCodex } from '../horaghfus/worldbuilding-handbook/chapters/worldbuilding-handbook-chapters';
import registry from './user-pages/registry.json';
import { mergeUserPageRegistry, UserPageRegistry } from '../user-pages';

const baseVisibleChapters: Chapter[] = [
  worldbuildingHandbookCodex,
];

const baseAllChapters: Chapter[] = [
  worldbuildingHandbookCodex,
];

const mergedUserPages = mergeUserPageRegistry(baseVisibleChapters, baseAllChapters, registry as unknown as UserPageRegistry, 'horaghfus');

// Put chapters here only if they should appear in the sidebar.
export const chapters: Chapter[] = mergedUserPages.chapters;

// Register every addressable chapter here, including hidden chapters.
export const allChapters: Chapter[] = mergedUserPages.allChapters;

export {
  worldbuildingHandbookCodex,
};
