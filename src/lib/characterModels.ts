import { useEffect, useState } from 'react';

export interface CharacterModelAsset {
  path: string;
  bytes: number;
}

export function characterModelUrl(modelPath: string): string {
  return `${import.meta.env.BASE_URL}models/${modelPath.split('/').map(encodeURIComponent).join('/')}`;
}

export function isCharacterModelAsset(value: unknown): value is CharacterModelAsset {
  if (!value || typeof value !== 'object') return false;
  const model = value as CharacterModelAsset;
  return typeof model.path === 'string' && /\.(glb|fbx)$/i.test(model.path)
    && !model.path.split('/').some(segment => !segment || segment === '.' || segment === '..')
    && !/[\\:]/.test(model.path) && Number.isFinite(model.bytes) && model.bytes >= 0;
}

export function useCharacterModels() {
  const [models, setModels] = useState<CharacterModelAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetch(`${import.meta.env.BASE_URL}models/index.json`, { signal: controller.signal, cache: 'no-cache' })
      .then(async response => {
        if (!response.ok) throw new Error('Catalog unavailable');
        const entries: unknown = await response.json();
        if (!Array.isArray(entries) || !entries.every(isCharacterModelAsset)) throw new Error('Invalid catalog');
        if (!controller.signal.aborted) setModels(entries);
      })
      .catch(() => { if (!controller.signal.aborted) setError('The 3D model library could not be loaded. Try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return { models, loading, error, reload: () => setRevision(value => value + 1) };
}
