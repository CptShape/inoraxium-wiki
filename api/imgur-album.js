const IMAGE_URL_PATTERN = /https?:\\?\/\\?\/i\.imgur\.com\\?\/[a-zA-Z0-9_-]+\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\\<>\s]*)?/gi;

const parseAlbumId = (rawUrl) => {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const markerIndex = segments.findIndex(segment => ['a', 'album', 'gallery'].includes(segment.toLowerCase()));
    if (markerIndex >= 0 && segments[markerIndex + 1]) {
      return segments[markerIndex + 1].replace(/[^a-zA-Z0-9_-]/g, '');
    }
    if (/^(?:www\.)?imgur\.com$/i.test(parsed.hostname) && segments[0]) {
      return segments[0].replace(/[^a-zA-Z0-9_-]/g, '');
    }
  } catch {
    return trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
  }

  return '';
};

const imageLabelFromUrl = (url, fallback) => {
  try {
    const fileName = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return fileName.replace(/\.(avif|gif|jpe?g|png|webp)$/i, '') || fallback;
  } catch {
    return fallback;
  }
};

const extractImagesFromHtml = (html) => {
  const matches = html.match(IMAGE_URL_PATTERN) || [];
  const seen = new Set();
  const images = [];

  for (const match of matches) {
    const url = match
      .replace(/\\\//g, '/')
      .replace(/\\u002F/g, '/')
      .replace(/&amp;/g, '&');
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({
      id: key,
      link: url,
      name: imageLabelFromUrl(url, `Imgur image ${images.length + 1}`),
    });
  }

  return images;
};

const collectImagesFromJson = (value, images = []) => {
  if (Array.isArray(value)) {
    value.forEach(item => collectImagesFromJson(item, images));
    return images;
  }

  if (!value || typeof value !== 'object') return images;

  const link = value.link || value.url || value.href || value.src;
  if (typeof link === 'string' && /^https?:\/\/i\.imgur\.com\/.+\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(link)) {
    images.push({
      id: typeof value.id === 'string' ? value.id : link.toLowerCase(),
      link,
      name: typeof value.title === 'string'
        ? value.title
        : typeof value.name === 'string'
          ? value.name
          : imageLabelFromUrl(link, `Imgur image ${images.length + 1}`),
    });
  }

  const hash = typeof value.hash === 'string' ? value.hash : typeof value.id === 'string' ? value.id : '';
  const ext = typeof value.ext === 'string' ? value.ext : typeof value.extension === 'string' ? value.extension : '';
  if (hash && /^\.[a-z0-9]+$/i.test(ext)) {
    const imageUrl = `https://i.imgur.com/${hash}${ext}`;
    images.push({
      id: hash,
      link: imageUrl,
      name: typeof value.title === 'string'
        ? value.title
        : typeof value.name === 'string'
          ? value.name
          : imageLabelFromUrl(imageUrl, `Imgur image ${images.length + 1}`),
    });
  }

  Object.values(value).forEach(item => collectImagesFromJson(item, images));
  return images;
};

const dedupeImages = (images) => {
  const seen = new Set();
  return images.filter((image) => {
    const key = String(image.link || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const readAlbumUrl = (req) => {
  if (req.method === 'GET') {
    return req.query?.albumUrl || req.query?.url || req.query?.id || '';
  }
  return req.body?.albumUrl || req.body?.url || req.body?.id || '';
};

const fetchAlbumJsonImages = async (albumId) => {
  const response = await fetch(`https://imgur.com/a/${encodeURIComponent(albumId)}/layout/blog.json`, {
    headers: {
      Accept: 'application/json,text/html',
      'User-Agent': 'Mozilla/5.0 InoraxiumWiki/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Imgur album JSON request failed (${response.status}).`);
  }

  const text = await response.text();
  if (/^\s*</.test(text)) {
    return dedupeImages(extractImagesFromHtml(text));
  }

  const data = JSON.parse(text);
  return dedupeImages(collectImagesFromJson(data));
};

const fetchAlbumHtmlImages = async (albumId) => {
  const response = await fetch(`https://imgur.com/a/${encodeURIComponent(albumId)}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 InoraxiumWiki/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Imgur album page request failed (${response.status}).`);
  }

  const html = await response.text();
  return dedupeImages(extractImagesFromHtml(html));
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (!['GET', 'POST'].includes(req.method || '')) {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const albumId = parseAlbumId(readAlbumUrl(req));
  if (!albumId) {
    res.status(400).json({ error: 'Please enter a valid Imgur album link.' });
    return;
  }

  const errors = [];
  for (const loader of [fetchAlbumJsonImages, fetchAlbumHtmlImages]) {
    try {
      const images = await loader(albumId);
      if (images.length > 0) {
        res.status(200).json({ data: images });
        return;
      }
      errors.push('No direct image links were found.');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Imgur album request failed.');
    }
  }

  res.status(502).json({
    error: `Imgur album could not be imported. ${errors.join(' ')}`.trim(),
  });
}
