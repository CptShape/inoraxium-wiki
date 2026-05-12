import { Chapter } from '../../../../../types';
import { generalRuleAbilities } from './abilities';
import { generalRuleActions } from './actions';
import { generalRuleCombat } from './combat';
import { generalRuleConditions } from './conditions';
import { generalRuleLevelTable } from './level-table';
import { generalRuleMagicSchools } from './magic-schools';

export const generalRulesChapter: Chapter = {
  id: 'general-rules',
  title: 'General Rules',
  subtitle: 'The Foundation of Play',
  icon: '⚔️',
  content: 'src/data/inoraxium/players-handbook/chapters/general-rules/general-rules.md',
  subChapters: [generalRuleAbilities, generalRuleActions, generalRuleCombat, generalRuleConditions, generalRuleMagicSchools, generalRuleLevelTable],
};

export { generalRuleAbilities, generalRuleActions, generalRuleCombat, generalRuleConditions, generalRuleMagicSchools, generalRuleLevelTable };
