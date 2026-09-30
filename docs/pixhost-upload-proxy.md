# Pixhost Upload Proxy

The character sheet uploads item/spell homebrew images to Pixhost. Browser-side uploads can fail with `Failed to fetch` when Pixhost does not allow CORS from the site origin, so the production-safe setup is to proxy the upload through the Vercel backend.

## Frontend Configuration

The GitHub Pages build uses the shared API origin:

```env
VITE_API_BASE_URL=https://inoraxium-wiki-three.vercel.app
```

The upload endpoint is derived automatically as `${VITE_API_BASE_URL}/api/upload-pixhost-image`. A separate `VITE_PIXHOST_UPLOAD_PROXY_URL` value is optional and should only be used to override that endpoint.

In a Vercel-hosted frontend build, `VITE_API_BASE_URL` can remain unset because the frontend and API share the same origin. Local development falls back to the production Vercel API when no override is configured.

## Backend

The proxy implementation and CORS policy live in:

- `api/upload-pixhost-image.ts`
- `api/_lib/http.ts`

GitHub Pages (`https://cptshape.github.io`) and the standard local development origins are allowed by default. Additional frontend origins can be supplied through the server-only `API_ALLOWED_ORIGINS` Vercel environment variable.
