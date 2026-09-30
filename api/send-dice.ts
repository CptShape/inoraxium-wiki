import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors, resolveDiscordWebhook } from './_lib/http.js';

// Vercel serverless function to securely forward dice rolls to Discord.
// This hides the Webhook URL from the client browser and prevents spam.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    
  if (!applyApiCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { webhookUrl: clientWebhookUrl, characterName, result } = req.body;

  // Use client-supplied webhook if available, otherwise fall back to server environment variable
  const webhookUrl = resolveDiscordWebhook(clientWebhookUrl || process.env.DISCORD_WEBHOOK_URL);

  if (!webhookUrl) {
    return res.status(400).json({
      error: 'Webhook URL not provided by client, and no default DISCORD_WEBHOOK_URL is set in the Vercel dashboard.',
    });
  }

  if (!result || !result.macroName) {
    return res.status(400).json({ error: 'Invalid payload: missing roll result data.' });
  }

  // Strip emoji from step labels for Discord (they can cause encoding issues)
  const cleanLabel = (s: string) => s.replace(/[🎲📊❌🔄🏆💀⚡]/g, '').trim();

  const breakdownText = result.steps
    .map((s: any) => `${cleanLabel(s.label)} = **${s.value}**${s.detail ? ` _(${s.detail})_` : ''}`)
    .join('\n')
    .slice(0, 1024);

  // Construct the rich embed
  const embed = {
    title: `🎲 ${result.macroName}`,
    color: 0xf59e0b, // amber
    fields: [
      ...(result.description ? [{
        name: 'Description',
        value: result.description,
        inline: false,
      }] : []),
      {
        name: 'Formula',
        value: `\`${result.formula}\``,
        inline: false,
      },
      {
        name: 'Result',
        value: `**${result.total}**`,
        inline: true,
      },
      ...(breakdownText ? [{
        name: 'Breakdown',
        value: breakdownText,
        inline: false,
      }] : []),
    ],
    timestamp: new Date(result.timestamp).toISOString(),
    footer: {
      text: characterName ? `Rolled by ${characterName}` : 'Eldritch Grimoire Dice',
    },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: (characterName || 'Dice Roller').slice(0, 80),
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Discord rejected the payload: ${errorText}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({
      error: `Server failed to connect to Discord: ${err instanceof Error ? err.message : 'Unknown network error'}`,
    });
  }
}

