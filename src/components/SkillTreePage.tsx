import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy,
  Edit3,
  Expand,
  FileJson,
  Import,
  Link2,
  Minus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import sampleSkillTree from '../data/inoraxium/tools/skill-trees/modular-polymorph.json';
import { GameSystemId } from '../types';
import { authProvider, AuthState } from '../lib/auth';
import { loadEditorAccess } from '../lib/editorPermissions';
import { deleteSkillTreeRecord, loadSavedSkillTrees, saveSkillTreeRecord } from '../lib/skillTrees';
import {
  SavedSkillTreeRecord,
  SkillTreeConnection,
  SkillTreeData,
  SkillTreeImportSkillSummary,
  SkillTreeNode,
} from '../types/skillTree';

const REMOTE_SKILL_TREE_ORIGIN = 'https://www.rpgskilltreegenerator.com';
const TREE_PADDING = 220;

type ViewTransform = {
  x: number;
  y: number;
  scale: number;
};

type SkillTreeEditMode = 'idle' | 'linking';

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const sanitizeName = (value: string) =>
  value.trim().replace(/\s+/g, ' ');

const createDefaultRawSkill = (skill: SkillTreeNode) => ({
  id: skill.id,
  x: skill.x,
  y: skill.y,
  name: skill.name,
  showActions: false,
  showTooltip: false,
  description: skill.description,
  maxPoints: skill.maxPoints,
  currentPoints: skill.currentPoints,
  requiredPoints: skill.requiredPoints,
  image: skill.image?.replace(REMOTE_SKILL_TREE_ORIGIN, '') ?? '/img/skill/axe-hammer-grey.png',
  shouldAnimate: true,
  resources: [...skill.resources],
  size: skill.size,
  borderType: skill.borderType ?? 'solid',
  shape: skill.shape ?? 'round',
  cost: skill.cost ?? 1,
  prerequisiteModeOverride: 'global',
  exclusiveSkillIds: [...skill.exclusiveSkillIds],
});

const createDefaultTopSkill = (skill: SkillTreeNode) => ({
  'Skill Name': skill.name,
  'Skill Position': `(${Math.round(skill.x / 120)},${Math.round(skill.y / 120)})`,
  'Skill Position Exact': { x: skill.x, y: skill.y },
  'Skill Level': 1,
  'Skill Description': skill.description,
  'Skill Max Points': skill.maxPoints,
  'Skill Current Points': skill.currentPoints,
  'Skill Image': skill.image?.replace(REMOTE_SKILL_TREE_ORIGIN, '') ?? '/axe-hammer-grey.png',
  'Skill Dependencies': [] as string[],
  'Skill Prerequisite': skill.prerequisiteText,
  'Skill Resources': [...skill.resources],
});

const toRemoteAssetUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^(https?:)?\/\//.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/img/')) {
    return `${REMOTE_SKILL_TREE_ORIGIN}${trimmed}`;
  }
  if (trimmed.startsWith('/')) {
    const imageLike = /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(trimmed);
    if (imageLike) {
      return `${REMOTE_SKILL_TREE_ORIGIN}/img/skill${trimmed}`;
    }
    return `${REMOTE_SKILL_TREE_ORIGIN}${trimmed}`;
  }
  return trimmed;
};

const parseSourceSummaries = (sourceJson: Record<string, unknown>) => {
  const summaries = new Map<string, SkillTreeImportSkillSummary>();
  const rawSkills = Array.isArray(sourceJson.Skills) ? sourceJson.Skills : [];
  rawSkills.forEach((entry) => {
    if (!isObjectRecord(entry)) return;
    const skillName = typeof entry['Skill Name'] === 'string' ? entry['Skill Name'] : '';
    if (!skillName) return;
    summaries.set(skillName, {
      skillName,
      skillPosition: typeof entry['Skill Position'] === 'string' ? entry['Skill Position'] : undefined,
      skillLevel: typeof entry['Skill Level'] === 'number' ? entry['Skill Level'] : undefined,
      skillDescription: typeof entry['Skill Description'] === 'string' ? entry['Skill Description'] : undefined,
      skillMaxPoints: typeof entry['Skill Max Points'] === 'number' ? entry['Skill Max Points'] : undefined,
      skillCurrentPoints: typeof entry['Skill Current Points'] === 'number' ? entry['Skill Current Points'] : undefined,
      skillImage: typeof entry['Skill Image'] === 'string' ? entry['Skill Image'] : undefined,
      skillDependencies: Array.isArray(entry['Skill Dependencies'])
        ? entry['Skill Dependencies'].map((item) => String(item))
        : [],
      skillPrerequisite: typeof entry['Skill Prerequisite'] === 'string' ? entry['Skill Prerequisite'] : undefined,
      skillResources: Array.isArray(entry['Skill Resources'])
        ? entry['Skill Resources'].map((item) => String(item))
        : [],
    });
  });
  return summaries;
};

const normalizeImportedTree = (sourceJson: Record<string, unknown>): SkillTreeData => {
  const fullData = isObjectRecord(sourceJson.FullData) ? sourceJson.FullData : {};
  const config = isObjectRecord(fullData.config) ? fullData.config : {};
  const sourceSummaries = parseSourceSummaries(sourceJson);
  const rawSkills = Array.isArray(fullData.skills) ? fullData.skills : [];
  const rawConnections = Array.isArray(fullData.connections) ? fullData.connections : [];
  const rawTopSkills = Array.isArray(sourceJson.Skills) ? sourceJson.Skills : [];

  const normalizedSkills: SkillTreeNode[] = rawSkills
    .filter(isObjectRecord)
    .map((rawSkill) => {
      const name = typeof rawSkill.name === 'string' ? rawSkill.name : 'Unnamed Skill';
      const summary = sourceSummaries.get(name);
      return {
        id: typeof rawSkill.id === 'number' ? rawSkill.id : Number(rawSkill.id),
        x: typeof rawSkill.x === 'number' ? rawSkill.x : 0,
        y: typeof rawSkill.y === 'number' ? rawSkill.y : 0,
        name,
        description:
          typeof rawSkill.description === 'string'
            ? rawSkill.description
            : summary?.skillDescription ?? '',
        maxPoints:
          typeof rawSkill.maxPoints === 'number'
            ? rawSkill.maxPoints
            : summary?.skillMaxPoints ?? 1,
        currentPoints:
          typeof rawSkill.currentPoints === 'number'
            ? rawSkill.currentPoints
            : summary?.skillCurrentPoints ?? 0,
        requiredPoints: typeof rawSkill.requiredPoints === 'number' ? rawSkill.requiredPoints : 0,
        image: toRemoteAssetUrl(
          typeof rawSkill.image === 'string' ? rawSkill.image : summary?.skillImage,
        ),
        size: typeof rawSkill.size === 'number' ? rawSkill.size : 60,
        borderType: typeof rawSkill.borderType === 'string' ? rawSkill.borderType : 'solid',
        shape:
          rawSkill.shape === 'square' || rawSkill.shape === 'round'
            ? rawSkill.shape
            : 'round',
        cost: typeof rawSkill.cost === 'number' ? rawSkill.cost : 1,
        resources: Array.isArray(rawSkill.resources)
          ? rawSkill.resources.map((item) => String(item))
          : summary?.skillResources ?? [],
        prerequisiteText: summary?.skillPrerequisite ?? '-',
        dependencyNames: summary?.skillDependencies ?? [],
        exclusiveSkillIds: Array.isArray(rawSkill.exclusiveSkillIds)
          ? rawSkill.exclusiveSkillIds.map((item) => Number(item))
          : [],
      };
    });

  const normalizedConnections: SkillTreeConnection[] = rawConnections
    .filter(isObjectRecord)
    .map((rawConnection) => ({
      id: typeof rawConnection.id === 'string' ? rawConnection.id : `${rawConnection.from}-${rawConnection.to}`,
      from: typeof rawConnection.from === 'number' ? rawConnection.from : Number(rawConnection.from),
      to: typeof rawConnection.to === 'number' ? rawConnection.to : Number(rawConnection.to),
      hasControlPoint: rawConnection.hasControlPoint === true,
      controlPoint:
        isObjectRecord(rawConnection.controlPoint) &&
        typeof rawConnection.controlPoint.x === 'number' &&
        typeof rawConnection.controlPoint.y === 'number'
          ? { x: rawConnection.controlPoint.x, y: rawConnection.controlPoint.y }
          : undefined,
      mutuallyExclusive: rawConnection.mutuallyExclusive === true,
      dotted: rawConnection.dotted === true,
      unlockMode: rawConnection.unlockMode === 'full-point' ? 'full-point' : 'any-point',
    }));

  const nameToId = new Map(normalizedSkills.map((skill) => [sanitizeName(skill.name).toLowerCase(), skill.id]));
  const connectionIds = new Set(normalizedConnections.map((connection) => `${connection.from}-${connection.to}`));

  rawTopSkills.filter(isObjectRecord).forEach((rawSkill) => {
    const sourceName = typeof rawSkill['Skill Name'] === 'string' ? rawSkill['Skill Name'] : '';
    const sourceId = nameToId.get(sanitizeName(sourceName).toLowerCase());
    if (!sourceId) return;

    const dependencies = Array.isArray(rawSkill['Skill Dependencies'])
      ? rawSkill['Skill Dependencies'].map((item) => String(item))
      : [];

    dependencies.forEach((dependencyName) => {
      const targetId = nameToId.get(sanitizeName(dependencyName).toLowerCase());
      if (!targetId) return;
      const connectionId = `${sourceId}-${targetId}`;
      if (connectionIds.has(connectionId)) return;
      normalizedConnections.push({
        id: connectionId,
        from: sourceId,
        to: targetId,
        hasControlPoint: false,
        dotted: false,
        mutuallyExclusive: false,
        unlockMode: 'any-point',
      });
      connectionIds.add(connectionId);
    });

    const prerequisiteText =
      typeof rawSkill['Skill Prerequisite'] === 'string' ? rawSkill['Skill Prerequisite'] : '';
    parsePrerequisites(prerequisiteText).forEach((requirement) => {
      const fromId = nameToId.get(requirement.name.toLowerCase());
      if (!fromId) return;
      const connectionId = `${fromId}-${sourceId}`;
      if (connectionIds.has(connectionId)) return;
      normalizedConnections.push({
        id: connectionId,
        from: fromId,
        to: sourceId,
        hasControlPoint: false,
        dotted: false,
        mutuallyExclusive: false,
        unlockMode: requirement.minPoints > 1 ? 'full-point' : 'any-point',
      });
      connectionIds.add(connectionId);
    });
  });

  return {
    className:
      typeof fullData.currentName === 'string' && fullData.currentName.trim()
        ? fullData.currentName
        : typeof sourceJson['Class Name'] === 'string' && sourceJson['Class Name'].trim()
          ? sourceJson['Class Name']
          : 'Unnamed Skill Tree',
    skills: normalizedSkills,
    connections: normalizedConnections,
    config: {
      backgroundImage: toRemoteAssetUrl(
        typeof fullData.currentBackgroundLink === 'string'
          ? fullData.currentBackgroundLink
          : undefined,
      ),
      overlayColor: typeof fullData.overlayColor === 'string' ? fullData.overlayColor : '#000000',
      overlayOpacity: typeof fullData.overlayOpacity === 'number' ? fullData.overlayOpacity : 65,
      gridSize: typeof fullData.gridSize === 'number' ? fullData.gridSize : 120,
      gridOpacity: typeof fullData.gridOpacity === 'number' ? fullData.gridOpacity : 12,
      showGlobalGrid: fullData.showGlobalGrid !== false,
      showArrows: fullData.showArrows !== false,
      minScale: typeof fullData.minScale === 'number' ? fullData.minScale : 0.45,
      maxScale: typeof fullData.maxScale === 'number' ? fullData.maxScale : 2,
      scaleStep: typeof fullData.scaleStep === 'number' ? fullData.scaleStep : 0.1,
      maxPoints: typeof fullData.maxPoints === 'number' ? fullData.maxPoints : undefined,
      treeUnlockColor:
        typeof fullData.treeUnlockColor === 'string' ? fullData.treeUnlockColor : '#ffd700',
      treeLockedColor:
        typeof fullData.treeLockedColor === 'string' ? fullData.treeLockedColor : '#292929',
      treeUnlockBoxshadow:
        typeof fullData.treeUnlockBoxshadow === 'string'
          ? fullData.treeUnlockBoxshadow
          : '0 0 18px rgba(250, 204, 21, 0.35)',
      treeLockedBoxshadow:
        typeof fullData.treeLockedBoxshadow === 'string'
          ? fullData.treeLockedBoxshadow
          : '0 0 12px rgba(0, 0, 0, 0.45)',
      skillFontSize: typeof fullData.skillFontSize === 'number' ? fullData.skillFontSize : 12,
      skillNamesSize:
        typeof fullData.skillNamesSize === 'number' ? fullData.skillNamesSize : 12,
      showSkillNames: fullData.showSkillNames === true,
      defaultSkillImage: toRemoteAssetUrl(
        typeof fullData.defaultSkillImage === 'string'
          ? fullData.defaultSkillImage
          : typeof config.default === 'string'
            ? config.default
            : undefined,
      ),
    },
    sourceJson,
  };
};

const exportTreeToSourceJson = (tree: SkillTreeData): Record<string, unknown> => {
  const sourceJson = structuredClone(tree.sourceJson);
  const fullData = isObjectRecord(sourceJson.FullData) ? sourceJson.FullData : {};
  const rawSkills = Array.isArray(fullData.skills) ? fullData.skills : [];
  const rawTopSkills = Array.isArray(sourceJson.Skills) ? sourceJson.Skills : [];
  const skillById = new Map(tree.skills.map((skill) => [skill.id, skill]));
  const rawSkillTemplates = new Map<number, Record<string, unknown>>();
  const rawTopTemplates = new Map<string, Record<string, unknown>>();

  rawSkills.filter(isObjectRecord).forEach((rawSkill) => {
    const skillId = typeof rawSkill.id === 'number' ? rawSkill.id : Number(rawSkill.id);
    if (!Number.isFinite(skillId)) return;
    rawSkillTemplates.set(skillId, rawSkill);
  });
  rawTopSkills.filter(isObjectRecord).forEach((rawSkill) => {
    const skillName = typeof rawSkill['Skill Name'] === 'string' ? rawSkill['Skill Name'] : '';
    if (!skillName) return;
    rawTopTemplates.set(skillName, rawSkill);
  });

  const dependencyMap = new Map<number, string[]>();
  tree.connections.forEach((connection) => {
    const fromSkill = skillById.get(connection.from);
    const toSkill = skillById.get(connection.to);
    if (!fromSkill || !toSkill) return;
    const current = dependencyMap.get(connection.from) ?? [];
    current.push(toSkill.name);
    dependencyMap.set(connection.from, current);
  });

  const nextRawSkills = tree.skills.map((skill) => ({
    ...(rawSkillTemplates.get(skill.id) ?? createDefaultRawSkill(skill)),
    id: skill.id,
    x: skill.x,
    y: skill.y,
    name: skill.name,
    description: skill.description,
    maxPoints: skill.maxPoints,
    currentPoints: skill.currentPoints,
    requiredPoints: skill.requiredPoints,
    image: skill.image?.replace(REMOTE_SKILL_TREE_ORIGIN, '') ?? '/img/skill/axe-hammer-grey.png',
    resources: [...skill.resources],
    size: skill.size,
    borderType: skill.borderType ?? 'solid',
    shape: skill.shape ?? 'round',
    cost: skill.cost ?? 1,
    exclusiveSkillIds: [...skill.exclusiveSkillIds],
  }));

  const nextTopSkills = tree.skills.map((skill) => ({
    ...(rawTopTemplates.get(skill.name) ?? createDefaultTopSkill(skill)),
    'Skill Name': skill.name,
    'Skill Position': `(${Math.round(skill.x / 120)},${Math.round(skill.y / 120)})`,
    'Skill Position Exact': { x: skill.x, y: skill.y },
    'Skill Description': skill.description,
    'Skill Max Points': skill.maxPoints,
    'Skill Current Points': skill.currentPoints,
    'Skill Image': skill.image?.replace(REMOTE_SKILL_TREE_ORIGIN, '') ?? '/axe-hammer-grey.png',
    'Skill Dependencies': dependencyMap.get(skill.id) ?? [],
    'Skill Prerequisite': skill.prerequisiteText,
    'Skill Resources': [...skill.resources],
  }));

  if (isObjectRecord(sourceJson.FullData)) {
    sourceJson.FullData = {
      ...fullData,
      currentName: tree.className,
      skills: nextRawSkills,
      connections: tree.connections.map((connection) => ({ ...connection })),
    };
  }
  sourceJson.Skills = nextTopSkills;
  sourceJson['Class Name'] = tree.className;
  return sourceJson;
};

const parsePrerequisites = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return [];
  const segments = trimmed
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  const parsed = segments
    .map((segment) => {
      const match = segment.match(/^(.*)\((\d+)\)\s*$/);
      if (!match) {
        return null;
      }

      return {
        name: sanitizeName(match[1]),
        minPoints: Number(match[2]),
      };
    })
    .filter((entry): entry is { name: string; minPoints: number } => !!entry);

  if (parsed.length > 0) {
    return parsed;
  }

  return [{ name: sanitizeName(trimmed), minPoints: 1 }];
};

const getNodeCenter = (skill: SkillTreeNode, minX: number, minY: number) => {
  const size = skill.size;
  const x = skill.x - minX + TREE_PADDING;
  const y = skill.y - minY + TREE_PADDING;
  return {
    x: x + size / 2,
    y: y + size / 2,
  };
};

const buildConnectionPath = (
  connection: SkillTreeConnection,
  fromSkill: SkillTreeNode,
  toSkill: SkillTreeNode,
  minX: number,
  minY: number,
) => {
  const from = getNodeCenter(fromSkill, minX, minY);
  const to = getNodeCenter(toSkill, minX, minY);

  if (connection.hasControlPoint && connection.controlPoint) {
    const control = {
      x: connection.controlPoint.x - minX + TREE_PADDING,
      y: connection.controlPoint.y - minY + TREE_PADDING,
    };
    return `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
  }

  const dx = Math.abs(to.x - from.x) * 0.45;
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
};

const getConnectionMidpoint = (
  connection: SkillTreeConnection,
  fromSkill: SkillTreeNode,
  toSkill: SkillTreeNode,
  minX: number,
  minY: number,
) => {
  const from = getNodeCenter(fromSkill, minX, minY);
  const to = getNodeCenter(toSkill, minX, minY);

  if (connection.hasControlPoint && connection.controlPoint) {
    const control = {
      x: connection.controlPoint.x - minX + TREE_PADDING,
      y: connection.controlPoint.y - minY + TREE_PADDING,
    };

    const t = 0.5;
    const x =
      (1 - t) * (1 - t) * from.x +
      2 * (1 - t) * t * control.x +
      t * t * to.x;
    const y =
      (1 - t) * (1 - t) * from.y +
      2 * (1 - t) * t * control.y +
      t * t * to.y;
    return { x, y };
  }

  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
  };
};

const defaultTransformForBounds = (
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
  minScale: number,
  maxScale: number,
): ViewTransform => {
  const safeViewportWidth = Math.max(viewportWidth, 1);
  const safeViewportHeight = Math.max(viewportHeight, 1);
  const scale = Math.min(
    maxScale,
    Math.max(minScale, Math.min((safeViewportWidth - 80) / width, (safeViewportHeight - 80) / height)),
  );
  return {
    scale,
    x: (safeViewportWidth - width * scale) / 2,
    y: (safeViewportHeight - height * scale) / 2,
  };
};

const cloneTreeData = (tree: SkillTreeData): SkillTreeData => structuredClone(tree);

export const SkillTreePage: React.FC<{ system: GameSystemId }> = ({ system }) => {
  const [authState, setAuthState] = useState<AuthState>({ uid: null, displayName: null });
  const [canEdit, setCanEdit] = useState(false);
  const [savedTrees, setSavedTrees] = useState<SavedSkillTreeRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<string>('');
  const [treeName, setTreeName] = useState('Modular Polymorph');
  const [treeData, setTreeData] = useState<SkillTreeData>(() =>
    normalizeImportedTree(sampleSkillTree as unknown as Record<string, unknown>),
  );
  const [statusMessage, setStatusMessage] = useState<string>('Loaded sample tree.');
  const [isBusy, setIsBusy] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<number | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [transform, setTransform] = useState<ViewTransform>({ x: 40, y: 40, scale: 0.6 });
  const [isPanning, setIsPanning] = useState(false);
  const [editMode, setEditMode] = useState<SkillTreeEditMode>('idle');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number; transform: ViewTransform } | null>(null);
  const draggingSkillRef = useRef<{
    skillId: number;
    startClientX: number;
    startClientY: number;
    startSkillX: number;
    startSkillY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => authProvider.onAuthChange(setAuthState), []);

  useEffect(() => {
    loadEditorAccess(authState.uid)
      .then((access) => setCanEdit(access.canEdit))
      .catch((error) => {
        console.error('Failed to load edit access for skill trees:', error);
        setCanEdit(false);
      });
  }, [authState.uid]);

  const reloadSavedTrees = useCallback(async () => {
    const records = await loadSavedSkillTrees(system);
    setSavedTrees(records);
    return records;
  }, [system]);

  useEffect(() => {
    reloadSavedTrees().catch((error) => {
      console.error('Failed to load saved skill trees:', error);
      setStatusMessage('Could not load saved skill trees from Firestore.');
    });
  }, [reloadSavedTrees]);

  const worldBounds = useMemo(() => {
    const xs = treeData.skills.map((skill) => skill.x);
    const ys = treeData.skills.map((skill) => skill.y);
    const maxWidths = treeData.skills.map((skill) => skill.x + skill.size);
    const maxHeights = treeData.skills.map((skill) => skill.y + skill.size);
    const minX = Math.min(...xs, 0);
    const minY = Math.min(...ys, 0);
    const maxX = Math.max(...maxWidths, 1200);
    const maxY = Math.max(...maxHeights, 800);
    return {
      minX,
      minY,
      width: maxX - minX + TREE_PADDING * 2,
      height: maxY - minY + TREE_PADDING * 2,
    };
  }, [treeData.skills]);

  const skillById = useMemo(
    () => new Map(treeData.skills.map((skill) => [skill.id, skill])),
    [treeData.skills],
  );

  const skillByName = useMemo(
    () => new Map(treeData.skills.map((skill) => [sanitizeName(skill.name).toLowerCase(), skill])),
    [treeData.skills],
  );

  const totalSpentPoints = useMemo(
    () => treeData.skills.reduce((sum, skill) => sum + skill.currentPoints * (skill.cost ?? 1), 0),
    [treeData.skills],
  );

  const incomingConnections = useMemo(() => {
    const map = new Map<number, SkillTreeConnection[]>();
    treeData.connections.forEach((connection) => {
      const list = map.get(connection.to) ?? [];
      list.push(connection);
      map.set(connection.to, list);
    });
    return map;
  }, [treeData.connections]);

  const skillStates = useMemo(() => {
    return new Map(
      treeData.skills.map((skill) => {
        const prerequisites = parsePrerequisites(skill.prerequisiteText);
        const unmetPrerequisites = prerequisites.filter((requirement) => {
          const dependency = skillByName.get(requirement.name.toLowerCase());
          return !dependency || dependency.currentPoints < requirement.minPoints;
        });

        const incoming = incomingConnections.get(skill.id) ?? [];
        const incomingLocked = prerequisites.length === 0
          ? incoming.filter((connection) => {
              const source = skillById.get(connection.from);
              if (!source) return true;
              const unlockMode = connection.unlockMode ?? 'any-point';
              if (unlockMode === 'full-point') {
                return source.currentPoints < source.maxPoints;
              }
              return source.currentPoints <= 0;
            })
          : [];

        const exclusiveConflict = skill.exclusiveSkillIds.some((exclusiveSkillId) => {
          const exclusiveSkill = skillById.get(exclusiveSkillId);
          return !!exclusiveSkill && exclusiveSkill.currentPoints > 0;
        });

        const totalCapReached =
          typeof treeData.config.maxPoints === 'number' &&
          totalSpentPoints >= treeData.config.maxPoints &&
          skill.currentPoints < skill.maxPoints;

        const isUnlocked = unmetPrerequisites.length === 0 && incomingLocked.length === 0 && !exclusiveConflict;
        const canAddPoint =
          isUnlocked &&
          skill.currentPoints < skill.maxPoints &&
          !totalCapReached;

        return [
          skill.id,
          {
            isUnlocked,
            canAddPoint,
            unmetRequirements: unmetPrerequisites.map(
              (requirement) => `${requirement.name} (${requirement.minPoints})`,
            ),
            blockedByConnections: incomingLocked
              .map((connection) => skillById.get(connection.from)?.name)
              .filter((value): value is string => !!value),
            exclusiveConflict,
            totalCapReached,
          },
        ] as const;
      }),
    );
  }, [incomingConnections, skillById, skillByName, totalSpentPoints, treeData.config.maxPoints, treeData.skills]);

  const visibleSkills = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return treeData.skills;
    return treeData.skills.filter((skill) => skill.name.toLowerCase().includes(normalizedQuery));
  }, [searchQuery, treeData.skills]);

  const visibleSkillIds = useMemo(() => new Set(visibleSkills.map((skill) => skill.id)), [visibleSkills]);

  const fitTreeToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setTransform(
      defaultTransformForBounds(
        worldBounds.width,
        worldBounds.height,
        viewport.clientWidth,
        viewport.clientHeight,
        treeData.config.minScale ?? 0.45,
        treeData.config.maxScale ?? 2,
      ),
    );
  }, [treeData.config.maxScale, treeData.config.minScale, worldBounds.height, worldBounds.width]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fitTreeToViewport();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [
    fitTreeToViewport,
    treeData.connections.length,
    treeData.skills.length,
    worldBounds.height,
    worldBounds.minX,
    worldBounds.minY,
    worldBounds.width,
  ]);

  const updateTreePoints = useCallback((skillId: number, delta: 1 | -1) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      const targetSkill = nextTree.skills.find((skill) => skill.id === skillId);
      if (!targetSkill) return currentTree;

      const currentStates = new Map(
        nextTree.skills.map((skill) => {
          const prerequisites = parsePrerequisites(skill.prerequisiteText);
          const unmet = prerequisites.filter((requirement) => {
            const dependency = nextTree.skills.find(
              (candidate) => sanitizeName(candidate.name).toLowerCase() === requirement.name.toLowerCase(),
            );
            return !dependency || dependency.currentPoints < requirement.minPoints;
          });
          return [skill.id, unmet.length === 0] as const;
        }),
      );

      if (delta > 0) {
        const totalPoints =
          nextTree.skills.reduce((sum, skill) => sum + skill.currentPoints * (skill.cost ?? 1), 0);
        const maxPoints = nextTree.config.maxPoints;
        if (typeof maxPoints === 'number' && totalPoints >= maxPoints) {
          return currentTree;
        }
        if (targetSkill.currentPoints >= targetSkill.maxPoints) {
          return currentTree;
        }
        if (!currentStates.get(skillId)) {
          return currentTree;
        }
        targetSkill.currentPoints += 1;
      } else {
        if (targetSkill.currentPoints <= 0) {
          return currentTree;
        }
        targetSkill.currentPoints -= 1;
      }

      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
  }, []);

  const updateSelectedSkill = useCallback((skillId: number, patch: Partial<SkillTreeNode>) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      const targetSkill = nextTree.skills.find((skill) => skill.id === skillId);
      if (!targetSkill) return currentTree;

      Object.assign(targetSkill, patch);
      if (typeof targetSkill.maxPoints === 'number' && targetSkill.currentPoints > targetSkill.maxPoints) {
        targetSkill.currentPoints = targetSkill.maxPoints;
      }
      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
  }, []);

  const toggleConnection = useCallback((fromId: number, toId: number) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      const existingIndex = nextTree.connections.findIndex(
        (connection) => connection.from === fromId && connection.to === toId,
      );

      if (existingIndex >= 0) {
        nextTree.connections.splice(existingIndex, 1);
      } else {
        nextTree.connections.push({
          id: `${fromId}-${toId}`,
          from: fromId,
          to: toId,
          hasControlPoint: false,
          mutuallyExclusive: false,
          dotted: false,
          unlockMode: 'any-point',
        });
      }

      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
  }, []);

  const updateConnection = useCallback((connectionId: string, patch: Partial<SkillTreeConnection>) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      const targetConnection = nextTree.connections.find((connection) => connection.id === connectionId);
      if (!targetConnection) return currentTree;
      Object.assign(targetConnection, patch);
      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
  }, []);

  const deleteConnection = useCallback((connectionId: string) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      const nextConnections = nextTree.connections.filter((connection) => connection.id !== connectionId);
      if (nextConnections.length === nextTree.connections.length) {
        return currentTree;
      }
      nextTree.connections = nextConnections;
      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
    setSelectedConnectionId((current) => (current === connectionId ? null : current));
  }, []);

  const deleteSkill = useCallback((skillId: number) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      nextTree.skills = nextTree.skills.filter((skill) => skill.id !== skillId);
      nextTree.connections = nextTree.connections.filter(
        (connection) => connection.from !== skillId && connection.to !== skillId,
      );
      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
    setSelectedSkillId((current) => (current === skillId ? null : current));
    setSelectedConnectionId(null);
    setEditMode('idle');
    setIsEditModalOpen(false);
  }, []);

  const addSkillAtPosition = useCallback((worldX: number, worldY: number) => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      const nextId = nextTree.skills.reduce((maxId, skill) => Math.max(maxId, skill.id), 0) + 1;
      nextTree.skills.push({
        id: nextId,
        x: Math.round(worldX),
        y: Math.round(worldY),
        name: `New Skill ${nextId}`,
        description: 'Describe this skill.',
        maxPoints: 5,
        currentPoints: 0,
        requiredPoints: 0,
        image: nextTree.config.defaultSkillImage,
        size: 60,
        borderType: 'solid',
        shape: 'round',
        cost: 1,
        resources: [],
        prerequisiteText: '-',
        dependencyNames: [],
        exclusiveSkillIds: [],
      });
      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
    setSelectedConnectionId(null);
    setSelectedSkillId(null);
  }, []);

  const resetPoints = useCallback(() => {
    setTreeData((currentTree) => {
      const nextTree = cloneTreeData(currentTree);
      nextTree.skills.forEach((skill) => {
        skill.currentPoints = 0;
      });
      nextTree.sourceJson = exportTreeToSourceJson(nextTree);
      return nextTree;
    });
    setStatusMessage('Reset all allocated points.');
  }, []);

  const selectedSkill = useMemo(
    () => treeData.skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, treeData.skills],
  );

  const selectedSkillState = selectedSkill ? skillStates.get(selectedSkill.id) : null;
  const selectedIncomingSkillIds = useMemo(
    () =>
      selectedSkill
        ? new Set(
            treeData.connections
              .filter((connection) => connection.to === selectedSkill.id)
              .map((connection) => connection.from),
          )
        : new Set<number>(),
    [selectedSkill, treeData.connections],
  );
  const selectedOutgoingSkillIds = useMemo(
    () =>
      selectedSkill
        ? new Set(
            treeData.connections
              .filter((connection) => connection.from === selectedSkill.id)
              .map((connection) => connection.to),
          )
        : new Set<number>(),
    [selectedSkill, treeData.connections],
  );
  const selectedConnection = useMemo(
    () => treeData.connections.find((connection) => connection.id === selectedConnectionId) ?? null,
    [selectedConnectionId, treeData.connections],
  );
  const selectedConnectionEndpoints = useMemo(() => {
    if (!selectedConnection) return null;
    const fromSkill = skillById.get(selectedConnection.from);
    const toSkill = skillById.get(selectedConnection.to);
    if (!fromSkill || !toSkill) return null;
    return { fromSkill, toSkill };
  }, [selectedConnection, skillById]);
  const selectedSkillCanvasPosition = useMemo(() => {
    if (!selectedSkill) return null;
    const x = selectedSkill.x - worldBounds.minX + TREE_PADDING + selectedSkill.size / 2;
    const y = selectedSkill.y - worldBounds.minY + TREE_PADDING - 18;
    return { x, y };
  }, [selectedSkill, worldBounds.minX, worldBounds.minY]);
  const selectedConnectionCanvasPosition = useMemo(() => {
    if (!selectedConnectionEndpoints) return null;
    const from = getNodeCenter(
      selectedConnectionEndpoints.fromSkill,
      worldBounds.minX,
      worldBounds.minY,
    );
    const to = getNodeCenter(
      selectedConnectionEndpoints.toSkill,
      worldBounds.minX,
      worldBounds.minY,
    );
    return {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
    };
  }, [selectedConnectionEndpoints, worldBounds.minX, worldBounds.minY]);

  const importSkillTreeJson = useCallback((rawText: string, fallbackName: string) => {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const normalized = normalizeImportedTree(parsed);
    const nextName =
      sanitizeName(normalized.className ?? '') ||
      sanitizeName(fallbackName.replace(/\.json$/i, '')) ||
      'Imported Skill Tree';
    normalized.className = nextName;
    normalized.sourceJson = exportTreeToSourceJson(normalized);
    setTreeData(normalized);
    setTreeName(nextName);
    setSelectedRecordId('');
    setSelectedSkillId(null);
    setStatusMessage(`Imported ${fallbackName}.`);
  }, []);

  const handleImportFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        importSkillTreeJson(text, file.name);
      } catch (error) {
        console.error('Failed to import skill tree JSON:', error);
        setStatusMessage('Could not import that JSON file.');
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [importSkillTreeJson],
  );

  const handleLoadSavedTree = useCallback((recordId: string) => {
    setSelectedRecordId(recordId);
    if (!recordId) {
      const base = normalizeImportedTree(sampleSkillTree as unknown as Record<string, unknown>);
      base.className = 'Modular Polymorph';
      base.sourceJson = exportTreeToSourceJson(base);
      setTreeData(base);
      setTreeName('Modular Polymorph');
      setStatusMessage('Loaded bundled sample tree.');
      return;
    }
    const record = savedTrees.find((item) => item.id === recordId);
    if (!record) return;
    const normalized = normalizeImportedTree(record.treeData);
    normalized.className = record.name;
    normalized.sourceJson = exportTreeToSourceJson(normalized);
    setTreeData(normalized);
    setTreeName(record.name);
    setSelectedSkillId(null);
    setStatusMessage(`Loaded saved tree "${record.name}".`);
  }, [savedTrees]);

  const handleSave = useCallback(
    async (asCopy = false) => {
      if (!canEdit || !authState.uid) {
        setStatusMessage('You need editor permission and a signed-in account to save skill trees.');
        return;
      }
      const trimmedName = sanitizeName(treeName);
      if (!trimmedName) {
        setStatusMessage('Give the skill tree a name before saving.');
        return;
      }

      setIsBusy(true);
      try {
        const nextTree = cloneTreeData(treeData);
        nextTree.className = trimmedName;
        nextTree.sourceJson = exportTreeToSourceJson(nextTree);
        const savedRecord = await saveSkillTreeRecord(
          {
            id: asCopy ? null : selectedRecordId || null,
            name: trimmedName,
            system,
            source: 'rpgskilltreegenerator',
            treeData: nextTree.sourceJson,
            createdBy: authState.uid,
            createdByName: authState.displayName,
            updatedBy: authState.uid,
            updatedByName: authState.displayName,
          },
          { asCopy },
        );
        setTreeData(nextTree);
        setSelectedRecordId(savedRecord.id);
        setTreeName(savedRecord.name);
        const records = await reloadSavedTrees();
        setSavedTrees(records);
        setStatusMessage(asCopy ? `Saved "${trimmedName}" as a copy.` : `Saved "${trimmedName}".`);
      } catch (error) {
        console.error('Failed to save skill tree:', error);
        setStatusMessage('Could not save the skill tree.');
      } finally {
        setIsBusy(false);
      }
    },
    [authState.displayName, authState.uid, canEdit, reloadSavedTrees, selectedRecordId, system, treeData, treeName],
  );

  const handleDeleteTree = useCallback(async () => {
    if (!canEdit || !authState.uid) {
      setStatusMessage('You need editor permission and a signed-in account to delete skill trees.');
      return;
    }
    if (!selectedRecordId) {
      setStatusMessage('The bundled sample cannot be deleted.');
      return;
    }

    const record = savedTrees.find((item) => item.id === selectedRecordId);
    const recordName = record?.name ?? treeName;

    setIsBusy(true);
    try {
      await deleteSkillTreeRecord(selectedRecordId);
      const records = await reloadSavedTrees();
      setSavedTrees(records);
      setSelectedRecordId('');
      const base = normalizeImportedTree(sampleSkillTree as unknown as Record<string, unknown>);
      base.className = 'Modular Polymorph';
      base.sourceJson = exportTreeToSourceJson(base);
      setTreeData(base);
      setTreeName('Modular Polymorph');
      setSelectedSkillId(null);
      setSelectedConnectionId(null);
      setStatusMessage(`Deleted "${recordName}" and switched back to the bundled sample.`);
    } catch (error) {
      console.error('Failed to delete skill tree:', error);
      setStatusMessage('Could not delete the selected tree.');
    } finally {
      setIsBusy(false);
    }
  }, [authState.uid, canEdit, reloadSavedTrees, savedTrees, selectedRecordId, treeName]);

  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-skill-node="true"]') || (event.target as HTMLElement).closest('[data-tree-ui="true"]')) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      transform,
    };
  };

  const handlePanMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingSkillRef.current) {
      const drag = draggingSkillRef.current;
      const dx = (event.clientX - drag.startClientX) / transform.scale;
      const dy = (event.clientY - drag.startClientY) / transform.scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        drag.moved = true;
      }
      setTreeData((currentTree) => {
        const nextTree = cloneTreeData(currentTree);
        const targetSkill = nextTree.skills.find((skill) => skill.id === drag.skillId);
        if (!targetSkill) return currentTree;
        targetSkill.x = Math.round(drag.startSkillX + dx);
        targetSkill.y = Math.round(drag.startSkillY + dy);
        nextTree.sourceJson = exportTreeToSourceJson(nextTree);
        return nextTree;
      });
      return;
    }
    if (!isPanning || !panStartRef.current) return;
    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;
    setTransform({
      ...panStartRef.current.transform,
      x: panStartRef.current.transform.x + dx,
      y: panStartRef.current.transform.y + dy,
    });
  };

  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingSkillRef.current) {
      draggingSkillRef.current = null;
    }
    if (isPanning) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsPanning(false);
    panStartRef.current = null;
  };

  const handleWheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const step = treeData.config.scaleStep ?? 0.1;
    const minScale = treeData.config.minScale ?? 0.45;
    const maxScale = treeData.config.maxScale ?? 2;
    const direction = event.deltaY > 0 ? -1 : 1;
    const nextScale = Math.max(minScale, Math.min(maxScale, transform.scale + direction * step));
    if (nextScale === transform.scale) return;

    const rect = viewport.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const worldX = (cursorX - transform.x) / transform.scale;
    const worldY = (cursorY - transform.y) / transform.scale;

    setTransform({
      scale: nextScale,
      x: cursorX - worldX * nextScale,
      y: cursorY - worldY * nextScale,
    });
  };

  return (
    <div className="w-full p-4 md:p-8 animate-fade-in">
      <div className="mb-5 rounded-2xl border border-amber-800/30 bg-black/20 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <h1
          className="text-4xl font-bold text-amber-300"
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          Skill Tree
        </h1>
        <p className="mt-2 max-w-4xl text-amber-100/80" style={{ fontFamily: "'IM Fell English', serif" }}>
          Import exported JSON files from RPG Skill Tree Generator, allocate points directly on the tree,
          and save named versions into Firestore for later reuse.
        </p>
      </div>

      <div className="rounded-3xl border border-amber-800/30 bg-stone-950/65 shadow-[0_24px_90px_rgba(0,0,0,0.45)] overflow-hidden">
        <div className="sticky top-0 z-20 border-b border-amber-800/25 bg-stone-950/95 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-3 px-4 py-4">
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-amber-600">
                Saved Trees
              </label>
              <select
                value={selectedRecordId}
                onChange={(event) => handleLoadSavedTree(event.target.value)}
                className="w-full rounded-xl border border-amber-800/30 bg-black/35 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none"
              >
                <option value="">Bundled Sample</option>
                {savedTrees.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[220px] flex-[1.2]">
              <label className="mb-1 block text-[11px] uppercase tracking-[0.22em] text-amber-600">
                Tree Name
              </label>
              <input
                value={treeName}
                onChange={(event) => setTreeName(event.target.value)}
                placeholder="Name this saved tree"
                className="w-full rounded-xl border border-amber-800/30 bg-black/35 px-3 py-2 text-sm text-amber-100 placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-sky-700/40 bg-sky-950/25 px-4 text-sm text-sky-100 transition-colors hover:border-sky-500/70 hover:bg-sky-900/40"
              >
                <Import size={16} />
                Import JSON
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={!canEdit || !authState.uid || isBusy}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/25 px-4 text-sm text-emerald-100 transition-colors hover:border-emerald-500/70 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={16} />
                Save
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={!canEdit || !authState.uid || isBusy}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-violet-700/40 bg-violet-950/25 px-4 text-sm text-violet-100 transition-colors hover:border-violet-500/70 hover:bg-violet-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Copy size={16} />
                Save as Copy
              </button>
              <button
                onClick={handleDeleteTree}
                disabled={!canEdit || !authState.uid || isBusy || !selectedRecordId}
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-rose-700/40 bg-rose-950/25 px-4 text-sm text-rose-100 transition-colors hover:border-rose-500/70 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-800/15 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() =>
                  setTransform((current) => ({
                    ...current,
                    scale: Math.max(treeData.config.minScale ?? 0.45, current.scale - (treeData.config.scaleStep ?? 0.1)),
                  }))
                }
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-800/25 bg-black/25 px-3 text-sm text-amber-200 hover:border-amber-600/60 hover:bg-amber-950/20"
              >
                <ZoomOut size={15} />
                Zoom Out
              </button>
              <button
                onClick={() =>
                  setTransform((current) => ({
                    ...current,
                    scale: Math.min(treeData.config.maxScale ?? 2, current.scale + (treeData.config.scaleStep ?? 0.1)),
                  }))
                }
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-800/25 bg-black/25 px-3 text-sm text-amber-200 hover:border-amber-600/60 hover:bg-amber-950/20"
              >
                <ZoomIn size={15} />
                Zoom In
              </button>
              <button
                onClick={fitTreeToViewport}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-800/25 bg-black/25 px-3 text-sm text-amber-200 hover:border-amber-600/60 hover:bg-amber-950/20"
              >
                <Expand size={15} />
                Fit
              </button>
              <button
                onClick={resetPoints}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-800/25 bg-black/25 px-3 text-sm text-amber-200 hover:border-amber-600/60 hover:bg-amber-950/20"
              >
                <RotateCcw size={15} />
                Reset Points
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-amber-300/80">
              <span>Total spent: {totalSpentPoints}{typeof treeData.config.maxPoints === 'number' ? ` / ${treeData.config.maxPoints}` : ''}</span>
              <span>Scale: {Math.round(transform.scale * 100)}%</span>
              {!canEdit && (
                <span className="rounded-full border border-amber-800/20 bg-amber-950/15 px-3 py-1 text-amber-200/80">
                  Read-only for your account
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-amber-800/10 px-4 py-2 text-sm">
            <p className="text-amber-200/80">{statusMessage}</p>
            <div className="flex items-center gap-2 rounded-full border border-amber-800/20 bg-black/20 px-3 py-1.5">
              <Search size={14} className="text-amber-500" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Find a skill"
                className="w-40 bg-transparent text-sm text-amber-100 placeholder:text-stone-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div
            ref={viewportRef}
            className="relative min-h-[78vh] overflow-hidden border-r border-amber-800/20 bg-stone-950/90"
            onPointerDown={startPan}
            onPointerMove={handlePanMove}
            onPointerUp={endPan}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => {
              if (draggingSkillRef.current?.moved) {
                draggingSkillRef.current = null;
                return;
              }
              if (editMode === 'linking') {
                setEditMode('idle');
              }
              setSelectedSkillId(null);
              setSelectedConnectionId(null);
            }}
            onDoubleClick={(event) => {
              if (!canEdit) return;
              if ((event.target as HTMLElement).closest('[data-skill-node="true"]') || (event.target as HTMLElement).closest('[data-tree-ui="true"]')) {
                return;
              }
              const rect = viewportRef.current?.getBoundingClientRect();
              if (!rect) return;
              const localX = event.clientX - rect.left;
              const localY = event.clientY - rect.top;
              const worldX = (localX - transform.x) / transform.scale + worldBounds.minX - TREE_PADDING;
              const worldY = (localY - transform.y) / transform.scale + worldBounds.minY - TREE_PADDING;
              addSkillAtPosition(worldX, worldY);
              setStatusMessage('Created a new skill node.');
            }}
            onDragStart={(event) => event.preventDefault()}
            onPointerLeave={() => {
              setIsPanning(false);
              panStartRef.current = null;
              draggingSkillRef.current = null;
            }}
            onWheel={handleWheelZoom}
            style={{
              cursor: isPanning ? 'grabbing' : 'grab',
              overscrollBehavior: 'contain',
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              backgroundImage:
                `${treeData.config.backgroundImage ? `linear-gradient(rgb(0 0 0 / 0.48), rgb(0 0 0 / 0.68)), url(${treeData.config.backgroundImage}), ` : ''}` +
                `radial-gradient(circle at 20% 20%, rgb(var(--theme-600-rgb) / 0.12), transparent 32%), radial-gradient(circle at 80% 10%, rgb(var(--theme-400-rgb) / 0.08), transparent 28%), linear-gradient(180deg, rgb(4 10 20 / 0.96), rgb(5 10 18 / 0.98))`,
              backgroundSize: treeData.config.backgroundImage ? 'cover, auto, auto, auto' : 'auto',
              backgroundPosition: 'center',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: treeData.config.showGlobalGrid
                  ? `linear-gradient(rgb(255 255 255 / ${Math.max((treeData.config.gridOpacity ?? 12) / 100, 0.04)}) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / ${Math.max((treeData.config.gridOpacity ?? 12) / 100, 0.04)}) 1px, transparent 1px)`
                  : 'none',
                backgroundSize: `${treeData.config.gridSize}px ${treeData.config.gridSize}px`,
                opacity: 0.6,
                pointerEvents: 'none',
              }}
            />

            <div
              className="absolute left-0 top-0 origin-top-left"
              style={{
                width: `${worldBounds.width}px`,
                height: `${worldBounds.height}px`,
                transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                willChange: 'transform',
              }}
            >
              <svg
                width={worldBounds.width}
                height={worldBounds.height}
                className="absolute inset-0 overflow-visible"
                style={{ pointerEvents: 'auto' }}
              >
                <defs>
                  <filter id="skill-tree-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <marker
                    id="skill-tree-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(251,191,36,0.95)" />
                  </marker>
                </defs>
                {treeData.connections.map((connection) => {
                  const fromSkill = skillById.get(connection.from);
                  const toSkill = skillById.get(connection.to);
                  if (!fromSkill || !toSkill) return null;
                  const fromVisible = visibleSkillIds.has(fromSkill.id);
                  const toVisible = visibleSkillIds.has(toSkill.id);
                  const faded = searchQuery.trim() !== '' && (!fromVisible || !toVisible);
                  const path = buildConnectionPath(
                    connection,
                    fromSkill,
                    toSkill,
                    worldBounds.minX,
                    worldBounds.minY,
                  );
                  const midpoint = getConnectionMidpoint(
                    connection,
                    fromSkill,
                    toSkill,
                    worldBounds.minX,
                    worldBounds.minY,
                  );
                  return (
                    <g key={connection.id}>
                      <path
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={18}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedConnectionId(connection.id);
                          setSelectedSkillId(null);
                          setEditMode('idle');
                        }}
                      />
                      <path
                        d={path}
                        fill="none"
                        stroke={connection.mutuallyExclusive ? 'rgba(244,114,182,0.95)' : 'rgba(255,255,255,0.6)'}
                        strokeWidth={connection.mutuallyExclusive ? 3.5 : 2.2}
                        strokeDasharray={connection.dotted ? '7 7' : undefined}
                        markerEnd={treeData.config.showArrows ? 'url(#skill-tree-arrow)' : undefined}
                        filter="url(#skill-tree-glow)"
                        opacity={faded ? 0.12 : 0.82}
                        style={{ pointerEvents: 'none' }}
                      />
                      <g
                        transform={`translate(${midpoint.x}, ${midpoint.y})`}
                        style={{ pointerEvents: 'none', opacity: faded ? 0.18 : 0.95 }}
                      >
                        <circle r="10" fill="rgba(12,18,28,0.9)" stroke="rgba(251,191,36,0.8)" strokeWidth="1.5" />
                        <text
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill="rgba(251,191,36,0.95)"
                          fontSize="12"
                          fontWeight="700"
                        >
                          →
                        </text>
                      </g>
                    </g>
                  );
                })}
              </svg>

              {treeData.skills.map((skill) => {
                const state = skillStates.get(skill.id);
                if (!state) return null;
                const x = skill.x - worldBounds.minX + TREE_PADDING;
                const y = skill.y - worldBounds.minY + TREE_PADDING;
                const isSelected = selectedSkillId === skill.id;
                const isFilteredOut = searchQuery.trim() !== '' && !visibleSkillIds.has(skill.id);
                const skillGlow = state.isUnlocked
                  ? treeData.config.treeUnlockBoxshadow ?? '0 0 20px rgba(250, 204, 21, 0.35)'
                  : treeData.config.treeLockedBoxshadow ?? '0 0 12px rgba(0,0,0,0.45)';

                return (
                  <button
                    key={skill.id}
                    type="button"
                    data-skill-node="true"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (!canEdit) return;
                      draggingSkillRef.current = {
                        skillId: skill.id,
                        startClientX: event.clientX,
                        startClientY: event.clientY,
                        startSkillX: skill.x,
                        startSkillY: skill.y,
                        moved: false,
                      };
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onDragStart={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (draggingSkillRef.current?.skillId === skill.id && draggingSkillRef.current.moved) {
                        draggingSkillRef.current = null;
                        return;
                      }
                      setSelectedConnectionId(null);
                      if (editMode === 'linking' && selectedSkillId && selectedSkillId !== skill.id) {
                        toggleConnection(selectedSkillId, skill.id);
                        setEditMode('idle');
                        setStatusMessage(`Linked ${skillById.get(selectedSkillId)?.name ?? 'skill'} -> ${skill.name}.`);
                        return;
                      }

                      if (selectedSkillId !== skill.id) {
                        setSelectedSkillId(skill.id);
                        return;
                      }

                      if (state.canAddPoint) {
                        updateTreePoints(skill.id, 1);
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedConnectionId(null);
                      setSelectedSkillId(skill.id);
                      updateTreePoints(skill.id, -1);
                    }}
                    className="absolute flex items-center justify-center transition-all duration-150"
                    tabIndex={-1}
                    style={{
                      left: `${x}px`,
                      top: `${y}px`,
                      width: `${skill.size}px`,
                      height: `${skill.size}px`,
                      borderRadius: skill.shape === 'square' ? '1rem' : '9999px',
                      borderWidth: skill.borderType === 'solid' ? '3px' : '2px',
                      borderStyle: skill.borderType === 'solid' ? 'solid' : 'dashed',
                      borderColor: state.isUnlocked
                        ? treeData.config.treeUnlockColor ?? '#ffd700'
                        : treeData.config.treeLockedColor ?? '#292929',
                      boxShadow: isSelected
                        ? `0 0 0 3px rgb(255 255 255 / 0.28), ${skillGlow}`
                        : skillGlow,
                      background:
                        skill.image
                          ? `linear-gradient(rgb(0 0 0 / 0.18), rgb(0 0 0 / 0.48)), url(${skill.image}) center / cover no-repeat`
                          : `radial-gradient(circle at 30% 20%, rgb(255 255 255 / 0.18), transparent 42%), linear-gradient(135deg, ${state.isUnlocked ? 'rgba(34,197,94,0.28)' : 'rgba(17,24,39,0.92)'}, rgba(17,24,39,0.98))`,
                      opacity: isFilteredOut ? 0.2 : 1,
                    }}
                    title={`${skill.name} (${skill.currentPoints}/${skill.maxPoints})`}
                  >
                    {!skill.image && (
                      <span
                        className="text-lg font-bold uppercase text-amber-50"
                        style={{ fontFamily: "'Cinzel', serif" }}
                      >
                        {skill.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="absolute -right-2 -top-2 rounded-full border border-amber-300/40 bg-black/85 px-2 py-0.5 text-[11px] font-bold text-amber-100 shadow-lg">
                      {skill.currentPoints}/{skill.maxPoints}
                    </span>
                  </button>
                );
              })}

              {treeData.skills.map((skill) => {
                const isFilteredOut = searchQuery.trim() !== '' && !visibleSkillIds.has(skill.id);
                const x = skill.x - worldBounds.minX + TREE_PADDING + skill.size / 2;
                const y = skill.y - worldBounds.minY + TREE_PADDING + skill.size + 18;
                return (
                  <div
                    key={`${skill.id}-label`}
                    className="pointer-events-none absolute -translate-x-1/2 text-center"
                    style={{
                      left: `${x}px`,
                      top: `${y}px`,
                      width: `${Math.max(skill.size + 70, 120)}px`,
                      opacity: isFilteredOut ? 0.14 : 1,
                    }}
                  >
                    <p
                      className="text-balance text-amber-50 drop-shadow-[0_2px_5px_rgba(0,0,0,0.9)]"
                      style={{
                        fontFamily: "'Cinzel', serif",
                        fontSize: `${treeData.config.showSkillNames ? treeData.config.skillNamesSize ?? 12 : 12}px`,
                      }}
                    >
                      {skill.name}
                    </p>
                  </div>
                );
              })}

              {selectedSkill && selectedSkillCanvasPosition && (
                <div
                  className="absolute -translate-x-1/2 -translate-y-full"
                  style={{
                    left: `${selectedSkillCanvasPosition.x}px`,
                    top: `${selectedSkillCanvasPosition.y}px`,
                  }}
                  data-tree-ui="true"
                >
                  <div
                    className="flex items-center gap-2 rounded-2xl border border-amber-700/30 bg-stone-950/95 px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditModalOpen(true);
                        setEditMode('idle');
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-800/20 bg-black/20 px-3 py-1.5 text-xs text-amber-100 hover:border-amber-600/50 hover:bg-amber-950/20"
                    >
                      <Edit3 size={13} />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditMode((current) => (current === 'linking' ? 'idle' : 'linking'));
                        setSelectedConnectionId(null);
                      }}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                        editMode === 'linking'
                          ? 'border-sky-500/60 bg-sky-950/30 text-sky-100'
                          : 'border-amber-800/20 bg-black/20 text-amber-100 hover:border-amber-600/50 hover:bg-amber-950/20'
                      }`}
                    >
                      <Link2 size={13} />
                      Link
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSkill(selectedSkill.id)}
                      disabled={!canEdit}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-700/30 bg-rose-950/20 px-3 py-1.5 text-xs text-rose-100 hover:border-rose-500/60 hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              )}

              {selectedConnection && selectedConnectionEndpoints && selectedConnectionCanvasPosition && (
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${selectedConnectionCanvasPosition.x}px`,
                    top: `${selectedConnectionCanvasPosition.y}px`,
                  }}
                  data-tree-ui="true"
                >
                  <div
                    className="flex items-center gap-2 rounded-2xl border border-amber-700/30 bg-stone-950/95 px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <select
                      value={selectedConnection.unlockMode ?? 'any-point'}
                      onChange={(event) =>
                        updateConnection(selectedConnection.id, {
                          unlockMode: event.target.value === 'full-point' ? 'full-point' : 'any-point',
                        })
                      }
                      disabled={!canEdit}
                      className="rounded-lg border border-amber-800/20 bg-black/30 px-2 py-1.5 text-xs text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <option value="any-point">Any Point</option>
                      <option value="full-point">Full Point</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => deleteConnection(selectedConnection.id)}
                      disabled={!canEdit}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-700/30 bg-rose-950/20 px-3 py-1.5 text-xs text-rose-100 hover:border-rose-500/60 hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-4 bg-stone-950/90 p-5">
            <div className="rounded-2xl border border-amber-800/20 bg-black/20 p-4">
              <h2 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                Tree Summary
              </h2>
              <div className="mt-3 space-y-2 text-sm text-amber-100/85">
                <p><span className="text-amber-500">Name:</span> {treeName || 'Untitled'}</p>
                <p><span className="text-amber-500">Nodes:</span> {treeData.skills.length}</p>
                <p><span className="text-amber-500">Connections:</span> {treeData.connections.length}</p>
                <p><span className="text-amber-500">Point Cap:</span> {treeData.config.maxPoints ?? 'Unlimited'}</p>
                <p><span className="text-amber-500">Saved Trees:</span> {savedTrees.length}</p>
              </div>
              <div className="mt-4 rounded-xl border border-amber-800/15 bg-amber-950/10 p-3 text-xs text-amber-100/75">
                Left click a node to add a point. Right click a node to remove a point. Drag empty space to pan and use the mouse wheel to zoom.
              </div>
            </div>

            <div className="rounded-2xl border border-amber-800/20 bg-black/20 p-4">
              <h2 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                Skill Details
              </h2>
              {selectedSkill ? (
                <div className="mt-4 space-y-3 text-sm text-amber-100/90">
                  <div>
                    <p className="text-xl text-amber-100" style={{ fontFamily: "'Cinzel', serif" }}>
                      {selectedSkill.name}
                    </p>
                    <p className="mt-1 text-amber-400">
                      {selectedSkill.currentPoints} / {selectedSkill.maxPoints} points
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => updateTreePoints(selectedSkill.id, 1)}
                      disabled={!selectedSkillState?.canAddPoint}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-700/40 bg-emerald-950/20 px-3 py-2 text-emerald-100 hover:border-emerald-500/70 hover:bg-emerald-900/35 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Plus size={14} />
                      Add Point
                    </button>
                    <button
                      onClick={() => updateTreePoints(selectedSkill.id, -1)}
                      disabled={selectedSkill.currentPoints <= 0}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-700/40 bg-rose-950/20 px-3 py-2 text-rose-100 hover:border-rose-500/70 hover:bg-rose-900/35 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <Minus size={14} />
                      Remove Point
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap leading-6 text-amber-100/85">
                    {selectedSkill.description || 'No description provided for this skill.'}
                  </p>
                  <div className="space-y-2 rounded-xl border border-amber-800/15 bg-black/20 p-3">
                    <p><span className="text-amber-500">Prerequisite:</span> {selectedSkill.prerequisiteText || '-'}</p>
                    {selectedSkillState?.unmetRequirements.length ? (
                      <p className="text-rose-300">
                        Missing: {selectedSkillState.unmetRequirements.join(', ')}
                      </p>
                    ) : (
                      <p className="text-emerald-300">All explicit prerequisites met.</p>
                    )}
                    {selectedSkillState?.blockedByConnections.length ? (
                      <p className="text-amber-300">
                        Incoming links still locked by: {selectedSkillState.blockedByConnections.join(', ')}
                      </p>
                    ) : null}
                    {selectedSkillState?.exclusiveConflict ? (
                      <p className="text-fuchsia-300">
                        Blocked by a mutually exclusive skill that already has points.
                      </p>
                    ) : null}
                    {selectedSkill.resources.length > 0 && (
                      <p><span className="text-amber-500">Resources:</span> {selectedSkill.resources.join(', ')}</p>
                    )}
                  </div>
                  <div className="rounded-xl border border-amber-800/15 bg-black/20 p-3 text-xs text-amber-100/75">
                    Click a node once to select it. Click the selected node again to add a point. Use the floating `Edit`, `Link`, and `Delete` actions above the selected node for structural changes.
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm text-stone-400">
                  Select a node on the tree to inspect and adjust it.
                </p>
              )}
            </div>

            {selectedConnection && selectedConnectionEndpoints && (
              <div className="rounded-2xl border border-amber-800/20 bg-black/20 p-4">
                <h2 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                  Connection
                </h2>
                <div className="mt-4 space-y-3 text-sm text-amber-100/90">
                  <p>
                    <span className="text-amber-500">Direction:</span>{' '}
                    {selectedConnectionEndpoints.fromSkill.name} → {selectedConnectionEndpoints.toSkill.name}
                  </p>
                  <label className="block space-y-1">
                    <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Mode</span>
                    <select
                      value={selectedConnection.unlockMode ?? 'any-point'}
                      onChange={(event) =>
                        updateConnection(selectedConnection.id, {
                          unlockMode: event.target.value === 'full-point' ? 'full-point' : 'any-point',
                        })
                      }
                      disabled={!canEdit}
                      className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <option value="any-point">Any Point</option>
                      <option value="full-point">Full Point</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => deleteConnection(selectedConnection.id)}
                    disabled={!canEdit}
                    className="inline-flex items-center gap-2 rounded-lg border border-rose-700/30 bg-rose-950/20 px-3 py-2 text-sm text-rose-100 hover:border-rose-500/60 hover:bg-rose-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-amber-800/20 bg-black/20 p-4">
              <h2 className="text-lg font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                JSON Compatibility
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-amber-100/80">
                <li className="flex gap-2"><FileJson size={15} className="mt-0.5 text-amber-500" /> Imports exported `.json` files from RPG Skill Tree Generator.</li>
                <li className="flex gap-2"><Save size={15} className="mt-0.5 text-amber-500" /> Saves the whole imported tree, including current allocated points, back into Firestore.</li>
                <li className="flex gap-2"><Copy size={15} className="mt-0.5 text-amber-500" /> `Save as Copy` preserves the original saved tree and creates a new record instead.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {isEditModalOpen && selectedSkill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setIsEditModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl rounded-3xl border border-amber-800/30 bg-stone-950/95 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-amber-300" style={{ fontFamily: "'Cinzel', serif" }}>
                  Edit Skill
                </h2>
                <p className="mt-1 text-sm text-amber-100/70">{selectedSkill.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-xl border border-amber-800/20 bg-black/25 px-3 py-2 text-sm text-amber-100 hover:border-amber-600/50 hover:bg-amber-950/20"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Skill Name</span>
                <input
                  type="text"
                  value={selectedSkill.name}
                  onChange={(event) => updateSelectedSkill(selectedSkill.id, { name: event.target.value })}
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Icon URL</span>
                <input
                  type="url"
                  value={selectedSkill.image ?? ''}
                  onChange={(event) =>
                    updateSelectedSkill(selectedSkill.id, { image: event.target.value.trim() || undefined })
                  }
                  disabled={!canEdit}
                  placeholder="https://i.imgur.com/example.png"
                  className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Max Skill Level</span>
                <input
                  type="number"
                  min={1}
                  value={selectedSkill.maxPoints}
                  onChange={(event) =>
                    updateSelectedSkill(selectedSkill.id, {
                      maxPoints: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Cost Per Level</span>
                <input
                  type="number"
                  min={1}
                  value={selectedSkill.cost ?? 1}
                  onChange={(event) =>
                    updateSelectedSkill(selectedSkill.id, {
                      cost: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Current Points</span>
                <input
                  type="number"
                  min={0}
                  max={selectedSkill.maxPoints}
                  value={selectedSkill.currentPoints}
                  onChange={(event) =>
                    updateSelectedSkill(selectedSkill.id, {
                      currentPoints: Math.max(0, Math.min(selectedSkill.maxPoints, Number(event.target.value) || 0)),
                    })
                  }
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
            </div>

            <label className="mt-4 block space-y-1">
              <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Resources</span>
              <input
                type="text"
                value={selectedSkill.resources.join(', ')}
                onChange={(event) =>
                  updateSelectedSkill(selectedSkill.id, {
                    resources: event.target.value
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean),
                  })
                }
                disabled={!canEdit}
                placeholder="mana, rage, focus"
                className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
              />
            </label>

            <label className="mt-4 block space-y-1">
              <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Prerequisite Text</span>
              <input
                type="text"
                value={selectedSkill.prerequisiteText}
                onChange={(event) =>
                  updateSelectedSkill(selectedSkill.id, {
                    prerequisiteText: event.target.value,
                  })
                }
                disabled={!canEdit}
                placeholder="Basic Form (1), Arcane Core (2)"
                className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
              />
            </label>

            <label className="mt-4 block space-y-1">
              <span className="text-xs uppercase tracking-[0.18em] text-amber-600">Description</span>
              <textarea
                value={selectedSkill.description}
                onChange={(event) =>
                  updateSelectedSkill(selectedSkill.id, { description: event.target.value })
                }
                disabled={!canEdit}
                rows={8}
                className="w-full rounded-xl border border-amber-800/20 bg-black/30 px-3 py-2 text-sm text-amber-100 focus:border-amber-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default SkillTreePage;
