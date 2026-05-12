import { Chapter } from '../../../../types';
import { mythologyChapter } from '../mythology/mythology';
import { chronicleChapter } from './history/history';
import { worldMapChapter } from './map/world-map';

export const worldbuildingHandbookCodex: Chapter = {
  id: 'worldbuilding-handbook-codex',
  title: 'Worldbuilding Handbook',
  subtitle: '???',
  icon: '⚔️',
  content: 'src/data/inoraxium/worldbuilding-handbook/chapters/worldbuilding-handbook-chapters.md',
  subChapters: [chronicleChapter, worldMapChapter, mythologyChapter],
};

export { chronicleChapter, worldMapChapter, mythologyChapter };
