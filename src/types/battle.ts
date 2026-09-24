export interface BattleCost {
  id: string;
  resource: 'combat' | 'movement' | 'reaction' | 'bar';
  barId: string;
  formula: string;
}

export interface BattleOperation {
  id: string;
  kind: 'damage' | 'healing' | 'bar' | 'effect' | 'push' | 'pull' | 'teleport';
  recipient: 'target' | 'actor';
  formula: string;
  barId: string;
  effectId: string;
  canOverflow: boolean;
  frequency?: 'per-target' | 'once';
  condition?: string;
}

export interface BattleCheck {
  id: string;
  name: string;
  when: 'always' | 'landed' | 'resisted';
  actorFormula: string;
  targetFormula: string;
  ties: 'actor' | 'target';
}

export interface BattleSettings {
  version: 1;
  enabled: boolean;
  target: 'self' | 'single' | 'point' | 'multiple';
  maxTargets?: string;
  availability?: string;
  unavailableReason?: string;
  animation?: 'attack' | 'cast';
  checks?: BattleCheck[];
  faction: 'all' | 'allies' | 'enemies';
  includeSelf: boolean;
  range: string;
  requiresLOS: boolean;
  shape: 'single' | 'burst' | 'square' | 'line' | 'cone' | 'custom';
  radius: number;
  length: number;
  width: number;
  angle: 45 | 90 | 180;
  cells: { x: number; y: number }[];
  cost: number;
  costResource: 'combat' | 'reaction';
  costs?: BattleCost[];
  check: 'none' | 'attack' | 'save' | 'opposed';
  actorFormula: string;
  targetFormula: string;
  actorRoll: 'once' | 'per-target';
  ties: 'actor' | 'target';
  amountFormula: string;
  landed: BattleOperation[];
  resisted: BattleOperation[];
  afterChecks?: BattleOperation[];
}
