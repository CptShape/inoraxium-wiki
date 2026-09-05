export interface PixhostUploadResult {
  showUrl: string;
  thumbUrl: string;
  name: string;
}

interface PixhostApiResponse {
  name?: string;
  show_url?: string;
  th_url?: string;
  showUrl?: string;
  thumbUrl?: string;
  error?: string;
  success?: boolean;
  data?: PixhostApiResponse;
}

const PIXHOST_UPLOAD_ENDPOINT = 'https://api.pixhost.to/images';
const PIXHOST_UPLOAD_PROXY_ENDPOINT = import.meta.env.VITE_PIXHOST_UPLOAD_PROXY_URL as string | undefined;

const isPixhostShowUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return /^(?:www\.)?pixhost\.to$/i.test(parsed.hostname) && /^\/show\//i.test(parsed.pathname);
  } catch {
    return false;
  }
};

export const isDirectImageUrl = (url: string): boolean => (
  /^https?:\/\/.+\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url) && !isPixhostShowUrl(url)
);

export const getPixhostDirectImageUrl = (showUrl: string, thumbUrl: string): string => {
  if (isDirectImageUrl(showUrl)) return showUrl;
  if (!thumbUrl) return showUrl;

  try {
    const parsed = new URL(thumbUrl);
    const pixhostThumbMatch = parsed.hostname.match(/^t(\d+)\.pixhost\.to$/i);
    const pathMatch = parsed.pathname.match(/^\/thumbs\/([^/]+)\/(.+)$/i);
    if (pixhostThumbMatch && pathMatch) {
      parsed.hostname = `img${pixhostThumbMatch[1]}.pixhost.to`;
      parsed.pathname = `/images/${pathMatch[1]}/${pathMatch[2]}`;
      return parsed.toString();
    }

    parsed.pathname = parsed.pathname
      .replace(/\/thumbs\//, '/images/')
      .replace(/\/t\//, '/images/')
      .replace(/\/thumb\//, '/images/')
      .replace(/\/small\//, '/images/')
      .replace(/\/thumbnail\//, '/images/');
    parsed.pathname = parsed.pathname.replace(/\/?thumbs?_/i, '/');
    return parsed.toString();
  } catch {
    return thumbUrl;
  }
};

const normalizePixhostResponse = (data: PixhostApiResponse, fileName: string): PixhostUploadResult => {
  const payload = data.data || data;
  const showUrl = payload.show_url || payload.showUrl || '';
  const thumbUrl = payload.th_url || payload.thumbUrl || showUrl;
  const imageUrl = getPixhostDirectImageUrl(showUrl, thumbUrl);

  if (!imageUrl) {
    throw new Error(payload.error || data.error || 'Pixhost upload response did not include an image URL.');
  }

  return {
    showUrl: imageUrl,
    thumbUrl,
    name: payload.name || fileName,
  };
};

export const uploadImageToPixhost = async (file: File): Promise<PixhostUploadResult> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }

  const formData = new FormData();
  formData.append('img', file);
  formData.append('content_type', '0');
  formData.append('max_th_size', '420');
  formData.append('optimize_for_web', '1');

  const uploadEndpoint = PIXHOST_UPLOAD_PROXY_ENDPOINT || PIXHOST_UPLOAD_ENDPOINT;

  let response: Response;
  try {
    response = await fetch(uploadEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    });
  } catch (error) {
    const needsProxy = !PIXHOST_UPLOAD_PROXY_ENDPOINT;
    throw new Error(needsProxy
      ? 'Image upload failed because the browser could not reach Pixhost directly. Pixhost direct browser uploads are likely blocked by CORS, so this needs a small Vercel upload proxy.'
      : `Image upload proxy could not be reached. ${error instanceof Error ? error.message : ''}`.trim());
  }

  const data = await response.json().catch(() => ({})) as PixhostApiResponse;
  if (!response.ok) {
    throw new Error(data.error || data.data?.error || `Pixhost upload failed (${response.status}).`);
  }

  return normalizePixhostResponse(data, file.name);
};
