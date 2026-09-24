import { applyCommand } from './engine';
import { createDemo } from './demo';
import { validateSnapshot } from './formula';
import type { CommandEnvelope, GameSession } from './types';

const prefix = 'inoraxium-demo-game-v1:';
const databaseName = 'inoraxium-demo-game';
const storeName = 'sessions';
const changeEvent = 'demo-game-saved';
export const sessionKey = (userId: string | null) => prefix + (userId || 'guest');

function storageError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error('Browser storage is full. The last saved encounter is unchanged. Export it before freeing disk space, then retry.');
  }
  return error instanceof Error ? error : new Error('Could not access encounter storage.');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Encounter storage is blocked by another tab. Close older tabs and retry.'));
    };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

function parseSession(raw: string): GameSession {
  const session = JSON.parse(raw) as GameSession;
  if (session?.version !== 1 || !Number.isInteger(session.revision) || !Array.isArray(session.world?.actors) || !Array.isArray(session.log)
    || !Array.isArray(session.processed) || !Array.isArray(session.undo) || !session.world.scenes?.some(s => s.id === session.world.sceneId)) throw new Error('Saved demo is invalid. Export a backup before resetting it.');
  session.world.actors.forEach(a => validateSnapshot(a.character));
  return session;
}

async function withRecord<T>(key: string, mode: IDBTransactionMode, operation: (raw: string | undefined, store: IDBObjectStore) => T): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(storageError(failure || transaction.error));
      const request = store.get(key);
      request.onsuccess = () => {
        try { result = operation(request.result, store); }
        catch (error) { failure = error; transaction.abort(); }
      };
    });
  } finally { db.close(); }
}

// Keep the reducer synchronous inside a single transaction: retrying could reroll.
async function updateSession(key: string, update: (raw: string | null) => GameSession, reset = false) {
  const migrated = new Map<string, string>();
  const session = await withRecord(key, 'readwrite', (saved, store) => {
    let raw = saved ?? null;
    if (saved === undefined) {
      raw = localStorage.getItem(key);
      if (raw !== null) migrated.set(key, raw);
      const backupKey = `${key}:backup`;
      const backup = localStorage.getItem(backupKey);
      if (backup !== null) { store.put(backup, backupKey); migrated.set(backupKey, backup); }
    }
    const next = update(raw);
    if (reset && raw !== null) store.put(raw, `${key}:backup`);
    const serialized = JSON.stringify(next);
    if (saved !== serialized) store.put(serialized, key);
    return next;
  });
  // Remove legacy copies only after the entire transaction has committed.
  for (const [legacyKey, raw] of migrated) {
    try { if (localStorage.getItem(legacyKey) === raw) localStorage.removeItem(legacyKey); }
    catch { /* IndexedDB is authoritative even if a legacy copy remains. */ }
  }
  return session;
}

export async function loadDemoSession(key: string): Promise<GameSession> {
  const saved = await withRecord(key, 'readonly', raw => raw === undefined ? null : parseSession(raw));
  return saved ?? updateSession(key, raw => raw === null ? createDemo() : parseSession(raw));
}

function openChannel() {
  try { return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(databaseName); }
  catch { return null; }
}

function notifySaved(key: string) {
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: key }));
  const channel = openChannel();
  try { channel?.postMessage(key); }
  catch { /* Notification failure must not report a committed command as failed. */ }
  finally { channel?.close(); }
}

export function subscribeDemoSession(key: string, listener: () => void) {
  const channel = openChannel();
  if (channel) channel.onmessage = event => { if (event.data === key) listener(); };
  const local = (event: Event) => { if ((event as CustomEvent).detail === key) listener(); };
  const visible = () => { if (document.visibilityState === 'visible') listener(); };
  const timer = channel ? undefined : window.setInterval(visible, 2000);
  window.addEventListener(changeEvent, local);
  window.addEventListener('focus', visible);
  document.addEventListener('visibilitychange', visible);
  return () => {
    channel?.close();
    window.clearInterval(timer);
    window.removeEventListener(changeEvent, local);
    window.removeEventListener('focus', visible);
    document.removeEventListener('visibilitychange', visible);
  };
}

export async function commitDemoCommand(key: string, envelope: CommandEnvelope) {
  const next = await updateSession(key, raw => applyCommand(raw === null ? createDemo() : parseSession(raw), envelope));
  notifySaved(key);
  return next;
}

export async function resetDemoSession(key: string) {
  const next = await updateSession(key, raw => {
    const fresh = createDemo();
    // Monotonic revisions also prevent in-flight reads from undoing a reset.
    try { const previous = raw && JSON.parse(raw); if (Number.isSafeInteger(previous?.revision)) fresh.revision = previous.revision + 1; }
    catch { /* Invalid saves can still be backed up and reset. */ }
    return fresh;
  }, true);
  notifySaved(key);
  return next;
}

export async function exportDemo(key: string) {
  let raw: string | null;
  try { raw = await withRecord(key, 'readonly', saved => saved ?? localStorage.getItem(key)); }
  catch (error) { raw = localStorage.getItem(key); if (raw === null) throw error; }
  if (raw === null) throw new Error('No saved encounter is available to export.');
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'demo-game-session.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
