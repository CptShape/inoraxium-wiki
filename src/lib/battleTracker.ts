export type BattleTrackerColumn = {
  id: string;
  name: string;
  isStatic?: boolean;
};

export type BattleTrackerRow = {
  id: string;
  cells: Record<string, string>;
  status?: 'fighting' | 'stunned' | 'unknown' | 'defeated';
};

export const BATTLE_TRACKER_STORAGE_KEY_COLUMNS = 'battleTrackerColumns';
export const BATTLE_TRACKER_STORAGE_KEY_ROWS = 'battleTrackerRows';
export const BATTLE_TRACKER_STORAGE_KEY_ACTIVE_INDEX = 'battleTrackerActiveRowIndex';
export const BATTLE_TRACKER_STORAGE_KEY_WEBHOOK = 'battleTrackerWebhookUrl';
export const BATTLE_TRACKER_STORAGE_KEY_DESC = 'battleTrackerEncounterDescription';

export const DEFAULT_BATTLE_TRACKER_COLUMNS: BattleTrackerColumn[] = [
  { id: 'name', name: 'Name', isStatic: true },
  { id: 'initiative', name: 'Initiative', isStatic: true },
];

export function loadBattleTrackerColumns(): BattleTrackerColumn[] {
  const saved = localStorage.getItem(BATTLE_TRACKER_STORAGE_KEY_COLUMNS);
  return saved ? JSON.parse(saved) : DEFAULT_BATTLE_TRACKER_COLUMNS;
}

export function loadBattleTrackerRows(): BattleTrackerRow[] {
  const saved = localStorage.getItem(BATTLE_TRACKER_STORAGE_KEY_ROWS);
  if (!saved) return [];
  const parsed = JSON.parse(saved);
  return parsed.map((r: any) => ({
    ...r,
    status: r.status ?? 'fighting',
  }));
}

export function saveBattleTrackerRows(rows: BattleTrackerRow[]): void {
  localStorage.setItem(BATTLE_TRACKER_STORAGE_KEY_ROWS, JSON.stringify(rows));
}

export function createUniqueCombatantName(existingRows: BattleTrackerRow[], baseName: string): string {
  const normalizedBase = baseName.trim() || 'Unnamed Combatant';
  const existingNames = new Set(existingRows.map(row => (row.cells['name'] || '').trim().toLowerCase()));

  if (!existingNames.has(normalizedBase.toLowerCase())) {
    return normalizedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${normalizedBase} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${normalizedBase} ${suffix}`;
}

export function addCombatantToBattleTracker(baseName: string): string {
  const columns = loadBattleTrackerColumns();
  const rows = loadBattleTrackerRows();
  const uniqueName = createUniqueCombatantName(rows, baseName);
  const emptyCells: Record<string, string> = {};

  columns.forEach((column) => {
    emptyCells[column.id] = '';
  });
  emptyCells['name'] = uniqueName;

  const nextRows = [
    ...rows,
    {
      id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cells: emptyCells,
      status: 'fighting' as const,
    },
  ];

  saveBattleTrackerRows(nextRows);
  window.dispatchEvent(new CustomEvent('battle-tracker:rows-updated'));
  return uniqueName;
}

export function clearBattleTrackerCombatants(): void {
  saveBattleTrackerRows([]);
  localStorage.setItem(BATTLE_TRACKER_STORAGE_KEY_ACTIVE_INDEX, '0');
  window.dispatchEvent(new CustomEvent('battle-tracker:rows-updated'));
}
