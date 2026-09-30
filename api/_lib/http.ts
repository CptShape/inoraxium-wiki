import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://cptshape.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5178',
  'http://127.0.0.1:5178',
]);

const configuredOrigins = () => new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.API_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean),
]);

const requestHost = (req: VercelRequest): string => {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host;
  return typeof host === 'string' ? host.toLowerCase() : '';
};

export function applyApiCors(
  req: VercelRequest,
  res: VercelResponse,
  methods: string,
  allowedHeaders = 'Content-Type',
): boolean {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  let sameOrigin = false;
  if (origin) {
    try { sameOrigin = new URL(origin).host.toLowerCase() === requestHost(req); }
    catch { sameOrigin = false; }
  }
  const allowed = !origin || sameOrigin || configuredOrigins().has(origin);
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
  return allowed;
}

export function resolveDiscordWebhook(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    const discordHost = host === 'discord.com'
      || host.endsWith('.discord.com')
      || host === 'discordapp.com'
      || host.endsWith('.discordapp.com');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !discordHost) return null;
    if (!/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
