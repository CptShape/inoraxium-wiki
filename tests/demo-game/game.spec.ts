import { test, expect, type Page } from '@playwright/test';

import { installStorageHelpers } from './storage-helpers';

const key = 'inoraxium-demo-game-v1:guest';
test.beforeEach(async ({ page }) => {
  await installStorageHelpers(page);
  page.on('pageerror', error => { throw error; });
});
async function openGame(page: Page) {
  await page.goto('#tools/demo-game');
  await expect(page.getByRole('heading', { name: 'Demo Game', exact: true }).last()).toBeVisible();
  await expect(page.locator('.dg-map')).toBeVisible();
}
async function clickTile(page: Page, x: number, y: number) {
  await page.locator(`.dg-tile[data-x="${x}"][data-y="${y}"]`).click();
}

test('battle, movement, local inputs, DC, undo, refresh and player restrictions', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await openGame(page);
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await clickTile(page, 4, 4);
  await page.locator('.dg-contextbar').getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.locator('.dg-resources button').nth(1)).toContainText('5');
  await page.getByRole('button', { name: 'Undo latest command' }).click();
  await expect(page.locator('.dg-resources button').nth(1)).toContainText('6');
  await page.getByRole('button', { name: 'Mend Mend' }).click();
  await page.getByRole('button', { name: 'Select Warden', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('spinbutton', { name: /Healing amount/ }).fill('4');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.dg-resources button').nth(2)).toContainText('1');
  await page.getByLabel('Roll formula').fill('DC(20, 20)');
  await page.locator('.dg-quick-roll').getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.locator('.dg-toast')).toContainText('Success');
  await page.locator('.dg-toast').getByRole('button', { name: 'Dismiss result' }).click();
  await expect(page.locator('.dg-toast')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.dg-resources button').nth(2)).toContainText('1');
  await page.getByLabel('View mode').selectOption('player');
  await expect(page.getByRole('button', { name: 'Encounter settings' })).toBeDisabled();
  await page.getByRole('button', { name: 'Select Sentinel', exact: true }).click();
  await expect(page.locator('.dg-quick-roll').getByRole('button', { name: 'Roll', exact: true })).toBeDisabled();
  expect(failures).toEqual([]);
});

test('reaction survives reload and roleplay movement uses normalized coordinates', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Select Sentinel', exact: true }).click();
  await page.getByRole('button', { name: 'Teleport', exact: true }).click();
  await clickTile(page, 4, 4);
  await page.getByRole('button', { name: 'Select Warden', exact: true }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await clickTile(page, 2, 4);
  await page.locator('.dg-contextbar').getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.locator('.dg-contextbar')).toContainText('Reaction available');
  await page.reload();
  await expect(page.locator('.dg-contextbar')).toContainText('Reaction available');
  await page.getByRole('button', { name: 'Ignore', exact: true }).click();
  await expect(page.locator('.dg-contextbar')).not.toContainText('Reaction available');
  await expect(page.locator('.dg-resources button').nth(1)).toContainText('5');
  await page.getByRole('button', { name: 'Roleplay', exact: true }).click();
  await page.locator('.dg-map').click({ position: { x: 150, y: 100 } });
  const position = await page.evaluate(async k => (await window.readDemoSession(k)).world.actors[0].roleplayPosition, key);
  expect(position.x).toBeGreaterThan(0);
  expect(position.x).toBeLessThan(1);
  expect(position.y).toBeGreaterThan(0);
  expect(position.y).toBeLessThan(1);
});

test('roll toast expires after ten seconds and two tabs preserve changes', async ({ page, context }) => {
  await openGame(page);
  await page.clock.install();
  await page.getByLabel('Roll formula').fill('DC(12, 12)');
  await page.locator('.dg-quick-roll').getByRole('button', { name: 'Roll', exact: true }).click();
  await expect(page.locator('.dg-toast')).toContainText('Success');
  await page.clock.fastForward(10001);
  await expect(page.locator('.dg-toast')).not.toBeVisible();
  const second = await context.newPage();
  await openGame(second);
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await expect(second.getByRole('button', { name: 'End turn', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'End turn', exact: true }).click();
  await expect(page.locator('.dg-turnbar')).toContainText('Arcanist');
});

test('imports an existing sheet snapshot and uses its actual attribute modifier', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify([{
    id: 'test-sheet', userId: 'guest', name: 'Snapshot Mage', race: 'Elf', className: 'Mage',
    mainAttributes: [{ id: 'int', name: 'Intelligence', value: '12' }],
    bars: [{ id: 'bar_hp', name: 'HP', currentValue: '40', maxValue: '40' }],
    diceMacros: [{ id: 'damage', name: 'Intelligence damage', formula: '70 * (@int_mod + 1)' }],
  }])));
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await page.getByRole('button', { name: 'Snapshot Mage Mage' }).click();
  await expect(page.getByRole('dialog')).toContainText('Combatant settings');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Snapshot Mage', exact: true })).toHaveCount(0);
  await clickTile(page, 4, 2);
  await expect(page.getByRole('button', { name: 'Select Snapshot Mage', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Intelligence damage Character/ }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('.dg-toast')).toContainText('140');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0]);
  expect(original.bars[0].currentValue).toBe('40');
  expect(original.mainAttributes[0].value).toBe('12');
});

test('isometric sprites animate, persist their preset and move without replaying AP', async ({ page }) => {
  await openGame(page);
  const token = page.getByRole('button', { name: 'Select Warden', exact: true });
  await expect(token.locator('.dg-sprite')).toHaveAttribute('data-sprite', 'knight');
  await page.getByRole('button', { name: 'Combatant settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Mage', exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(token.locator('.dg-sprite')).toHaveAttribute('data-sprite', 'mage');
  await page.reload();
  await expect(token.locator('.dg-sprite')).toHaveAttribute('data-sprite', 'mage');
  const first = await token.locator('.dg-sprite-frame').evaluateAll(frames => frames.findIndex(f => getComputedStyle(f).opacity === '1'));
  await expect.poll(() => token.locator('.dg-sprite-frame').evaluateAll(frames => frames.findIndex(f => getComputedStyle(f).opacity === '1'))).not.toBe(first);
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  const destination = page.locator('.dg-tile[data-x="5"][data-y="5"]');
  const bounds = (await destination.boundingBox())!;
  // The wall at (6,5) correctly covers the right side of this floor tile.
  await destination.click({ position: { x: bounds.width * .25, y: bounds.height * .5 } });
  await page.locator('.dg-contextbar').getByRole('button', { name: 'Move', exact: true }).click();
  await expect(token.locator('.dg-sprite')).toHaveAttribute('data-animation', 'run');
  expect(await token.evaluate(element => [...document.querySelectorAll('.dg-iso-cell:not(.is-wall)')].every(floor => Boolean(floor.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)))).toBe(true);
  const initial = await token.getAttribute('data-position');
  await expect.poll(() => token.getAttribute('data-position')).not.toBe(initial);
  await expect(token.locator('.dg-sprite')).toHaveAttribute('data-animation', 'idle');
  await expect(page.locator('.dg-resources button').nth(1)).toContainText('3');
  await page.reload();
  await expect(token.locator('.dg-sprite')).toHaveAttribute('data-animation', 'idle');
  await expect(page.locator('.dg-resources button').nth(1)).toContainText('3');
});

test('rotating the view preserves tile picking, elevation and player visibility', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Raise elevation', exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await clickTile(page, 8, 4);
    await page.getByRole('button', { name: 'Rotate view right', exact: true }).click();
  }
  const tile = await page.evaluate(async k => (await window.readDemoSession(k)).world.scenes[0].tiles['8,4'], key);
  expect(tile.elevation).toBe(4);
  await page.getByRole('button', { name: 'Lower foreground walls' }).click();
  await expect(page.getByRole('button', { name: 'Lower foreground walls' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Hide tile', exact: true }).click();
  await clickTile(page, 13, 5);
  await page.getByLabel('View mode').selectOption('player');
  await expect(page.getByRole('button', { name: 'Raise elevation' })).toHaveCount(0);
});

test('creates rectangular scenes, copies terrain and keeps original placements', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Add scene', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('New arena');
  await page.getByRole('spinbutton', { name: /columns/i }).fill('8');
  await page.getByRole('spinbutton', { name: /rows/i }).fill('6');
  await page.getByRole('button', { name: 'Create scene', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.dg-tile')).toHaveCount(48);
  await page.getByRole('button', { name: 'Rotate view right' }).click();
  await page.getByRole('button', { name: 'Wall', exact: true }).click();
  await clickTile(page, 5, 3);
  await page.getByRole('button', { name: 'Add scene', exact: true }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Copied arena');
  await page.getByLabel('Layout', { exact: true }).selectOption('copy');
  await page.getByRole('button', { name: 'Create scene', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const copied = await page.evaluate(async k => (await window.readDemoSession(k)).world.scenes.at(-1), key);
  expect(copied.width).toBe(8);
  expect(copied.tiles['5,3'].terrain).toBe('wall');
  await page.getByRole('combobox', { name: 'Scene', exact: true }).selectOption('courtyard');
  await expect(page.locator('.dg-tile')).toHaveCount(216);
  const positions = await page.evaluate(async k => (await window.readDemoSession(k)).world.actors.map((a: { position: unknown }) => a.position), key);
  expect(positions).toEqual([{ x: 3, y: 4 }, { x: 3, y: 7 }, { x: 13, y: 4 }]);
});

test('pans without editing and expands a sparse map without shifting actors', async ({ page }) => {
  await openGame(page);
  const map = page.locator('.dg-iso-map');
  const initial = await map.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Pan camera', exact: true }).click();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect(map).not.toHaveAttribute('viewBox', initial!);
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).revision, key)).toBe(0);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(map).toHaveAttribute('viewBox', initial!);
  await page.getByRole('button', { name: 'Expand grid', exact: true }).click();
  await page.getByLabel('Extra tiles: left').fill('4');
  await page.getByLabel('Extra tiles: right').fill('40');
  await page.getByRole('dialog').getByRole('button', { name: 'Expand grid', exact: true }).click();
  const world = await page.evaluate(async k => (await window.readDemoSession(k)).world, key);
  expect(world.scenes[0]).toMatchObject({ width: 62, minX: -4, sparse: true });
  expect(world.actors[0].position).toEqual({ x: 3, y: 4 });
  await expect(page.locator('.dg-tile')).toHaveCount(216);
  await page.reload();
  await expect(page.locator('.dg-tile')).toHaveCount(216);
});

test('configured area action previews targets, prompts once and resolves each target save', async ({ page }) => {
  test.setTimeout(75000);
  await openGame(page);
  await page.evaluate(async k => {
    const session = (await window.readDemoSession(k));
    const [actor, first, second] = session.world.actors;
    first.position = { x: 4, y: 4 }; second.position = { x: 4, y: 5 };
    first.character.mainAttributes.push({ id: 'wis', name: 'Wisdom', value: '12' });
    second.character.mainAttributes.push({ id: 'wis', name: 'Wisdom', value: '32' });
    const action = actor.character.spells[0].actions[0];
    action.name = 'Saving blast';
    const step = { id: 'damage', kind: 'damage', recipient: 'target', formula: '@roll.amount', barId: '', effectId: '', canOverflow: false };
    action.battleSettings = { version: 1, enabled: true, target: 'point', faction: 'all', includeSelf: false, range: '6', requiresLOS: true, shape: 'burst', radius: 1, length: 6, width: 1, angle: 90, cells: [{ x: 0, y: 0 }], cost: 1, costResource: 'combat', check: 'save', actorFormula: '12', targetFormula: '2d1kh1 + @wis_mod', actorRoll: 'once', ties: 'target', amountFormula: '@@healing', landed: [step], resisted: [{ ...step, id: 'half', formula: 'rounddown(@roll.amount / 2)' }] };
    await window.writeDemoSession(k, session);
  }, key);
  await page.reload();
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await page.getByRole('button', { name: /Saving blast Mend/ }).click();
  await page.getByRole('button', { name: 'Select Arcanist', exact: true }).hover();
  await expect(page.locator('.dg-area-tile').first()).toBeVisible();
  await page.getByRole('button', { name: 'Select Arcanist', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Affected characters (2)');
  await page.getByRole('spinbutton', { name: /Healing amount/ }).fill('20');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const actors = await page.evaluate(async k => (await window.readDemoSession(k)).world.actors, key);
  expect(actors[1].character.bars[0].currentValue).toBe('4');
  expect(actors[2].character.bars[0].currentValue).toBe('18');
  expect(actors[0].character.spells[0].usageRemaining).toBe('2');
  expect(actors[0].character.bars[2].currentValue).toBe('1');
  await page.getByRole('button', { name: 'Configure Saving blast', exact: true }).click();
  await page.getByRole('button', { name: 'Add cost', exact: true }).click();
  await page.getByRole('combobox', { name: 'Resource', exact: true }).last().selectOption('movement');
  await page.getByRole('textbox', { name: 'Cost formula', exact: true }).last().fill('@action.target.affected');
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const panel = page.locator('.bs-editor');
    const metrics = await panel.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
    await page.getByRole('dialog').screenshot({ path: `.artifacts/demo-game/battle-settings-${width}.png` });
  }
  await page.getByLabel('Difficulty formula').fill('15 + @str_mod');
  await page.getByRole('button', { name: 'Save battle settings', exact: true }).click();
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).world.actors[0].character.spells[0].actions[0].battleSettings.actorFormula, key)).toBe('15 + @str_mod');
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).world.actors[0].character.spells[0].actions[0].battleSettings.costs[1], key)).toMatchObject({ resource: 'movement', formula: '@action.target.affected' });
});

test('removing a token keeps its roster entry and supports re-placement or full removal', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Start battle', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Warden token', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Warden', exact: true })).toHaveCount(0);
  const roster = page.locator('.dg-roster-item').filter({ hasText: 'Warden' });
  await expect(roster).toContainText('Not placed');
  await expect(page.locator('.dg-turnbar')).toContainText('Arcanist');
  await roster.click();
  await page.locator('.dg-tile[data-x="4"][data-y="5"]').hover();
  await expect(page.locator('.dg-placement-preview')).toHaveAttribute('data-valid', 'true');
  await clickTile(page, 4, 5);
  await expect(page.getByRole('button', { name: 'Select Warden', exact: true })).toBeVisible();
  await expect(roster).not.toContainText('Not placed');
  await page.getByRole('button', { name: 'Remove Warden from encounter', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove from encounter', exact: true }).click();
  await expect(roster).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select Warden', exact: true })).toHaveCount(0);
});

test('floor painting previews an empty grid cell and paints exactly that footprint', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: 'Floor', exact: true }).click();
  const point = await page.locator('.dg-empty-plane').evaluate(el => {
    const svg = el.ownerSVGElement!;
    const matrix = svg.getScreenCTM()!;
    // Courtyard origin (624,106); (-3,4) is outside the wall's projected top.
    const p = new DOMPoint(288,130).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.dg-placement-preview')).toHaveAttribute('data-x', '-3');
  await expect(page.locator('.dg-placement-preview')).toHaveAttribute('data-y', '4');
  await page.screenshot({ path: '.artifacts/demo-game/floor-preview.png' });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.dg-tile[data-x="-3"][data-y="4"]')).toBeVisible();
  const scene = await page.evaluate(async k => (await window.readDemoSession(k)).world.scenes[0], key);
  expect(scene.tiles['-3,4'].terrain).toBe('floor');
  expect(scene.minX).toBe(-3);
});

test('asset creator imports a clipboard status directly into an outcome and exports its link', async ({ page }) => {
  await page.goto('#tools/asset-creator');
  await page.getByRole('button', { name: 'Add Action', exact: true }).click();
  const editor = page.locator('.bs-editor');
  await editor.locator('summary').click();
  await editor.getByRole('checkbox', { name: 'Use battle settings' }).check();
  await editor.getByTitle('Add on application step', { exact: true }).click();
  await editor.getByRole('combobox', { name: 'Operation', exact: true }).selectOption('effect');
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'readText', { configurable: true, value: async () => JSON.stringify({ schema: 'inoraxium-character-entry', version: 1, kind: 'status', entry: { name: 'Clipboard Stun', duration: '2', effects: [{ targetId: 'str_mod', value: '-2' }] } }) }));
  await editor.getByRole('button', { name: 'Import Status', exact: true }).click();
  await page.getByRole('button', { name: 'Import from Clipboard', exact: true }).click();
  await expect(editor.getByRole('combobox', { name: 'Action effect', exact: true })).toContainText('Clipboard Stun');
  const effectId = await editor.getByRole('combobox', { name: 'Action effect', exact: true }).inputValue();
  expect(effectId.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Create JSON', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create JSON', exact: true }).last().click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  expect(payload.entry.actions[0].effects[0].statusEntry.name).toBe('Clipboard Stun');
  expect(payload.entry.actions[0].battleSettings.landed[0].effectId).toBe(effectId);
});

test('elevated terrain and walls share depth order while only foreground high surfaces mask sprites', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGame(page);
  await page.evaluate(async k => {
    const s = (await window.readDemoSession(k));
    const tiles = s.world.scenes[0].tiles;
    tiles['4,4'] = { terrain: 'floor', elevation: 3, hidden: false };
    tiles['4,5'] = { terrain: 'floor', elevation: 3, hidden: false };
    tiles['3,4'] = { terrain: 'wall', elevation: 0, hidden: false };
    tiles['5,4'] = { terrain: 'wall', elevation: 0, hidden: false };
    s.world.actors[0].position = { x: 4, y: 4 };
    s.world.actors[1].position = { x: 4, y: 3 };
    await window.writeDemoSession(k, s);
  }, key);
  await page.reload();
  await page.getByRole('button', { name: 'Lower foreground walls', exact: true }).click();
  const high = page.getByRole('button', { name: 'Select Warden', exact: true });
  const low = page.getByRole('button', { name: 'Select Arcanist', exact: true });
  const maskFor = async (token: ReturnType<Page['locator']>) => {
    const ref = await token.locator('..').getAttribute('mask');
    return page.locator(`mask[id="${ref!.slice(5, -1)}"]`);
  };
  await expect((await maskFor(high)).locator('[data-occluder="5,4"]')).toHaveCount(0);
  await expect((await maskFor(low)).locator('[data-occluder="4,4"]')).toHaveCount(1);
  for (let rotation = 0; rotation < 4; rotation++) {
    const depths = await page.locator('.dg-iso-cell').evaluateAll(cells => cells.map(c => Number(c.getAttribute('data-depth'))));
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    await page.locator('.dg-isometric').screenshot({ path: `.artifacts/demo-game/elevation-${rotation}.png` });
    await page.getByRole('button', { name: 'Rotate view right', exact: true }).click();
  }
});

test('character sheet exposes Battle Settings on spell, equipment, general item and status actions', async ({ page }) => {
  await openGame(page);
  await page.evaluate(async k => {
    const c = (await window.readDemoSession(k)).world.actors[0].character;
    c.userId = 'guest'; c.name = 'Battle Settings QA';
    const action = c.spells[0].actions[0];
    c.spells[0].folderId = null;
    c.inventoryFolders = [{ id: 'equipment', name: 'Equipment', parentId: null }];
    c.inventory[0].folderId = 'equipment'; c.inventory[0].actions = [{ ...action, id: 'equipment-action' }];
    c.generalItems = [{ ...c.inventory[0], id: 'general', folderId: null, name: 'General Tool', actions: [{ ...action, id: 'general-action' }] }];
    c.statuses = [{ id: 'status', name: 'QA Status', description: '', active: true, folderId: null, duration: '2', effects: [], actions: [{ ...action, id: 'status-action' }] }];
    localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify([c]));
  }, key);
  await page.goto('#tools/characters');
  await page.getByRole('button', { name: /Load Character Sheet/ }).click();
  await page.getByRole('button', { name: 'Spells', exact: true }).click();
  await expect(page.locator('.bs-editor')).toHaveCount(1);
  await page.locator('.bs-editor summary').click();
  await expect(page.locator('.bs-editor').getByRole('checkbox', { name: 'Use battle settings' })).toBeDisabled();
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await expect(page.locator('.bs-editor')).toHaveCount(1);
  await page.getByRole('button', { name: 'Equipment', exact: true }).click();
  await expect(page.locator('.bs-editor')).toHaveCount(1);
  await page.getByRole('button', { name: 'Statuses', exact: true }).click();
  await expect(page.locator('.bs-editor')).toHaveCount(1);
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`layout and assets at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openGame(page);
    const app = page.locator('.demo-game');
    await app.scrollIntoViewIfNeeded();
    await expect(page.locator('.dg-roster img').first()).toBeVisible();
    const metrics = await app.evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, rect: element.getBoundingClientRect().toJSON() }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1);
    expect(metrics.rect.x).toBeGreaterThanOrEqual(0);
    expect(metrics.rect.right).toBeLessThanOrEqual(viewport.width);
    const imagesLoaded = await page.locator('.dg-roster img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0));
    expect(imagesLoaded).toBe(true);
    const spritePixels = await page.locator('.dg-sprite-frame').evaluateAll(async frames => {
      const urls = [...new Set(frames.map(frame => (frame as SVGImageElement).href.baseVal))];
      return Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
        return [...context.getImageData(0, 0, image.width, image.height).data].filter((value, index) => index % 4 === 3 && value > 0).length;
      }));
    });
    expect(spritePixels.length).toBe(12);
    expect(spritePixels.every(count => count > 50)).toBe(true);
    await app.screenshot({ path: `.artifacts/demo-game/${viewport.width}.png` });
    if (viewport.width < 600) {
      await page.getByLabel('Roll formula').scrollIntoViewIfNeeded();
      await expect(page.getByLabel('Roll formula')).toBeInViewport();
      await page.screenshot({ path: '.artifacts/demo-game/mobile-inspector.png' });
    }
  });
}
