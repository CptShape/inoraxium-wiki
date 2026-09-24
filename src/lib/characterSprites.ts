import type { CharacterSprites, SpriteAnimation, SpriteSheet } from '../types/sprites';
import { getPixhostDirectImageUrl } from './pixhost';

export const SPRITE_ANIMATIONS: SpriteAnimation[] = ['idle', 'move', 'attack', 'cast', 'hit', 'dodge', 'downed', 'recover'];
export const SPRITE_LIMITS = { frame: 256, sheet: 4096, frames: 64, fps: 30, uploadBytes: 8 * 1024 * 1024 };
export const defaultSpriteSheet = (): SpriteSheet => ({ url: '', frameWidth: 128, frameHeight: 128, columns: 4, frames: 4, fps: 12, anchorX: .5, anchorY: 1, displayHeight: 84 });

export function resolveSpriteUrl(input: string): string {
  const links = input.match(/https?:\/\/[^\s\[\]<>"')]+/g) || [];
  const thumb = links.find(url => /^https:\/\/t\d+\.pixhost\.to\/thumbs\//i.test(url));
  const direct = thumb ? getPixhostDirectImageUrl('', thumb) : links[0] || input.trim();
  let url: URL;
  try { url = new URL(direct); } catch { throw new Error('Enter an Imgur or Pixhost image URL.'); }
  if (/^(www\.)?imgur\.com$/i.test(url.hostname) && /^\/[a-zA-Z0-9]+(?:\.(png|webp))?$/.test(url.pathname)) {
    url.hostname = 'i.imgur.com';
    if (!/\.(png|webp)$/i.test(url.pathname)) url.pathname += '.png';
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^(i\.imgur\.com|img\d+\.pixhost\.to)$/i.test(url.hostname) || !/\.(png|webp)$/i.test(url.pathname)) {
    throw new Error('Use a full-size HTTPS PNG/WebP image from Imgur or Pixhost. Pixhost show links need their BBCode thumbnail link; albums are not sprite sheets.');
  }
  url.hash = '';
  return url.toString();
}

export function validateSpriteSheet(sheet: SpriteSheet) {
  if (!sheet || resolveSpriteUrl(sheet.url) !== sheet.url) throw new Error('Invalid sprite sheet URL.');
  for (const value of [sheet.frameWidth, sheet.frameHeight]) if (!Number.isInteger(value) || value < 1 || value > SPRITE_LIMITS.frame) throw new Error('Frame dimensions must be 1-256 pixels.');
  if (!Number.isInteger(sheet.frames) || sheet.frames < 1 || sheet.frames > SPRITE_LIMITS.frames || !Number.isInteger(sheet.columns) || sheet.columns < 1 || sheet.columns > sheet.frames) throw new Error('Use 1-64 frames and no more columns than frames.');
  if (!Number.isInteger(sheet.fps) || sheet.fps < 1 || sheet.fps > SPRITE_LIMITS.fps) throw new Error('Animation speed must be 1-30 FPS.');
  if (![sheet.anchorX, sheet.anchorY].every(v => Number.isFinite(v) && v >= 0 && v <= 1) || !Number.isFinite(sheet.displayHeight) || sheet.displayHeight < 32 || sheet.displayHeight > 160) throw new Error('Invalid sprite anchor or display height.');
  const width = sheet.columns * sheet.frameWidth, height = Math.ceil(sheet.frames / sheet.columns) * sheet.frameHeight;
  if (width > SPRITE_LIMITS.sheet || height > SPRITE_LIMITS.sheet) throw new Error('Sprite sheets must be at most 4096 x 4096 pixels.');
  return { width, height };
}

export function validateCharacterSprites(profile?: CharacterSprites) {
  if (!profile) return;
  if (profile.version !== 1 || !['knight', 'mage', 'monster'].includes(profile.preset) || !profile.clips || typeof profile.clips !== 'object') throw new Error('Invalid character sprite profile.');
  for (const [animation, clip] of Object.entries(profile.clips)) {
    if (!SPRITE_ANIMATIONS.includes(animation as SpriteAnimation)) throw new Error('Unknown sprite animation.');
    validateSpriteSheet(clip);
  }
}

export function loadSpriteImage(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => { image.onload = image.onerror = null; image.src = ''; reject(new Error('Sprite image timed out.')); }, 15000);
    const finish = () => { clearTimeout(timeout); image.onload = image.onerror = null; };
    image.onload = () => { finish(); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { finish(); reject(new Error('Sprite image could not be loaded. Check the full-size image URL.')); };
    image.src = url;
  });
}

export async function verifySpriteSheet(sheet: SpriteSheet) {
  const expected = validateSpriteSheet(sheet), actual = await loadSpriteImage(sheet.url);
  if (actual.width !== expected.width || actual.height !== expected.height) throw new Error(`Image is ${actual.width} x ${actual.height}; expected ${expected.width} x ${expected.height}.`);
}
