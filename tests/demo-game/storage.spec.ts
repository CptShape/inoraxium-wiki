import { test, expect } from '@playwright/test';
import { installStorageHelpers } from './storage-helpers';

const key = 'inoraxium-demo-game-v1:guest';
const storeUrl = '/inoraxium-wiki/src/lib/demoGame/store.ts';
test.beforeEach(async ({ page }) => {
  await installStorageHelpers(page);
  page.on('pageerror', error => { throw error; });
  await page.goto('#tools/demo-game');
  await expect(page.locator('.dg-map')).toBeVisible();
});

test('migrates a legacy encounter and backup without changing other local data', async ({ page }) => {
  const legacy = await page.evaluate(async k => {
    const session = await window.readDemoSession(k);
    session.world.name = 'Legacy encounter'; session.revision = 12;
    const raw = JSON.stringify(session);
    localStorage.setItem(k, raw);
    localStorage.setItem(`${k}:backup`, '{"originalBackup":true}');
    localStorage.setItem('unrelated-character-data', 'keep');
    await window.writeDemoRaw(k, undefined);
    return raw;
  }, key);
  await page.reload();
  await expect(page.locator('.dg-map')).toBeVisible();
  expect(await page.evaluate(k => window.readDemoRaw(k), key)).toBe(legacy);
  expect(await page.evaluate(k => window.readDemoRaw(`${k}:backup`), key)).toBe('{"originalBackup":true}');
  expect(await page.evaluate(k => [localStorage.getItem(k), localStorage.getItem(`${k}:backup`), localStorage.getItem('unrelated-character-data')], key)).toEqual([null, null, 'keep']);
});

test('large encounter saves, reloads, undoes, exports and resets beyond localStorage quota', async ({ page }) => {
  test.setTimeout(90000);
  const size = await page.evaluate(async k => {
    const session = await window.readDemoSession(k);
    session.world.actors[0].character.description = 'large-snapshot-'.repeat(55000);
    session.undo = Array.from({ length: 8 }, () => ({ world: structuredClone(session.world), label: 'Previous action' }));
    const raw = JSON.stringify(session);
    let exceeded = false;
    try { localStorage.setItem(`${k}:quota-test`, raw); }
    catch (e) { exceeded = e instanceof DOMException && e.name === 'QuotaExceededError'; }
    localStorage.removeItem(`${k}:quota-test`);
    if (!exceeded) throw new Error('Fixture did not exceed localStorage quota');
    await window.writeDemoSession(k, session);
    return raw.length;
  }, key);
  expect(size).toBeGreaterThan(6_000_000);
  await page.reload();
  await page.getByLabel('Roll formula').fill('DC(20, 20)');
  await page.locator('.dg-quick-roll').getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.locator('.dg-toast')).toContainText('Success');
  await page.reload();
  await expect(page.locator('.dg-map')).toBeVisible();
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).revision, key)).toBe(1);
  await page.getByRole('button', { name: 'Undo latest command' }).click();
  await expect.poll(() => page.evaluate(async k => (await window.readDemoSession(k)).revision, key)).toBe(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export encounter JSON' }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(JSON.parse(Buffer.concat(chunks).toString()).revision).toBe(2);
  const beforeReset = await page.evaluate(k => window.readDemoRaw(k), key);
  await page.evaluate(async ({ k, url }) => { const store = await import(url); await store.resetDemoSession(k); }, { k: key, url: storeUrl });
  expect(await page.evaluate(k => window.readDemoRaw(`${k}:backup`), key)).toBe(beforeReset);
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).revision, key)).toBe(3);
  expect(await page.evaluate(k => localStorage.getItem(k), key)).toBeNull();
});

test('failed migration keeps legacy data and a failed reset rolls back its backup', async ({ page }) => {
  const result = await page.evaluate(async ({ k, url }) => {
    const store = await import(url);
    const legacyKey = `${k}:migration-test`;
    const raw = (await window.readDemoRaw(k))!;
    localStorage.setItem(legacyKey, raw);
    localStorage.setItem(`${legacyKey}:backup`, 'legacy backup');
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      if (args[1] === legacyKey) this.transaction.abort();
      return request;
    };
    let migrationFailed = false;
    try { await store.loadDemoSession(legacyKey); } catch { migrationFailed = true; }
    finally { IDBObjectStore.prototype.put = original; }
    const afterAbort = [localStorage.getItem(legacyKey), localStorage.getItem(`${legacyKey}:backup`), await window.readDemoRaw(legacyKey), await window.readDemoRaw(`${legacyKey}:backup`)];
    await store.loadDemoSession(legacyKey);
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args);
      if (args[1] === legacyKey) this.transaction.abort();
      return request;
    };
    let resetFailed = false;
    try { await store.resetDemoSession(legacyKey); } catch { resetFailed = true; }
    finally { IDBObjectStore.prototype.put = original; }
    return { migrationFailed, resetFailed, afterAbort, raw, saved: await window.readDemoRaw(legacyKey), backup: await window.readDemoRaw(`${legacyKey}:backup`) };
  }, { k: key, url: storeUrl });
  expect(result.migrationFailed).toBe(true);
  expect(result.afterAbort).toEqual([result.raw, 'legacy backup', undefined, undefined]);
  expect(result.resetFailed).toBe(true);
  expect(result.saved).toBe(result.raw);
  expect(result.backup).toBe('legacy backup');
});

test('a write quota failure is visible, leaves the saved state intact and can be retried', async ({ page }) => {
  const before = await page.evaluate(k => window.readDemoRaw(k), key);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('Injected quota failure', 'QuotaExceededError'); };
  });
  await page.locator('.dg-quick-roll').getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.locator('.demo-game')).toContainText('Browser storage is full');
  expect(await page.evaluate(k => window.readDemoRaw(k), key)).toBe(before);
  await expect(page.locator('.dg-toast')).not.toBeVisible();
  await page.reload();
  await page.locator('.dg-quick-roll').getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.locator('.dg-toast')).toBeVisible();
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).revision, key)).toBe(1);
});

test('concurrent stale commands cannot overwrite each other and accounts stay separate', async ({ page }) => {
  const result = await page.evaluate(async ({ k, url }) => {
    const store = await import(url);
    const session = await store.loadDemoSession(k);
    const envelope = { baseRevision: session.revision, by: 'QA', role: 'dm', controlledIds: [], command: { type: 'mode', mode: 'roleplay' } };
    const outcomes = await Promise.allSettled([
      store.commitDemoCommand(k, { ...envelope, id: 'first' }),
      store.commitDemoCommand(k, { ...envelope, id: 'second' }),
    ]);
    const saved = await store.loadDemoSession(k);
    const duplicate = await store.commitDemoCommand(k, { ...envelope, id: saved.processed.at(-1) });
    const other = await store.loadDemoSession(`${k}:other-account`);
    return { outcomes: outcomes.map(o => o.status), revision: saved.revision, duplicateRevision: duplicate.revision, otherRevision: other.revision };
  }, { k: key, url: storeUrl });
  expect(result.outcomes.sort()).toEqual(['fulfilled', 'rejected']);
  expect(result.revision).toBe(1);
  expect(result.duplicateRevision).toBe(1);
  expect(result.otherRevision).toBe(0);
});

test('invalid legacy data can be exported and reset without being discarded', async ({ page }) => {
  await page.evaluate(async k => {
    await window.writeDemoRaw(k, undefined);
    localStorage.setItem(k, 'invalid legacy data');
  }, key);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export saved data', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export saved data', exact: true }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe('invalid legacy data');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset demo', exact: true }).click();
  await expect(page.locator('.dg-map')).toBeVisible();
  expect(await page.evaluate(k => window.readDemoRaw(`${k}:backup`), key)).toBe('invalid legacy data');
});

test('cross-tab refresh works without BroadcastChannel and without localStorage writes', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('inoraxium-demo-game')) throw new DOMException('localStorage is full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.reload();
  const second = await context.newPage();
  await second.goto('#tools/demo-game');
  await expect(second.locator('.dg-map')).toBeVisible();
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await expect(second.getByRole('button', { name: 'End turn', exact: true })).toBeVisible();
});
