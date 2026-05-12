import { Chapter } from '../../../../../types';
import { eraOfDraktharChapter } from './asd/era-of-drakthar';
import { eraOfReckoningChapter } from './asd/era-of-reckoning';

export const chronicleChapter: Chapter = {
  id: 'chronicle',
  title: 'World Chronicle',
  subtitle: 'A Timeline of Ages and Upheavals',
  icon: '⏳',
  content: 'src/data/inoraxium/worldbuilding-handbook/chapters/history/history.md',
  prevChapter: 'players-handbook',
  nextChapter: 'kinships',
  subChapters: [eraOfDraktharChapter,eraOfReckoningChapter],
};

export { eraOfDraktharChapter, eraOfReckoningChapter };
