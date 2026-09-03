import { Chapter } from '../../../../types';
import { assetCreatorChapter } from './asset-creator';
import { battleTrackerChapter } from './battle-tracker';
import { campaignsChapter } from './campaigns';
import { charactersChapter } from './characters';
import { sessionChapter } from './session';

export const toolsChapter: Chapter = {
  id: 'tools',
  title: 'Tools',
  subtitle: 'Instruments and Utilities for the Game Master',
  icon: '🛠️',
  content: 'src/data/inoraxium/tools/chapters/tools.md',
  subChapters: [battleTrackerChapter, charactersChapter, sessionChapter, campaignsChapter, assetCreatorChapter],
};

export { assetCreatorChapter, battleTrackerChapter, campaignsChapter, charactersChapter, sessionChapter };
