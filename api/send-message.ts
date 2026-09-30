import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors, resolveDiscordWebhook } from './_lib/http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyApiCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { webhookUrl, message, username } = req.body as {
    webhookUrl?: string;
    message?: string;
    username?: string;
  };

  const targetWebhook = resolveDiscordWebhook(webhookUrl || process.env.DISCORD_WEBHOOK_URL);

  if (!targetWebhook) {
    return res.status(400).json({ error: 'Webhook URL missing.' });
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const safeMessage = message.trim().slice(0, 4096); // embed description limiti

  const embed = {
    description: safeMessage,
    color: 0x00ffff, // 💧 aqua
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(targetWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username?.trim() || 'Battle Master',
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return res.status(response.status).json({
        error: `Discord rejected the payload: ${errorText}`,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      error: `Server failed to connect to Discord: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    });
  }
}
