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

const readAlbumUrl = (req) => {
  if (req.method === 'GET') {
    return req.query?.albumUrl || req.query?.url || req.query?.id || '';
  }
  return req.body?.albumUrl || req.body?.url || req.body?.id || '';
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

  try {
    const response = await fetch(`https://imgur.com/a/${encodeURIComponent(albumId)}`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 InoraxiumWiki/1.0',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `Imgur album page request failed (${response.status}).` });
      return;
    }

    const html = await response.text();
    const images = extractImagesFromHtml(html);
    if (images.length === 0) {
      res.status(404).json({ error: 'Imgur album page did not include any direct image links.' });
      return;
    }

    res.status(200).json({ data: images });
  } catch (error) {
    res.status(502).json({
      error: `Imgur album could not be reached. ${error instanceof Error ? error.message : ''}`.trim(),
    });
  }
}
