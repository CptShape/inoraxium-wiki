import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const allowed = new Set(['.env.example', '.env.sample', '.env.template']);
export function isPrivateEnv(path) {
  const name = path.replaceAll('\\', '/').split('/').at(-1).toLowerCase();
  return (name === '.env' || name.startsWith('.env.')) && !allowed.has(name);
}
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function history(ref) {
  return git(['log', '--format=', '--name-only', '-z', '--no-renames', '--diff-filter=ACM', ref, '--', ':(icase).env*', ':(icase,glob)**/.env*']).split('\0').map(path => path.trim()).filter(Boolean);
}
try {
  const mode = process.argv[2] || '--index';
  let files;
  if (mode === '--pre-push') {
    const refs = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split(/\s+/)[1]).filter(sha => !/^0+$/.test(sha));
    files = [...new Set(refs)].flatMap(history);
  } else if (mode === '--history') {
    files = history(process.argv[3] || 'HEAD');
  } else if (mode === '--index') {
    files = git(['ls-files', '-z']).split('\0').filter(Boolean);
  } else {
    throw new Error('Unknown check mode.');
  }
  const blocked = [...new Set(files.filter(isPrivateEnv))];
  if (blocked.length) {
    console.error('Blocked: private environment files must not be committed or pushed.');
    blocked.forEach(path => console.error(`  ${JSON.stringify(path)}`));
    console.error('Keep the local file; remove it from the index with git rm --cached -- <path>. Use a placeholder .env.example for documentation.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Environment file check failed: ${error.message}`);
  process.exitCode = 1;
}
