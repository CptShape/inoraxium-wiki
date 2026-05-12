import { Chapter } from '../../../../types';
import { chronicleChapter } from './history/history';

export const worldbuildingHandbookCodex: Chapter = {
  id: 'worldbuilding-handbook-codex',
  title: 'Worldbuilding Handbook',
  subtitle: '???',
  icon: '⚔️',
  content: 'src/data/horaghfus/worldbuilding-handbook/chapters/worldbuilding-handbook-chapters.md',
  subChapters: [chronicleChapter],
};

export { chronicleChapter };
