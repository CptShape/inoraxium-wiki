import { test, expect, type Page } from '@playwright/test';
import { installStorageHelpers } from './storage-helpers';

const key = 'inoraxium-demo-game-v1:guest';
test.beforeEach(async ({ page }) => {
  await installStorageHelpers(page);
  page.on('pageerror', error => { throw error; });
  await page.goto('#tools/demo-game');
  await expect(page.locator('.dg-map')).toBeVisible();
});

async function spriteRoute(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#ff4060', '#40ff80', '#4070ff', '#ffff40'][i];
      ctx.fillRect(i * 128 + 30, 20, 68, 108);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(i * 128 + 42, 35, 12, 12);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://i.imgur.com/qa-sprite.png', route => route.fulfill({ contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(png, 'base64') }));
}

test('multiple targets, follow-up editor and teleport controls work together', async ({ page }) => {
  await page.evaluate(async k => {
    const session = await window.readDemoSession(k);
    const [actor, a, b] = session.world.actors;
    a.position = { x: 4, y: 4 }; b.position = { x: 4, y: 5 };
    const action = actor.character.spells![0].actions![0];
    const url = '/inoraxium-wiki/src/lib/battleSettings.ts';
    const { defaultBattleSettings, newBattleOperation } = await import(url);
    action.name = 'Selected teleport';
    action.battleSettings = { ...defaultBattleSettings(), target: 'multiple', maxTargets: '1', amountFormula: '0', costs: [], landed: [{ ...newBattleOperation('teleport'), formula: '3' }] };
    await window.writeDemoSession(k, session);
  }, key);
  await page.reload();
  await page.getByRole('button', { name: 'Selected teleport Mend No cost', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Arcanist', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: 'Sentinel', exact: true })).toBeDisabled();
  await dialog.getByRole('spinbutton', { name: 'Tile X', exact: true }).fill('4');
  await dialog.getByRole('spinbutton', { name: 'Tile Y', exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).world.actors[1].position, key)).toEqual({ x: 4, y: 3 });
  await page.getByRole('button', { name: 'Configure Selected teleport', exact: true }).click();
  await page.getByRole('button', { name: 'Add check', exact: true }).click();
  await page.getByLabel('Check name', { exact: true }).fill('Second save');
  await page.getByRole('button', { name: 'Duplicate step', exact: true }).first().click();
  await expect(page.getByRole('combobox', { name: 'Operation', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Move step up', exact: true }).last().click();
  await page.getByRole('button', { name: 'Remove outcome step', exact: true }).last().click();
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const editor = page.locator('.bs-editor');
    const sizes = await editor.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
    await dialog.screenshot({ path: `.artifacts/demo-game/advanced-settings-${width}.png` });
  }
  await page.getByRole('button', { name: 'Save battle settings', exact: true }).click();
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).world.actors[0].character.spells![0].actions![0].battleSettings!.checks![0].name, key)).toBe('Second save');
});

test('sprite editor validates sheets, saves to character, reloads and imports into battle', async ({ page }) => {
  test.setTimeout(90000);
  await spriteRoute(page);
  await page.evaluate(async k => {
    const session = await window.readDemoSession(k);
    const character = session.world.actors[0].character;
    character.userId = 'sprite-qa'; character.name = 'Sprite QA'; character.sendToSpreadsheet = false;
    localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify([character]));
    const url = '/inoraxium-wiki/src/lib/auth.ts';
    const { authProvider } = await import(url);
    authProvider.onAuthChange = (setter: (state: unknown) => void) => { setter({ uid: 'sprite-qa', displayName: 'QA', email: null }); return () => {}; };
  }, key);
  page.on('dialog', dialog => void dialog.dismiss());
  await page.goto('#tools/characters');
  await page.getByRole('button', { name: /Load Character Sheet/ }).click();
  await page.getByRole('button', { name: 'Sprites', exact: true }).click();
  const editor = page.locator('.character-sprites');
  await editor.getByLabel('Sprite sheet URL / Pixhost BBCode', { exact: true }).fill('https://i.imgur.com/qa-sprite.png');
  await editor.getByRole('spinbutton', { name: 'Frame width (px)', exact: true }).fill('64');
  await editor.getByRole('button', { name: 'Apply animation', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('expected 256 x 128');
  await editor.getByRole('spinbutton', { name: 'Frame width (px)', exact: true }).fill('128');
  await editor.getByRole('button', { name: 'Apply animation', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Animation applied');
  await expect(editor.locator('.dg-sprite')).toHaveAttribute('data-sprite', 'custom');
  const first = await editor.locator('.dg-sprite').getAttribute('data-frame');
  await expect.poll(() => editor.locator('.dg-sprite').getAttribute('data-frame')).not.toBe(first);
  for (const width of [1920, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await editor.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.width + 1);
    expect(sizes.left).toBeGreaterThanOrEqual(0);
    expect(sizes.right).toBeLessThanOrEqual(width);
    await editor.screenshot({ path: `.artifacts/demo-game/sprites-${width}.png` });
  }
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
  const preview = await editor.locator('.cs-preview').screenshot({ path: '.artifacts/demo-game/custom-sprite-preview.png' });
  const coloredPixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let colored = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i + 1], data[i + 2]) > 200 && Math.min(data[i], data[i + 1], data[i + 2]) < 150) colored++;
    return colored;
  }, preview.toString('base64'));
  expect(coloredPixels).toBeGreaterThan(500);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(editor).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0]);
  expect(saved.sprites.clips.idle.url).toBe('https://i.imgur.com/qa-sprite.png');
  await page.evaluate(async ({ k, saved }) => {
    const session = await window.readDemoSession(k);
    const url = '/inoraxium-wiki/src/lib/demoGame/adapter.ts';
    const { adaptCharacter } = await import(url);
    session.world.actors[0] = adaptCharacter(saved, { x: 3, y: 4 });
    await window.writeDemoSession(k, session);
  }, { k: key, saved });
  await page.reload();
  await page.goto('#tools/demo-game');
  await expect(page.getByRole('button', { name: 'Select Sprite QA', exact: true }).locator('.dg-sprite')).toHaveAttribute('data-sprite', 'custom');
});

test('cast and hit visuals are transient, do not replay on reload, and missing sheets fall back', async ({ page }) => {
  await spriteRoute(page);
  await page.evaluate(async k => {
    const session = await window.readDemoSession(k);
    const [actor, target] = session.world.actors;
    target.position = { x: 4, y: 4 };
    const url = '/inoraxium-wiki/src/lib/battleSettings.ts';
    const { defaultBattleSettings, newBattleOperation } = await import(url);
    const action = actor.character.spells![0].actions![0];
    action.name = 'Visual hit';
    action.battleSettings = { ...defaultBattleSettings(), animation: 'cast', costs: [], amountFormula: '1', landed: [newBattleOperation()] };
    actor.character.sprites = { version: 1, preset: 'mage', clips: { idle: { url: 'https://i.imgur.com/missing-sheet.png', frameWidth: 128, frameHeight: 128, columns: 4, frames: 4, fps: 12, anchorX: .5, anchorY: 1, displayHeight: 84 } } };
    await window.writeDemoSession(k, session);
  }, key);
  await page.route('https://i.imgur.com/missing-sheet.png', route => route.abort());
  await page.reload();
  const caster = page.getByRole('button', { name: 'Select Warden', exact: true }).locator('.dg-sprite');
  await expect(caster).not.toHaveAttribute('data-sprite', 'custom');
  await page.getByRole('button', { name: 'Visual hit Mend No cost', exact: true }).click();
  await page.getByRole('button', { name: 'Select Arcanist', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(caster).toHaveAttribute('data-animation', 'cast');
  await expect(page.getByRole('button', { name: 'Select Arcanist', exact: true }).locator('.dg-sprite')).toHaveAttribute('data-animation', 'hit');
  await expect(caster).toHaveAttribute('data-animation', 'idle');
  await page.reload();
  await expect(caster).toHaveAttribute('data-animation', 'idle');
  expect(await page.evaluate(async k => (await window.readDemoSession(k)).revision, key)).toBe(1);
});

test('external character reload discards sprite drafts without resetting applied edits', async ({ page }) => {
  await spriteRoute(page);
  await page.evaluate(async () => {
    const url = '/inoraxium-wiki/tests/demo-game/sprite-editor-harness.tsx';
    (await import(url)).mountSpriteEditor();
  });
  const editor = page.locator('.character-sprites');
  await editor.getByLabel('FPS', { exact: true }).fill('6');
  await editor.getByRole('button', { name: 'Apply animation', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Animation applied');
  await expect(editor.getByLabel('FPS', { exact: true })).toHaveValue('6');
  await editor.getByLabel('FPS', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Reload profile', exact: true }).click();
  await expect(editor.getByLabel('Sprite sheet URL / Pixhost BBCode', { exact: true })).toHaveValue('');
  await expect(editor.getByLabel('FPS', { exact: true })).toHaveValue('12');
  await expect(editor.locator('.dg-sprite')).toHaveAttribute('data-sprite', 'monster');
});

test('custom sheet downed pose holds the last frame and reduced motion stays still', async ({ page }) => {
  await spriteRoute(page);
  await page.evaluate(async k => {
    const session = await window.readDemoSession(k);
    session.world.actors[0].state = 'downed';
    session.world.actors[0].character.sprites = { version: 1, preset: 'knight', clips: { downed: { url: 'https://i.imgur.com/qa-sprite.png', frameWidth: 128, frameHeight: 128, columns: 4, frames: 4, fps: 12, anchorX: .5, anchorY: 1, displayHeight: 84 } } };
    await window.writeDemoSession(k, session);
  }, key);
  await page.reload();
  const token = page.getByRole('button', { name: 'Select Warden', exact: true }).locator('.dg-sprite');
  await expect(token).toHaveAttribute('data-sprite', 'custom');
  await expect(token).toHaveAttribute('data-frame', '3');
  await page.waitForTimeout(450);
  await expect(token).toHaveAttribute('data-frame', '3');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(token).toHaveAttribute('data-sprite', 'custom');
  await expect(token).toHaveAttribute('data-frame', '0');
});
