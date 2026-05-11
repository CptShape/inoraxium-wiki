export interface CustomAttribute {
  id: string;
  name: string;
  value: string;
  favorite?: boolean;
}

export interface CharacterBar {
  id: string;
  name: string;
  currentValue: string;
  maxValue: string;
  color?: string;
  favorite?: boolean;
}

export interface SkillAttribute extends CustomAttribute {
  proficiencyMode?: 'none' | 'half' | 'proficient' | 'expertise';
}

export interface CharacterDiceMacro {
  id: string;
  name: string;
  formula: string;
}

export interface CharacterEntryFolder {
  id: string;
  name: string;
  color: string;
  parentId?: string | null;
  hidden?: boolean;
}

export interface CharacterAction {
  id: string;
  name: string;
  description: string;
  cost: string;
  usageRemaining: string;
  macros?: CharacterDiceMacro[];
  effects?: StatusEffect[];
}

export interface CharacterDisplayStat {
  id: string;
  referenceId: string;
}

export interface CharacterAttributeSectionModes {
  main?: 'all' | 'favorites' | 'hidden';
  secondary?: 'all' | 'favorites' | 'hidden';
  skills?: 'all' | 'favorites' | 'hidden';
  other?: 'all' | 'favorites' | 'hidden';
  bars?: 'all' | 'favorites' | 'hidden';
}

export interface CharacterAttributeSectionColumns {
  display?: number;
  main?: number;
  secondary?: number;
  skills?: number;
  other?: number;
  bars?: number;
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
  actions?: CharacterAction[];
  hidden?: boolean;
  folderId?: string | null;
}

export interface CharacterGeneralItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythical' | 'unique';
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
  actions?: CharacterAction[];
  hidden?: boolean;
  folderId?: string | null;
}

export interface StatusEffect {
  id?: string;
  targetId: string;
  value: string;
  active?: boolean;
}

export interface CharacterStatus {
  id: string;
  name: string;
  duration: string;
  description: string;
  effects: StatusEffect[];
  color?: string;
  hidden?: boolean;
}

export interface CharacterData {
  id: string;
  name: string;
  race: string;
  className: string;
  age?: string;
  bodyAge?: string;
  mentalAge?: string;
  spiritualAge?: string;
  alignment?: string;
  visibility?: 'private' | 'public';
  userId?: string | null;
  bio?: string;
  backstory?: string;
  notes?: string;
  portraitUrl?: string;
  createdAt?: number;
  tags?: string[];
  displayStats?: CharacterDisplayStat[];
  attributeSectionModes?: CharacterAttributeSectionModes;
  attributeSectionColumns?: CharacterAttributeSectionColumns;
  mainAttributes?: CustomAttribute[];
  secondaryAttributes?: CustomAttribute[];
  skills?: SkillAttribute[];
  otherAttributes?: CustomAttribute[];
  bars?: CharacterBar[];
  diceMacros?: CharacterDiceMacro[];
  statuses?: CharacterStatus[];
  generalItems?: CharacterGeneralItem[];
  inventory?: CharacterInventoryItem[];
  inventoryFolders?: CharacterEntryFolder[];
  collapsedInventoryFolderIds?: string[];
  collapsedSheetQuickRoll?: boolean;
  spells?: CharacterSpell[];
  spellFolders?: CharacterEntryFolder[];
  collapsedSpellFolderIds?: string[];
  modifierFormula?: string;
}

export interface FavoriteRecord {
  userId: string;
  characterId: string;
  /** Firestore doc id is `${userId}_${characterId}` */
}
