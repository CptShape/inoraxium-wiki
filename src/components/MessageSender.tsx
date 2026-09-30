import React, { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { apiUrl } from '../lib/api';

const STORAGE_KEY_WEBHOOK = 'messageSenderWebhookUrl';
const STORAGE_KEY_NAME = 'messageSenderName';
const STORAGE_KEY_MESSAGE = 'messageSenderMessage';

export const MessageSender: React.FC = () => {
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem(STORAGE_KEY_WEBHOOK) || '');
  const [name, setName] = useState(() => localStorage.getItem(STORAGE_KEY_NAME) || '');
  const [message, setMessage] = useState(() => localStorage.getItem(STORAGE_KEY_MESSAGE) || '');
  const [status, setStatus] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WEBHOOK, webhookUrl);
  }, [webhookUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_NAME, name);
  }, [name]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_MESSAGE, message);
  }, [message]);

  const canSend = webhookUrl.trim().startsWith('http') && name.trim().length > 0 && message.trim().length > 0 && !isSending;

const sendMessage = async () => {
  if (!canSend) return;

  setIsSending(true);
  setStatus('Sending message to server...');

  try {
    const response = await fetch(apiUrl('/api/send-message'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhookUrl: webhookUrl.trim(), // opsiyonel (backend fallback env de var)
        username: name.trim(),
        message: message.trim(),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(`Server error: ${data.error || response.status}`);
      return;
    }

    setStatus('Message sent.');
    setTimeout(() => setStatus(null), 2500);
  } catch (error) {
    console.error('Failed to send message:', error);
    setStatus('Failed to send message. Check server or network.');
  } finally {
    setIsSending(false);
  }
};

  

  return (
    <div className="w-full p-4 md:p-8 animate-fade-in">
      <div className="mb-6 border-b border-amber-900/30 pb-4">
        <h1
          className="text-4xl md:text-5xl font-bold text-amber-500 tracking-wider mb-2 drop-shadow-md"
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          Message Sender
        </h1>
        <p
          className="text-amber-200/70 text-lg italic"
          style={{ fontFamily: "'IM Fell English', serif" }}
        >
          Send a simple named message to Discord from inside your tools chapter.
        </p>
      </div>

      <div className="rounded-2xl border border-indigo-700/30 bg-indigo-950/10 p-5 shadow-xl">
        <h3
          className="mb-4 flex items-center gap-2 text-lg text-indigo-300"
          style={{ fontFamily: "'Cinzel', serif" }}
        >
          🔗 Discord Integration
        </h3>

        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="mb-1 block text-xs text-stone-400">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full rounded border border-stone-700 bg-stone-900/80 px-3 py-2 text-sm font-mono text-stone-200 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-stone-400">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Dungeon Master"
              className="w-full rounded border border-stone-700 bg-stone-900/80 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-stone-400">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder="Write the message you want to send to Discord..."
              className="w-full resize-y rounded border border-stone-700 bg-stone-900/80 px-3 py-2 text-sm text-amber-100 focus:outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <p
              className="text-xs text-indigo-200/70"
              style={{ fontFamily: "'IM Fell English', serif" }}
            >
              The webhook posts the message using the name you provide above.
            </p>
            <button
              onClick={sendMessage}
              disabled={!canSend}
              className="flex h-[38px] items-center gap-2 rounded-md border border-indigo-700/50 bg-indigo-900/40 px-5 py-2 text-sm font-bold text-indigo-100 shadow-md transition-all hover:bg-indigo-900/60 hover:border-indigo-500/80 disabled:opacity-25 disabled:cursor-not-allowed cursor-pointer"
              style={{ fontFamily: "'Cinzel', serif" }}
            >
              <Send size={14} />
              <span>{isSending ? 'Sending...' : 'Send'}</span>
            </button>
          </div>

          {status && (
            <p
              className="text-xs text-indigo-300/85"
              style={{ fontFamily: "'IM Fell English', serif" }}
            >
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageSender;
