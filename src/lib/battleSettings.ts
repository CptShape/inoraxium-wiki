import type { BattleCheck, BattleCost, BattleOperation, BattleSettings } from '../types/battle';
import type { CharacterAction, StatusEffect } from '../types/character';

export const newBattleOperation = (kind: BattleOperation['kind'] = 'damage'): BattleOperation => ({ id: crypto.randomUUID(), kind, recipient: 'target', formula: '@roll.amount', barId: '', effectId: '', canOverflow: false });
export const battleCosts = (s: BattleSettings): BattleCost[] => s.costs ?? [{ id: 'legacy-cost', resource: s.costResource, barId: '', formula: String(s.cost) }];
export const newBattleCost = (): BattleCost => ({ id: crypto.randomUUID(), resource: 'combat', barId: '', formula: '1' });
export const newBattleCheck = (): BattleCheck => ({ id: `check_${crypto.randomUUID().replace(/-/g, '')}`, name: 'Follow-up save', when: 'landed', actorFormula: '12', targetFormula: '1d20 + @wis_mod', ties: 'target' });
export const battleOperations = (s: BattleSettings) => [...s.landed, ...s.resisted, ...s.afterChecks || []];
export const defaultBattleSettings = (): BattleSettings => ({ version: 1, enabled: true, target: 'single', faction: 'all', includeSelf: false, range: '6', requiresLOS: true,
  shape: 'single', radius: 2, length: 6, width: 1, angle: 90, cells: [{ x: 0, y: 0 }], cost: 1, costResource: 'combat', check: 'none',
  actorFormula: '12', targetFormula: '1d20 + @wis_mod', actorRoll: 'once', ties: 'target', amountFormula: '0', landed: [], resisted: [] });

export function validateBattleSettings(s: BattleSettings) {
  if (!s || s.version !== 1 || typeof s.enabled !== 'boolean') throw new Error('Invalid battle settings version.');
  const oneOf = (v: unknown, values: unknown[]) => { if (!values.includes(v)) throw new Error('Invalid battle setting option.'); };
  oneOf(s.target, ['self', 'single', 'point', 'multiple']); oneOf(s.faction, ['all', 'allies', 'enemies']);
  if (s.target === 'multiple' && s.shape !== 'single') throw new Error('Selected characters use the single-cell pattern.');
  if (s.animation !== undefined) oneOf(s.animation, ['attack', 'cast']);
  for (const value of [s.maxTargets, s.availability, s.unavailableReason]) if (value !== undefined && (typeof value !== 'string' || value.length > 2000)) throw new Error('Invalid action requirement.');
  if (s.checks !== undefined && (!Array.isArray(s.checks) || s.checks.length > 8)) throw new Error('Use at most eight follow-up checks.');
  const ids = new Set(['primary']);
  for (const check of s.checks || []) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(check.id) || ids.has(check.id)) throw new Error('Check IDs must be unique identifiers.');
    ids.add(check.id);
    oneOf(check.when, ['always', 'landed', 'resisted']); oneOf(check.ties, ['actor', 'target']);
    if (![check.name, check.actorFormula, check.targetFormula].every(v => typeof v === 'string' && v.length <= 2000)) throw new Error('Invalid follow-up check.');
  }
  oneOf(s.shape, ['single', 'burst', 'square', 'line', 'cone', 'custom']); oneOf(s.check, ['none', 'attack', 'save', 'opposed']);
  oneOf(s.actorRoll, ['once', 'per-target']); oneOf(s.ties, ['actor', 'target']); oneOf(s.costResource, ['combat', 'reaction']); oneOf(s.angle, [45, 90, 180]);
  if (s.costs !== undefined && (!Array.isArray(s.costs) || s.costs.length > 24)) throw new Error('Invalid battle costs.');
  for (const cost of battleCosts(s)) {
    oneOf(cost.resource, ['combat', 'movement', 'reaction', 'bar']);
    if (![cost.id, cost.barId, cost.formula].every(v => typeof v === 'string' && v.length <= 2000)) throw new Error('Invalid battle cost formula.');
  }
  if (!Number.isFinite(s.cost) || s.cost < 0 || ![s.radius, s.length, s.width].every(n => Number.isInteger(n) && n >= 0 && n <= 50) || s.length < 1 || s.width < 1) throw new Error('Invalid battle cost or pattern size.');
  if (typeof s.includeSelf !== 'boolean' || typeof s.requiresLOS !== 'boolean') throw new Error('Invalid targeting settings.');
  if (!Array.isArray(s.cells) || s.cells.length > 256 || s.cells.some(p => !Number.isInteger(p.x) || !Number.isInteger(p.y) || Math.abs(p.x) > 50 || Math.abs(p.y) > 50)) throw new Error('Invalid custom pattern.');
  if (![s.range, s.actorFormula, s.targetFormula, s.amountFormula].every(f => typeof f === 'string' && f.length <= 2000)) throw new Error('Invalid battle formula.');
  if (!Array.isArray(s.landed) || !Array.isArray(s.resisted) || s.landed.length > 24 || s.resisted.length > 24) throw new Error('Too many battle outcome steps.');
  if (s.afterChecks !== undefined && (!Array.isArray(s.afterChecks) || s.afterChecks.length > 24)) throw new Error('Too many after-check steps.');
  for (const branch of [s.landed, s.resisted, s.afterChecks || []]) if (new Set(branch.map(op => op.id)).size !== branch.length) throw new Error('Outcome step IDs must be unique within each branch.');
  for (const op of battleOperations(s)) {
    oneOf(op.kind, ['damage', 'healing', 'bar', 'effect', 'push', 'pull', 'teleport']); oneOf(op.recipient, ['actor', 'target']);
    if (op.frequency !== undefined) oneOf(op.frequency, ['per-target', 'once']);
    if (op.frequency === 'once' && op.recipient !== 'actor') throw new Error('Once-per-action steps must target the actor.');
    if (op.frequency === 'once' && ['push', 'pull'].includes(op.kind)) throw new Error('Push/pull needs a target direction and cannot run once for the actor.');
    if (op.condition !== undefined && (typeof op.condition !== 'string' || op.condition.length > 2000)) throw new Error('Invalid step condition.');
    if (![op.id, op.formula, op.barId, op.effectId].every(v => typeof v === 'string' && v.length <= 2000) || typeof op.canOverflow !== 'boolean') throw new Error('Invalid outcome step.');
  }
}

// Import/duplicate creates new effect IDs; outcome links must follow those IDs.
export function remapBattleSettings(action: Pick<CharacterAction, 'battleSettings' | 'effects'>, effects: StatusEffect[]): BattleSettings | undefined {
  if (!action.battleSettings) return undefined;
  const copy = structuredClone(action.battleSettings);
  validateBattleSettings(copy);
  const remap = new Map((action.effects || []).map((effect, index) => [effect.id, effects[index]?.id]));
  for (const op of battleOperations(copy)) if (op.kind === 'effect' && remap.get(op.effectId)) op.effectId = remap.get(op.effectId)!;
  return copy;
}

export const battleFormulas = (s: BattleSettings): string[] => [s.range, s.maxTargets || '1', s.availability || '1', ...battleCosts(s).map(c => c.formula), ...(s.check === 'none' ? [] : [s.actorFormula, s.targetFormula]), ...(s.checks || []).flatMap(c => [c.actorFormula, c.targetFormula]), s.amountFormula, ...battleOperations(s).flatMap(op => [op.condition || '1', ...(op.kind === 'effect' ? [] : [op.formula])])];
