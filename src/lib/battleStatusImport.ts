import type { CharacterStatus, StatusEffect } from '../types/character';
import { importJsonTextWithChoice } from './jsonTransfer';

export function parseBattleStatus(raw: string): StatusEffect {
  const payload = JSON.parse(raw);
  if (payload?.schema !== 'inoraxium-character-entry' || payload.version !== 1 || payload.kind !== 'status' || !payload.entry || typeof payload.entry !== 'object' || Array.isArray(payload.entry)) throw new Error('Import a status export JSON.');
  const entry: Partial<CharacterStatus> = payload.entry;
  if (typeof entry.name !== 'string' || !entry.name.trim() || entry.effects !== undefined && !Array.isArray(entry.effects)) throw new Error('Invalid status template.');
  return { id: crypto.randomUUID(), effectType: 'status', targetId: '', value: '', active: true, statusName: entry.name, statusEntry: structuredClone(entry), statusFolderId: null };
}

export async function importBattleStatus(onAdd: (effect: StatusEffect) => void) {
  const raw = await importJsonTextWithChoice();
  if (raw) onAdd(parseBattleStatus(raw));
}
