import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterData, CharacterInventoryItem, PartyData } from '../types/character';
import { changeHomebrewEntry, copyHomebrewObject } from './homebrewEntries';
import { addEntryToPartyInventory, saveHomebrewEntry } from './firestore';

const db = vi.hoisted(() => ({ current: {} as Record<string, unknown>, update: vi.fn(), fail: false }));
vi.mock('firebase/app', () => ({ getApps: () => [{}], getApp: () => ({}), initializeApp: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), doc: (...args: unknown[]) => args.slice(1),
  arrayUnion: (entry: unknown) => ({ union: entry }),
  runTransaction: async (_db: unknown, callback: (tx: unknown) => Promise<unknown>) => {
    if (db.fail) throw new Error('Network unavailable');
    return callback({ get: async () => ({ exists: () => true, id: db.current.id, data: () => structuredClone(db.current) }), update: db.update });
  },
  collection: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(), deleteDoc: vi.fn(), query: vi.fn(), where: vi.fn(), or: vi.fn(), onSnapshot: vi.fn(),
}));

const item = (id = 'item-1') => ({ id, name: id, quantity: 1, effects: [], actions: [] }) as unknown as CharacterInventoryItem;
const character = () => ({ id: 'char-1', name: 'QA', userId: 'owner', inventory: [item()], statuses: [], bars: [], updatedAt: 10 }) as unknown as CharacterData;
const storageKey = 'battleTrackerLocalCharacters';
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  db.current = character() as unknown as Record<string, unknown>; db.fail = false; db.update.mockClear();
});

describe('Homebrew entry changes', () => {
  it('preserves unrelated concurrent edits', () => {
    const original = item();
    const fresh = { ...character(), name: 'New character name', inventory: [original, { ...item('item-2'), quantity: 8 }] };
    const next = changeHomebrewEntry(fresh, 'owner', 'inventory', { ...original, name: 'Edited' }, original);
    expect(next.name).toBe('New character name'); expect(next.inventory![1].quantity).toBe(8);
    expect(next.inventory![0].name).toBe('Edited'); expect(fresh.inventory[0].name).toBe('item-1');
  });
  it('rejects changed or deleted objects and revoked control', () => {
    const original = item(), edited = { ...original, name: 'Edited' };
    expect(() => changeHomebrewEntry({ ...character(), inventory: [{ ...original, quantity: 3 }] }, 'owner', 'inventory', edited, original)).toThrow('changed while');
    expect(() => changeHomebrewEntry({ ...character(), inventory: [] }, 'owner', 'inventory', edited, original)).toThrow('deleted');
    expect(() => changeHomebrewEntry(character(), 'viewer', 'inventory', edited, original)).toThrow('Control permission');
  });
  it('rejects duplicate IDs across sections and invalid quantities', () => {
    expect(() => changeHomebrewEntry(character(), 'owner', 'generalItems', item())).toThrow('already in use');
    expect(() => changeHomebrewEntry(character(), 'owner', 'inventory', { ...item('new'), quantity: 1.5 })).toThrow('whole number');
  });
  it('accepts negative quantities and safely retries identical adds/edits', () => {
    const c = character(); expect(changeHomebrewEntry(c, 'owner', 'inventory', item())).toBe(c);
    expect(changeHomebrewEntry(c, 'owner', 'inventory', item(), item())).toBe(c);
    expect(changeHomebrewEntry(c, 'owner', 'inventory', { ...item(), quantity: -2 }, item()).inventory![0].quantity).toBe(-2);
  });
  it('copies deep instance IDs but preserves formulas, local IDs and battle effect links', () => {
    const original = { ...item(), folderId: 'folder', linkedStatusSourceEntryId: 'source', localVariables: [{ id: 'local_a', value: '2' }], actions: [{ id: 'action', effects: [{ id: 'effect', targetId: 'bar_hp' }], battleSettings: { landed: [{ id: 'step', effectId: 'effect', formula: '@@local_a' }] } }] } as unknown as CharacterInventoryItem;
    const copy = copyHomebrewObject(original);
    expect(copy.id).not.toBe(original.id); expect(copy.actions![0].id).not.toBe('action');
    expect(copy.localVariables![0].id).toBe('local_a'); expect(copy.folderId).toBeNull();
    expect(copy).not.toHaveProperty('linkedStatusSourceEntryId');
    const action = copy.actions![0] as any;
    expect(action.battleSettings.landed[0].effectId).toBe(action.effects[0].id);
    expect(action.battleSettings.landed[0].formula).toBe('@@local_a');
    expect(original.folderId).toBe('folder');
  });
});

describe('Firestore entry transactions', () => {
  it('adds only an atomic array union and timestamp', async () => {
    const added = item('new'); const next = await saveHomebrewEntry('char-1', 'owner', 'inventory', added);
    expect(db.update).toHaveBeenCalledWith(['characters', 'char-1'], { inventory: { union: added }, updatedAt: expect.any(Number) });
    expect(next.inventory).toHaveLength(2);
  });
  it('merges edits with latest collection, not the stale page snapshot', async () => {
    db.current.inventory = [item(), { ...item('other'), quantity: 99 }];
    await saveHomebrewEntry('char-1', 'owner', 'inventory', { ...item(), name: 'Edit' }, item());
    const patch = db.update.mock.calls[0][1]; expect(Object.keys(patch).sort()).toEqual(['inventory', 'updatedAt']);
    expect(patch.inventory[1].quantity).toBe(99);
  });
  it('does not write or update local cache when a conflict or network failure occurs', async () => {
    localStorage.setItem(storageKey, '[]'); db.current.inventory = [{ ...item(), quantity: 5 }];
    await expect(saveHomebrewEntry('char-1', 'owner', 'inventory', { ...item(), name: 'Edit' }, item())).rejects.toThrow('changed while');
    expect(db.update).not.toHaveBeenCalled(); expect(localStorage.getItem(storageKey)).toBe('[]');
    db.fail = true;
    await expect(saveHomebrewEntry('char-1', 'owner', 'inventory', item('new'))).rejects.toThrow('Network');
    expect(localStorage.getItem(storageKey)).toBe('[]');
  });
  it('reads latest local data for guest saves', async () => {
    localStorage.setItem(storageKey, JSON.stringify([{ ...character(), userId: 'guest', name: 'Latest' }]));
    const next = await saveHomebrewEntry('char-1', null, 'inventory', item('new'));
    expect(next.name).toBe('Latest'); expect(next.inventory).toHaveLength(2); expect(db.update).not.toHaveBeenCalled();
  });
  it('party copy touches only its collection, preserves other entries and rechecks membership', async () => {
    const party = { id: 'party', characterIds: ['char-1'], generalItems: [item('existing')], updatedAt: 1 } as unknown as PartyData;
    db.current = party as unknown as Record<string, unknown>;
    const next = await addEntryToPartyInventory(party, 'item', item(), 'char-1');
    expect(next.generalItems).toHaveLength(2); expect(next.generalItems![1].id).not.toBe('item-1');
    expect(Object.keys(db.update.mock.calls[0][1]).sort()).toEqual(['generalItems', 'updatedAt']);
    db.current.characterIds = []; db.update.mockClear();
    await expect(addEntryToPartyInventory(party, 'item', item(), 'char-1')).rejects.toThrow('no longer in');
    expect(db.update).not.toHaveBeenCalled();
  });
});
