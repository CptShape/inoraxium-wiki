import { google, sheets_v4 } from 'googleapis';

export const REQUIRED_HEADERS = ['characterId', 'characterName'] as const;

export type CharacterValues = Record<string, string | number | boolean | null>;

export interface CharacterSheetSyncInput {
  characterId: string;
  characterName: string;
  sheetId: string;
  tabName: string;
  values: CharacterValues;
}

export interface SyncResult {
  rowIndex: number;
  createdRow: boolean;
  headers: string[];
  updatedColumns: string[];
}

interface SheetsEnv {
  clientEmail: string;
  privateKey: string;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getGoogleSheetsEnv(): SheetsEnv {
  return {
    clientEmail: getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    privateKey: getRequiredEnv('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n'),
  };
}

function getSheetsClient(): sheets_v4.Sheets {
  const { clientEmail, privateKey } = getGoogleSheetsEnv();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

function quoteSheetName(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`;
}

function columnNumberToLetter(columnNumber: number): string {
  let result = '';
  let current = columnNumber;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function normalizeHeaderRow(headerRow?: Array<string | null>): string[] {
  return (headerRow ?? []).map(header => String(header ?? '').trim());
}

function buildDesiredHeaders(existingHeaders: string[], valueKeys: string[]): string[] {
  const desiredHeaders = [...existingHeaders];
  for (const requiredHeader of REQUIRED_HEADERS) {
    if (!desiredHeaders.includes(requiredHeader)) desiredHeaders.push(requiredHeader);
  }

  const missingValueHeaders = valueKeys
    .filter(key => !desiredHeaders.includes(key))
    .sort((a, b) => a.localeCompare(b));
  desiredHeaders.push(...missingValueHeaders);
  return desiredHeaders;
}

function valueForHeader(header: string, input: CharacterSheetSyncInput): string | number | boolean {
  if (header === 'characterId') return input.characterId;
  if (header === 'characterName') return input.characterName;
  const value = input.values[header];
  return value === null ? '' : value;
}

export async function syncCharacterSheetToGoogle(input: CharacterSheetSyncInput): Promise<SyncResult> {
  const sheets = getSheetsClient();
  const sheetName = quoteSheetName(input.tabName);
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: input.sheetId,
    range: `${sheetName}!1:1`,
  });

  const existingHeaders = normalizeHeaderRow(headerResponse.data.values?.[0]);
  const desiredHeaders = buildDesiredHeaders(existingHeaders, Object.keys(input.values));
  const headersChanged = desiredHeaders.length !== existingHeaders.length
    || desiredHeaders.some((header, index) => header !== existingHeaders[index]);

  if (headersChanged) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: input.sheetId,
      range: `${sheetName}!A1:${columnNumberToLetter(desiredHeaders.length)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [desiredHeaders] },
    });
  }

  const idColumnIndex = desiredHeaders.indexOf('characterId');
  const idColumnLetter = columnNumberToLetter(idColumnIndex + 1);
  const idColumnResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: input.sheetId,
    range: `${sheetName}!${idColumnLetter}2:${idColumnLetter}`,
  });

  const idRows = idColumnResponse.data.values ?? [];
  const rowOffset = idRows.findIndex(row => String(row[0] ?? '').trim() === input.characterId);
  const rowIndex = rowOffset >= 0 ? rowOffset + 2 : idRows.length + 2;
  const createdRow = rowOffset < 0;
  const updatedColumns = desiredHeaders.filter(header => (
    header === 'characterId'
    || header === 'characterName'
    || Object.prototype.hasOwnProperty.call(input.values, header)
  ));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: input.sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updatedColumns.map((header) => {
        const columnLetter = columnNumberToLetter(desiredHeaders.indexOf(header) + 1);
        return {
          range: `${sheetName}!${columnLetter}${rowIndex}`,
          values: [[valueForHeader(header, input)]],
        };
      }),
    },
  });

  return {
    rowIndex,
    createdRow,
    headers: desiredHeaders,
    updatedColumns,
  };
}
