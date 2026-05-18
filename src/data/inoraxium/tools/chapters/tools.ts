import { Chapter } from '../../../../types';
import { battleTrackerChapter } from './battle-tracker';
import { charactersChapter } from './characters';
import { diceMacrosChapter } from './dice-macros';
import { messageSenderChapter } from './message-sender';
import { skillTreeChapter } from './skill-tree';

export const toolsChapter: Chapter = {
  id: 'tools',
  title: 'Tools',
  subtitle: 'Instruments and Utilities for the Game Master',
  icon: '🛠️',
  content: 'src/data/inoraxium/tools/chapters/tools.md',
  subChapters: [battleTrackerChapter, diceMacrosChapter, messageSenderChapter, charactersChapter, skillTreeChapter],
};

export { battleTrackerChapter, diceMacrosChapter, messageSenderChapter, charactersChapter, skillTreeChapter };
