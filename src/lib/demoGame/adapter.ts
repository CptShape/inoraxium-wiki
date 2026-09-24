import type { CharacterData } from '../../types/character';
import { getPixhostDirectImageUrl } from '../pixhost';
import { characterContext, resolveFormula, validateSnapshot } from './formula';
import type { ActionExtension, Combatant, GameAction, Point } from './types';
import { battleCosts } from '../battleSettings';

export const newId = () => crypto.randomUUID();
export const defaultExtension = (): ActionExtension => ({ target: 'self', range: 6, cost: 0, costResource: 'combat', requiresLOS: true, damageFormula: '', defenseId: '' });
export function battleCostLabel(actor: Combatant, action: GameAction) {
  if (!action.battleSettings) return '';
  return battleCosts(action.battleSettings).map(cost => `${cost.formula} ${cost.resource === 'bar' ? actor.character.bars?.find(b => b.id === cost.barId)?.name || cost.barId || 'Custom bar' : { combat: 'CAP', movement: 'MAP', reaction: 'RAP' }[cost.resource]}`).join(' + ') || 'No cost';
}
export function extensionFor(actor: Combatant, action: GameAction): ActionExtension {
  const s = action.battleSettings;
  if (!s) return actor.extensions[action.id] || defaultExtension();
  let range = 0;
  try { range = resolveFormula(s.range, characterContext(actor.character)).total; } catch { /* Execution reports the invalid range without breaking the viewer. */ }
  return { ...defaultExtension(), target: s.target === 'self' ? 'self' : 'single', range, cost: s.cost, costResource: s.costResource, requiresLOS: s.requiresLOS };
}
export function actorImage(actor: Combatant) {
  const gallery = actor.character.gallery || [];
  const picture = gallery.find(g => g.tags?.includes('token')) || gallery.find(g => g.tags?.includes('main'));
  return picture ? getPixhostDirectImageUrl(picture.url, picture.thumbUrl || '') : actor.character.portraitUrl || '';
}
export function adaptCharacter(character: CharacterData, position: Point): Combatant {
  validateSnapshot(character);
  const bars = character.bars || [];
  const find = (ids: string[]) => bars.find(b => ids.includes(b.id.toLowerCase()))?.id || '';
  return {
    id: newId(), sourceCharacterId: character.id, character: structuredClone(character), importedAt: Date.now(),
    position, roleplayPosition: { x: .25, y: .5 }, team: 'party', initiative: 0, state: 'active', locked: false, hidden: false,
    bindings: { hp: find(['bar_hp', 'hp']), movement: find(['bar_map', 'map']), combat: find(['bar_cap', 'cap']), reaction: find(['bar_rap', 'rap']) },
    extensions: {}, deathSaves: { successes: 0, failures: 0 },
  };
}
export function getActions(actor: Combatant): GameAction[] {
  const result: GameAction[] = [];
  for (const macro of actor.character.diceMacros || []) result.push({ id: `character/${macro.id}`, name: macro.name, formula: macro.formula, sourceName: 'Character', sourceId: actor.character.id, sourceKind: 'character', effects: [], locals: [], costLabel: '' });
  const sources = [
    ...(actor.character.inventory || []).filter(e => e.equipped).map(entry => ({ kind: 'inventory-item' as const, entry })),
    ...(actor.character.generalItems || []).filter(e => e.equipped).map(entry => ({ kind: 'general-item' as const, entry })),
    ...(actor.character.spells || []).map(entry => ({ kind: 'spell' as const, entry })),
    ...(actor.character.statuses || []).filter(e => e.active !== false).map(entry => ({ kind: 'status' as const, entry })),
  ];
  for (const { kind, entry } of sources) {
    const base = { sourceName: entry.name, sourceId: entry.id, sourceKind: kind, locals: entry.localVariables || [], costLabel: 'resourceCost' in entry ? entry.resourceCost : '', remaining: 'usageRemaining' in entry && entry.totalUsage ? entry.usageRemaining : undefined };
    for (const [index, effect] of ('effects' in entry ? entry.effects || [] : []).entries()) {
      if (!effect.effectType || effect.effectType === 'attribute' || effect.active === false) continue;
      // Equipment-owned statuses are auto-applied by the sheet; do not create a
      // second manual Apply action for the same attached status template.
      if (effect.effectType === 'status' && (kind === 'inventory-item' || kind === 'general-item')) continue;
      result.push({ ...base, id: `${kind}/${entry.id}/effect/${effect.id || index}`, name: effect.statusName || effect.barUpdateDescription || `Update ${effect.targetLabel || effect.targetId || 'item'}`, formula: '', effects: [effect] });
    }
    for (const macro of ('macros' in entry ? entry.macros || [] : [])) result.push({ ...base, id: `${kind}/${entry.id}/macro/${macro.id}`, name: macro.name, formula: macro.formula, effects: [] });
    for (const action of entry.actions || []) {
      const actionBase = { ...base, actionId: action.id, costLabel: action.cost, remaining: action.maxUsage ? action.usageRemaining : undefined };
      if (action.battleSettings?.enabled) {
        result.push({ ...actionBase, id: `${kind}/${entry.id}/${action.id}/battle`, name: action.name, formula: '', effects: action.effects || [], battleSettings: action.battleSettings });
        continue;
      }
      for (const macro of action.macros || []) result.push({ ...actionBase, id: `${kind}/${entry.id}/${action.id}/macro/${macro.id}`, name: `${action.name}: ${macro.name}`, formula: macro.formula, effects: [] });
      if (action.effects?.some(e => e.effectType && e.effectType !== 'attribute')) result.push({ ...actionBase, id: `${kind}/${entry.id}/${action.id}/effects`, name: action.name, formula: '', effects: action.effects.filter(e => e.effectType && e.effectType !== 'attribute' && e.active !== false) });
    }
  }
  return result;
}
