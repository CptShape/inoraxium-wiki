export interface CustomAttribute {
  id: string;
  name: string;
  value: string;
  favorite?: boolean;
  calculationType?: 'sum' | 'override-highest' | 'override-lowest';
  valueOptions?: Array<{
    value: string;
    label: string;
  }>;
}

export interface CharacterBar {
  id: string;
  name: string;
  currentValue: string;
  maxValue: string;
  mode?: 'default' | 'resource';
  resetValue?: string;
  resetTrigger?: 'short-rest' | 'long-rest' | 'turn-end' | 'battle-end';
  color?: string;
  favorite?: boolean;
}

export interface SkillAttribute extends CustomAttribute {
  proficiencyMode?: 'none' | 'half' | 'proficient' | 'expertise';
  linkedMainAttributeId?: string;
}

export interface CharacterDiceMacro {
  id: string;
  name: string;
  formula: string;
  folderId?: string | null;
}

export type CharacterReplenishTrigger = 'custom' | 'short-rest' | 'long-rest' | 'battle' | 'round';

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
  maxUsage?: string;
  replenishTrigger?: CharacterReplenishTrigger;
  replenishAmount?: string;
  macros?: CharacterDiceMacro[];
  effects?: StatusEffect[];
}

export interface CharacterLocalVariable {
  id: string;
  description: string;
  value: string;
}

export interface CharacterDisplayStat {
  id: string;
  referenceId: string;
  row?: number;
  column?: number;
  colors?: {
    background?: string;
    value?: string;
    label?: string;
  };
}

export interface CharacterAttributeSectionModes {
  main?: 'all' | 'favorites' | 'hidden';
  secondary?: 'all' | 'favorites' | 'hidden';
  skills?: 'all' | 'favorites' | 'hidden';
  other?: 'all' | 'favorites' | 'hidden';
  resistances?: 'all' | 'favorites' | 'hidden';
  bars?: 'all' | 'favorites' | 'hidden';
}

export interface CharacterAttributeSectionColumns {
  display?: number;
  main?: number;
  secondary?: number;
  skills?: number;
  other?: number;
  resistances?: number;
  bars?: number;
}

export interface CharacterSpell {
  id: string;
  name: string;
  description: string;
  homebrewImageUrl?: string;
  homebrewImageThumbUrl?: string;
  level: string;
  resourceCost: string;
  usageRemaining: string;
  totalUsage: string;
  replenishTrigger?: CharacterReplenishTrigger;
  replenishAmount?: string;
  magicSchool: string;
  color: string;
  macros: CharacterDiceMacro[];
  actions?: CharacterAction[];
  localVariables?: CharacterLocalVariable[];
  hidden?: boolean;
  folderId?: string | null;
}

export interface CharacterGeneralItem {
  id: string;
  name: string;
  description: string;
  homebrewImageUrl?: string;
  homebrewImageThumbUrl?: string;
  quantity: number;
  status: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythical' | 'unique';
  equipped?: boolean;
  macros: CharacterDiceMacro[];
  effects?: StatusEffect[];
  actions?: CharacterAction[];
  localVariables?: CharacterLocalVariable[];
  hidden?: boolean;
}

export interface CharacterInventoryItem {
  id: string;
  name: string;
  description: string;
  homebrewImageUrl?: string;
  homebrewImageThumbUrl?: string;
  quantity: number;
  status: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythical' | 'unique';
  equipped?: boolean;
  macros: CharacterDiceMacro[];
  effects?: StatusEffect[];
  actions?: CharacterAction[];
  localVariables?: CharacterLocalVariable[];
  hidden?: boolean;
  folderId?: string | null;
}

export interface StatusEffect {
  id?: string;
  effectType?: 'attribute' | 'status' | 'bar-update';
  targetId: string;
  value: string;
  active?: boolean;
  useTargetPicker?: boolean;
  targetLabel?: string;
  statusName?: string;
  statusEntry?: Partial<CharacterStatus>;
  statusFolderId?: string | null;
  barUpdateDescription?: string;
}

export type CharacterScriptConditionOperator = 'lte' | 'lt' | 'gte' | 'gt' | 'eq' | 'neq' | 'between' | 'outside';

export interface CharacterScriptStatusEntry {
  id: string;
  name: string;
  entry: Partial<CharacterStatus>;
  statusFolderId?: string | null;
  onFalse: 'remove' | 'keep';
  appliedStatusInstanceIds?: string[];
}

export interface CharacterScriptCondition {
  id: string;
  leftId: string;
  operator: CharacterScriptConditionOperator;
  compareValue?: string;
  minValue?: string;
  maxValue?: string;
  statusEntries?: CharacterScriptStatusEntry[];
  /** Legacy field kept so older saved scripts do not crash. */
  statusIds: string[];
  /** Legacy field kept so older saved scripts do not crash. */
  onFalse: 'remove' | 'keep';
  /** Legacy field kept so older saved scripts do not crash. */
  appliedStatusInstanceIds?: string[];
}

export interface CharacterScript {
  id: string;
  name: string;
  watchIds: string[];
  conditions: CharacterScriptCondition[];
  importedValueLabels?: Record<string, string>;
  active?: boolean;
  color?: string;
  hidden?: boolean;
  folderId?: string | null;
}

export type CharacterStatusDurationType = 'custom' | 'round' | 'battle' | 'short-rest' | 'long-rest' | 'minute';
export type CharacterStatusDurationEndBehavior = 'delete' | 'deactivate';

export interface CharacterStatus {
  id: string;
  name: string;
  duration: string;
  durationType?: CharacterStatusDurationType;
  durationEndBehavior?: CharacterStatusDurationEndBehavior;
  maxDuration?: string;
  replenishTrigger?: CharacterReplenishTrigger;
  replenishAmount?: string;
  description: string;
  effects: StatusEffect[];
  actions?: CharacterAction[];
  localVariables?: CharacterLocalVariable[];
  active?: boolean;
  color?: string;
  hidden?: boolean;
  folderId?: string | null;
  scriptSourceConditionId?: string;
  scriptSourceTemplateStatusId?: string;
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
  sendToSpreadsheet?: boolean;
  userId?: string | null;
  ownerEmail?: string;
  ownerTransferredAt?: number;
  controlUserIds?: string[];
  viewUserIds?: string[];
  bio?: string;
  backstory?: string;
  notes?: string;
  portraitUrl?: string;
  createdAt?: number;
  tags?: string[];
  displayStats?: CharacterDisplayStat[];
  displaySlotStates?: Record<string, 'unlocked' | 'locked' | 'blocked'>;
  attributeSectionModes?: CharacterAttributeSectionModes;
  attributeSectionColumns?: CharacterAttributeSectionColumns;
  mainAttributes?: CustomAttribute[];
  secondaryAttributes?: CustomAttribute[];
  skills?: SkillAttribute[];
  otherAttributes?: CustomAttribute[];
  resistances?: CustomAttribute[];
  bars?: CharacterBar[];
  diceMacros?: CharacterDiceMacro[];
  diceMacroFolders?: CharacterEntryFolder[];
  collapsedDiceMacroFolderIds?: string[];
  scripts?: CharacterScript[];
  scriptFolders?: CharacterEntryFolder[];
  collapsedScriptFolderIds?: string[];
  statuses?: CharacterStatus[];
  statusFolders?: CharacterEntryFolder[];
  collapsedStatusFolderIds?: string[];
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

export type CampaignRole = 'dm' | 'player';

export interface CampaignMember {
  uid: string;
  email?: string;
  displayName?: string;
  role: CampaignRole;
  joinedAt: number;
}

export interface CampaignData {
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  joinInviteCode?: string;
  dmUserIds: string[];
  playerUserIds: string[];
  members: CampaignMember[];
  createdAt: number;
  updatedAt: number;
}

export interface PartyData {
  id: string;
  campaignId: string;
  name: string;
  createdBy: string;
  visibility: 'private' | 'public';
  characterIds: string[];
  generalItems?: CharacterGeneralItem[];
  inventory?: CharacterInventoryItem[];
  inventoryFolders?: CharacterEntryFolder[];
  spells?: CharacterSpell[];
  spellFolders?: CharacterEntryFolder[];
  statuses?: CharacterStatus[];
  statusFolders?: CharacterEntryFolder[];
  createdAt: number;
  updatedAt: number;
}
