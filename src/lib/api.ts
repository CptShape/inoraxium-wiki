const DEFAULT_DEVELOPMENT_API_ORIGIN = 'https://inoraxium-wiki-three.vercel.app';

const configuredApiOrigin = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '');

const apiOrigin = configuredApiOrigin || (import.meta.env.DEV ? DEFAULT_DEVELOPMENT_API_ORIGIN : '');

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiOrigin}${normalizedPath}`;
};
