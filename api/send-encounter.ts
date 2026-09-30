import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors, resolveDiscordWebhook } from './_lib/http';

type CombatantStatus = 'fighting' | 'stunned' | 'unknown' | 'defeated';

interface CombatantPayload {
  name: string;
  initiative: string;
  status: CombatantStatus;
}

const statusLabel: Record<CombatantStatus, string> = {
  fighting: 'Fighting',
  stunned: 'Stunned',
  unknown: 'Unknown',
  defeated: 'Defeated',
};

const statusIcon: Record<CombatantStatus, string> = {
  fighting: '⚔️',
  stunned: '⚡',
  unknown: '❓',
  defeated: '💀',
};

const normalizeStatus = (status: unknown): CombatantStatus => {
  if (status === 'stunned' || status === 'unknown' || status === 'defeated') return status;
  return 'fighting';
};

const formatCombatantLine = (combatant: CombatantPayload, index: number) => {
  const name = combatant.name?.trim() || 'Unnamed Combatant';
  const initiative = combatant.initiative?.trim() || '0';
  const status = normalizeStatus(combatant.status);

  return `**${index + 1}.** ${statusIcon[status]} **${name}** — Initiative: \`${initiative}\` — *${statusLabel[status]}*`;
};

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

  const { webhookUrl, type, description, combatants } = req.body as {
    webhookUrl?: string;
    type?: 'start' | 'end';
    description?: string;
    combatants?: CombatantPayload[];
  };

  const targetWebhook = resolveDiscordWebhook(webhookUrl || process.env.DISCORD_WEBHOOK_URL);
  if (!targetWebhook) {
    return res.status(400).json({ error: 'Webhook URL missing.' });
  }

  if (!Array.isArray(combatants) || combatants.length === 0) {
    return res.status(400).json({ error: 'No combatants were provided.' });
  }

  const isEnd = type === 'end';
  const title = isEnd ? '🏁 Encounter Ended' : '⚔️ Encounter Started!';
  const color = isEnd ? 0x7f1d1d : 0xb52a1f;

  const safeDescription = description?.trim() || (isEnd
    ? 'The combat encounter has ended.'
    : 'A new combat encounter has begun.');

  const fields = isEnd
    ? [
        {
          name: '💀 Defeated',
          value: combatants
            .filter((c) => normalizeStatus(c.status) === 'defeated')
            .map(formatCombatantLine)
            .join('\n') || '_None_',
          inline: false,
        },
        {
          name: '🛡️ Survived',
          value: combatants
            .filter((c) => normalizeStatus(c.status) !== 'defeated')
            .map(formatCombatantLine)
            .join('\n') || '_None_',
          inline: false,
        },
      ]
    : [
        {
          name: 'Initiative Order',
          value: combatants.map(formatCombatantLine).join('\n').slice(0, 4000),
          inline: false,
        },
      ];

  const embed = {
    title,
    description: safeDescription.slice(0, 2048),
    color,
    fields: fields.map((field) => ({
      ...field,
      value: field.value.slice(0, 1024),
    })),
    timestamp: new Date().toISOString(),
    footer: { text: 'Eldritch Grimoire Battle Tracker' },
  };

  try {
    const response = await fetch(targetWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Battle Master',
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      return res.status(response.status).json({ error: `Discord rejected the payload: ${errorText}` });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({
      error: `Server failed to connect to Discord: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
