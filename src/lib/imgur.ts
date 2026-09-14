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

export const loadImgurAlbumImages = async (albumUrlOrId: string): Promise<ImgurAlbumImage[]> => {
  if (!IMGUR_CLIENT_ID) {
    throw new Error('Imgur album import needs VITE_IMGUR_CLIENT_ID in the environment.');
  }

  const albumId = parseImgurAlbumId(albumUrlOrId);
  if (!albumId) {
    throw new Error('Please enter a valid Imgur album link.');
  }

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
    const images = rawImages
      .filter(image => typeof image.link === 'string' && /^https?:\/\/.+\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(image.link || ''))
      .map((image): ImgurAlbumImage => ({
        url: image.link || '',
        label: image.title || image.name || imageLabelFromUrl(image.link || '', image.id || 'Imgur image'),
      }));

    if (images.length > 0) return images;
    lastError = 'Imgur album did not include any direct image links.';
  }

  throw new Error(lastError);
};
