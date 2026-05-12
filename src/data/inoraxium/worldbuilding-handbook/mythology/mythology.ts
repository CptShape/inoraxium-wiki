import { Chapter } from '../../../../types';
import { allGods } from './gods';

export const mythologyChapter: Chapter & { gods?: typeof allGods } = {
  id: 'mythology',
  title: 'Mythology',
  subtitle: 'The Divine Pantheon',
  icon: '🏛️',
  content: 'mythology', // Special marker - triggers mythology module rendering
  nextChapter: 'kinships',
  prevChapter: 'chronicle',
  gods: allGods,
};
