import { timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from './_lib/http';
import { syncCharacterSheetToGoogle, type CharacterSheetSyncInput, type CharacterValues } from './_lib/googleSheets';

type JsonResponse =
  | {
      success: true;
      message: string;
      data: {
        characterId: string;
        characterName: string;
        sheetId: string;
        tabName: string;
        rowIndex: number;
        createdRow: boolean;
        updatedColumns: string[];
        headers: string[];
      };
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        details?: unknown;
      };
    };

function jsonError(
  res: VercelResponse,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(typeof details === 'undefined' ? {} : { details }),
    },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateValues(values: unknown): values is CharacterValues {
  if (!isPlainObject(values)) {
    return false;
  }

  return Object.values(values).every((value) => {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  });
}

function parsePayload(body: unknown): { ok: true; data: CharacterSheetSyncInput } | { ok: false; message: string; details?: unknown } {
  if (!isPlainObject(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const { characterId, characterName, sheetId, tabName, values } = body;

  const trimmedCharacterId = typeof characterId === 'string' ? characterId.trim() : '';
  const trimmedCharacterName = typeof characterName === 'string' ? characterName.trim() : '';
  const trimmedSheetId = typeof sheetId === 'string' ? sheetId.trim() : '';
  const trimmedTabName = typeof tabName === 'string' ? tabName.trim() : '';

  if (!trimmedCharacterId) {
    return { ok: false, message: 'characterId is required and must be a non-empty string.' };
  }

  if (!trimmedCharacterName) {
    return { ok: false, message: 'characterName is required and must be a non-empty string.' };
  }

  if (!trimmedSheetId) {
    return { ok: false, message: 'sheetId is required and must be a non-empty string.' };
  }

  if (!trimmedTabName) {
    return { ok: false, message: 'tabName is required and must be a non-empty string.' };
  }

  if (!validateValues(values)) {
    return {
      ok: false,
      message: 'values is required and must be an object containing only string, number, boolean, or null values.',
    };
  }

  if (Object.keys(values).length === 0) {
    return { ok: false, message: 'values must include at least one field to sync.' };
  }

  if (Object.prototype.hasOwnProperty.call(values, 'characterId') || Object.prototype.hasOwnProperty.call(values, 'characterName')) {
    return {
      ok: false,
      message: 'values cannot include characterId or characterName because those fields are managed separately.',
    };
  }

  return {
    ok: true,
    data: {
      characterId: trimmedCharacterId,
      characterName: trimmedCharacterName,
      sheetId: trimmedSheetId,
      tabName: trimmedTabName,
      values,
    },
  };
}

function secretsMatch(expectedSecret: string, providedSecret: string): boolean {
  const expected = Uint8Array.from(Buffer.from(expectedSecret));
  const provided = Uint8Array.from(Buffer.from(providedSecret));

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

function getSecretFromRequest(req: VercelRequest): string {
  const headerSecret = req.headers['x-sync-secret'];
  return typeof headerSecret === 'string' ? headerSecret.trim() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyApiCors(req, res, 'POST, OPTIONS', 'Content-Type, x-sync-secret')) {
    return jsonError(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.');
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return jsonError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST requests are allowed.');
  }

  const expectedSecret = process.env.CHARACTER_SYNC_SHARED_SECRET?.trim();
  if (!expectedSecret) {
    return jsonError(
      res,
      500,
      'SERVER_MISCONFIGURED',
      'Missing CHARACTER_SYNC_SHARED_SECRET environment variable.',
    );
  }

  const providedSecret = getSecretFromRequest(req);
  if (!providedSecret || !secretsMatch(expectedSecret, providedSecret)) {
    return jsonError(res, 401, 'UNAUTHORIZED', 'Invalid or missing sync secret.');
  }

  const parsedPayload = parsePayload(req.body);
  if (parsedPayload.ok === false) {
    return jsonError(res, 400, 'INVALID_REQUEST', parsedPayload.message, parsedPayload.details);
  }

  const allowedSheetId = process.env.CHARACTER_SYNC_SHEET_ID?.trim();
  const allowedTabName = process.env.CHARACTER_SYNC_TAB_NAME?.trim();
  if (!allowedSheetId || !allowedTabName) {
    return jsonError(res, 500, 'SERVER_MISCONFIGURED', 'Missing allowed spreadsheet target configuration.');
  }
  if (parsedPayload.data.sheetId !== allowedSheetId || parsedPayload.data.tabName !== allowedTabName) {
    return jsonError(res, 403, 'TARGET_NOT_ALLOWED', 'This spreadsheet target is not allowed.');
  }

  try {
    const payload = parsedPayload.data;
    const result = await syncCharacterSheetToGoogle(payload);

    return res.status(200).json({
      success: true,
      message: result.createdRow ? 'Character sheet synced and a new row was created.' : 'Character sheet synced successfully.',
      data: {
        characterId: payload.characterId,
        characterName: payload.characterName,
        sheetId: payload.sheetId,
        tabName: payload.tabName,
        rowIndex: result.rowIndex,
        createdRow: result.createdRow,
        updatedColumns: result.updatedColumns,
        headers: result.headers,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(res, 500, 'SYNC_FAILED', `Failed to sync data to Google Sheets: ${message}`);
  }
}

