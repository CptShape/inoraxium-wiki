export interface ImgurAlbumImage {
  url: string;
  label: string;
}

interface ImgurApiImage {
  id?: string;
  title?: string | null;
  name?: string | null;
  link?: string;
  type?: string;
  animated?: boolean;
}

interface ImgurApiResponse {
  data?: ImgurApiImage[] | { images?: ImgurApiImage[] };
  success?: boolean;
  status?: number;
}

const IMGUR_CLIENT_ID = import.meta.env.VITE_IMGUR_CLIENT_ID as string | undefined;
const CONFIGURED_IMGUR_ALBUM_PROXY_ENDPOINT = import.meta.env.VITE_IMGUR_ALBUM_PROXY_URL as string | undefined;
const PIXHOST_UPLOAD_PROXY_ENDPOINT = import.meta.env.VITE_PIXHOST_UPLOAD_PROXY_URL as string | undefined;

const getImgurAlbumProxyEndpoint = (): string => {
  if (CONFIGURED_IMGUR_ALBUM_PROXY_ENDPOINT?.trim()) {
    return CONFIGURED_IMGUR_ALBUM_PROXY_ENDPOINT.trim();
  }

  if (PIXHOST_UPLOAD_PROXY_ENDPOINT?.trim()) {
    try {
      const url = new URL(PIXHOST_UPLOAD_PROXY_ENDPOINT.trim());
      url.pathname = url.pathname.replace(/\/[^/]*$/, '/imgur-album');
      return url.toString();
    } catch {
      return '';
    }
  }

  return '';
};

export const parseImgurAlbumId = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
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

const imageLabelFromUrl = (url: string, fallback: string): string => {
  try {
    const fileName = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
    return fileName.replace(/\.(avif|gif|jpe?g|png|webp)$/i, '') || fallback;
  } catch {
    return fallback;
  }
};

const normalizeImgurImages = (rawImages: ImgurApiImage[]): ImgurAlbumImage[] => {
  const seen = new Set<string>();
  return rawImages
    .filter(image => typeof image.link === 'string' && /^https?:\/\/.+\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(image.link || ''))
    .map((image): ImgurAlbumImage => ({
      url: image.link || '',
      label: image.title || image.name || imageLabelFromUrl(image.link || '', image.id || 'Imgur image'),
    }))
    .filter((image) => {
      const key = image.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const extractImgurImagesFromHtml = (html: string): ImgurAlbumImage[] => {
  const rawMatches = html.match(/https?:\\?\/\\?\/i\.imgur\.com\\?\/[a-zA-Z0-9_-]+\.(?:avif|gif|jpe?g|png|webp)(?:\?[^"'\\<>\s]*)?/gi) || [];
  const rawImages = rawMatches.map((match, index): ImgurApiImage => {
    const link = match
      .replace(/\\\//g, '/')
      .replace(/\\u002F/g, '/')
      .replace(/&amp;/g, '&');
    return {
      id: `imgur-${index + 1}`,
      link,
      name: imageLabelFromUrl(link, `Imgur image ${index + 1}`),
    };
  });
  return normalizeImgurImages(rawImages);
};

const loadImgurAlbumImagesFromApi = async (albumId: string): Promise<ImgurAlbumImage[]> => {
  const endpoints = [
    `https://api.imgur.com/3/album/${encodeURIComponent(albumId)}/images`,
    `https://api.imgur.com/3/gallery/album/${encodeURIComponent(albumId)}`,
  ];

  let lastError = 'Imgur album could not be loaded.';
  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
      },
    }).catch((error) => {
      throw new Error(`Imgur could not be reached. ${error instanceof Error ? error.message : ''}`.trim());
    });

    const payload = await response.json().catch(() => ({})) as ImgurApiResponse;
    if (!response.ok) {
      lastError = `Imgur album request failed (${response.status}).`;
      continue;
    }

    const rawImages = Array.isArray(payload.data)
      ? payload.data
      : payload.data?.images || [];
    const images = normalizeImgurImages(rawImages);

    if (images.length > 0) return images;
    lastError = 'Imgur album did not include any direct image links.';
  }

  throw new Error(lastError);
};

const loadImgurAlbumImagesFromProxy = async (albumUrlOrId: string): Promise<ImgurAlbumImage[]> => {
  const endpoint = getImgurAlbumProxyEndpoint();
  if (!endpoint) {
    throw new Error('Imgur album proxy is not configured.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ albumUrl: albumUrlOrId }),
  }).catch((error) => {
    throw new Error(`Imgur album proxy could not be reached. ${error instanceof Error ? error.message : ''}`.trim());
  });

  const payload = await response.json().catch(() => ({})) as ImgurApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Imgur album proxy request failed (${response.status}).`);
  }

  const rawImages = Array.isArray(payload.data)
    ? payload.data
    : payload.data?.images || [];
  const images = normalizeImgurImages(rawImages);
  if (images.length > 0) return images;

  throw new Error('Imgur album proxy did not return any direct image links.');
};

const loadImgurAlbumImagesFromPublicPage = async (albumId: string): Promise<ImgurAlbumImage[]> => {
  const response = await fetch(`https://imgur.com/a/${encodeURIComponent(albumId)}`, {
    headers: {
      Accept: 'text/html',
    },
  }).catch((error) => {
    throw new Error(`Imgur album page could not be reached. ${error instanceof Error ? error.message : ''}`.trim());
  });

  if (!response.ok) {
    throw new Error(`Imgur album page request failed (${response.status}).`);
  }

  const html = await response.text();
  const images = extractImgurImagesFromHtml(html);
  if (images.length > 0) return images;

  throw new Error('Imgur album page did not include any direct image links.');
};

export const loadImgurAlbumImages = async (albumUrlOrId: string): Promise<ImgurAlbumImage[]> => {
  const albumId = parseImgurAlbumId(albumUrlOrId);
  if (!albumId) {
    throw new Error('Please enter a valid Imgur album link.');
  }

  const errors: string[] = [];

  const proxyEndpoint = getImgurAlbumProxyEndpoint();
  if (proxyEndpoint) {
    try {
      return await loadImgurAlbumImagesFromProxy(albumUrlOrId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Imgur album proxy failed.');
    }
  }

  if (IMGUR_CLIENT_ID?.trim()) {
    try {
      return await loadImgurAlbumImagesFromApi(albumId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Imgur API failed.');
    }
  }

  try {
    return await loadImgurAlbumImagesFromPublicPage(albumId);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Imgur public album page failed.');
  }

  throw new Error(
    [
      'Imgur album could not be imported automatically.',
      'Use VITE_IMGUR_ALBUM_PROXY_URL for the API-keyless album proxy, or VITE_IMGUR_CLIENT_ID if Imgur client registration becomes available again.',
      ...errors.map(message => `- ${message}`),
    ].join('\n'),
  );
};
