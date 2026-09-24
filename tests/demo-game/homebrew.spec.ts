import { test, expect } from '@playwright/test';
import { installStorageHelpers } from './storage-helpers';

test.beforeEach(async ({ page }) => {
  await installStorageHelpers(page);
  // Real local persistence, isolated from the user's Firebase data and subscriptions.
  await page.route('**/src/lib/firestore.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from './firestore.ts?qaActual';
    export const subscribeCharacterById = (id, uid, cb) => {
      cb(JSON.parse(localStorage.getItem('battleTrackerLocalCharacters') || '[]').find(c => c.id === id) || null);
      return () => {};
    };
    export const loadPartiesForCharacterTransfer = async () => [{ campaign: { name: 'QA Campaign' }, party: { id: 'qa-party', name: 'QA Party', characterIds: ['hb-qa'] } }];
    export const addEntryToPartyInventory = async (...args) => { window.qaPartySend = args; return args[0]; };
  ` }));
  page.on('pageerror', error => { throw error; });
  await page.goto('#tools/demo-game');
  await expect(page.locator('.dg-map')).toBeVisible();
  await page.evaluate(async () => {
    const session = await window.readDemoSession('inoraxium-demo-game-v1:guest');
    const character = session.world.actors[0].character;
    character.id = 'hb-qa'; character.userId = 'guest'; character.sendToSpreadsheet = false;
    character.inventory = [{ id: 'qa-item', name: 'QA Sword', quantity: 2, equipped: false, effects: [], actions: [], localVariables: [], macros: [], rarity: 'common' }];
    localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify([character]));
  });
  await page.goto('#homebrew-library/inventory/hb-qa/inventory-item/qa-item');
  await expect(page.getByRole('button', { name: 'Edit object', exact: true })).toBeVisible();
});

test('Add and Edit persist only the selected entry, with responsive dialogs', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit object', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('QA Sword');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('QA Edited Sword');
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, right: el.getBoundingClientRect().right }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.right).toBeLessThanOrEqual(width);
    const content = await page.locator('.hb-dialog-content').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(content.scroll).toBeLessThanOrEqual(content.width + 1);
    await dialog.screenshot({ path: `.artifacts/demo-game/homebrew-edit-${width}.png` });
  }
  await page.evaluate(() => {
    const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!);
    chars[0].name = 'Concurrent name'; chars[0].inventory.push({ id: 'concurrent', name: 'Concurrent item', quantity: 10 });
    localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars));
  });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0]);
  expect(data.name).toBe('Concurrent name'); expect(data.inventory[1].quantity).toBe(10); expect(data.inventory[0].name).toBe('QA Edited Sword');
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const kind of ['Item', 'Spell', 'Status']) {
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await dialog.getByRole('button', { name: kind, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`QA New ${kind}`);
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('heading', { name: `QA New ${kind}`, exact: true, level: 2 })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await dialog.getByRole('button', { name: 'Attribute', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Attribute type', exact: true }).selectOption('resistances');
  await dialog.getByLabel('Name', { exact: true }).fill('QA Resistance');
  await dialog.getByLabel('ID', { exact: true }).fill('resistance_qa');
  await expect(dialog.getByLabel('Value / formula', { exact: true })).toHaveValue('0');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0].resistances.find((a: any) => a.id === 'resistance_qa').value)).toBe('0');
});

test('conflicts preserve draft; closing offers discard; party send requires a signed-in account', async ({ page }) => {
  await page.getByRole('button', { name: 'Send to Party', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Sign in');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Edit object', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Conflicting draft');
  await page.evaluate(() => {
    const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].inventory[0].quantity = 99;
    localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars));
  });
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed while');
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Conflicting draft');
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0].inventory[0].quantity)).toBe(99);
});

test('view-only characters cannot add, edit or send', async ({ page }) => {
  await page.evaluate(() => { const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].userId = 'someone-else'; chars[0].visibility = 'public'; localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars)); });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Edit object', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send to Party', exact: true })).toBeDisabled();
});

test('nested action, effect and local variable fields persist and reopen', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit object', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add Variable', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add Action', exact: true }).click();
  await dialog.getByPlaceholder('Action name', { exact: true }).fill('QA Action');
  await dialog.getByRole('button', { name: 'Bar Update', exact: true }).first().click();
  await dialog.getByRole('combobox', { name: 'Target bar', exact: true }).selectOption({ index: 1 });
  await dialog.getByPlaceholder('+100', { exact: true }).fill('-5');
  await dialog.getByRole('button', { name: 'Add Effect', exact: true }).last().click();
  await dialog.getByRole('combobox', { name: 'Effect target', exact: true }).selectOption({ index: 1 });
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.locator('.hb-dialog-content').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    await dialog.getByPlaceholder('Action name', { exact: true }).scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: `.artifacts/demo-game/homebrew-action-${width}.png` });
  }
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0].inventory[0]);
  expect(entry.actions[0].effects[0].value).toBe('-5'); expect(entry.effects[0].targetId).toBeTruthy(); expect(entry.localVariables).toHaveLength(1);
  await page.getByRole('button', { name: 'Edit object', exact: true }).click();
  await expect(dialog.getByPlaceholder('Action name', { exact: true })).toHaveValue('QA Action');
  await expect(dialog.getByPlaceholder('+100', { exact: true })).toHaveValue('-5');
});

test('party selector sends a copy request without changing the source character', async ({ page }) => {
  const before = await page.evaluate(async () => {
    const url = '/inoraxium-wiki/src/lib/auth.ts'; const { authProvider } = await import(url);
    authProvider.onAuthChange = (setter: (state: unknown) => void) => { setter({ uid: 'qa-owner', displayName: 'QA', email: null }); return () => {}; };
    return localStorage.getItem('battleTrackerLocalCharacters');
  });
  await page.goto('#homebrew-character-sheet/hb-qa/overview');
  await expect(page.getByRole('button', { name: 'Edit object', exact: true })).toHaveCount(0);
  await page.goto('#homebrew-library/inventory/hb-qa/inventory-item/qa-item');
  await page.getByRole('button', { name: 'Send to Party', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'QA Party QA Campaign', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const request = await page.evaluate(() => (window as any).qaPartySend);
  expect(request[0].id).toBe('qa-party'); expect(request[1]).toBe('item'); expect(request[2].id).toBe('qa-item'); expect(request[3]).toBe('hb-qa');
  expect(await page.evaluate(() => localStorage.getItem('battleTrackerLocalCharacters'))).toBe(before);
});

test('clipboard imports prefill each object type and persist only on Confirm', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  for (const kind of ['item', 'spell', 'status']) {
    const before = await page.evaluate(() => localStorage.getItem('battleTrackerLocalCharacters'));
    await page.evaluate(kind => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => JSON.stringify({ schema: 'inoraxium-character-entry', version: 1, kind, entry: {
        id: 'original-export-id', name: `Imported ${kind}`, description: 'Clipboard description', quantity: 7,
        magicSchool: 'Evocation', duration: '3', active: false, homebrewImageUrl: 'https://example.test/image.png',
        actions: [{ id: 'source-action', name: 'Imported action', macros: [{ id: 'source-macro', name: 'Test roll', formula: '70 * (@int_mod + 1)' }] }],
        localVariables: [{ id: 'local_a', kind: 'variable', value: '@level + 2', description: 'Imported local' }],
      } }) } });
    }, kind);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await dialog.getByRole('button', { name: 'Import from Clipboard', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(`Imported ${kind}`);
    await expect(dialog.getByPlaceholder('Action name', { exact: true })).toHaveValue('Imported action');
    if (kind === 'spell') await expect(dialog.getByLabel('Magic School', { exact: true })).toHaveValue('Evocation');
    if (kind === 'status') await expect(dialog.getByRole('checkbox', { name: 'Active', exact: true })).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('battleTrackerLocalCharacters'))).toBe(before);
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(`Edited imported ${kind}`);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const size = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
      if (kind === 'item') await dialog.screenshot({ path: `.artifacts/demo-game/homebrew-import-${width}.png` });
    }
    await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const entry = await page.evaluate(kind => {
      const character = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0];
      return character[kind === 'item' ? 'inventory' : kind === 'spell' ? 'spells' : 'statuses'].find((e: any) => e.name === `Edited imported ${kind}`);
    }, kind);
    expect(entry.id).not.toBe('original-export-id'); expect(entry.actions[0].id).not.toBe('source-action');
    expect(entry.localVariables[0].id).toBe('local_a'); expect(entry.localVariables[0].value).toBe('@level + 2');
    expect(entry.actions[0].macros[0].formula).toBe('70 * (@int_mod + 1)');
    await page.setViewportSize({ width: 1280, height: 900 });
  }
});

test('clipboard denial allows paste; invalid and cancelled imports preserve the form', async ({ page }) => {
  const before = await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => { throw new Error('Denied'); } } });
    return localStorage.getItem('battleTrackerLocalCharacters');
  });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Item', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Keep this draft');
  await dialog.getByRole('button', { name: 'Import from Clipboard', exact: true }).click();
  await dialog.getByLabel('Paste export JSON', { exact: true }).fill('invalid JSON');
  await dialog.getByRole('button', { name: 'Load JSON', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('valid JSON');
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Keep this draft');
  await dialog.getByLabel('Paste export JSON', { exact: true }).fill(JSON.stringify({ schema: 'inoraxium-character-entry', version: 1, kind: 'item', entry: { name: 'Replacement' } }));
  await dialog.getByRole('button', { name: 'Load JSON', exact: true }).click();
  await dialog.getByRole('button', { name: 'Keep current form', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Keep this draft');
  await dialog.getByRole('button', { name: 'Import from Clipboard', exact: true }).click();
  await dialog.getByRole('button', { name: 'Load JSON', exact: true }).click();
  await dialog.getByRole('button', { name: 'Replace form', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Replacement');
  expect(await page.evaluate(() => localStorage.getItem('battleTrackerLocalCharacters'))).toBe(before);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('battleTrackerLocalCharacters'))).toBe(before);
});
