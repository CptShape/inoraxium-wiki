import { describe, expect, it } from 'vitest';
import { createDemo } from './demo';
import { adaptCharacter, getActions } from './adapter';
import { applyCommand, inputVariables, resourceValue } from './engine';
import { resolveFormula, resolveLocals, validateSnapshot } from './formula';
import { findMovement, hasLineOfSight, sceneOf, scenePoints, tileAt, traverse } from './map';
import { battlePlan, patternCells } from './battle';
import { defaultBattleSettings, newBattleOperation, remapBattleSettings } from '../battleSettings';
import { extensionFor } from './adapter';
import { parseBattleStatus } from '../battleStatusImport';
import type { Command, CommandEnvelope, GameSession } from './types';
import { isoLayout, projectIso, sampleMotion, terrainOccludesActor, unprojectIso, viewPoint, type Rotation } from './isometric';
import { spriteFor } from './sprites';
import { defaultSpriteSheet, resolveSpriteUrl, validateCharacterSprites, validateSpriteSheet } from '../characterSprites';

const envelope = (session: GameSession, command: Command): CommandEnvelope => ({ id: crypto.randomUUID(), baseRevision: session.revision, command, by: 'test', role: 'dm', controlledIds: [] });
const run = (session: GameSession, command: Command) => applyCommand(session, envelope(session, command));

function areaFixture() {
  const session = run(createDemo(), { type: 'start' }), [actor, low, high] = session.world.actors;
  low.position = { x: 4, y: 4 }; high.position = { x: 4, y: 5 };
  low.character.mainAttributes!.push({ id: 'wis', name: 'WIS', value: '12' });
  high.character.mainAttributes!.push({ id: 'wis', name: 'WIS', value: '32' });
  actor.character.mainAttributes!.push({ id: 'cha', name: 'CHA', value: '16' });
  const action = actor.character.spells![0].actions![0];
  action.name = 'Saving blast'; action.maxUsage = '2'; action.usageRemaining = '2';
  action.effects = [{ id: 'slow', targetId: '', value: '', effectType: 'status', statusName: 'Slowed', statusEntry: { name: 'Slowed', duration: '2', effects: [] } }];
  action.battleSettings = { ...defaultBattleSettings(), target: 'point', shape: 'burst', radius: 1, check: 'save', actorFormula: '12', targetFormula: '2d1kh1 + @wis_mod', amountFormula: '@@healing',
    landed: [newBattleOperation('damage'), { ...newBattleOperation('effect'), effectId: 'slow' }], resisted: [{ ...newBattleOperation('damage'), formula: 'rounddown(@roll.amount / 2)' }] };
  const battleAction = getActions(actor).find(a => a.battleSettings)!;
  const command: Command = { type: 'action', actorId: actor.id, actionId: battleAction.id, targetId: actor.id, anchor: { x: 4, y: 5 }, inputs: { healing: 20 } };
  return { session, actor, low, high, action, battleAction, command };
}

describe('advanced battle settings', () => {
  it('selects only requested targets, enforces count, deduplicates and checks eligibility', () => {
    const { session, action, actor, low, high, command } = areaFixture();
    const s = action.battleSettings!;
    Object.assign(s, { target: 'multiple', shape: 'single', maxTargets: '2', check: 'none', amountFormula: '2', landed: [newBattleOperation()], resisted: [] });
    const chosen = { ...command, targetIds: [high.id] };
    const next = run(session, chosen);
    expect(resourceValue(next.world.actors[1], 'hp')).toBe(24);
    expect(resourceValue(next.world.actors[2], 'hp')).toBe(26);
    expect(next.log.at(-1)?.details).toContain('Targets: 1 / Affected: 1 / Resisted: 0');
    expect(() => run(session, command)).toThrow(/Select 1-2/);
    expect(() => run(session, { ...command, targetIds: [high.id, high.id] })).toThrow(/different targets/);
    s.maxTargets = '1';
    expect(() => run(session, { ...command, targetIds: [low.id, high.id] })).toThrow(/Select 1-1/);
    s.maxTargets = '2'; s.range = '1'; high.position = { x: 13, y: 4 };
    expect(() => run(session, chosen)).toThrow(/not eligible/);
    expect(() => run(session, { ...command, targetIds: [actor.id] })).toThrow(/not eligible/);
    low.hidden = true;
    expect(battlePlan(session.world, actor, s, actor.position, '', false).targets).toHaveLength(0);
  });
  it('charges actor outcomes once or per target and keeps per-target behavior for old settings', () => {
    const { session, action, command } = areaFixture();
    const s = action.battleSettings!;
    s.check = 'none'; s.amountFormula = '0'; s.costs = [];
    s.landed = [{ ...newBattleOperation('bar'), recipient: 'actor', barId: 'bar_map', formula: '-1', frequency: 'once' }];
    expect(resourceValue(run(session, command).world.actors[0], 'movement')).toBe(5);
    delete s.landed[0].frequency;
    expect(resourceValue(run(session, command).world.actors[0], 'movement')).toBe(4);
    s.landed[0].frequency = 'once'; s.landed[0].formula = '@target.wis_mod';
    expect(() => run(session, command)).toThrow(/Unknown/);
  });
  it('supports sequential saves and independent effects from intermediate check results', () => {
    const { session, action, command } = areaFixture();
    const s = action.battleSettings!;
    s.check = 'attack'; s.actorFormula = '20'; s.targetFormula = '10'; s.amountFormula = '0';
    s.checks = [{ id: 'secondary', name: 'Wisdom save', when: 'landed', actorFormula: '12', targetFormula: '1 + @wis_mod', ties: 'target' }];
    s.landed = []; s.resisted = [];
    s.afterChecks = [{ ...newBattleOperation('damage'), formula: '3', condition: '@check.primary.landed' }, { ...newBattleOperation('effect'), effectId: 'slow', condition: '@check.secondary.landed' }];
    const next = run(session, command);
    expect(resourceValue(next.world.actors[1], 'hp')).toBe(21);
    expect(resourceValue(next.world.actors[2], 'hp')).toBe(25);
    expect(next.world.actors[1].character.statuses).toHaveLength(1);
    expect(next.world.actors[2].character.statuses || []).toHaveLength(0);
    expect(next.log.at(-1)?.details).toContain('Targets: 2 / Affected: 1 / Resisted: 1');
    s.actorFormula = '0';
    const missed = run(session, command);
    expect(resourceValue(missed.world.actors[1], 'hp')).toBe(24);
    expect(missed.world.actors[1].character.statuses || []).toHaveLength(0);
  });
  it('runs after-check actor effects once across both outcome branches', () => {
    const { session, action, command } = areaFixture();
    action.battleSettings!.afterChecks = [{ ...newBattleOperation('bar'), recipient: 'actor', barId: 'bar_map', frequency: 'once', formula: '-1' }];
    expect(resourceValue(run(session, command).world.actors[0], 'movement')).toBe(5);
  });
  it('prompts for availability and step inputs and rejects before spending when unavailable', () => {
    const { session, action, actor, command } = areaFixture();
    const s = action.battleSettings!;
    s.availability = '@@healing > 30'; s.unavailableReason = 'Need more healing';
    expect(inputVariables(getActions(actor).find(a => a.battleSettings)!, extensionFor(actor, getActions(actor).find(a => a.battleSettings)!))).toHaveLength(1);
    expect(() => run(session, command)).toThrow('Need more healing');
    expect(resourceValue(actor, 'combat')).toBe(2);
    expect(actor.character.spells![0].usageRemaining).toBe('3');
    s.availability = '1'; s.landed[0].condition = '0';
    expect(resourceValue(run(session, command).world.actors[1], 'hp')).toBe(24);
  });
  it('pushes only until an obstacle without spending the target movement resource', () => {
    const { session, action, command } = areaFixture();
    const s = action.battleSettings!; s.check = 'none'; s.amountFormula = '0';
    s.landed = [{ ...newBattleOperation('push'), formula: '4' }];
    session.world.scenes[0].tiles['6,4'] = { terrain: 'wall', elevation: 0, hidden: false };
    const next = run(session, command);
    expect(next.world.actors[1].position).toEqual({ x: 5, y: 4 });
    expect(resourceValue(next.world.actors[1], 'movement')).toBe(resourceValue(session.world.actors[1], 'movement'));
    expect(session.world.actors[1].position).toEqual({ x: 4, y: 4 });
  });
  it('pulling cannot move through its caster or occupied diagonal corners', () => {
    const { session, action, command } = areaFixture();
    const s = action.battleSettings!; s.check = 'none'; s.amountFormula = '0';
    s.landed = [{ ...newBattleOperation('pull'), formula: '4' }];
    const next = run(session, command);
    expect(next.world.actors[1].position).toEqual({ x: 4, y: 4 });
    expect(next.world.actors[2].position).toEqual({ x: 4, y: 5 });
  });
  it('teleports to validated destinations and rolls back all costs for an invalid later target', () => {
    const { session, action, low, high, actor, command } = areaFixture();
    const s = action.battleSettings!; s.check = 'none'; s.amountFormula = '0';
    const op = { ...newBattleOperation('teleport'), formula: '3' }; s.landed = [op];
    const destinations = { [`${low.id}/${op.id}`]: { x: 4, y: 3 }, [`${high.id}/${op.id}`]: { x: 4, y: 6 } };
    const next = run(session, { ...command, destinations });
    expect(next.world.actors[1].position).toEqual({ x: 4, y: 3 });
    destinations[`${high.id}/${op.id}`] = actor.position;
    expect(() => run(session, { ...command, destinations })).toThrow(/empty/);
    expect(low.position).toEqual({ x: 4, y: 4 });
    expect(resourceValue(actor, 'combat')).toBe(2);
    destinations[`${high.id}/${op.id}`] = { x: 15, y: 8 };
    expect(() => run(session, { ...command, destinations })).toThrow(/range|sight/);
  });
  it('keeps after-check imported effect references when duplicating actions', () => {
    const { action } = areaFixture();
    action.battleSettings!.afterChecks = [{ ...newBattleOperation('effect'), effectId: 'slow' }];
    expect(remapBattleSettings(action, [{ ...action.effects![0], id: 'new-status' }])!.afterChecks![0].effectId).toBe('new-status');
  });
  it('records attack/cast, actual damage and healing visuals only after a successful command', () => {
    const { session, actor, low, high, action, command } = areaFixture();
    action.battleSettings!.animation = 'cast';
    const next = run(session, command);
    expect(next.log.at(-1)?.animations).toEqual(expect.arrayContaining([
      { actorId: actor.id, animation: 'cast', delay: 0 }, { actorId: low.id, animation: 'hit', delay: 350 }, { actorId: high.id, animation: 'hit', delay: 350 },
    ]));
    expect(next.log.at(-1)?.animations?.some(a => a.animation === 'dodge')).toBe(false);
    const heal = run(next, { type: 'bar', actorId: low.id, barId: low.bindings.hp, value: 1, operation: 'add', canOverflow: false });
    expect(heal.log.at(-1)?.animations).toEqual([{ actorId: low.id, animation: 'recover', delay: 0 }]);
    expect(run(heal, { type: 'undo' }).log.at(-1)?.animations).toBeUndefined();
  });
});

describe('custom sprite contract', () => {
  it('resolves full-size Imgur and Pixhost sheets without using thumbnails', () => {
    expect(resolveSpriteUrl('https://imgur.com/abc123')).toBe('https://i.imgur.com/abc123.png');
    expect(resolveSpriteUrl('[url=https://pixhost.to/show/1/2_test.png][img]https://t3.pixhost.to/thumbs/1/2_test.png[/img][/url]')).toBe('https://img3.pixhost.to/images/1/2_test.png');
    expect(() => resolveSpriteUrl('https://imgur.com/a/abc123')).toThrow(/full-size/);
    expect(() => resolveSpriteUrl('https://pixhost.to/show/1/2_test.png')).toThrow(/full-size/);
    expect(() => resolveSpriteUrl('javascript:alert(1)')).toThrow();
    expect(() => resolveSpriteUrl('https://i.imgur.com.evil.test/abc.png')).toThrow();
  });
  it('validates frame sizes, sheet limits, frame count, anchors and FPS', () => {
    const clip = { ...defaultSpriteSheet(), url: 'https://i.imgur.com/abc.png' };
    expect(validateSpriteSheet(clip)).toEqual({ width: 512, height: 128 });
    for (const patch of [{ frameWidth: 257 }, { frames: 65 }, { fps: 31 }, { fps: 0 }, { columns: 5 }, { anchorY: 2 }, { frameHeight: NaN }, { columns: 64, frames: 64, frameWidth: 256 }]) expect(() => validateSpriteSheet({ ...clip, ...patch })).toThrow();
    expect(() => validateCharacterSprites({ version: 1, preset: 'mage', clips: { idle: clip } })).not.toThrow();
    const actor = createDemo().world.actors[0]; delete actor.sprite;
    actor.character.sprites = { version: 1, preset: 'monster', clips: { idle: clip } };
    expect(spriteFor(actor)).toBe('monster');
    expect(adaptCharacter(actor.character, { x: 0, y: 0 }).character.sprites).toEqual(actor.character.sprites);
  });
});

describe('battle action settings', () => {
  it('exposes final target counters consistently to shared amount, every outcome and costs', () => {
    const { session, action, command } = areaFixture();
    const s = action.battleSettings!;
    s.amountFormula = '@action.target.quantity + @action.target.affected * 10 + @action.target.resisted';
    s.costs = [{ id: 'cap', resource: 'combat', barId: '', formula: '@action.target.affected' }, { id: 'map', resource: 'movement', barId: '', formula: '@action.target.quantity' }];
    s.landed = [{ ...newBattleOperation(), formula: '@roll.amount' }];
    s.resisted = [{ ...newBattleOperation(), formula: '@action.target.affected + @action.target.resisted' }];
    const next = run(session, command);
    expect(resourceValue(next.world.actors[0], 'combat')).toBe(1);
    expect(resourceValue(next.world.actors[0], 'movement')).toBe(4);
    expect(resourceValue(next.world.actors[1], 'hp')).toBe(11);
    expect(resourceValue(next.world.actors[2], 'hp')).toBe(26);
    expect(next.log.at(-1)?.details).toContain('Targets: 2 / Affected: 1 / Resisted: 1');
    s.check = 'none'; s.costs = [];
    const automatic = run(session, command);
    expect(automatic.log.at(-1)?.details).toContain('Targets: 2 / Affected: 2 / Resisted: 0');
  });
  it('aggregates costs sharing a bar and rejects all changes when any combined cost is unaffordable', () => {
    const { session, actor, action, command } = areaFixture();
    const s = action.battleSettings!;
    s.costs = [{ id: 'cap', resource: 'combat', barId: '', formula: '1' }, { id: 'same', resource: 'bar', barId: 'bar_cap', formula: '2' }];
    expect(() => run(session, command)).toThrow(/Not enough bar_cap/);
    expect(actor.character.spells![0].usageRemaining).toBe('3');
    expect(resourceValue(session.world.actors[1], 'hp')).toBe(24);
    actor.character.bars!.push({ id: 'bar_mana', name: 'Mana', currentValue: '10', maxValue: '10' });
    s.costs = [{ id: 'cap', resource: 'combat', barId: '', formula: '1' }, { id: 'map', resource: 'movement', barId: '', formula: '2' }, { id: 'mana', resource: 'bar', barId: 'bar_mana', formula: '3' }];
    const next = run(session, command);
    expect(next.world.actors[0].character.bars!.find(b => b.id === 'bar_mana')!.currentValue).toBe('7');
    expect(resourceValue(next.world.actors[0], 'combat')).toBe(1);
    expect(resourceValue(next.world.actors[0], 'movement')).toBe(4);
    s.costs[0].formula = '-1';
    expect(() => run(session, command)).toThrow(/non-negative/);
  });
  it('uses source-owned local formulas in target saves and disallows circular post-save dependencies', () => {
    const { session, actor, action, command } = areaFixture();
    actor.character.spells![0].localVariables!.push({ id: 'caster_dc', description: '', value: '@cha_mod + 9' });
    action.battleSettings!.targetFormula = '@@caster_dc';
    let next = run(session, command);
    expect(next.log.at(-1)?.details).toContain('Targets: 2 / Affected: 0 / Resisted: 2');
    action.battleSettings!.amountFormula = '@action.target.affected';
    action.battleSettings!.targetFormula = '@roll.amount';
    expect(() => run(session, command)).toThrow(/Unknown value: @roll.amount/);
    action.battleSettings!.check = 'none';
    Reflect.deleteProperty(actor.character.spells![0], 'totalUsage');
    Reflect.deleteProperty(actor.character.spells![0], 'usageRemaining');
    next = run(session, command);
    expect(next.log.at(-1)?.details).toContain('Targets: 2 / Affected: 2 / Resisted: 0');
  });
  it('imports clipboard status exports without reusing instance IDs and rejects other asset kinds', () => {
    const payload = { schema: 'inoraxium-character-entry', version: 1, kind: 'status', entry: { id: 'source', name: 'Stunned', duration: '1', effects: [{ targetId: 'str_mod', value: '-2' }] } };
    const first = parseBattleStatus(JSON.stringify(payload)), second = parseBattleStatus(JSON.stringify(payload));
    expect(first.effectType).toBe('status');
    expect(first.id).not.toBe(second.id);
    expect(first.statusEntry?.effects?.[0].targetId).toBe('str_mod');
    expect(() => parseBattleStatus(JSON.stringify({ ...payload, kind: 'item' }))).toThrow(/status export/);
    expect(() => parseBattleStatus(JSON.stringify({ ...payload, entry: {} }))).toThrow(/Invalid/);
  });
  it('resolves each target save in its own context, charges once, and uses landed/resisted branches', () => {
    const { session, actor, battleAction, command } = areaFixture();
    expect(inputVariables(battleAction, extensionFor(actor, battleAction)).map(v => v.id)).toEqual(['healing']);
    const next = run(session, command), [caster, low, high] = next.world.actors;
    expect(resourceValue(caster, 'combat')).toBe(1);
    expect(caster.character.spells![0].usageRemaining).toBe('2');
    expect(caster.character.spells![0].actions![0].usageRemaining).toBe('1');
    expect(resourceValue(low, 'hp')).toBe(4);
    expect(resourceValue(high, 'hp')).toBe(18);
    expect(low.character.statuses?.[0].name).toBe('Slowed');
    expect(high.character.statuses || []).toHaveLength(0);
    expect(next.log.at(-1)?.details.join(' ')).toContain('12 vs 12');
    expect(session.world.actors[0].character.spells![0].usageRemaining).toBe('3');
  });
  it('supports opposed actor CHA vs target WIS, explicit tie policy and no effect on a resisted result', () => {
    const fixture = areaFixture(), s = fixture.action.battleSettings!;
    s.check = 'opposed'; s.actorFormula = '1d1 + @cha_mod'; s.targetFormula = '1d1 + @wis_mod'; s.resisted = [];
    let next = run(fixture.session, fixture.command);
    expect(resourceValue(next.world.actors[1], 'hp')).toBe(4);
    expect(resourceValue(next.world.actors[2], 'hp')).toBe(28);
    s.actorFormula = '12'; s.ties = 'actor';
    next = run(fixture.session, fixture.command);
    expect(resourceValue(next.world.actors[2], 'hp')).toBe(8);
  });
  it('rolls back every target, usage and AP when a later target cannot receive an operation', () => {
    const { session, high, command } = areaFixture();
    high.bindings.hp = '';
    const before = structuredClone(session);
    expect(() => run(session, command)).toThrow(/bar not found/);
    expect(session).toEqual(before);
    if (command.type === 'action') expect(() => run(session, { ...command, inputs: {} })).toThrow(/input|value/i);
  });
  it('rejects range violations, hidden targets and missing effect links without charging', () => {
    const { session, actor, action, command } = areaFixture();
    action.battleSettings!.range = '0';
    expect(() => run(session, command)).toThrow(/range/);
    action.battleSettings!.range = '6';
    action.battleSettings!.landed[1].effectId = 'deleted';
    expect(() => run(session, command)).toThrow(/missing action effect/);
    action.battleSettings!.landed[1].effectId = 'slow';
    session.world.actors[1].hidden = true; session.world.actors[2].hidden = true;
    expect(() => applyCommand(session, { ...envelope(session, command), role: 'player', controlledIds: [actor.id] })).toThrow(/No eligible/);
  });
  it('previews the same faction, area and line-of-sight selection used by execution', () => {
    const { session, actor, action, low, high } = areaFixture(), s = action.battleSettings!;
    s.faction = 'enemies';
    expect(battlePlan(session.world, actor, s, { x: 4, y: 5 }, actor.id, true).targets.map(a => a.id)).toEqual([high.id]);
    s.faction = 'allies';
    expect(battlePlan(session.world, actor, s, { x: 4, y: 5 }, actor.id, true).targets.map(a => a.id)).toEqual([low.id]);
    expect(patternCells({ ...s, shape: 'square', radius: 1 }, actor.position, { x: 5, y: 5 })).toHaveLength(9);
    expect(patternCells({ ...s, shape: 'burst', radius: 1 }, actor.position, { x: 5, y: 5 })).toHaveLength(5);
    expect(patternCells({ ...s, shape: 'line', length: 3, width: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    const cone = patternCells({ ...s, shape: 'cone', length: 3 }, { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(cone).toContainEqual({ x: 2, y: 1 }); expect(cone).not.toContainEqual({ x: -1, y: 0 });
    expect(patternCells({ ...s, shape: 'custom', cells: [{ x: -1, y: 0 }, { x: 1, y: 0 }] }, actor.position, { x: 5, y: 5 })).toEqual([{ x: 4, y: 5 }, { x: 6, y: 5 }]);
  });
  it('preserves outcome references when imported effects receive new IDs', () => {
    const { action } = areaFixture();
    const effects = action.effects!.map(e => ({ ...e, id: crypto.randomUUID() }));
    const copy = remapBattleSettings(action, effects)!;
    expect(copy.landed[1].effectId).toBe(effects[0].id);
    expect(action.battleSettings!.landed[1].effectId).toBe('slow');
    expect(JSON.parse(JSON.stringify(copy))).toEqual(copy);
  });
});

describe('expandable sparse maps', () => {
  it('expands beyond the old size in all directions without moving characters or filling void', () => {
    const initial = createDemo(), positions = initial.world.actors.map(a => a.position);
    const next = run(initial, { type: 'scene-expand', left: 20, right: 20, top: 5, bottom: 5, fill: false }), scene = sceneOf(next.world);
    expect(scene.width).toBe(58); expect(scene.minX).toBe(-20);
    expect(scenePoints(scene)).toHaveLength(216);
    expect(tileAt(scene, { x: -1, y: 4 }).terrain).toBe('void');
    expect(next.world.actors.map(a => a.position)).toEqual(positions);
    expect(findMovement(next.world, next.world.actors[0], { x: -1, y: 4 }).path).toHaveLength(0);
    const painted = run(next, { type: 'tile', position: { x: -25, y: 0 }, tile: { terrain: 'floor', elevation: 0, hidden: false } });
    expect(sceneOf(painted.world).minX).toBe(-25);
    expect(tileAt(sceneOf(painted.world), { x: -24, y: 0 }).terrain).toBe('void');
    expect(tileAt(sceneOf(run(painted, { type: 'undo' }).world), { x: -25, y: 0 }).terrain).toBe('void');
  });
  it('can add floor strips, preserves negative-coordinate scenes and blocks deleting occupied floor', () => {
    const initial = createDemo();
    const next = run(initial, { type: 'scene-expand', left: 2, right: 0, top: 0, bottom: 0, fill: true });
    expect(tileAt(sceneOf(next.world), { x: -2, y: 3 }).terrain).toBe('floor');
    const copied = run(next, { type: 'scene-create', name: 'Wide', width: 20, height: 12, copyCurrent: true });
    expect(sceneOf(copied.world).minX).toBe(-2);
    expect(() => run(initial, { type: 'tile', position: initial.world.actors[0].position, tile: { terrain: 'void', elevation: 0, hidden: false } })).toThrow(/floor/);
    expect(() => applyCommand(initial, { ...envelope(initial, { type: 'scene-expand', left: 1, right: 0, top: 0, bottom: 0, fill: false }), role: 'player' })).toThrow(/DM/);
  });
});

describe('isometric presentation', () => {
  it('picks the same negative-coordinate cell at every rotation and separates supporting floor from occluders', () => {
    const scene = { ...sceneOf(createDemo().world), minX: -20, minY: -10, width: 58, height: 25 };
    for (const rotation of [0, 1, 2, 3] as Rotation[]) for (const p of [{ x: -21, y: -11 }, { x: 2, y: 4 }, { x: 40, y: 15 }]) {
      expect(unprojectIso(projectIso(p, 0, scene, rotation), scene, rotation)).toEqual(p);
    }
    expect(terrainOccludesActor({ x: 4, y: 4 }, 0, { x: 3.8, y: 4 }, 0)).toBe(false);
    expect(terrainOccludesActor({ x: 4, y: 4 }, 3, { x: 4, y: 4 }, 3)).toBe(false);
    expect(terrainOccludesActor({ x: 4, y: 4 }, 3, { x: 4, y: 3 }, 0)).toBe(true);
    expect(terrainOccludesActor({ x: 4, y: 4 }, 3, { x: 4, y: 5 }, 0)).toBe(false);
    expect(terrainOccludesActor({ x: 4, y: 4 }, 2, { x: 4, y: 3 }, 3)).toBe(false);
  });
  it('projects rectangular maps into bounds at every rotation without changing logical coordinates', () => {
    const scene = sceneOf(createDemo().world);
    for (const rotation of [0, 1, 2, 3] as Rotation[]) {
      const layout = isoLayout(scene, rotation), positions = new Set<string>();
      for (let x = 0; x < scene.width; x++) for (let y = 0; y < scene.height; y++) {
        const point = { x, y }, screen = projectIso(point, 0, scene, rotation);
        positions.add(`${screen.x},${screen.y}`);
        expect(screen.x).toBeGreaterThan(0);
        expect(screen.x).toBeLessThan(layout.width);
        expect(screen.y).toBeGreaterThan(0);
        expect(screen.y).toBeLessThan(layout.height);
        expect(point).toEqual({ x, y });
      }
      expect(positions.size).toBe(scene.width * scene.height);
    }
    expect(viewPoint({ x: 2, y: 3 }, scene, 1)).toEqual({ x: 3, y: 15 });
    const a = projectIso({ x: 2, y: 3 }, 0, scene, 0), b = projectIso({ x: 2, y: 3 }, 2, scene, 0);
    expect(b.y).toBe(a.y - 36);
  });
  it('samples only the committed path and clamps animation timestamps', () => {
    const path = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }];
    expect(sampleMotion(path, -.1)).toEqual(path[0]);
    expect(sampleMotion(path, .5)).toEqual({ x: 1.5, y: 1 });
    expect(sampleMotion(path, 1.5)).toEqual({ x: 2, y: 1.5 });
    expect(sampleMotion(path, 100)).toEqual(path[2]);
  });
  it('supports old saves and persists appearance without modifying source sheets', () => {
    const session = createDemo(), actor = session.world.actors[0];
    expect(session.world.actors.map(spriteFor)).toEqual(['knight', 'mage', 'monster']);
    const command: Command = { type: 'actor-settings', actorId: actor.id, bindings: actor.bindings, team: actor.team, initiative: actor.initiative, state: actor.state, locked: false, hidden: false, sprite: 'mage' };
    const next = run(session, command);
    expect(spriteFor(JSON.parse(JSON.stringify(next.world.actors[0])))).toBe('mage');
    expect(next.world.actors[0].character).toEqual(actor.character);
    expect(spriteFor(run(next, { type: 'undo' }).world.actors[0])).toBe('knight');
    expect(() => run(session, { ...command, sprite: 'invalid' as 'mage' })).toThrow(/sprite/);
    expect(() => applyCommand(session, { ...envelope(session, command), role: 'player', controlledIds: [actor.id] })).toThrow(/DM/);
  });
  it('records only actual movement, including pauses, resumes and teleports', () => {
    let session = run(createDemo(), { type: 'start' });
    const actorId = session.world.actors[0].id;
    session.world.actors[2].position = { x: 4, y: 4 };
    session = run(session, { type: 'move', actorId, destination: { x: 2, y: 4 } });
    expect(session.log.at(-1)?.motion).toBeUndefined();
    session = run(session, { type: 'reaction', use: false, inputs: {} });
    expect(session.log.at(-1)?.motion).toEqual({ actorId, sceneId: 'courtyard', path: [{ x: 3, y: 4 }, { x: 2, y: 4 }] });
    expect(resourceValue(session.world.actors[0], 'movement')).toBe(5);
    session = run(session, { type: 'teleport', actorId, destination: { x: 1, y: 4 } });
    expect(session.log.at(-1)?.motion).toBeUndefined();
    session = run(session, { type: 'undo' });
    expect(session.log.at(-1)?.motion).toBeUndefined();
  });
});

describe('command boundary', () => {
  it('keeps imported characters in the roster until placement, and preserves a removed token character', () => {
    const initial = createDemo(), actor = adaptCharacter(initial.world.actors[0].character, { x: 3, y: 4 });
    let next = run(initial, { type: 'add-actor', actor });
    expect(next.world.actors.at(-1)?.placed).toBe(false);
    expect(() => run(next, { type: 'place-actor', actorId: actor.id, destination: { x: 3, y: 4 } })).toThrow(/empty floor/);
    next = run(next, { type: 'place-actor', actorId: actor.id, destination: { x: 4, y: 4 } });
    next = run(next, { type: 'start' });
    expect(next.world.combat.order).toContain(actor.id);
    next = run(next, { type: 'unplace-actor', actorId: actor.id });
    expect(next.world.actors.at(-1)?.placed).toBe(false);
    expect(next.world.actors.at(-1)?.character).toEqual(actor.character);
    expect(next.world.combat.order).not.toContain(actor.id);
    next = run(JSON.parse(JSON.stringify(next)), { type: 'place-actor', actorId: actor.id, destination: { x: 5, y: 4 } });
    expect(next.world.combat.order).toContain(actor.id);
    expect(() => applyCommand(next, { ...envelope(next, { type: 'unplace-actor', actorId: actor.id }), role: 'player', controlledIds: [actor.id] })).toThrow(/DM/);
    next = run(next, { type: 'remove-actor', actorId: actor.id });
    expect(next.world.actors.some(a => a.id === actor.id)).toBe(false);
    expect(next.world.combat.order).not.toContain(actor.id);
  });
  it('removes the active token without stranding initiative and remembers per-scene absence', () => {
    let next = run(createDemo(), { type: 'start' });
    const first = next.world.actors[0].id, second = next.world.actors[1].id;
    next = run(next, { type: 'unplace-actor', actorId: first });
    expect(next.world.combat.activeId).toBe(second);
    next = run(next, { type: 'time', action: 'end-battle' });
    next = run(next, { type: 'scene', sceneId: 'camp' });
    expect(next.world.actors.every(a => a.placed === false)).toBe(true);
    next = run(next, { type: 'place-actor', actorId: first, destination: { x: 2, y: 2 } });
    next = run(next, { type: 'scene', sceneId: 'courtyard' });
    expect(next.world.actors[0].placed).toBe(false);
    expect(next.world.actors[1].placed).toBe(true);
    next = run(next, { type: 'remove-actor', actorId: first });
    expect(next.world.scenes[1].placements?.[first]).toBeUndefined();
  });
  it('creates independent scenes with valid placements and atomically rejects invalid creation', () => {
    const initial = createDemo(), oldPositions = initial.world.actors.map(a => a.position);
    const command: Command = { type: 'scene-create', name: 'Small arena', width: 6, height: 6, copyCurrent: false };
    let next = run(initial, command);
    expect(sceneOf(next.world).width).toBe(6);
    expect(new Set(next.world.actors.map(a => `${a.position.x},${a.position.y}`)).size).toBe(3);
    expect(next.world.actors.every(a => a.placed === false)).toBe(true);
    expect(initial.world.scenes).toHaveLength(2);
    next = run(next, { type: 'scene', sceneId: 'courtyard' });
    expect(next.world.actors.map(a => a.position)).toEqual(oldPositions);
    const copy = run(next, { ...command, name: 'Courtyard copy', copyCurrent: true });
    expect(sceneOf(copy.world).tiles).toEqual(sceneOf(next.world).tiles);
    sceneOf(copy.world).tiles['0,0'].elevation = 5;
    expect(copy.world.scenes[0].tiles['0,0'].elevation).toBe(0);
    expect(() => run(initial, { ...command, width: 0 })).toThrow(/dimensions/);
    expect(() => run(initial, { ...command, name: 'Camp' })).toThrow(/already exists/);
    expect(() => run(run(initial, { type: 'start' }), command)).toThrow(/End battle/);
    expect(() => applyCommand(initial, { ...envelope(initial, command), role: 'player' })).toThrow(/DM/);
  });
  it('preserves independent placements when switching scenes', () => {
    const initial = createDemo(), actor = initial.world.actors[0];
    let next = run(initial, { type: 'scene', sceneId: 'camp' });
    next = run(next, { type: 'place-actor', actorId: actor.id, destination: { x: 8, y: 8 } });
    next = run(next, { type: 'scene', sceneId: 'courtyard' });
    expect(next.world.actors[0].position).toEqual(actor.position);
    next = run(next, { type: 'scene', sceneId: 'camp' });
    expect(next.world.actors[0].position).toEqual({ x: 8, y: 8 });
  });
  it('deduplicates a command and rejects stale commands without mutating the old state', () => {
    const initial = createDemo(), command = envelope(initial, { type: 'start' });
    const next = applyCommand(initial, command);
    expect(initial.world.combat.running).toBe(false);
    expect(next.world.combat.running).toBe(true);
    expect(applyCommand(next, command)).toBe(next);
    expect(() => applyCommand(next, envelope(initial, { type: 'end-turn' }))).toThrow(/changed/);
  });
  it('blocks DM operations and another player\'s combatant', () => {
    const initial = createDemo();
    expect(() => applyCommand(initial, { ...envelope(initial, { type: 'start' }), role: 'player' })).toThrow(/DM/);
    expect(() => applyCommand(initial, { ...envelope(initial, { type: 'move', actorId: initial.world.actors[0].id, destination: { x: 4, y: 4 } }), role: 'player' })).toThrow(/control/);
  });
  it('undo restores the world while preserving append-only event history and monotonic revision', () => {
    const initial = createDemo();
    const next = run(run(initial, { type: 'start' }), { type: 'undo' });
    expect(next.world).toEqual(initial.world);
    expect(next.revision).toBe(2);
    expect(next.log).toHaveLength(2);
    expect(next.undo).toHaveLength(0);
  });
  it('takes an independent character snapshot', () => {
    const original = createDemo().world.actors[0].character;
    const copy = adaptCharacter(original, { x: 1, y: 1 });
    copy.character.bars![0].currentValue = '1';
    expect(original.bars![0].currentValue).toBe('32');
  });
});

describe('movement', () => {
  it('uses the same traversal cost for preview and execution', () => {
    const initial = run(createDemo(), { type: 'start' }), actor = initial.world.actors[0];
    const movement = findMovement(initial.world, actor, { x: 5, y: 5 });
    expect(movement.path[0]).toEqual(actor.position);
    expect(movement.path.at(-1)).toEqual({ x: 5, y: 5 });
    expect(movement.cost).toBe(3);
    const next = run(initial, { type: 'move', actorId: actor.id, destination: { x: 5, y: 5 } });
    expect(resourceValue(next.world.actors[0], 'movement')).toBe(3);
  });
  it('finds the cheaper detour when direct tiles are expensive', () => {
    const initial = createDemo(), actor = initial.world.actors[0];
    actor.position = { x: 2, y: 2 };
    sceneOf(initial.world).tiles = { '3,2': { terrain: 'floor', elevation: 1, hidden: false } };
    initial.world.rules.elevationCost = 20;
    const movement = findMovement(initial.world, actor, { x: 4, y: 2 });
    expect(movement.cost).toBe(4);
    expect(movement.path).not.toContainEqual({ x: 3, y: 2 });
  });
  it('blocks diagonal corner cutting, occupied tiles and excessive steps', () => {
    const initial = createDemo(), actor = initial.world.actors[0];
    actor.position = { x: 5, y: 3 };
    expect(traverse(initial.world, actor, actor.position, { x: 6, y: 2 }).allowed).toBe(false);
    expect(traverse(initial.world, actor, { x: 3, y: 6 }, initial.world.actors[1].position).allowed).toBe(false);
    sceneOf(initial.world).tiles['4,3'] = { terrain: 'floor', elevation: 3, hidden: false };
    expect(traverse(initial.world, actor, actor.position, { x: 4, y: 3 }).allowed).toBe(false);
  });
  it('rejects unaffordable movement and the wrong turn', () => {
    const initial = run(createDemo(), { type: 'start' });
    expect(() => run(initial, { type: 'move', actorId: initial.world.actors[1].id, destination: { x: 4, y: 7 } })).toThrow(/turn/);
    expect(() => run(initial, { type: 'move', actorId: initial.world.actors[0].id, destination: { x: 15, y: 9 } })).toThrow(/movement AP/);
    expect(resourceValue(initial.world.actors[0], 'movement')).toBe(6);
  });
  it('pauses before leaving adjacency and resumes once without charging twice', () => {
    const initial = run(createDemo(), { type: 'start' });
    const actor = initial.world.actors[0];
    initial.world.actors[2].position = { x: 4, y: 4 };
    const paused = run(initial, { type: 'move', actorId: actor.id, destination: { x: 2, y: 4 } });
    expect(paused.world.pending?.queue).toHaveLength(1);
    expect(paused.world.actors[0].position).toEqual({ x: 3, y: 4 });
    expect(resourceValue(paused.world.actors[0], 'movement')).toBe(6);
    const resumed = run(paused, { type: 'reaction', use: false, inputs: {} });
    expect(resumed.world.pending).toBeNull();
    expect(resumed.world.actors[0].position).toEqual({ x: 2, y: 4 });
    expect(resourceValue(resumed.world.actors[0], 'movement')).toBe(5);
  });
  it('can resolve a reaction after serializing and restoring the session', () => {
    const initial = run(createDemo(), { type: 'start' });
    initial.world.actors[2].position = { x: 4, y: 4 };
    const reaction = getActions(initial.world.actors[2]).find(a => a.name === 'Intercept')!;
    initial.world.actors[2].character.inventory![0].macros.find(m => m.name === 'Intercept')!.formula = '20';
    initial.world.actors[2].extensions[reaction.id].damageFormula = '5';
    const paused = run(initial, { type: 'move', actorId: initial.world.actors[0].id, destination: { x: 2, y: 4 } });
    const next = run(JSON.parse(JSON.stringify(paused)), { type: 'reaction', use: true, inputs: {} });
    expect(resourceValue(next.world.actors[0], 'hp')).toBe(27);
    expect(resourceValue(next.world.actors[2], 'reaction')).toBe(0);
    expect(next.world.pending).toBeNull();
  });
});

describe('formula compatibility and safety', () => {
  it('supports sheet/local refs, aliases, lazy IF and inclusive DC', () => {
    expect(resolveFormula('50 * @level * if(@@local_ap_reaction =< 0, 1, 0)', { level: 3 }, { local_ap_reaction: 0 }).total).toBe(150);
    expect(resolveFormula('roundup(2.1) + rounddown(2.9)', {}).total).toBe(5);
    expect(resolveFormula('if(1, 7, 1/0)', {}).total).toBe(7);
    expect(resolveFormula('DC(20, 20)', {}).outcome).toBe('Success');
    expect(resolveFormula('DC(20, 19)', {}).outcome).toBe('Failure');
    expect(resolveFormula('DC(@target.ac, 1d1 + @str_mod)', { 'target.ac': 4, str_mod: 3 }, {}, true).outcome).toBe('Success');
  });
  it('rejects missing references, non-finite values, oversized rolls and executable expressions', () => {
    expect(() => resolveFormula('@missing', {})).toThrow(/Unknown/);
    expect(() => resolveFormula('1 / 0', {})).toThrow(/finite/);
    expect(() => resolveFormula('101d20', {}, {}, true)).toThrow(/limit/);
    expect(() => resolveFormula('globalThis.alert(1)', {})).toThrow();
    const actor = createDemo().world.actors[0];
    actor.character.mainAttributes![0].value = 'if(0, globalThis.alert(1), 1)';
    expect(() => validateSnapshot(actor.character)).toThrow();
  });
  it('resolves local dependencies regardless of row order and detects cycles', () => {
    const locals = resolveLocals([{ id: 'a', value: '@@b * 2', description: '' }, { id: 'b', value: '3', description: '' }], {}, {});
    expect(locals.resolve('a')).toBe(6);
    expect(() => resolveLocals([{ id: 'a', value: '@@b', description: '' }, { id: 'b', value: '@@a', description: '' }], {}, {}).resolve('a')).toThrow(/Circular/);
  });
});

describe('resources, effects and time', () => {
  it('preserves resource bonuses when editing the effective current value', () => {
    const initial = createDemo(), actor = initial.world.actors[0];
    actor.character.inventory![0].effects = [{ targetId: 'bar_rap_current', value: '3' }];
    expect(resourceValue(actor, 'reaction')).toBe(4);
    const next = run(initial, { type: 'bar', actorId: actor.id, barId: 'bar_rap', value: -1, operation: 'add', canOverflow: false });
    expect(resourceValue(next.world.actors[0], 'reaction')).toBe(3);
    expect(next.world.actors[0].character.bars!.find(b => b.id === 'bar_rap')!.currentValue).toBe('0');
  });
  it('clamps default bars only when overflow is disabled', () => {
    const initial = createDemo(), id = initial.world.actors[0].id;
    const clamped = run(initial, { type: 'bar', actorId: id, barId: 'bar_hp', value: 100, operation: 'add', canOverflow: false });
    expect(resourceValue(clamped.world.actors[0], 'hp')).toBe(32);
    const overflow = run(initial, { type: 'bar', actorId: id, barId: 'bar_hp', value: 100, operation: 'add', canOverflow: true });
    expect(resourceValue(overflow.world.actors[0], 'hp')).toBe(132);
  });
  it('asks only referenced inputs and atomically heals, spends CAP and consumes spell uses', () => {
    let initial = run(createDemo(), { type: 'start' });
    const actor = initial.world.actors[0];
    const action = getActions(actor).find(a => a.name === 'Mend')!;
    action.locals.push({ id: 'unused', description: '', value: '0', kind: 'input' });
    expect(inputVariables(action, actor.extensions[action.id]).map(v => v.id)).toEqual(['healing']);
    initial = run(initial, { type: 'bar', actorId: actor.id, barId: 'bar_hp', value: -10, operation: 'add', canOverflow: false });
    expect(() => run(initial, { type: 'action', actorId: actor.id, targetId: actor.id, actionId: action.id, inputs: {} })).toThrow(/Input required/);
    expect(resourceValue(initial.world.actors[0], 'combat')).toBe(2);
    const next = run(initial, { type: 'action', actorId: actor.id, targetId: actor.id, actionId: action.id, inputs: { healing: 4 } });
    expect(resourceValue(next.world.actors[0], 'hp')).toBe(26);
    expect(resourceValue(next.world.actors[0], 'combat')).toBe(1);
    expect(next.world.actors[0].character.spells![0].usageRemaining).toBe('2');
  });
  it('rejects invalid targets without spending resources', () => {
    const initial = run(createDemo(), { type: 'start' }), actor = initial.world.actors[0];
    const strike = getActions(actor).find(a => a.name === 'Strike')!;
    expect(() => run(initial, { type: 'action', actorId: actor.id, actionId: strike.id, targetId: initial.world.actors[2].id, inputs: {} })).toThrow(/range/);
    expect(resourceValue(actor, 'combat')).toBe(2);
    expect(hasLineOfSight(initial.world, { x: 5, y: 4 }, { x: 7, y: 4 })).toBe(false);
  });
  it('advances only the ending combatant with the existing time rules', () => {
    let initial = run(createDemo(), { type: 'start' });
    const id = initial.world.actors[0].id;
    initial = run(initial, { type: 'bar', actorId: id, barId: 'bar_map', value: 0, operation: 'set', canOverflow: false });
    const next = run(initial, { type: 'end-turn' });
    expect(resourceValue(next.world.actors[0], 'movement')).toBe(6);
    expect(next.world.combat.activeId).toBe(initial.world.actors[1].id);
    expect(initial.world.actors[1].character).toEqual(next.world.actors[1].character);
  });
  it('requires selecting an item in array mode and allows negative quantity', () => {
    const initial = createDemo(), actor = initial.world.actors[0], item = actor.character.inventory![0];
    item.actions = [{ id: 'spend', name: 'Spend', description: '', cost: '', usageRemaining: '', effects: [{ effectType: 'item-update', targetId: '', value: '-2', itemUpdateArrayMode: true, itemUpdateIds: [item.id] }] }];
    const action = getActions(actor).find(a => a.name === 'Spend')!;
    expect(() => run(initial, { type: 'action', actorId: actor.id, targetId: actor.id, actionId: action.id, inputs: {} })).toThrow(/Choose an item/);
    const next = run(initial, { type: 'action', actorId: actor.id, targetId: actor.id, actionId: action.id, inputs: {}, itemId: item.id });
    expect(next.world.actors[0].character.inventory![0].quantity).toBe(-1);
    expect(next.log.at(-1)!.details.join(' ')).toContain('below zero');
  });
});
