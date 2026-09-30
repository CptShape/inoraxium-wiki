import { Readable } from 'node:stream';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyApiCors } from './_lib/http.js';

const PIXHOST_UPLOAD_URL = 'https://api.pixhost.to/images';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!applyApiCors(req, res, 'POST, OPTIONS')) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return res.status(400).json({ error: 'Content-Type must be multipart/form-data.' });
  }

  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };
  const contentLength = req.headers['content-length'];

  if (typeof contentLength === 'string') {
    headers['Content-Length'] = contentLength;
  }

  try {
    // bodyParser is disabled so this forwards the original multipart bytes and boundary unchanged.
    const pixhostResponse = await fetch(PIXHOST_UPLOAD_URL, {
      method: 'POST',
      headers,
      body: Readable.toWeb(req) as ReadableStream,
      duplex: 'half',
    } as RequestInit);
    const responseBody = Buffer.from(await pixhostResponse.arrayBuffer());
    const responseContentType = pixhostResponse.headers.get('content-type');

    res.status(pixhostResponse.status);
    res.setHeader('Content-Type', responseContentType ?? 'application/json');
    return res.send(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(502).json({ error: `Failed to upload image to Pixhost: ${message}` });
  }
}

