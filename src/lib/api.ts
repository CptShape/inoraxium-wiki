const LEGACY_DEVELOPMENT_API_ORIGIN = 'https://ulunavir-vercel.vercel.app';

const configuredApiOrigin = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '');

const apiOrigin = configuredApiOrigin || (import.meta.env.DEV ? LEGACY_DEVELOPMENT_API_ORIGIN : '');

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiOrigin}${normalizedPath}`;
};
