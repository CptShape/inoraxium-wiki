import type { CharacterStatus, StatusEffect } from '../../types/character';
import { applyCharacterTimeProgression } from '../characterTime';
import { defaultExtension, getActions, newId } from './adapter';
import { characterContext, resolveFormula, resolveLocals, validateSnapshot } from './formula';
import { distance, findMovement, hasLineOfSight, inside, isGround, isPlaced, keyOf, samePoint, sceneOf, materializeScene, includePoint, tileAt, traverse } from './map';
import type { ActionExtension, Combatant, CommandEnvelope, GameAction, GameEvent, GameSession, GameWorld, Point, ResourceRole, Scene } from './types';
import { SPRITES } from './sprites';
import { battleCosts, battleFormulas, battleOperations, validateBattleSettings } from '../battleSettings';
import { battleContext, battlePlan } from './battle';

export const actorById = (world: GameWorld, id: string) => {
  const actor = world.actors.find(a => a.id === id);
  if (!actor) throw new Error('Combatant no longer exists.');
  return actor;
};
export const resourceValue = (actor: Combatant, role: ResourceRole) => {
  const id = actor.bindings[role];
  return id ? characterContext(actor.character)[`${id}_current`] : undefined;
};
export const targetContext = (actor: Combatant, target: Combatant, world: GameWorld) => {
  const actorValues = characterContext(actor.character), targetValues = characterContext(target.character);
  return { ...actorValues,
    ...Object.fromEntries(Object.entries(actorValues).map(([k, v]) => [`actor.${k}`, v])),
    ...Object.fromEntries(Object.entries(targetValues).map(([k, v]) => [`target.${k}`, v])),
    'session.round': world.combat.round,
  };
};

function changeBar(actor: Combatant, id: string, value: number, set: boolean, canOverflow: boolean) {
  if (!Number.isFinite(value)) throw new Error('Bar value must be finite.');
  const bar = actor.character.bars?.find(b => b.id === id);
  if (!bar) throw new Error(`Target bar not found: ${id || '(unbound)'}`);
  const context = characterContext(actor.character);
  const current = context[`${id}_current`];
  const base = resolveFormula(bar.currentValue, context).total;
  let next = set ? value : current + value;
  if (bar.mode !== 'resource' && !canOverflow) next = Math.min(next, context[`${id}_max`]);
  // Resource-bar bonuses are derived; write only the base adjustment, never the bonus twice.
  bar.currentValue = String(Math.round((base + next - current) * 10000) / 10000);
  return `${bar.name}: ${current} -> ${next}`;
}

function spend(actor: Combatant, role: ResourceRole, amount: number, details: string[]) {
  if (amount === 0) return;
  const available = resourceValue(actor, role);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid action cost.');
  if (available === undefined) throw new Error(`Bind a ${role} resource in combatant settings.`);
  if (available < amount) throw new Error(`Not enough ${role} AP (${available} / ${amount}).`);
  details.push(changeBar(actor, actor.bindings[role], -amount, false, true));
}

function requireTurn(world: GameWorld, actor: Combatant) {
  if (!isPlaced(actor)) throw new Error('Place this character on the map first.');
  if (actor.state !== 'active') throw new Error('This combatant is not active.');
  if (world.combat.running && world.rules.strictTurns && world.combat.activeId !== actor.id) throw new Error('It is another combatant\'s turn.');
}

function sourceEntry(actor: Combatant, action: GameAction) {
  const entries = action.sourceKind === 'inventory-item' ? actor.character.inventory : action.sourceKind === 'general-item' ? actor.character.generalItems : action.sourceKind === 'spell' ? actor.character.spells : actor.character.statuses;
  return entries?.find(e => e.id === action.sourceId);
}

function effectFormula(effect: StatusEffect) { return effect.effectType === 'status' ? '' : effect.value; }
export function inputVariables(action: GameAction, extension: ActionExtension) {
  const wanted = new Set<string>();
  const scan = (text: string) => {
    for (const match of text.matchAll(/@@([a-zA-Z0-9_-]+)/g)) {
      if (wanted.has(match[1])) continue;
      wanted.add(match[1]);
      const variable = action.locals.find(v => v.id === match[1]);
      if (variable && variable.kind !== 'input') scan(variable.value);
    }
  };
  const referenced = action.battleSettings ? new Set(battleOperations(action.battleSettings).filter(op => op.kind === 'effect').map(op => op.effectId)) : null;
  [action.formula, extension.damageFormula, ...(action.battleSettings ? battleFormulas(action.battleSettings) : []), ...action.effects.filter(e => !referenced || referenced.has(e.id || '')).map(effectFormula)].forEach(scan);
  return action.locals.filter(v => v.kind === 'input' && wanted.has(v.id));
}

function applyActionEffect(target: Combatant, action: GameAction, effect: StatusEffect, context: Record<string, number>, values: Record<string, number>, details: string[], itemId?: string) {
  if (effect.active === false) return;
    if (effect.effectType === 'bar-update') {
      details.push(changeBar(target, effect.targetId, resolveFormula(effect.value, context, values).total, false, effect.canOverflow ?? false));
    } else if (effect.effectType === 'item-update') {
      const targetItemId = effect.itemUpdateArrayMode ? itemId : effect.targetId;
      if (!targetItemId || (effect.itemUpdateArrayMode && !effect.itemUpdateIds?.includes(targetItemId))) throw new Error('Choose an item for the quantity update.');
      const item = [...target.character.inventory || [], ...target.character.generalItems || []].find(i => i.id === targetItemId);
      if (!item) throw new Error('The target does not have this item.');
      const before = item.quantity;
      item.quantity += resolveFormula(effect.value, context, values).total;
      details.push(`${item.name}: ${before} -> ${item.quantity}${item.quantity < 0 ? ' (quantity below zero)' : ''}`);
    } else if (effect.effectType === 'status') {
      if (!effect.statusEntry) throw new Error('Status template is missing.');
      const template = structuredClone(effect.statusEntry);
      const status: CharacterStatus = { ...template, id: newId(), name: template.name || effect.statusName || 'Status', description: template.description || '', duration: template.duration || '', effects: template.effects || [], active: true };
      if (action.sourceKind !== 'character') {
        status.linkedStatusSourceType = action.sourceKind;
        status.linkedStatusSourceId = action.sourceId;
        status.linkedStatusSourceEffectId = effect.id;
      }
      target.character.statuses = [...target.character.statuses || [], status];
      validateSnapshot(target.character);
      details.push(`${target.character.name}: + ${status.name}`);
    }
}

function chargeAction(actor: Combatant, action: GameAction, cost: number, costResource: 'combat' | 'reaction', context: Record<string, number>, values: Record<string, number>, details: string[]) {
  const entry = sourceEntry(actor, action);
  const nestedAction = action.actionId ? entry?.actions?.find(a => a.id === action.actionId) : undefined;
  const usagePools = [
    ...(entry && 'totalUsage' in entry && entry.totalUsage ? [entry] : []),
    ...(nestedAction?.maxUsage ? [nestedAction] : []),
  ];
  for (const usage of usagePools) {
    const remaining = resolveFormula(usage.usageRemaining || '0', context, values).total;
    if (remaining < 1) throw new Error('No uses remaining.');
    usage.usageRemaining = String(remaining - 1);
    details.push(`Uses: ${remaining} -> ${remaining - 1}`);
  }
  spend(actor, costResource, cost, details);
}

function executeBattleAction(world: GameWorld, actor: Combatant, action: GameAction, anchor: Point, targetId: string, inputs: Record<string, number>, choices: Record<string, string>, isDm: boolean, details: string[], selectedIds: string[] | undefined, destinations: Record<string, Point>, animations: NonNullable<GameEvent['animations']>) {
  const s = action.battleSettings!, plan = battlePlan(world, actor, s, anchor, targetId, isDm, s.target === 'multiple' ? selectedIds || [] : undefined);
  if (!plan.targets.length) throw new Error('No eligible targets in this area.');
  for (const op of battleOperations(s)) if (op.kind === 'effect' && !action.effects.some(e => e.id === op.effectId && ['status', 'bar-update', 'item-update'].includes(e.effectType || ''))) throw new Error('An outcome points to a missing action effect. Update Battle Settings.');
  const casterContext = characterContext(actor.character);
  const evaluate = (formula: string, context: Record<string, number>, dice = true) => {
    // Locals belong to the action source, even in a target's saving-throw formula.
    const locals = resolveLocals(action.locals, { ...context, ...casterContext }, inputs);
    for (const ref of formula.matchAll(/@@([a-zA-Z0-9_-]+)/g)) locals.resolve(ref[1]);
    const roll = resolveFormula(formula, context, locals.values, dice);
    details.push(...roll.details);
    return { value: roll.total, locals: locals.values };
  };
  const shared = Object.fromEntries(Object.entries(battleContext(actor, actor, world)).filter(([key]) => !key.startsWith('target.')));
  shared['action.target.quantity'] = plan.targets.length;
  if (!evaluate(s.availability || '1', shared, false).value) throw new Error(s.unavailableReason || 'Action requirements are not met.');
  const dependsOnResults = (formula: string, seen = new Set<string>()): boolean => {
    if (/@action\.target\.(affected|resisted)\b/.test(formula)) return true;
    for (const ref of formula.matchAll(/@@([a-zA-Z0-9_-]+)/g)) {
      if (seen.has(ref[1])) continue;
      seen.add(ref[1]);
      const local = action.locals.find(v => v.id === ref[1]);
      if (local && local.kind !== 'input' && dependsOnResults(local.value, seen)) return true;
    }
    return false;
  };
  // A result-dependent shared amount is deferred until every save is resolved.
  // Checks referencing that deferred amount fail explicitly instead of using zero.
  const deferredAmount = dependsOnResults(s.amountFormula);
  if (!deferredAmount) shared['roll.amount'] = evaluate(s.amountFormula, shared).value;
  const actorRoll = s.check !== 'none' && s.actorRoll === 'once' ? evaluate(s.actorFormula, shared).value : 0;
  // Freeze all target contexts and resolve checks before any target gains/loses a
  // resource or status. Target order must not change later opponents' defenses.
  const resolutions = plan.targets.map(target => {
    const context: Record<string, number> = { ...battleContext(actor, target, world), ...Object.fromEntries(Object.entries(shared).filter(([key]) => key.startsWith('action.') || key.startsWith('roll.'))) };
    let a = s.check === 'none' ? 0 : s.actorRoll === 'once' ? actorRoll : evaluate(s.actorFormula, context).value;
    let t = s.check === 'none' ? 0 : evaluate(s.targetFormula, { ...context, ...battleContext(actor, target, world, 'target'), 'roll.actor': a }).value;
    let landed = s.check === 'none' || (s.ties === 'actor' ? a >= t : a > t);
    const remember = (id: string, executed: boolean) => Object.assign(context, { [`check.${id}.executed`]: Number(executed), [`check.${id}.landed`]: Number(executed && landed), [`check.${id}.resisted`]: Number(executed && !landed), [`check.${id}.actor`]: executed ? a : 0, [`check.${id}.target`]: executed ? t : 0, 'roll.actor': a, 'roll.target': t, 'roll.margin': a - t });
    remember('primary', true);
    for (const check of s.checks || []) {
      if (check.when !== 'always' && (check.when === 'landed') !== landed) { remember(check.id, false); continue; }
      a = evaluate(check.actorFormula, context).value;
      t = evaluate(check.targetFormula, { ...context, ...battleContext(actor, target, world, 'target'), 'roll.actor': a }).value;
      landed = check.ties === 'actor' ? a >= t : a > t;
      remember(check.id, true);
      details.push(`${target.character.name} / ${check.name}: ${a} vs ${t} / ${landed ? 'landed' : 'resisted'}`);
    }
    return { target, landed, context };
  });
  shared['action.target.affected'] = resolutions.filter(r => r.landed).length;
  shared['action.target.resisted'] = resolutions.length - shared['action.target.affected'];
  if (deferredAmount) shared['roll.amount'] = evaluate(s.amountFormula, shared).value;
  const counters = { 'action.target.quantity': plan.targets.length, 'action.target.affected': shared['action.target.affected'], 'action.target.resisted': shared['action.target.resisted'], 'roll.amount': shared['roll.amount'] };
  for (const resolution of resolutions) Object.assign(resolution.context, counters);
  details.push(`Targets: ${plan.targets.length} / Affected: ${counters['action.target.affected']} / Resisted: ${counters['action.target.resisted']}`, `Shared amount: ${shared['roll.amount']}`);
  const costs = new Map<string, number>();
  for (const cost of battleCosts(s)) {
    const amount = evaluate(cost.formula, shared).value;
    if (amount < 0) throw new Error('Cost formulas must return a non-negative number.');
    if (amount === 0) continue;
    const id = cost.resource === 'bar' ? cost.barId : actor.bindings[cost.resource];
    if (!id || !actor.character.bars?.some(b => b.id === id)) throw new Error(`Cost bar not found: ${id || cost.resource}`);
    costs.set(id, (costs.get(id) || 0) + amount);
  }
  for (const [id, amount] of costs) {
    const available = shared[`${id}_current`];
    if (!Number.isFinite(available) || available < amount) throw new Error(`Not enough ${id} (${available} / ${amount}).`);
  }
  const usageLocals = resolveLocals(action.locals, shared, inputs);
  const source = sourceEntry(actor, action), nested = source?.actions?.find(a => a.id === action.actionId);
  for (const formula of [source && 'usageRemaining' in source ? source.usageRemaining || '' : '', nested?.usageRemaining || '']) for (const ref of formula.matchAll(/@@([a-zA-Z0-9_-]+)/g)) usageLocals.resolve(ref[1]);
  chargeAction(actor, action, 0, 'combat', shared, usageLocals.values, details);
  for (const [id, amount] of costs) details.push(changeBar(actor, id, -amount, false, true));
  const once = new Set<string>();
  for (const { target, landed, context } of resolutions) {
    if (!landed && target.id !== actor.id) animations.push({ actorId: target.id, animation: 'dodge', delay: 350 });
    details.push(`${target.character.name}: ${landed ? 'Effect lands' : 'Effect resisted'}${s.check === 'none' ? '' : ` (${context['roll.actor']} vs ${context['roll.target']})`}`);
    for (const { op, branch } of [...(landed ? s.landed : s.resisted).map(op => ({ op, branch: landed ? 'landed' : 'resisted' })), ...(s.afterChecks || []).map(op => ({ op, branch: 'afterChecks' }))]) {
      const recipient = op.recipient === 'actor' ? actor : target;
      const operationKey = `${branch}/${op.id}`;
      if (op.frequency === 'once' && once.has(operationKey)) continue;
      const stepContext = op.frequency === 'once' ? shared : context;
      if (!evaluate(op.condition || '1', stepContext, false).value) continue;
      if (op.frequency === 'once') once.add(operationKey);
      if (op.kind === 'effect') {
        const effect = action.effects.find(e => e.id === op.effectId)!;
        const locals = resolveLocals(action.locals, { ...stepContext, ...casterContext }, inputs);
        for (const ref of effectFormula(effect).matchAll(/@@([a-zA-Z0-9_-]+)/g)) locals.resolve(ref[1]);
        applyActionEffect(recipient, action, effect, stepContext, locals.values, details, choices[`${recipient.id}/${effect.id}`]);
      } else if (op.kind === 'push' || op.kind === 'pull' || op.kind === 'teleport') {
        const amount = evaluate(op.formula, stepContext, false).value;
        if (!Number.isInteger(amount) || amount < 0 || amount > 100) throw new Error('Movement distance must be an integer from 0 to 100.');
        const before = { ...recipient.position }, scene = sceneOf(world);
        if (op.kind === 'teleport') {
          const destination = destinations[`${recipient.id}/${op.id}`];
          if (!destination || !inside(scene, destination) || !isGround(tileAt(scene, destination)) || (!isDm && tileAt(scene, destination).hidden) || world.actors.some(a => isPlaced(a) && a.id !== recipient.id && samePoint(a.position, destination))) throw new Error('Teleport requires an empty, visible floor tile.');
          if (distance(before, destination) > amount || (s.requiresLOS && !hasLineOfSight(world, before, destination))) throw new Error('Teleport destination is out of range or blocked from sight.');
          recipient.position = { ...destination };
        } else {
          const source = recipient.id === actor.id ? target.position : actor.position;
          const direction = { x: Math.sign(before.x - source.x), y: Math.sign(before.y - source.y) };
          if (op.frequency === 'once') throw new Error('Push/pull needs a target direction and cannot run once for the actor.');
          for (let i = 0; i < amount; i++) {
            const sign = op.kind === 'push' ? 1 : -1;
            const to = { x: recipient.position.x + direction.x * sign, y: recipient.position.y + direction.y * sign };
            if (!traverse(world, recipient, recipient.position, to).allowed || (!isDm && tileAt(scene, to).hidden)) break;
            recipient.position = to;
          }
        }
        details.push(`${recipient.character.name} / ${op.kind}: (${before.x}, ${before.y}) -> (${recipient.position.x}, ${recipient.position.y})`);
      } else {
        const amount = evaluate(op.formula, stepContext).value;
        const delta = op.kind === 'damage' ? -Math.max(0, amount) : op.kind === 'healing' ? Math.max(0, amount) : amount;
        details.push(`${recipient.character.name} / ${changeBar(recipient, op.kind === 'bar' ? op.barId : recipient.bindings.hp, delta, false, op.kind === 'damage' || op.canOverflow)}`);
      }
    }
  }
  return `${actor.character.name} / ${action.name} / ${plan.targets.length} target(s)`;
}

function executeAction(world: GameWorld, actor: Combatant, target: Combatant, action: GameAction, extension: ActionExtension, inputs: Record<string, number>, details: string[], itemId?: string) {
  if (!isPlaced(actor) || !isPlaced(target)) throw new Error('Actor and target must be placed on the map.');
  if (actor.state !== 'active') throw new Error('This combatant is not active.');
  if (extension.target === 'self' && actor.id !== target.id) throw new Error('This action targets its owner.');
  if (world.mode === 'battle' && distance(actor.position, target.position) > extension.range) throw new Error('Target is out of range.');
  if (world.mode === 'battle' && extension.requiresLOS && !hasLineOfSight(world, actor.position, target.position)) throw new Error('Line of sight is blocked.');
  const context = targetContext(actor, target, world);
  const locals = resolveLocals(action.locals, context, inputs);
  const formulas = [action.formula, extension.damageFormula, ...action.effects.map(effectFormula)];
  for (const formula of formulas) for (const ref of formula.matchAll(/@@([a-zA-Z0-9_-]+)/g)) locals.resolve(ref[1]);
  chargeAction(actor, action, extension.cost, extension.costResource, context, locals.values, details);
  let hit = true;
  if (action.formula) {
    const roll = resolveFormula(action.formula, context, locals.values, true);
    details.push(...roll.details, `${action.name}: ${roll.outcome || roll.total}`);
    hit = roll.outcome !== 'Failure';
    if (extension.defenseId) {
      const defense = characterContext(target.character)[extension.defenseId];
      if (defense === undefined) throw new Error(`Target defense not found: ${extension.defenseId}`);
      hit = hit && roll.total >= defense;
      details.push(`${roll.total} / ${extension.defenseId} ${defense}: ${hit ? 'Hit' : 'Miss'}`);
    }
  }
  if (hit && extension.damageFormula) {
    const damage = resolveFormula(extension.damageFormula, context, locals.values, true);
    details.push(...damage.details);
    details.push(changeBar(target, target.bindings.hp, -Math.max(0, damage.total), false, true));
  }
  if (hit) for (const effect of action.effects) applyActionEffect(target, action, effect, context, locals.values, details, itemId);
  return `${actor.character.name} / ${action.name}${actor.id !== target.id ? ` -> ${target.character.name}` : ''}`;
}

function advanceMovement(world: GameWorld, actor: Combatant, path: Point[], details: string[], travelled: Point[], skipFirstReaction = false) {
  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    const step = traverse(world, actor, actor.position, point);
    const available = resourceValue(actor, 'movement');
    if (!step.allowed || actor.state !== 'active' || (world.combat.running && (available === undefined || available < step.cost))) {
      world.pending = null;
      details.push('Movement interrupted; unused movement AP was not spent.');
      return;
    }
    const queue = world.combat.running && !(i === 0 && skipFirstReaction) ? world.actors.flatMap(other => {
      if (!isPlaced(other) || other.id === actor.id || other.state !== 'active' || other.team === actor.team || other.team === 'neutral' || actor.team === 'neutral'
        || distance(other.position, actor.position) > 1 || distance(other.position, point) <= 1) return [];
      return getActions(other).filter(action => {
        const ext = other.extensions[action.id];
        return ext?.reaction === 'leave-adjacency' && (resourceValue(other, ext.costResource) ?? 0) >= ext.cost
          && distance(other.position, actor.position) <= ext.range && (!ext.requiresLOS || hasLineOfSight(world, other.position, actor.position));
      }).map(action => ({ actorId: other.id, actionId: action.id }));
    }) : [];
    if (queue.length) {
      world.pending = { actorId: actor.id, path: path.slice(i), queue };
      details.push(`Movement paused: ${queue.length} reaction option(s).`);
      return;
    }
    if (world.combat.running) spend(actor, 'movement', step.cost, details);
    actor.position = point;
    travelled.push({ ...point });
  }
  world.pending = null;
}

function switchScene(world: GameWorld, scene: Scene) {
  if (world.combat.running) throw new Error('End battle before switching scenes.');
  sceneOf(world).placements = Object.fromEntries(world.actors.map(actor => [actor.id, { position: actor.position, roleplayPosition: actor.roleplayPosition, placed: isPlaced(actor) }]));
  world.sceneId = scene.id;
  const occupied = new Set<string>();
  world.actors.forEach(actor => {
    const saved = scene.placements?.[actor.id];
    actor.placed = saved ? saved.placed !== false : false;
    if (saved) { actor.position = saved.position; actor.roleplayPosition = saved.roleplayPosition; }
    if (!isPlaced(actor)) return;
    if (inside(scene, actor.position) && isGround(tileAt(scene, actor.position)) && !occupied.has(keyOf(actor.position))) { occupied.add(keyOf(actor.position)); return; }
    actor.placed = false;
  });
}

function removeFromInitiative(world: GameWorld, id: string) {
  const index = world.combat.order.indexOf(id);
  world.combat.order = world.combat.order.filter(entry => entry !== id);
  if (world.combat.activeId === id) world.combat.activeId = world.combat.order[Math.max(0, index) % world.combat.order.length] || null;
  if (!world.combat.order.length) { world.combat.running = false; world.combat.activeId = null; }
}

export function applyCommand(session: GameSession, envelope: CommandEnvelope): GameSession {
  if (session.processed.includes(envelope.id)) return session;
  if (envelope.baseRevision !== session.revision) throw new Error('The encounter changed. Review the new state and try again.');
  const next = structuredClone(session), world = next.world, command = envelope.command;
  const details: string[] = [];
  const animations: NonNullable<GameEvent['animations']> = [];
  let motion: GameEvent['motion'];
  let message = '';
  const dmOnly = ['mode', 'start', 'time', 'actor-settings', 'extension', 'battle-settings', 'add-actor', 'remove-actor', 'place-actor', 'unplace-actor', 'tile', 'rules', 'scene', 'scene-create', 'scene-expand', 'scene-background', 'teleport', 'undo', 'cancel-move'];
  if (dmOnly.includes(command.type) && envelope.role !== 'dm') throw new Error('DM control required.');
  const control = (id: string) => {
    const actor = actorById(world, id);
    if (envelope.role !== 'dm' && !envelope.controlledIds.includes(id)) throw new Error('You do not control this combatant.');
    return actor;
  };
  if (world.pending && !['reaction', 'cancel-move', 'bar', 'status', 'actor-settings', 'undo'].includes(command.type)) throw new Error('Resolve or cancel the pending movement first.');
  switch (command.type) {
    case 'move': {
      if (world.mode !== 'battle') throw new Error('Switch to Battle mode.');
      const actor = control(command.actorId);
      if (actor.locked && envelope.role !== 'dm') throw new Error('Token is locked.');
      requireTurn(world, actor);
      const movement = findMovement(world, actor, command.destination);
      if (movement.path.length < 2) throw new Error('No traversable path to this tile.');
      if (world.combat.running && (resourceValue(actor, 'movement') ?? -1) < movement.cost) throw new Error('Not enough movement AP.');
      motion = { actorId: actor.id, sceneId: world.sceneId, path: [{ ...actor.position }] };
      advanceMovement(world, actor, movement.path.slice(1), details, motion.path);
      message = `${actor.character.name} moved to ${actor.position.x}, ${actor.position.y}`;
      break;
    }
    case 'teleport': {
      const actor = control(command.actorId), scene = sceneOf(world);
      if (!isPlaced(actor)) throw new Error('Place this character on the map first.');
      if (!inside(scene, command.destination) || !isGround(tileAt(scene, command.destination)) || world.actors.some(a => isPlaced(a) && a.id !== actor.id && samePoint(a.position, command.destination))) throw new Error('Choose an empty floor tile.');
      actor.position = command.destination;
      message = `${actor.character.name} teleported`;
      break;
    }
    case 'roleplay-move': {
      const actor = control(command.actorId);
      if (!isPlaced(actor)) throw new Error('Place this character on the map first.');
      if (world.mode !== 'roleplay') throw new Error('Switch to Roleplay mode.');
      if (actor.locked && envelope.role !== 'dm') throw new Error('Token is locked.');
      if (!Number.isFinite(command.destination.x) || !Number.isFinite(command.destination.y)) throw new Error('Invalid position.');
      actor.roleplayPosition = { x: Math.max(.03, Math.min(.97, command.destination.x)), y: Math.max(.05, Math.min(.95, command.destination.y)) };
      message = `${actor.character.name} moved`;
      break;
    }
    case 'mode': world.mode = command.mode; message = `${command.mode === 'battle' ? 'Battle' : 'Roleplay'} mode`; break;
    case 'start': {
      if (world.combat.running) throw new Error('Battle is already running.');
      const order = world.actors.filter(isPlaced).sort((a, b) => b.initiative - a.initiative).map(a => a.id);
      if (!order.length) throw new Error('Place a combatant on the map first.');
      world.combat = { running: true, round: 1, order, activeId: order[0] };
      world.mode = 'battle';
      message = 'Battle started';
      break;
    }
    case 'end-turn': {
      if (!world.combat.running || !world.combat.activeId) throw new Error('Start battle first.');
      const actor = control(world.combat.activeId);
      actor.character = applyCharacterTimeProgression(actor.character, 'end-turn');
      const index = world.combat.order.indexOf(actor.id), nextIndex = (index + 1) % world.combat.order.length;
      world.combat.activeId = world.combat.order[nextIndex];
      if (nextIndex === 0) world.combat.round++;
      message = `${actor.character.name}: end turn`;
      details.push(`${actorById(world, world.combat.activeId).character.name}'s turn / Round ${world.combat.round}`);
      break;
    }
    case 'time':
      if (command.action === 'end-turn') throw new Error('Use the turn command.');
      world.actors.forEach(actor => { actor.character = applyCharacterTimeProgression(actor.character, command.action); });
      if (command.action === 'end-battle') world.combat.running = false;
      message = command.action.replace(/-/g, ' ');
      break;
    case 'roll': {
      const actor = control(command.actorId);
      const roll = resolveFormula(command.formula, targetContext(actor, actor, world), command.inputs, true);
      message = `${actor.character.name}: ${roll.outcome || roll.total}`;
      details.push(command.formula, ...roll.details);
      break;
    }
    case 'action': {
      const actor = control(command.actorId);
      requireTurn(world, actor);
      const action = getActions(actor).find(a => a.id === command.actionId);
      if (!action) throw new Error('This action is no longer available.');
      if (action.battleSettings?.enabled) {
        animations.push({ actorId: actor.id, animation: action.battleSettings.animation || (action.sourceKind === 'spell' ? 'cast' : 'attack'), delay: 0 });
        message = executeBattleAction(world, actor, action, command.anchor || actor.position, command.targetId, command.inputs, command.choices || {}, envelope.role === 'dm', details, command.targetIds, command.destinations || {}, animations);
        break;
      }
      const target = actorById(world, command.targetId);
      if (envelope.role !== 'dm' && (target.hidden || tileAt(sceneOf(world), target.position).hidden)) throw new Error('Target is hidden.');
      const extension = actor.extensions[action.id] || defaultExtension();
      if (extension.reaction) throw new Error('Reaction actions require a matching event.');
      message = executeAction(world, actor, target, action, extension, command.inputs, details, command.itemId);
      animations.push({ actorId: actor.id, animation: action.sourceKind === 'spell' ? 'cast' : 'attack', delay: 0 });
      break;
    }
    case 'reaction': {
      const pending = world.pending;
      if (!pending?.queue.length) throw new Error('No reaction is waiting.');
      const request = pending.queue[0], actor = control(request.actorId), target = actorById(world, pending.actorId);
      if (command.use) {
        const action = getActions(actor).find(a => a.id === request.actionId);
        if (!action) throw new Error('Reaction is no longer available.');
        message = executeAction(world, actor, target, action, actor.extensions[action.id], command.inputs, details, command.itemId);
      } else message = `${actor.character.name}: reaction declined`;
      pending.queue.shift();
      if (!pending.queue.length) {
        motion = { actorId: target.id, sceneId: world.sceneId, path: [{ ...target.position }] };
        advanceMovement(world, target, pending.path, details, motion.path, true);
      }
      break;
    }
    case 'cancel-move': world.pending = null; message = 'Movement cancelled'; break;
    case 'bar': {
      const actor = control(command.actorId);
      details.push(changeBar(actor, command.barId, command.value, command.operation === 'set', command.canOverflow));
      message = `${actor.character.name}: manual bar update`; break;
    }
    case 'actor-settings': {
      const actor = control(command.actorId);
      if (!Number.isFinite(command.initiative)) throw new Error('Invalid initiative.');
      if (command.sprite !== undefined && !Object.prototype.hasOwnProperty.call(SPRITES, command.sprite)) throw new Error('Unknown sprite preset.');
      for (const id of Object.values(command.bindings)) if (id && !actor.character.bars?.some(b => b.id === id)) throw new Error('Resource binding points to a missing bar.');
      Object.assign(actor, { bindings: command.bindings, team: command.team, initiative: command.initiative, state: command.state, locked: command.locked, hidden: command.hidden });
      if (command.sprite !== undefined) actor.sprite = command.sprite;
      message = `${actor.character.name}: settings updated`; break;
    }
    case 'battle-settings': {
      const actor = control(command.actorId), action = getActions(actor).find(a => a.id === command.actionId);
      if (!action?.actionId) throw new Error('Choose an object action.');
      const entry = sourceEntry(actor, action)?.actions?.find(a => a.id === action.actionId);
      if (!entry) throw new Error('Action no longer exists.');
      validateBattleSettings(command.settings);
      entry.battleSettings = structuredClone(command.settings);
      if (command.effects) entry.effects = structuredClone(command.effects);
      validateSnapshot(actor.character);
      message = `${actor.character.name}: ${action.name} battle settings updated`; break;
    }
    case 'extension': {
      const actor = control(command.actorId), ext = command.extension;
      if (!getActions(actor).some(a => a.id === command.actionId)) throw new Error('Action not found.');
      if (!Number.isFinite(ext.range) || ext.range < 0 || !Number.isFinite(ext.cost) || ext.cost < 0) throw new Error('Range and cost must be non-negative numbers.');
      actor.extensions[command.actionId] = ext; message = `${actor.character.name}: battle action updated`; break;
    }
    case 'status': {
      const actor = control(command.actorId), status = actor.character.statuses?.find(s => s.id === command.statusId);
      if (!status) throw new Error('Status not found.');
      if (command.operation === 'delete') actor.character.statuses = actor.character.statuses?.filter(s => s.id !== status.id);
      else status.active = status.active === false;
      message = `${actor.character.name}: ${status.name} ${command.operation === 'delete' ? 'removed' : status.active ? 'activated' : 'deactivated'}`;
      break;
    }
    case 'death-save': {
      const actor = control(command.actorId);
      if (command.result === 'clear') actor.deathSaves = { successes: 0, failures: 0 };
      else if (command.result === 'success') actor.deathSaves.successes = Math.min(3, actor.deathSaves.successes + 1);
      else actor.deathSaves.failures = Math.min(3, actor.deathSaves.failures + 1);
      message = `${actor.character.name}: death save ${command.result}`; break;
    }
    case 'add-actor': {
      if (world.actors.length >= 24) throw new Error('This demo supports 24 combatants.');
      if (world.actors.some(a => a.id === command.actor.id)) throw new Error('Combatant ID already exists.');
      validateSnapshot(command.actor.character);
      world.actors.push({ ...structuredClone(command.actor), placed: false });
      message = `${command.actor.character.name} added to roster`; break;
    }
    case 'remove-actor': {
      const actor = control(command.actorId);
      world.actors = world.actors.filter(a => a.id !== actor.id);
      removeFromInitiative(world, actor.id);
      world.scenes.forEach(scene => { if (scene.placements) delete scene.placements[actor.id]; });
      message = `${actor.character.name} removed`; break;
    }
    case 'unplace-actor': {
      const actor = control(command.actorId);
      actor.placed = false;
      removeFromInitiative(world, actor.id);
      message = `${actor.character.name}: token removed from map`; break;
    }
    case 'place-actor': {
      const actor = control(command.actorId), p = command.destination, scene = sceneOf(world);
      if (isPlaced(actor)) throw new Error('This character is already on the map.');
      if (world.mode === 'battle') {
        if (!inside(scene, p) || !isGround(tileAt(scene, p)) || world.actors.some(a => isPlaced(a) && samePoint(a.position, p))) throw new Error('Choose an empty floor tile.');
        actor.position = p;
      } else {
        if (![p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error('Invalid scene position.');
        actor.roleplayPosition = p;
      }
      actor.placed = true;
      if (world.combat.running && !world.combat.order.includes(actor.id)) world.combat.order.push(actor.id);
      message = `${actor.character.name} placed on map`; break;
    }
    case 'tile': {
      const scene = sceneOf(world), tile = command.tile;
      if (!['floor', 'wall', 'difficult', 'void'].includes(tile.terrain) || !Number.isInteger(tile.elevation) || tile.elevation < 0 || tile.elevation > 10) throw new Error('Invalid tile.');
      if (world.actors.some(a => isPlaced(a) && samePoint(a.position, command.position)) && !isGround(tile)) throw new Error('Move the token before removing its floor.');
      if (!inside(scene, command.position)) { materializeScene(scene); includePoint(scene, command.position); }
      scene.tiles[keyOf(command.position)] = tile; message = `Tile ${keyOf(command.position)} updated`; break;
    }
    case 'rules': {
      const r = command.rules;
      if (![r.orthogonalCost, r.diagonalCost, r.elevationCost, r.maxStepHeight].every(Number.isFinite) || r.orthogonalCost <= 0 || r.diagonalCost <= 0 || r.elevationCost < 0 || r.maxStepHeight < 0) throw new Error('Invalid movement rules.');
      world.rules = r; message = 'Movement rules updated'; break;
    }
    case 'scene': {
      const scene = world.scenes.find(s => s.id === command.sceneId);
      if (!scene) throw new Error('Scene not found.');
      switchScene(world, scene);
      message = scene.name; break;
    }
    case 'scene-create': {
      if (world.scenes.length >= 12) throw new Error('This demo supports up to 12 scenes.');
      const source = sceneOf(world), name = command.name.trim();
      const width = command.copyCurrent ? source.width : command.width, height = command.copyCurrent ? source.height : command.height;
      if (!name || name.length > 80) throw new Error('Scene name must contain 1-80 characters.');
      if (world.scenes.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new Error('A scene with this name already exists.');
      if (!command.copyCurrent && ![width, height].every(n => Number.isInteger(n) && n >= 6 && n <= 100)) throw new Error('Initial floor dimensions must be between 6 and 100 tiles; the grid can expand later.');
      const scene: Scene = { id: newId(), name, width, height, background: command.copyCurrent ? source.background : '', tiles: command.copyCurrent ? structuredClone(source.tiles) : {}, ...(command.copyCurrent ? { sparse: source.sparse, minX: source.minX, minY: source.minY } : {}) };
      world.scenes.push(scene);
      switchScene(world, scene);
      message = `${name}: scene created`; break;
    }
    case 'scene-expand': {
      const scene = sceneOf(world), { left, right, top, bottom } = command;
      if (![left, right, top, bottom].every(n => Number.isInteger(n) && n >= 0 && n <= 100) || left + right + top + bottom === 0) throw new Error('Choose 0-100 extra tiles per edge.');
      const old = { ...scene }, minX = (scene.minX || 0) - left, minY = (scene.minY || 0) - top;
      const width = scene.width + left + right, height = scene.height + top + bottom;
      if (command.fill && width * height - scene.width * scene.height > 10000) throw new Error('Add at most 10000 floor tiles at once, or expand without floor.');
      materializeScene(scene);
      includePoint(scene, { x: minX, y: minY });
      includePoint(scene, { x: minX + width - 1, y: minY + height - 1 });
      if (command.fill) for (let y = minY; y < minY + height; y++) for (let x = minX; x < minX + width; x++) {
        if (!inside(old, { x, y })) scene.tiles[keyOf({ x, y })] = { terrain: 'floor', elevation: 0, hidden: false };
      }
      message = `Grid expanded: ${width} x ${height}`; break;
    }
    case 'scene-background': {
      if (command.url && !/^https?:\/\//i.test(command.url)) throw new Error('Use an HTTPS or HTTP image URL.');
      sceneOf(world).background = command.url; message = 'Scene background updated'; break;
    }
    case 'undo': {
      const previous = next.undo.pop();
      if (!previous) throw new Error('Nothing to undo.');
      next.world = previous.world; message = `Undone: ${previous.label}`; break;
    }
  }
  next.revision++;
  if (command.type === 'action' || command.type === 'bar') for (const actor of world.actors) {
    const before = session.world.actors.find(a => a.id === actor.id);
    if (!before || !actor.bindings.hp) continue;
    const oldHp = resourceValue(before, 'hp'), hp = resourceValue(actor, 'hp');
    if (oldHp !== undefined && hp !== undefined && oldHp !== hp) {
      const dodge = animations.findIndex(a => a.actorId === actor.id && a.animation === 'dodge');
      if (dodge >= 0) animations.splice(dodge, 1);
      animations.push({ actorId: actor.id, animation: hp < oldHp ? 'hit' : 'recover', delay: command.type === 'action' ? 350 : 0 });
    }
  }
  next.processed = [...next.processed, envelope.id].slice(-500);
  next.log = [...next.log, { id: newId(), commandId: envelope.id, revision: next.revision, type: command.type, message, details, at: Date.now(), by: envelope.by, ...(motion && motion.path.length > 1 ? { motion } : {}), ...(animations.length ? { animations } : {}) }].slice(-250);
  if (command.type !== 'undo') next.undo = [...next.undo, { world: session.world, label: message }].slice(-8);
  return next;
}
