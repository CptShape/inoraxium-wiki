import { Chapter } from '../../../../types';
import { assetCreatorChapter } from './asset-creator';
import { battleTrackerChapter } from './battle-tracker';
import { charactersChapter } from './characters';
import { sessionChapter } from './session';

export const toolsChapter: Chapter = {
  id: 'tools',
  title: 'Tools',
  subtitle: 'Instruments and Utilities for the Game Master',
  icon: '🛠️',
  content: 'src/data/inoraxium/tools/chapters/tools.md',
  subChapters: [battleTrackerChapter, charactersChapter, sessionChapter, assetCreatorChapter],
};

export { assetCreatorChapter, battleTrackerChapter, charactersChapter, sessionChapter };
