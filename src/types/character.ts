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
  color?: string;
}

export interface CharacterDiceMacro {
  id: string;
  name: string;
  formula: string;
}

export interface CharacterDisplayStat {
  id: string;
  referenceId: string;
}

export interface CharacterSpell {
  id: string;
  name: string;
  description: string;
  level: string;
  resourceCost: string;
  usageRemaining: string;
  totalUsage: string;
  magicSchool: string;
  color: string;
  macros: CharacterDiceMacro[];
}

export interface CharacterInventoryItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  status: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythical' | 'unique';
  equipped?: boolean;
  macros: CharacterDiceMacro[];
  effects?: StatusEffect[];
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
  race: string;
  className: string;
  visibility?: 'private' | 'public';
  userId?: string | null;
  bio?: string;
  backstory?: string;
  notes?: string;
  portraitUrl?: string;
  createdAt?: number;
  tags?: string[];
  displayStats?: CharacterDisplayStat[];
  mainAttributes?: CustomAttribute[];
  secondaryAttributes?: CustomAttribute[];
  otherAttributes?: CustomAttribute[];
  bars?: CharacterBar[];
  diceMacros?: CharacterDiceMacro[];
  statuses?: CharacterStatus[];
  inventory?: CharacterInventoryItem[];
  spells?: CharacterSpell[];
  modifierFormula?: string;
}

export interface FavoriteRecord {
  userId: string;
  characterId: string;
  /** Firestore doc id is `${userId}_${characterId}` */
}
