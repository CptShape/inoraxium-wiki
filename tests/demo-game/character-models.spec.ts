import { randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { animatedFbx, texturedFbx } from './fbx-fixture';

// Small, animated, self-contained GLB: tests the actual renderer without external assets.
function animatedGlb() {
  const positions = new Float32Array([
    0, 1, 0, -1, -1, 1, 1, -1, 1,
    0, 1, 0, 1, -1, 1, 0, -1, -1,
    0, 1, 0, 0, -1, -1, -1, -1, 1,
    -1, -1, 1, 0, -1, -1, 1, -1, 1,
  ]);
  const times = new Float32Array([0, 1, 2]);
  const rotations = new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, 0, 0, 1]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(times.buffer), Buffer.from(rotations.buffer)]);
  const json = Buffer.from(JSON.stringify({
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.45, 0.1, 1], metallicFactor: 0.25, roughnessFactor: 0.5 } }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }, { buffer: 0, byteOffset: positions.byteLength, byteLength: times.byteLength }, { buffer: 0, byteOffset: positions.byteLength + times.byteLength, byteLength: rotations.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 12, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] }, { bufferView: 1, componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [2] }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' }],
    animations: [{ name: 'Idle', samplers: [{ input: 1, output: 2 }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }],
  }));
  const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + paddedJson.length + binary.length, 8);
  header.writeUInt32LE(paddedJson.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0); binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, paddedJson, binaryHeader, binary]);
}

const filename = `__viewer qa ${randomUUID()}.GLB`;
const fixturePath = path.resolve('public/models', filename);
const fbxFilename = `__viewer qa ${randomUUID()}.FBX`;
const fbxFixturePath = path.resolve('public/models', fbxFilename);
test.beforeAll(async () => {
  await writeFile(fixturePath, animatedGlb(), { flag: 'wx' });
  await writeFile(fbxFixturePath, animatedFbx(), { flag: 'wx' });
});
test.afterAll(async () => { await Promise.all([unlink(fixturePath), unlink(fbxFixturePath)]); });

test.beforeEach(async ({ page }) => {
  // Exercise local persistence and rendering without contacting the user's Firebase data.
  await page.route('**/src/lib/auth.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export const authProvider = { getUid: () => 'guest', getDisplayName: () => 'QA',
      onAuthChange: cb => { cb({uid: 'guest', email: null, displayName: 'QA'}); return () => {}; } };
  ` }));
  await page.route('**/src/lib/firestore.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    export * from './firestore.ts?qaActual';
    const characters = () => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters') || '[]');
    export const loadCharacters = async () => characters();
    export const loadFavorites = async () => [];
    export const loadAdminAccess = async () => ({isAdmin: false, source: 'none'});
    export const loadUserDiceSettings = async () => ({macros: [], webhookUrl: '', autoSend: false});
    export const subscribeCharacterById = (id, uid, cb) => { cb(characters().find(c => c.id === id) || null); return () => {}; };
  ` }));
  await page.addInitScript(() => {
    if (localStorage.getItem('qaModelsSeeded')) return;
    localStorage.setItem('qaModelsSeeded', 'true');
    localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify([{ id: 'model-qa', name: 'QA Ayrton', race: 'Human', className: 'Fighter', userId: 'guest', visibility: 'private', sendToSpreadsheet: false }]));
  });
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', error => { throw error; });
});

test('select, save, reopen, view and clear a character model', async ({ page, request }) => {
  const catalog = await (await request.get('models/index.json')).json();
  expect(catalog).toContainEqual({ path: filename, bytes: animatedGlb().length });
  expect(catalog).toContainEqual({ path: fbxFilename, bytes: Buffer.byteLength(animatedFbx()) });
  expect(catalog.every((entry: { path: string }) => /\.(glb|fbx)$/i.test(entry.path))).toBe(true);
  await page.goto('#homebrew-character-sheet/model-qa');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
  await expect(page.locator('model-viewer')).toHaveCount(0);
  await page.goto('#tools/characters');
  await page.getByRole('button', { name: 'Load Character Sheet' }).click();
  await page.getByRole('button', { name: '3D Model', exact: true }).click();
  const select = page.getByLabel('Character 3D model', { exact: true });
  await select.selectOption(filename);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0].model3dPath)).toBe(filename);
  await page.reload();
  await page.getByRole('button', { name: 'Load Character Sheet' }).click();
  await page.getByRole('button', { name: '3D Model', exact: true }).click();
  await expect(select).toHaveValue(filename);
  await page.goto('#homebrew-character-sheet/model-qa');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const viewer = page.locator('model-viewer');
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(viewer).toHaveJSProperty('src', `/inoraxium-wiki/models/${encodeURIComponent(filename)}`);
  const radius = await viewer.evaluate((element: any) => element.getCameraOrbit().radius);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => viewer.evaluate((element: any) => element.getCameraOrbit().radius)).toBeLessThan(radius);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  const bounds = await viewer.boundingBox();
  const theta = await viewer.evaluate((element: any) => element.getCameraOrbit().theta);
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 120, bounds!.y + bounds!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => viewer.evaluate((element: any) => element.getCameraOrbit().theta)).not.toBe(theta);
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await expect.poll(() => viewer.evaluate((element: any) => element.getCameraOrbit().theta)).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click();
  await page.getByRole('button', { name: 'Auto rotate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auto rotate', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Viewer settings', exact: true }).click();
  await page.getByLabel('Background', { exact: true }).selectOption('parchment');
  await page.getByLabel('Lighting', { exact: true }).selectOption('legacy');
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect.poll(() => viewer.evaluate((element: any) => element.paused)).toBe(false);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect.poll(() => viewer.evaluate((element: any) => element.paused)).toBe(true);
  await page.getByRole('button', { name: 'Viewer settings', exact: true }).click();
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const size = await page.locator('.character-model-viewer').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, right: element.getBoundingClientRect().right }));
    expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
    expect(size.right).toBeLessThanOrEqual(width);
    await page.locator('.character-model-viewer').screenshot({ path: `.artifacts/demo-game/model-viewer-${width}.png` });
  }
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('#tools/characters');
  await page.getByRole('button', { name: 'Load Character Sheet' }).click();
  await page.getByRole('button', { name: '3D Model', exact: true }).click();
  await select.selectOption('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('#homebrew-character-sheet/model-qa');
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
});

test('missing models, library retry and model errors remain recoverable', async ({ page }) => {
  await page.goto('#homebrew-character-sheet/model-qa');
  await page.evaluate(() => { const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].model3dPath = 'removed.glb'; localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars)); });
  await page.reload();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
  await page.evaluate(filename => { const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].model3dPath = filename; localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars)); }, filename);
  await page.route('**/models/index.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry model library' })).toBeVisible();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
  await page.unroute('**/models/index.json');
  await page.getByRole('button', { name: 'Retry model library' }).click();
  await page.route('**/models/*.GLB', route => route.fulfill({ status: 404, body: 'Missing' }));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('could not be loaded', { timeout: 30000 });
  await page.unroute('**/models/*.GLB');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('model-viewer')).toHaveCount(0);
});

test('FBX selection persists and renders with animation and camera controls', async ({ page }) => {
  await page.goto('#tools/characters');
  await page.getByRole('button', { name: 'Load Character Sheet' }).click();
  await page.getByRole('button', { name: '3D Model', exact: true }).click();
  await page.getByLabel('Character 3D model', { exact: true }).selectOption(fbxFilename);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!)[0].model3dPath)).toBe(fbxFilename);
  await page.goto('#homebrew-character-sheet/model-qa');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  const viewer = page.locator('model-viewer');
  const preparedUrl = await viewer.evaluate((element: any) => element.src as string);
  expect(preparedUrl.startsWith('blob:')).toBe(true);
  await expect(page.getByLabel('Animation', { exact: true })).toHaveValue('Idle');
  expect(await viewer.evaluate((element: any) => element.duration)).toBeCloseTo(2);
  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect.poll(() => viewer.evaluate((element: any) => element.currentTime)).toBeGreaterThan(0.05);
  await page.getByLabel('Speed', { exact: true }).selectOption('0.5');
  await expect(viewer).toHaveJSProperty('timeScale', 0.5);
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  const radius = await viewer.evaluate((element: any) => element.getCameraOrbit().radius);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(() => viewer.evaluate((element: any) => element.getCameraOrbit().radius)).toBeLessThan(radius);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('.character-model-viewer').screenshot({ path: '.artifacts/demo-game/fbx-model-viewer-390.png' });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(viewer).toHaveCount(0);
  expect(await page.evaluate(url => fetch(url).then(() => false).catch(() => true), preparedUrl)).toBe(true);
});

test('invalid FBX can be retried without leaving the viewer', async ({ page }) => {
  await page.goto('#homebrew-character-sheet/model-qa');
  await page.evaluate(filename => { const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].model3dPath = filename; localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars)); }, fbxFilename);
  await page.reload();
  await page.route('**/models/*.FBX*', route => route.fulfill({ contentType: 'application/octet-stream', body: 'invalid FBX data' }));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('This FBX could not be prepared', { timeout: 30000 });
  await page.unroute('**/models/*.FBX*');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByLabel('Animation', { exact: true })).toHaveValue('Idle');
});

test('FBX waits for external textures and explains missing texture files', async ({ page }) => {
  await page.goto('#homebrew-character-sheet/model-qa');
  await page.evaluate(filename => { const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].model3dPath = filename; localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars)); }, fbxFilename);
  await page.reload();
  await page.route('**/models/*.FBX*', route => route.fulfill({ contentType: 'application/octet-stream', body: texturedFbx() }));
  await page.route('**/models/__viewer-qa-pixel.png', route => route.fulfill({ status: 404, body: 'Missing texture' }));
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('FBX textures could not be loaded', { timeout: 30000 });
  await page.unroute('**/models/__viewer-qa-pixel.png');
  await page.route('**/models/__viewer-qa-pixel.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64') }));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled({ timeout: 30000 });
  const result = await page.locator('model-viewer').evaluate(async (element: any) => {
    const bytes = await (await fetch(element.src)).arrayBuffer();
    const view = new DataView(bytes);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
    return { images: json.images?.length, baseColorTexture: json.materials[0].pbrMetallicRoughness.baseColorTexture };
  });
  expect(result.images).toBe(1);
  expect(result.baseColorTexture).toBeTruthy();
});

test('optional repository model renders in the shared viewer', async ({ page }) => {
  const modelPath = process.env.CHARACTER_MODEL_QA_PATH;
  test.skip(!modelPath, 'Set CHARACTER_MODEL_QA_PATH to verify a repository model.');
  test.setTimeout(180000);
  await page.goto('#homebrew-character-sheet/model-qa');
  await page.evaluate(filename => { const chars = JSON.parse(localStorage.getItem('battleTrackerLocalCharacters')!); chars[0].model3dPath = filename; localStorage.setItem('battleTrackerLocalCharacters', JSON.stringify(chars)); }, modelPath!);
  await page.reload();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('.cmv-stage')).toHaveAttribute('aria-busy', 'false', { timeout: 120000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeEnabled();
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('.character-model-viewer').screenshot({ path: '.artifacts/demo-game/repository-model.png' });
  console.log('Repository model:', await page.locator('model-viewer').evaluate((element: any) => ({ dimensions: element.getDimensions(), animations: element.availableAnimations })));
});
