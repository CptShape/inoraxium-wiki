import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from './_lib/http.js';

const IMGUR_BASE_URL = 'https://imgur.com';
const IMGUR_IMAGE_URL = 'https://i.imgur.com';
const USER_AGENT = 'Mozilla/5.0 InoraxiumWiki/1.0';
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

interface ImgurImage {
  id: string;
  link: string;
  name: string;
}

interface ImageArrayPath {
  label: string;
  segments: string[];
}

interface ImageArrayMatch {
  label: string;
  items: unknown[];
}

const IMAGE_ARRAY_PATHS: ImageArrayPath[] = [
  { label: 'data.album_images.images', segments: ['data', 'album_images', 'images'] },
  { label: 'album_images.images', segments: ['album_images', 'images'] },
  { label: 'data.images', segments: ['data', 'images'] },
  { label: 'images', segments: ['images'] },
  { label: 'data.post.images', segments: ['data', 'post', 'images'] },
  { label: 'post.images', segments: ['post', 'images'] },
  { label: 'data.media', segments: ['data', 'media'] },
  { label: 'media', segments: ['media'] },
  { label: 'data.posts[].media', segments: ['data', 'posts', '[]', 'media'] },
  { label: 'posts[].media', segments: ['posts', '[]', 'media'] },
];

function parseAlbumHash(albumUrl: unknown): string | null {
  if (typeof albumUrl !== 'string') {
    return null;
  }

  const input = albumUrl.trim();
  if (/^[A-Za-z0-9]+$/.test(input)) {
    return input;
  }

  try {
    const url = new URL(input);
    if (url.hostname !== 'imgur.com' && url.hostname !== 'www.imgur.com') {
      return null;
    }

    const match = url.pathname.match(/^\/(?:a|gallery)\/([A-Za-z0-9]+)(?:\/|$)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function getAlbumUrl(req: VercelRequest): unknown {
  if (req.method === 'GET') {
    return req.query.albumUrl;
  }

  if (req.body && typeof req.body === 'object') {
    return req.body.albumUrl;
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body).albumUrl;
    } catch {
      return null;
    }
  }

  return null;
}

function parseDirectImgurImageUrl(value: string): { id: string; link: string } | null {
  const match = value.match(/https:\/\/i\.imgur\.com\/([^\s"'<>/?]+)\.(png|jpe?g|webp|gif|avif)(?:\?[^\s"'<>]*)?/i);
  if (!match || !match[1]) {
    return null;
  }

  return {
    id: match[1],
    link: `${IMGUR_IMAGE_URL}/${match[1]}.${match[2].toLowerCase()}`,
  };
}

function propertyValue(object: Record<string, unknown>, names: string[]): unknown {
  // Respect the caller's priority order instead of relying on JSON key order.
  for (const name of names) {
    for (const [key, value] of Object.entries(object)) {
      if (key.toLowerCase() === name) {
        return value;
      }
    }
  }

  return undefined;
}

function buildImageUrl(object: Record<string, unknown>): string | null {
  const hash = propertyValue(object, ['hash', 'id']);
  const extension = propertyValue(object, ['ext', 'extension', 'type']);

  if (typeof hash !== 'string' || typeof extension !== 'string') {
    return null;
  }

  const normalizedHash = hash.trim();
  const normalizedExtension = extension
    .trim()
    .replace(/^image\//i, '')
    .replace(/^\./, '')
    .toLowerCase();
  if (!/^[A-Za-z0-9]+$/.test(normalizedHash) || !IMAGE_EXTENSIONS.has(normalizedExtension)) {
    return null;
  }

  return `${IMGUR_IMAGE_URL}/${normalizedHash}.${normalizedExtension}`;
}

function addImage(images: Map<string, ImgurImage>, id: string, link: string): void {
  if (!images.has(id)) {
    images.set(id, {
      id,
      link,
      name: '',
    });
  }
}

function addDirectImage(images: Map<string, ImgurImage>, value: string): boolean {
  const directImage = parseDirectImgurImageUrl(value);
  if (!directImage) {
    return false;
  }

  addImage(images, directImage.id, directImage.link);
  return true;
}

function collectImageItem(item: unknown, images: Map<string, ImgurImage>): boolean {
  if (typeof item === 'string') {
    return addDirectImage(images, item);
  }

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return false;
  }

  const object = item as Record<string, unknown>;

  for (const field of ['link', 'url', 'src', 'href']) {
    const candidate = propertyValue(object, [field]);
    if (typeof candidate === 'string' && addDirectImage(images, candidate)) {
      return true;
    }
  }

  const generatedUrl = buildImageUrl(object);
  if (!generatedUrl) {
    return false;
  }

  const generatedImage = parseDirectImgurImageUrl(generatedUrl);
  if (!generatedImage) {
    return false;
  }

  addImage(images, generatedImage.id, generatedImage.link);
  return true;
}

function findImageArrays(value: unknown, segments: string[]): unknown[][] {
  let values: unknown[] = [value];

  for (const segment of segments) {
    if (segment === '[]') {
      values = values.flatMap((item) => (Array.isArray(item) ? item : []));
      continue;
    }

    values = values.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }
      return [(item as Record<string, unknown>)[segment]];
    });
  }

  return values.filter(Array.isArray) as unknown[][];
}

function collectImagesFromKnownArrays(layout: unknown, images: Map<string, ImgurImage>): boolean {
  const matches: ImageArrayMatch[] = IMAGE_ARRAY_PATHS.flatMap(({ label, segments }) =>
    findImageArrays(layout, segments).map((items) => ({ label, items })),
  );
  const debugPaths = matches.map(({ label, items }) => `${label} (${items.length})`);
  console.info('[imgur-album] candidate image arrays:', debugPaths.join(', ') || 'none');

  let foundRealImage = false;
  for (const { items } of matches) {
    for (const item of items) {
      if (collectImageItem(item, images)) {
        foundRealImage = true;
      }
    }
  }

  return foundRealImage;
}

function collectImagesRecursively(value: unknown, images: Map<string, ImgurImage>, visited = new WeakSet<object>()): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImagesRecursively(item, images, visited);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  const object = value as Record<string, unknown>;
  // The generic fallback accepts direct image links only. It never builds an
  // image URL from album/root metadata such as cover or album id/hash fields.
  for (const field of ['link', 'url', 'src', 'href']) {
    const candidate = propertyValue(object, [field]);
    if (typeof candidate === 'string') {
      addDirectImage(images, candidate);
    }
  }

  for (const child of Object.values(object)) {
    collectImagesRecursively(child, images, visited);
  }
}

function collectImagesFromHtml(html: string, images: Map<string, ImgurImage>): void {
  const imagePattern = /https:\/\/i\.imgur\.com\/[^\s"'<>?]+\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s"'<>]*)?/gi;

  for (const match of html.matchAll(imagePattern)) {
    addDirectImage(images, match[0]);
  }
}

async function collectImagesFromLayout(albumHash: string, images: Map<string, ImgurImage>): Promise<void> {
  const response = await fetch(`${IMGUR_BASE_URL}/a/${albumHash}/layout/blog.json`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    return;
  }

  const text = await response.text();
  if (text.trimStart().startsWith('<')) {
    collectImagesFromHtml(text, images);
    return;
  }

  try {
    const layout = JSON.parse(text);
    const foundKnownImageArray = collectImagesFromKnownArrays(layout, images);

    if (!foundKnownImageArray) {
      collectImagesRecursively(layout, images);
    }
  } catch {
    // Some Imgur responses are neither valid JSON nor useful HTML. The album-page
    // fallback below handles those without exposing parser errors to the client.
  }
}

async function fetchAlbumHtml(albumHash: string): Promise<string | null> {
  const response = await fetch(`${IMGUR_BASE_URL}/a/${albumHash}`, {
    headers: {
      Accept: 'text/html',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    return null;
  }

  return response.text();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyApiCors(req, res, 'GET, POST, OPTIONS')) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET or POST.' });
  }

  const albumHash = parseAlbumHash(getAlbumUrl(req));
  if (!albumHash) {
    return res.status(400).json({
      error: 'Invalid albumUrl. Provide an Imgur album URL, gallery URL, or album hash.',
    });
  }

  const images = new Map<string, ImgurImage>();

  try {
    await collectImagesFromLayout(albumHash, images);

    if (images.size === 0) {
      const html = await fetchAlbumHtml(albumHash);
      if (html) {
        collectImagesFromHtml(html, images);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(502).json({ error: `Imgur album request failed: ${message}` });
  }

  if (images.size === 0) {
    return res.status(404).json({ error: 'No supported images were found in this Imgur album.' });
  }

  return res.status(200).json({ data: [...images.values()] });
}

