import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors, resolveDiscordWebhook } from './_lib/http.js';

interface GalleryAnnouncementPayload {
  userName?: unknown;
  characterName?: unknown;
  galleryUrl?: unknown;
  imageUrls?: unknown;
}

const MAX_IMAGES_PER_REQUEST = 100;
const MAX_EMBEDS_PER_MESSAGE = 10;

const cleanText = (value: unknown, fallback: string, maxLength: number): string => {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[\r\n]+/g, ' ');
  return cleaned ? cleaned.slice(0, maxLength) : fallback;
};

const escapeDiscordMarkdown = (value: string): string => (
  value.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, '\\$1').replace(/@/g, '@\u200b')
);

const parseHttpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const parseImageUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const candidate of value.slice(0, MAX_IMAGES_PER_REQUEST)) {
    const url = parseHttpUrl(candidate);
    if (url) unique.add(url);
  }
  return [...unique];
};

const chunk = <T,>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyApiCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const webhookUrl = resolveDiscordWebhook(process.env.DISCORD_ANNOUNCEMENT_WEBHOOK_URL);
  if (!webhookUrl) {
    return res.status(500).json({ error: 'DISCORD_ANNOUNCEMENT_WEBHOOK_URL is not configured.' });
  }

  const body = (req.body || {}) as GalleryAnnouncementPayload;
  const galleryUrl = parseHttpUrl(body.galleryUrl);
  const imageUrls = parseImageUrls(body.imageUrls);
  if (!galleryUrl || imageUrls.length === 0) {
    return res.status(400).json({ error: 'A valid galleryUrl and at least one image URL are required.' });
  }

  const userName = escapeDiscordMarkdown(cleanText(body.userName, 'Bir kullanıcı', 120));
  const characterName = escapeDiscordMarkdown(cleanText(body.characterName, 'İsimsiz karakter', 120));
  const description = [
    `**${userName} kullanıcısı**`,
    `${characterName} karakterinin galerisine yeni ekleme yapmıştır.`,
    '',
    `[Galeriye git](${galleryUrl})`,
  ].join('\n');

  try {
    for (const imageChunk of chunk(imageUrls, MAX_EMBEDS_PER_MESSAGE)) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Gallery Announcements',
          allowed_mentions: { parse: [] },
          embeds: imageChunk.map(imageUrl => ({
            title: 'Yeni Galeri Görseli',
            description,
            color: 0x22c55e,
            image: { url: imageUrl },
            timestamp: new Date().toISOString(),
          })),
        }),
      });

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        return res.status(502).json({
          error: `Discord rejected the gallery announcement (${response.status}).`,
          details: details.slice(0, 500),
        });
      }
    }

    return res.status(200).json({ success: true, announcedImages: imageUrls.length });
  } catch (error) {
    return res.status(502).json({
      error: `Failed to send gallery announcement: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
