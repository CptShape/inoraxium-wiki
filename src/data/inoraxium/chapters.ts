import { Chapter } from '../../types';
import registry from './user-pages/registry.json';
import { mergeUserPageRegistry } from '../user-pages';

import { playersHandbookCodex } from './players-handbook/chapters/players-handbook-chapters';
import { styleChapter } from './styles/styles';
import { chronicleChapter } from './worldbuilding-handbook/chapters/history/history';
import { worldbuildingHandbookCodex } from './worldbuilding-handbook/chapters/worldbuilding-handbook-chapters';
import { pleiadasSistersChapter } from './worldbuilding-handbook/chapters/history/asd/pleiadas-sisters';
import { toolsChapter } from './tools/chapters/tools';

const baseVisibleChapters: Chapter[] = [
  playersHandbookCodex,
  worldbuildingHandbookCodex,
  styleChapter,
  pleiadasSistersChapter,
  toolsChapter,
];

const baseAllChapters: Chapter[] = [
  playersHandbookCodex,
  worldbuildingHandbookCodex,
  chronicleChapter,
  styleChapter,
  pleiadasSistersChapter,
  toolsChapter,
];

const mergedUserPages = mergeUserPageRegistry(baseVisibleChapters, baseAllChapters, registry, 'inoraxium');

// Put chapters here only if they should appear in the sidebar.
export const chapters: Chapter[] = mergedUserPages.chapters;

// Register every addressable chapter here, including hidden chapters.
export const allChapters: Chapter[] = mergedUserPages.allChapters;

export {
  playersHandbookCodex,
  worldbuildingHandbookCodex,
  styleChapter,
  pleiadasSistersChapter,
  toolsChapter,
};
