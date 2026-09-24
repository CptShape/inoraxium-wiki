import type { CharacterData, CharacterLocalVariable, StatusEffect } from '../../types/character';
import type { CharacterTimeAction } from '../characterTime';
import type { BattleSettings } from '../../types/battle';

export type Point = { x: number; y: number };
export type SpritePreset = 'knight' | 'mage' | 'monster';
export type Tile = { terrain: 'floor' | 'wall' | 'difficult' | 'void'; elevation: number; hidden: boolean };
export type ResourceRole = 'hp' | 'movement' | 'combat' | 'reaction';
export type SourceKind = 'inventory-item' | 'general-item' | 'spell' | 'status' | 'character';
export interface ActionExtension {
  target: 'self' | 'single';
  range: number;
  cost: number;
  costResource: 'combat' | 'reaction';
  requiresLOS: boolean;
  damageFormula: string;
  defenseId: string;
  reaction?: 'leave-adjacency';
}
export interface GameAction {
  id: string;
  name: string;
  sourceName: string;
  sourceId: string;
  sourceKind: SourceKind;
  actionId?: string;
  formula: string;
  effects: StatusEffect[];
  locals: CharacterLocalVariable[];
  costLabel: string;
  remaining?: string;
  battleSettings?: BattleSettings;
}
export interface Combatant {
  id: string;
  sprite?: SpritePreset;
  character: CharacterData;
  sourceCharacterId: string;
  importedAt: number;
  position: Point;
  placed?: boolean;
  roleplayPosition: Point;
  team: 'party' | 'opposition' | 'neutral';
  initiative: number;
  state: 'active' | 'downed' | 'unconscious';
  bindings: Record<ResourceRole, string>;
  extensions: Record<string, ActionExtension>;
  locked: boolean;
  hidden: boolean;
  deathSaves: { successes: number; failures: number };
}
export interface GameRules {
  orthogonalCost: number;
  diagonalCost: number;
  elevationCost: number;
  maxStepHeight: number;
  strictTurns: boolean;
}
export interface Scene {
  id: string;
  name: string;
  width: number;
  height: number;
  minX?: number;
  minY?: number;
  sparse?: boolean;
  background: string;
  tiles: Record<string, Tile>;
  placements?: Record<string, { position: Point; roleplayPosition: Point; placed?: boolean }>;
}
export interface PendingMovement {
  actorId: string;
  path: Point[];
  queue: { actorId: string; actionId: string }[];
}
export interface GameWorld {
  name: string;
  mode: 'battle' | 'roleplay';
  scenes: Scene[];
  sceneId: string;
  actors: Combatant[];
  rules: GameRules;
  combat: { running: boolean; round: number; order: string[]; activeId: string | null };
  pending: PendingMovement | null;
}
export interface GameEvent {
  id: string;
  commandId: string;
  revision: number;
  type: Command['type'];
  message: string;
  details: string[];
  at: number;
  by: string;
  motion?: { actorId: string; sceneId: string; path: Point[] };
  animations?: { actorId: string; animation: 'attack' | 'cast' | 'hit' | 'dodge' | 'recover'; delay: number }[];
}
export interface GameSession {
  version: 1;
  revision: number;
  world: GameWorld;
  log: GameEvent[];
  processed: string[];
  undo: { world: GameWorld; label: string }[];
}
export type Command =
  | { type: 'move'; actorId: string; destination: Point }
  | { type: 'teleport'; actorId: string; destination: Point }
  | { type: 'roleplay-move'; actorId: string; destination: Point }
  | { type: 'mode'; mode: GameWorld['mode'] }
  | { type: 'start' }
  | { type: 'end-turn' }
  | { type: 'time'; action: CharacterTimeAction }
  | { type: 'roll'; actorId: string; formula: string; inputs: Record<string, number> }
  | { type: 'action'; actorId: string; targetId: string; actionId: string; inputs: Record<string, number>; itemId?: string; anchor?: Point; choices?: Record<string, string>; targetIds?: string[]; destinations?: Record<string, Point> }
  | { type: 'reaction'; use: boolean; inputs: Record<string, number>; itemId?: string }
  | { type: 'cancel-move' }
  | { type: 'bar'; actorId: string; barId: string; value: number; operation: 'set' | 'add'; canOverflow: boolean }
  | { type: 'actor-settings'; actorId: string; bindings: Combatant['bindings']; team: Combatant['team']; initiative: number; state: Combatant['state']; locked: boolean; hidden: boolean; sprite?: SpritePreset }
  | { type: 'extension'; actorId: string; actionId: string; extension: ActionExtension }
  | { type: 'battle-settings'; actorId: string; actionId: string; settings: BattleSettings; effects?: StatusEffect[] }
  | { type: 'status'; actorId: string; statusId: string; operation: 'toggle' | 'delete' }
  | { type: 'death-save'; actorId: string; result: 'success' | 'failure' | 'clear' }
  | { type: 'add-actor'; actor: Combatant }
  | { type: 'remove-actor'; actorId: string }
  | { type: 'place-actor'; actorId: string; destination: Point }
  | { type: 'unplace-actor'; actorId: string }
  | { type: 'tile'; position: Point; tile: Tile }
  | { type: 'rules'; rules: GameRules }
  | { type: 'scene'; sceneId: string }
  | { type: 'scene-create'; name: string; width: number; height: number; copyCurrent: boolean }
  | { type: 'scene-expand'; left: number; right: number; top: number; bottom: number; fill: boolean }
  | { type: 'scene-background'; url: string }
  | { type: 'undo' };
export interface CommandEnvelope {
  id: string;
  baseRevision: number;
  by: string;
  role: 'dm' | 'player';
  controlledIds: string[];
  command: Command;
}
