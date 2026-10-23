# Private environment files

`.env` was tracked before it was ignored. Ignore rules do not stop Git from
recording changes to files already in its index. The historical `.env` entries
were removed from every branch; the local file was restored without changes.

Keep real values in ignored `.env` or `.env.local` files. Only placeholder
templates named `.env.example`, `.env.sample` or `.env.template` may be tracked.

`npm install` / `npm ci` installs the versioned commit and push guards locally
through the `prepare` script (CI skips installation). The installed guards live
inside Git's common directory, so checking out an old branch does not disable
them. A repository-local exclude also ignores environment files on old branches.
Existing custom hook configurations are not silently overwritten.

The commit guard rejects tracked private environment files, including files
added with `git add -f`. The push guard scans the full history of every outgoing
branch to stop old secret-bearing commits from being reintroduced. A GitHub
Actions check repeats the index and history checks remotely. Git hooks can be
deliberately bypassed, so they supplement proper secret handling.

Run the checks manually:

```sh
node scripts/install-git-hooks.mjs
node scripts/check-env-files.mjs --index
node scripts/check-env-files.mjs --history HEAD
node --test scripts/check-env-files.test.mjs
```

After a history rewrite, use a fresh clone on other computers. Do not merge or
push the old history back into the repository. Local recovery backups stay in
the ignored `.artifacts/demo-game/` directory and must never be uploaded.

History removal does not revoke a disclosed credential or clear GitHub's cached
commit views. Rotate the exposed Discord announcement webhook, update the local
and Vercel settings, and ask GitHub Support to remove cached views if old commit
URLs still expose the file. Firebase browser configuration (`VITE_FIREBASE_*`)
is public client configuration; protect the database with its security rules.
