export interface CustomAttribute {
  id: string;
  name: string;
  value: string;
}

export interface CharacterBar {
  id: string;
  name: string;
  currentValue: string;
  maxValue: string;
}

export interface CharacterDiceMacro {
  id: string;
  name: string;
  formula: string;
}

export interface StatusEffect {
  targetId: string;
  value: string;
}

export interface CharacterStatus {
  id: string;
  name: string;
  duration: string;
  description: string;
  effects: StatusEffect[];
}

export interface CharacterData {
  id: string;
  name: string;
  level: number;
  race: string;
  className: string;
  visibility?: 'private' | 'public';
  userId?: string | null;
  attributes?: Record<string, number>;
  bio?: string;
  createdAt?: number;
  tags?: string[];
  mainAttributes?: CustomAttribute[];
  secondaryAttributes?: CustomAttribute[];
  otherAttributes?: CustomAttribute[];
  bars?: CharacterBar[];
  diceMacros?: CharacterDiceMacro[];
  statuses?: CharacterStatus[];
  modifierFormula?: string;
}

export interface FavoriteRecord {
  userId: string;
  characterId: string;
  /** Firestore doc id is `${userId}_${characterId}` */
}
