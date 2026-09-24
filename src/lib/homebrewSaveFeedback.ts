import type { CharacterData } from '../types/character';
import { setCachedHomebrewCharacter } from './homebrewCharacterCache';
import { buildCharacterSheetSyncValues } from './characterContext';
import { DEFAULT_CHARACTER_SYNC_SHEET_ID, DEFAULT_CHARACTER_SYNC_TAB_NAME, syncCharacterSheet } from './characterSheetSync';

export const homebrewNotice = (message: string) => window.dispatchEvent(new CustomEvent('homebrew-notice', { detail: message }));

export function publishHomebrewSave(character: CharacterData, onUpdated: (character: CharacterData) => void) {
  setCachedHomebrewCharacter(character);
  onUpdated(character);
  homebrewNotice('Saved.');
  if (!(character.sendToSpreadsheet ?? true)) return;
  void (async () => {
    try {
      const result = await syncCharacterSheet({ characterId: character.id, characterName: character.name, sheetId: DEFAULT_CHARACTER_SYNC_SHEET_ID, tabName: DEFAULT_CHARACTER_SYNC_TAB_NAME, values: buildCharacterSheetSyncValues(character) });
      if (!result.success) homebrewNotice(`Saved. Spreadsheet: ${result.message}`);
    } catch { homebrewNotice('Saved. Spreadsheet sync failed.'); }
  })();
}
