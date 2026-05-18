export interface CharacterSheetSyncPayload {
  characterId: string;
  characterName: string;
  sheetId: string;
  tabName: string;
  values: Record<string, string | number>;
}

export interface CharacterSheetSyncResult {
  success: boolean;
  skipped?: boolean;
  message: string;
  data?: {
    characterId: string;
    characterName: string;
    sheetId: string;
    tabName: string;
    rowIndex: number;
    createdRow: boolean;
    updatedColumns: string[];
    headers: string[];
  };
  error?: {
    code?: string;
    message: string;
  };
}

const CHARACTER_SYNC_ENDPOINT = 'https://ulunavir-vercel.vercel.app/api/sync-character-sheet';
const CHARACTER_SYNC_SECRET = 'ulunavirSync_yasoes31';
export const DEFAULT_CHARACTER_SYNC_SHEET_ID = '1I3OY-TlUcG4DMqDMGS-Vzim4EHtBgW-XTE16ta9lPbo';
export const DEFAULT_CHARACTER_SYNC_TAB_NAME = 'CptShape';
const LAST_SYNC_SNAPSHOT_PREFIX = 'characterSheetSync:lastSuccess:';

const getSnapshotStorageKey = (payload: CharacterSheetSyncPayload) => (
  `${LAST_SYNC_SNAPSHOT_PREFIX}${payload.sheetId}:${payload.tabName}:${payload.characterId}`
);

const getPayloadSnapshot = (payload: CharacterSheetSyncPayload) => JSON.stringify(payload);

export async function syncCharacterSheet(
  payload: CharacterSheetSyncPayload,
): Promise<CharacterSheetSyncResult> {
  const snapshotKey = getSnapshotStorageKey(payload);
  const snapshot = getPayloadSnapshot(payload);

  if (typeof window !== 'undefined' && window.localStorage.getItem(snapshotKey) === snapshot) {
    return {
      success: true,
      skipped: true,
      message: 'Spreadsheet sync skipped because nothing changed since the last successful sync.',
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(CHARACTER_SYNC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': CHARACTER_SYNC_SECRET,
      },
      body: snapshot,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      return {
        success: false,
        message: data?.error?.message || `Spreadsheet sync failed with status ${response.status}.`,
        error: data?.error || {
          code: 'SYNC_FAILED',
          message: data?.error?.message || `Spreadsheet sync failed with status ${response.status}.`,
        },
      };
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(snapshotKey, snapshot);
    }

    return {
      success: true,
      message: data.message || 'Spreadsheet sync completed.',
      data: data.data,
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.name === 'AbortError'
        ? 'Spreadsheet sync timed out.'
        : error.message
      : 'Spreadsheet sync failed.';

    return {
      success: false,
      message,
      error: {
        code: 'NETWORK_ERROR',
        message,
      },
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
