import { Chapter } from '../../../../../types';

import { raceDragonborn } from './dragonborn';
import { raceDwarf } from './dwarf';
import { raceElf } from './elf';
import { raceExmachina } from './exmachina';
import { raceTitanborn } from './titanborn';
import { raceHalfling } from './halfling';
import { raceHuman } from './human';
import { raceOrc } from './orc';
import { raceUndead } from './undead';

export const racesChapter: Chapter = {
  id: 'races',
  title: 'Races',
  subtitle: 'The Peoples of the Realm',
  icon: '👥',
  content: 'src/data/inoraxium/players-handbook/chapters/races/races.md',
  subChapters: [raceHuman, raceElf, raceDwarf, raceDragonborn, raceHalfling, raceTitanborn, raceExmachina, raceOrc, raceUndead],
};

export { raceElf, raceDwarf, raceHuman, raceDragonborn, raceOrc, raceUndead, raceExmachina, raceTitanborn, raceHalfling };
