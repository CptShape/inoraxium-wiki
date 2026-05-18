export interface SkillTreeImportSkillSummary {
  skillName: string;
  skillPosition?: string;
  skillLevel?: number;
  skillDescription?: string;
  skillMaxPoints?: number;
  skillCurrentPoints?: number;
  skillImage?: string;
  skillDependencies?: string[];
  skillPrerequisite?: string;
  skillResources?: string[];
}

export interface SkillTreeNode {
  id: number;
  x: number;
  y: number;
  name: string;
  description: string;
  maxPoints: number;
  currentPoints: number;
  requiredPoints: number;
  image?: string;
  size: number;
  borderType?: string;
  shape?: 'round' | 'square';
  cost?: number;
  resources: string[];
  prerequisiteText: string;
  dependencyNames: string[];
  exclusiveSkillIds: number[];
}

export interface SkillTreeConnection {
  id: string;
  from: number;
  to: number;
  hasControlPoint?: boolean;
  controlPoint?: {
    x: number;
    y: number;
  };
  mutuallyExclusive?: boolean;
  dotted?: boolean;
  unlockMode?: 'any-point' | 'full-point';
}

export interface SkillTreeConfig {
  backgroundImage?: string;
  overlayColor?: string;
  overlayOpacity?: number;
  gridSize: number;
  gridOpacity?: number;
  showGlobalGrid?: boolean;
  showArrows?: boolean;
  minScale?: number;
  maxScale?: number;
  scaleStep?: number;
  maxPoints?: number;
  treeUnlockColor?: string;
  treeLockedColor?: string;
  treeUnlockBoxshadow?: string;
  treeLockedBoxshadow?: string;
  skillFontSize?: number;
  skillNamesSize?: number;
  showSkillNames?: boolean;
  defaultSkillImage?: string;
}

export interface SkillTreeData {
  className?: string;
  skills: SkillTreeNode[];
  connections: SkillTreeConnection[];
  config: SkillTreeConfig;
  sourceJson: Record<string, unknown>;
}

export interface SavedSkillTreeRecord {
  id: string;
  name: string;
  system: 'inoraxium' | 'horaghfus';
  source: 'rpgskilltreegenerator';
  treeData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
}
