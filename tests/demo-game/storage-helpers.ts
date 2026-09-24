import type { Page } from '@playwright/test';
import type { GameSession } from '../../src/lib/demoGame/types';

declare global {
  interface Window {
    readDemoSession(key: string): Promise<GameSession>;
    writeDemoSession(key: string, session: GameSession): Promise<void>;
    readDemoRaw(key: string): Promise<string | undefined>;
    writeDemoRaw(key: string, raw: string | undefined): Promise<void>;
  }
}

export async function installStorageHelpers(page: Page) {
  await page.addInitScript(() => {
    const record = <T>(key: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
      const open = indexedDB.open('inoraxium-demo-game', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('sessions');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sessions', mode);
        const request = operation(tx.objectStore('sessions'));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    window.readDemoRaw = key => record(key, 'readonly', store => store.get(key));
    window.readDemoSession = async key => JSON.parse((await window.readDemoRaw(key))!);
    window.writeDemoRaw = async (key, raw) => { await record(key, 'readwrite', store => raw === undefined ? store.delete(key) : store.put(raw, key)); };
    window.writeDemoSession = (key, session) => window.writeDemoRaw(key, JSON.stringify(session));
  });
}
