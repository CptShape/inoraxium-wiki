import type { CharacterBar, CharacterData, CharacterGeneralItem, CharacterInventoryItem, CharacterSpell, CharacterStatus, CustomAttribute, SkillAttribute } from '../types/character';

export const entryFields = ['inventory', 'generalItems', 'spells', 'statuses', 'mainAttributes', 'secondaryAttributes', 'otherAttributes', 'skills', 'resistances', 'bars'] as const;
export type HomebrewEntryField = typeof entryFields[number];
export type HomebrewObject = CharacterInventoryItem | CharacterGeneralItem | CharacterSpell | CharacterStatus;
export type HomebrewEntry = HomebrewObject | CustomAttribute | SkillAttribute | CharacterBar;
export type HomebrewObjectKind = 'item' | 'spell' | 'status';
export const objectField = (kind: string): HomebrewEntryField => kind === 'spell' ? 'spells' : kind === 'status' ? 'statuses' : kind === 'general-item' ? 'generalItems' : 'inventory';
export const canControlHomebrew = (character: CharacterData, uid: string | null) => !character.userId || character.userId === 'guest' || Boolean(uid && (character.userId === uid || character.controlUserIds?.includes(uid)));

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
export const sameEntry = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function changeHomebrewEntry(character: CharacterData, uid: string | null, field: HomebrewEntryField, entry: HomebrewEntry, original?: HomebrewEntry): CharacterData {
  if (!canControlHomebrew(character, uid)) throw new Error('Control permission required.');
  if (!entryFields.includes(field)) throw new Error('Invalid entry category.');
  if (!entry.id || !entry.name.trim()) throw new Error('Enter a name and ID.');
  const list = (character[field] || []) as HomebrewEntry[];
  const existing = list.find(item => item.id === entry.id);
  if (original) {
    if (entry.id !== original.id) throw new Error('An existing ID cannot be changed.');
    if (!existing) throw new Error('This object was deleted. Close the editor and refresh.');
    if (sameEntry(existing, entry)) return character;
    if (!sameEntry(existing, original)) throw new Error('This object changed while you were editing. Close and reopen the editor before saving. Your draft has not been saved.');
  } else if (existing) {
    if (sameEntry(existing, entry)) return character;
    throw new Error('This ID is already in use.');
  }
  if (!original && entryFields.some(key => key !== field && ((character[key] || []) as HomebrewEntry[]).some(item => item.id === entry.id))) throw new Error('This ID is already in use.');
  if ('quantity' in entry && (!Number.isFinite(entry.quantity) || !Number.isInteger(entry.quantity))) throw new Error('Quantity must be a whole number.');
  return { ...character, [field]: original ? list.map(item => item.id === entry.id ? entry : item) : [...list, entry] };
}

// Copies keep semantic local IDs and target references, but never source-instance ownership.
export function copyHomebrewObject<T extends HomebrewObject>(entry: T): T {
  const copy = structuredClone(entry);
  const ids = new Map<string, string>();
  const collect = (value: unknown, key = '') => {
    if (key === 'localVariables' || key === 'placeholders' || key === 'battleSettings') return;
    if (Array.isArray(value)) value.forEach(item => collect(item));
    else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.id === 'string') ids.set(record.id, crypto.randomUUID());
      Object.entries(record).forEach(([k, v]) => collect(v, k));
    }
  };
  collect(copy);
  const visit = (value: unknown, semantic = false) => {
    if (Array.isArray(value)) { value.forEach(item => visit(item, semantic)); return; }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(record)) {
      if (/^(linkedStatusSource|linkedScriptSource|scriptSource)/.test(key) || ['lastMatched', 'lastTriggeredNonce'].includes(key)) { delete record[key]; continue; }
      if (key === 'appliedStatusInstanceIds') { record[key] = []; continue; }
      if (key === 'effectId' && typeof val === 'string') record[key] = ids.get(val) || val;
      else if (key === 'id' && !semantic && typeof val === 'string') record[key] = ids.get(val) || val;
      else visit(val, semantic || key === 'localVariables' || key === 'placeholders' || key === 'battleSettings');
    }
  };
  visit(copy);
  if ('folderId' in copy) copy.folderId = null;
  return copy;
}
