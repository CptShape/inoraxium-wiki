# Pixhost Upload Proxy

The character sheet uploads item/spell homebrew images to Pixhost. Browser-side uploads can fail with `Failed to fetch` when Pixhost does not allow CORS from the site origin, so the production-safe setup is to proxy the upload through the Vercel backend.

## Frontend Setting

Add this Vite env value before building the GitHub Pages frontend:

```env
VITE_PIXHOST_UPLOAD_PROXY_URL=https://ulunavir-vercel.vercel.app/api/upload-pixhost-image
```

If this env value is missing, the frontend tries `https://api.pixhost.to/images` directly. That can work only if Pixhost allows browser CORS for the current origin.

## Vercel Endpoint

Create this endpoint in the Vercel project:

```ts
// api/upload-pixhost-image.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = {
  api: {
    bodyParser: false,
  },
};

const allowOrigin = (req: VercelRequest, res: VercelResponse) => {
  const origin = req.headers.origin || '';
  const allowedOrigins = new Set([
    'http://localhost:5173',
    'https://cptshape.github.io',
  ]);

  if (allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  allowOrigin(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const contentType = req.headers['content-type'];
  if (!contentType) {
    return res.status(400).json({ error: 'Missing multipart content type.' });
  }

  const pixhostResponse = await fetch('https://api.pixhost.to/images', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': contentType,
    },
    body: Buffer.concat(chunks),
  });

  const text = await pixhostResponse.text();
  res.status(pixhostResponse.status);
  res.setHeader('Content-Type', pixhostResponse.headers.get('content-type') || 'application/json; charset=utf-8');
  return res.send(text);
}
```

## Codex Prompt For The Vercel Project

Use this prompt in the Vercel project agent:

```text
Add a Vercel API route at /api/upload-pixhost-image that accepts multipart/form-data image uploads from my static frontend, forwards the exact multipart body to https://api.pixhost.to/images, and returns Pixhost's JSON response. Disable Vercel bodyParser for this route so the multipart body is not consumed. Add CORS for http://localhost:5173 and https://cptshape.github.io. The frontend sends img, content_type, max_th_size, and optimize_for_web fields.
```

After the endpoint is deployed, rebuild the frontend with `VITE_PIXHOST_UPLOAD_PROXY_URL` set to that endpoint.
