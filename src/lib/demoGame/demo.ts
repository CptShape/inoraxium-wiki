import type { CharacterData } from '../../types/character';
import { adaptCharacter, defaultExtension, getActions } from './adapter';
import type { GameSession, Scene } from './types';

const character = (id: string, name: string, portrait: string, hp: number, modifier: number): CharacterData => ({
  id, name, race: '', className: '', portraitUrl: `${import.meta.env.BASE_URL}resources/character-portraits/${portrait}`,
  mainAttributes: [{ id: 'str', name: 'Strength', value: String(10 + modifier * 2) }],
  secondaryAttributes: [{ id: 'ac', name: 'Defense', value: '12' }],
  bars: [
    { id: 'bar_hp', name: 'HP', currentValue: String(hp), maxValue: String(hp), color: '#db6473' },
    { id: 'bar_map', name: 'Movement AP', currentValue: '6', maxValue: '', mode: 'resource', resetValue: '6', resetTrigger: 'turn-end', color: '#62c7ad' },
    { id: 'bar_cap', name: 'Combat AP', currentValue: '2', maxValue: '', mode: 'resource', resetValue: '2', resetTrigger: 'turn-end', color: '#e2c779' },
    { id: 'bar_rap', name: 'Reaction AP', currentValue: '1', maxValue: '', mode: 'resource', resetValue: '1', resetTrigger: 'turn-end', color: '#7aace8' },
  ],
  inventory: [{ id: `${id}-sword`, name: 'Training blade', description: '', quantity: 1, status: 'equipped', equipped: true, macros: [{ id: 'strike', name: 'Strike', formula: '1d20 + @str_mod' }, { id: 'reaction', name: 'Intercept', formula: '1d20 + @str_mod' }] }],
  spells: [{ id: `${id}-heal`, name: 'Mend', description: '', level: '1', resourceCost: '1 CAP', usageRemaining: '3', totalUsage: '3', magicSchool: '', color: '#62c7ad', macros: [], replenishTrigger: 'long-rest', replenishAmount: '3', localVariables: [{ id: 'healing', description: 'Healing amount', kind: 'input', value: '0' }], actions: [{ id: 'heal', name: 'Mend', description: '', cost: '1 CAP', usageRemaining: '', effects: [{ id: 'heal-effect', effectType: 'bar-update', targetId: 'bar_hp', value: '@@healing', canOverflow: false }] }] }],
});

export function createDemo(): GameSession {
  const courtyard: Scene = { id: 'courtyard', name: 'Ruined courtyard', width: 18, height: 12, background: '', tiles: {} };
  for (let x = 0; x < 18; x++) for (const y of [0, 11]) courtyard.tiles[`${x},${y}`] = { terrain: 'wall', elevation: 0, hidden: false };
  for (let y = 0; y < 12; y++) for (const x of [0, 17]) courtyard.tiles[`${x},${y}`] = { terrain: 'wall', elevation: 0, hidden: false };
  for (const [x, y] of [[6, 3], [6, 4], [6, 5], [11, 6], [11, 7], [11, 8], [12, 8]]) courtyard.tiles[`${x},${y}`] = { terrain: 'wall', elevation: 0, hidden: false };
  for (const [x, y] of [[8, 4], [8, 5], [9, 4], [9, 5], [4, 8], [5, 8]]) courtyard.tiles[`${x},${y}`] = { terrain: 'difficult', elevation: 0, hidden: false };
  const actors = [
    adaptCharacter(character('demo-warden', 'Warden', 'mountain-dwarf.png', 32, 3), { x: 3, y: 4 }),
    adaptCharacter(character('demo-arcanist', 'Arcanist', 'high-elf.png', 24, 2), { x: 3, y: 7 }),
    adaptCharacter(character('demo-sentinel', 'Sentinel', 'dark-elf.png', 28, 2), { x: 13, y: 4 }),
  ];
  actors.forEach((actor, index) => {
    actor.team = index === 2 ? 'opposition' : 'party';
    actor.initiative = 18 - index * 3;
    actor.roleplayPosition = { x: .25 + index * .25, y: .58 };
    for (const action of getActions(actor)) actor.extensions[action.id] = {
      ...defaultExtension(), target: 'single', range: action.name === 'Mend' ? 6 : 1,
      cost: 1, costResource: action.name === 'Intercept' ? 'reaction' : 'combat',
      damageFormula: action.name === 'Mend' ? '' : '1d6 + @str_mod', defenseId: action.name === 'Mend' ? '' : 'ac',
      ...(action.name === 'Intercept' ? { reaction: 'leave-adjacency' as const } : {}),
    };
  });
  return { version: 1, revision: 0, processed: [], undo: [], log: [], world: {
    name: 'Courtyard encounter', mode: 'battle', scenes: [courtyard, { id: 'camp', name: 'Camp', width: 18, height: 12, background: '', tiles: {} }], sceneId: 'courtyard', actors,
    rules: { orthogonalCost: 1, diagonalCost: 2, elevationCost: 1, maxStepHeight: 1, strictTurns: true },
    combat: { running: false, round: 1, order: [], activeId: null }, pending: null,
  } };
}
