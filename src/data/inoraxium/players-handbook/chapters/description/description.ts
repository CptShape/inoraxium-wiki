import { Chapter } from '../../../../../types';

import { descriptionBackground } from './backgrounds';
import { descriptionEquipments } from './equipments';
import { descriptionFeats } from './feats';
import { descriptionLanguages } from './languages';

export const descriptionChapter: Chapter = {
  id: 'description',
  title: 'Description',
  subtitle: 'An Overview of the Character',
  icon: '�',
  content: 'src/data/inoraxium/players-handbook/chapters/description/description.md',
  subChapters: [descriptionBackground, descriptionFeats, descriptionLanguages, descriptionEquipments],
};

export { descriptionBackground, descriptionFeats, descriptionLanguages, descriptionEquipments };
