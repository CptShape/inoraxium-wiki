import { Chapter, GameSystemId } from '../types';
import { chapters as inoraxiumChapters, allChapters as allInoraxiumChapters } from './inoraxium/chapters';
import { chapters as horaghfusChapters, allChapters as allHoraghfusChapters } from './horaghfus/chapters';

export interface GameSystemDefinition {
  id: GameSystemId;
  name: string;
  chapters: Chapter[]; // Visible sidebar tree
  allChapters: Chapter[]; // Full registry, including hidden-but-linkable chapters
  defaultExpandedChapters: string[];
}

export const gameSystems: Record<GameSystemId, GameSystemDefinition> = {
  inoraxium: {
    id: 'inoraxium',
    name: 'Inoraxium',
    chapters: inoraxiumChapters,
    allChapters: allInoraxiumChapters,
    defaultExpandedChapters: ['kinships', 'elves', 'high-elves', 'user-pages'],
  },
  horaghfus: {
    id: 'horaghfus',
    name: 'Horaghfus',
    chapters: horaghfusChapters,
    allChapters: allHoraghfusChapters,
    defaultExpandedChapters: ['horaghfus-peoples', 'user-pages'],
  },
};
