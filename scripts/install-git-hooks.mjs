import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, chmodSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.CI) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const repository = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (repository.status !== 0 || resolve(repository.stdout.trim()).toLowerCase() !== root.toLowerCase()) process.exit(0);
  const common = resolve(root, git(['rev-parse', '--git-common-dir']));
  const hooks = resolve(common, 'env-safety-hooks');
  const config = spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  if (config.status !== 0 && config.status !== 1) throw new Error('Cannot inspect existing Git hooks configuration.');
  const existing = config.stdout.trim();
  if (existing && resolve(root, existing) !== hooks) throw new Error('Custom Git hooks already configured; integrate the environment checks before replacing them.');
  mkdirSync(hooks, { recursive: true });
  copyFileSync(resolve(root, 'scripts/check-env-files.mjs'), resolve(hooks, 'check-env-files.mjs'));
  for (const name of ['pre-commit', 'pre-push']) {
    copyFileSync(resolve(root, '.githooks', name), resolve(hooks, name));
    chmodSync(resolve(hooks, name), 0o755);
  }
  git(['config', '--local', 'core.hooksPath', hooks.replaceAll('\\', '/')]);
  // Keep the ignore rules active even when checking out an old branch.
  const exclude = resolve(common, 'info/exclude');
  if (!readFileSync(exclude, 'utf8').includes('# Private environment files')) appendFileSync(exclude, '\n# Private environment files\n.env\n.env.*\n!.env.example\n!.env.sample\n!.env.template\n');
  console.log('Environment file commit/push guards installed for all local branches.');
}
