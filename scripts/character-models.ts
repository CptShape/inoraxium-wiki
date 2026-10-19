import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Public assets retain stable filenames, so saved character selections survive builds.
export function characterModelsPlugin(): Plugin {
  let directory = '';
  let base = '/';
  const catalog = () => {
    const models: Array<{ path: string; bytes: number }> = [];
    const scan = (relative = '') => {
      for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
        const name = path.posix.join(relative, entry.name);
        if (entry.isDirectory()) scan(name);
        else if (entry.isFile() && /\.(glb|fbx)$/i.test(name)) {
          models.push({ path: name, bytes: statSync(path.join(directory, name)).size });
        }
      }
    };
    scan();
    return JSON.stringify(models.sort((a, b) => a.path.localeCompare(b.path, 'en')));
  };
  return {
    name: 'character-model-catalog',
    configResolved(config) {
      directory = path.join(config.publicDir, 'models');
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split('?')[0];
        if (url !== `${base}models/index.json` && url !== '/models/index.json') return next();
        try {
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(catalog());
        } catch (error) { next(error); }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'models/index.json', source: catalog() });
    },
  };
}
