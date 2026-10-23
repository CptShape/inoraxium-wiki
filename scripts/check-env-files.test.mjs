import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const guard = resolve('scripts/check-env-files.mjs');
function fixture(run) {
  const root = mkdtempSync(resolve(tmpdir(), 'env-guard-'));
  const git = args => { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  const check = (args = ['--index'], input) => spawnSync(process.execPath, [guard, ...args], { cwd: root, encoding: 'utf8', input });
  try { git(['init', '-q']); git(['config', 'user.name', 'Guard Test']); git(['config', 'user.email', 'test@example.invalid']); run({ root, git, check }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}
test('blocks a force-added .env without exposing its values', () => fixture(({ root, git, check }) => {
  writeFileSync(resolve(root, '.gitignore'), '.env\n'); writeFileSync(resolve(root, '.env'), 'PRIVATE_VALUE=do-not-print\n'); git(['add', '-f', '.env']);
  const result = check(); assert.equal(result.status, 1); assert.match(result.stderr, /\.env/); assert.doesNotMatch(result.stderr, /do-not-print/);
}));
test('blocks nested environment variants and uppercase names', () => fixture(({ root, git, check }) => {
  mkdirSync(resolve(root, 'nested')); writeFileSync(resolve(root, 'nested/.ENV.production'), 'DUMMY=value'); git(['add', '.']); assert.equal(check().status, 1);
}));
test('permits documented placeholder templates and ignored local files', () => fixture(({ root, git, check }) => {
  writeFileSync(resolve(root, '.gitignore'), '.env\n'); writeFileSync(resolve(root, '.env'), 'DUMMY=local'); writeFileSync(resolve(root, '.env.example'), 'DUMMY='); git(['add', '.']); assert.equal(check().status, 0);
}));
test('blocks old committed .env files even after they were removed', () => fixture(({ root, git, check }) => {
  writeFileSync(resolve(root, '.env'), 'DUMMY=old'); git(['add', '.']); git(['commit', '-qm', 'bad history']); git(['rm', '-q', '.env']); git(['commit', '-qm', 'remove file']); assert.equal(check(['--history', 'HEAD']).status, 1);
  const sha = git(['rev-parse', 'HEAD']); assert.equal(check(['--pre-push'], `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`).status, 1);
}));
test('permits a clean branch push and branch deletion', () => fixture(({ root, git, check }) => {
  writeFileSync(resolve(root, '.env.example'), 'DUMMY='); git(['add', '.']); git(['commit', '-qm', 'template']); const sha = git(['rev-parse', 'HEAD']); assert.equal(check(['--pre-push'], `refs/heads/main ${sha} refs/heads/main ${'0'.repeat(40)}\n`).status, 0); assert.equal(check(['--pre-push'], `refs/heads/old ${'0'.repeat(40)} refs/heads/old ${sha}\n`).status, 0);
}));
