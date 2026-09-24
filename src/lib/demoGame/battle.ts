import type { BattleSettings } from '../../types/battle';
import { validateBattleSettings } from '../battleSettings';
import { characterContext, resolveFormula } from './formula';
import { distance, hasLineOfSight, inside, isGround, isPlaced, keyOf, sceneOf, tileAt } from './map';
import type { Combatant, GameWorld, Point } from './types';

export function battleContext(actor: Combatant, target: Combatant, world: GameWorld, owner: 'actor' | 'target' = 'actor') {
  const a = characterContext(actor.character), t = characterContext(target.character);
  return { ...(owner === 'actor' ? a : t), ...Object.fromEntries(Object.entries(a).map(([k, v]) => [`actor.${k}`, v])), ...Object.fromEntries(Object.entries(t).map(([k, v]) => [`target.${k}`, v])), 'session.round': world.combat.round };
}

export function patternCells(s: BattleSettings, origin: Point, aim: Point): Point[] {
  if (s.shape === 'single') return [aim];
  if (s.shape === 'custom') return [...new Map(s.cells.map(p => { const point = { x: aim.x + p.x, y: aim.y + p.y }; return [keyOf(point), point]; })).values()];
  const directed = s.shape === 'line' || s.shape === 'cone', center = directed ? origin : aim;
  const r = directed ? Math.ceil(s.length + s.width) : s.radius, result: Point[] = [];
  const dx = aim.x - origin.x, dy = aim.y - origin.y, length = Math.hypot(dx, dy);
  if (directed && length === 0) throw new Error('Choose a direction away from the actor.');
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const radius = Math.hypot(x, y), along = directed ? (x * dx + y * dy) / length : 0, across = directed ? Math.abs(x * dy - y * dx) / length : 0;
    const included = s.shape === 'square' || (s.shape === 'burst' && radius <= s.radius + .001)
      || (s.shape === 'line' && along > 0 && along <= s.length + .001 && across <= (s.width - 1) / 2 + .35)
      || (s.shape === 'cone' && radius > 0 && radius <= s.length + .001 && along / radius >= Math.cos(s.angle * Math.PI / 360) - .001);
    if (included) result.push({ x: center.x + x, y: center.y + y });
  }
  return result;
}

export function battlePlan(world: GameWorld, actor: Combatant, s: BattleSettings, anchor: Point, targetId: string, isDm: boolean, selectedIds?: string[]) {
  validateBattleSettings(s);
  if (world.mode !== 'battle') throw new Error('Switch to Battle mode to use this action.');
  if (!isPlaced(actor)) throw new Error('Place this character on the map first.');
  const scene = sceneOf(world), target = world.actors.find(a => a.id === targetId);
  if (s.target === 'single' && (!target || !isPlaced(target) || (!isDm && (target.hidden || tileAt(scene, target.position).hidden)))) throw new Error('Select a visible character on the map.');
  const aim = s.target === 'self' || s.target === 'multiple' ? actor.position : s.target === 'single' ? target!.position : anchor;
  if (!inside(scene, aim)) throw new Error('Aim inside the scene.');
  if (!isDm && tileAt(scene, aim).hidden) throw new Error('This position is hidden.');
  const range = resolveFormula(s.range, characterContext(actor.character)).total;
  if (range < 0 || range > 10000 || distance(actor.position, aim) > range) throw new Error('Aim point is out of range.');
  if (s.requiresLOS && !hasLineOfSight(world, actor.position, aim)) throw new Error('Line of sight to the aim point is blocked.');
  const cells = patternCells(s, actor.position, aim).filter(p => inside(scene, p) && isGround(tileAt(scene, p)));
  const keys = new Set(cells.map(keyOf));
  let targets = world.actors.filter(other => {
    if (!isPlaced(other)) return false;
    if ((s.target === 'multiple' ? distance(actor.position, other.position) > range : !keys.has(keyOf(other.position))) || (!isDm && (other.hidden || tileAt(scene, other.position).hidden))) return false;
    if (other.id === actor.id && s.target !== 'self' && !s.includeSelf) return false;
    if (s.target !== 'self' || other.id !== actor.id) {
      const ally = other.id === actor.id || (other.team === actor.team && actor.team !== 'neutral');
      const enemy = other.team !== actor.team && other.team !== 'neutral' && actor.team !== 'neutral';
      if (s.faction === 'allies' && !ally || s.faction === 'enemies' && !enemy) return false;
    }
    return !s.requiresLOS || hasLineOfSight(world, (s.shape === 'burst' || s.shape === 'square' || s.shape === 'custom') ? aim : actor.position, other.position);
  });
  const limit = s.target === 'multiple' ? resolveFormula(s.maxTargets || '1', characterContext(actor.character)).total : targets.length;
  if (s.target === 'multiple') {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Target limit must be an integer from 1 to 100.');
    if (selectedIds !== undefined) {
      if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > limit || new Set(selectedIds).size !== selectedIds.length) throw new Error(`Select 1-${limit} different targets.`);
      if (selectedIds.some(id => !targets.some(t => t.id === id))) throw new Error('A selected target is not eligible.');
      targets = selectedIds.map(id => targets.find(t => t.id === id)!);
    }
  }
  return { aim, cells: s.target === 'multiple' ? targets.map(t => t.position) : cells, targets, limit };
}
