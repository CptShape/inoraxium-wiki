# Global Gallery

Open **Tools → Gallery** (`#tools/gallery`). The gallery uses the existing
Imgur album importer and Pixhost upload proxy, with shared image metadata and a
shared tag library in Firestore.

## Search and tags

`ayrton_octappen splash_art -nsfw` requires both positive tags and excludes
every image tagged `nsfw`. Search updates as you type. Autocomplete operates on
the token at the caret, including negative tokens. Use Up/Down and Enter/Tab,
or click a suggestion. Tag names are lowercase with underscores between words.
The legacy `splash-art` tag is searchable as `splash_art`.

The sidebar contains every known tag, grouped into **Character**, **Meta**,
**General Tags**, and **Character Specific**. Click to cycle through include
(green), exclude (red), and neutral. Double-click explicitly excludes a tag.
The sidebar, search field, and removable filter chips stay synchronized.
The copy button copies a shareable URL with the search included.

Use **Tag library** to change existing tags' categories. Create new tags while
uploading or editing an image. Tags with zero global image usage disappear from
search, autocomplete and the tag library automatically. Local guest records are
pruned on save/delete; an authenticated administrator also removes unused shared
tag definitions after fresh usage checks, including public legacy galleries.
Cleanup waits for all gallery subscriptions before considering a tag unused.

## Uploading and viewing

**Add images** accepts:

- Single or multiple image files, uploaded with the existing Pixhost proxy.
- Single or multiple direct image URLs and Imgur single-image links.
- Pixhost BBCode or Markdown blocks containing thumbnails.
- Standalone Pixhost `/show/…` links, resolved through `api/pixhost-image.ts`.
- Imgur albums, imported with the existing `api/imgur-album` helper.

Review the preview queue before publishing. Select/create tags for each image
independently; common tags can be added to all queued images. New tag creation
includes a category selector. The queue supports labels, removing individual
items, duplicate URL detection, and up to 100 images per save. Original upload
quality is enabled by default. Failed uploads keep the queue; successfully
uploaded files are reused on retry. Metadata is published only after all files
are ready, in one Firestore batch with the associated tag definitions.

Open a card for the large viewer, next/previous navigation (also Left/Right),
zoom, fit, original-image link, and tags. Uploaders can edit their own image
labels/tags or delete their records. Administrators can edit any image's tags in
the viewer's side panel, including images from public legacy character galleries.
Admin tag updates preserve the original uploader and other image fields. Tags
inherited from a character connection are listed separately; change that
connection to remove them. Deletion does not remove the file from the
external image host. The grid has sorting, two densities, lazy images and
incremental loading. On phones, both site navigation and the tag panel collapse.

## Character galleries

In **Character Sheet → BIO → Gallery**, select one or more **Character gallery
tags** using the checkboxes, then save the character. An image matches if it has
any selected tag; matching multiple selected tags does not duplicate it.
Matching global images appear immediately in the editor's
linked-image grid and in the Homebrew character gallery. Future global uploads
with that tag appear automatically, regardless of who uploaded them.
Original character gallery images remain available; matching URLs are merged
in the Homebrew gallery. Clearing all selected tags disconnects the global images.

Public legacy character galleries are also visible in the global archive,
without copying their records. Their images link back to the character gallery
and remain editable in the original character sheet. **Private legacy
characters are never added to the public archive.** Main portrait, Splash Art
and Token selections on the character sheet keep their existing behavior.

Linked global image cards have the same **Main**, **Splash Art**, and **Token**
buttons. These are character-local choices: selecting a role stores a reference
in the character's gallery and updates its existing portrait/overview fields.
It does not alter the global image's tags, reupload the file, or announce it as a
new upload. A referenced image appears once while linked. If the connection is
cleared, selected role references remain in the character's own gallery.

## Storage and release

- Shared collections: `galleryImages` and `galleryTags`.
- Global images are publicly readable. Authenticated users can publish images
  under their own UID; only the uploader or an administrator can change/delete
  an image. Authenticated users can create tags or change categories.
- Local guest mode stores metadata in `eldritchGalleryV1` in this browser and
  clearly labels the save as local. Failed remote writes do not silently turn
  into successful local saves.
- Character field: `galleryCharacterTags`. Existing `galleryCharacterTag`
  selections are read automatically; the first selected tag is also written to
  the old field for compatibility. An explicit empty array clears old selections.

The site build and the API deployment must include the new files. The new
Firestore collection permissions must also be published; a GitHub Pages build
does not deploy Firestore rules. `firebase.json` points to `firestore.rules`:

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules --project ulunavir-wiki
```

No usable Firebase CLI login was available during implementation, so live rules
were not read or deployed. The new rules were compiled and exercised in the
local Firestore emulator against the `demo-gallery-rules` project, without
accessing production image/character data.

## Validation

- 41 unit checks cover parsing, autocomplete replacement, query matching,
  legacy privacy/deduplication, atomic remote metadata writes, ownership,
  guest persistence, admin edits of global/legacy images, multiple character tags,
  role selection without global mutations, unused tag cleanup, and the Pixhost
  resolver's allowed hosts.
- 14 Playwright stories cover search, sidebar states, keyboard/lightbox behavior,
  per-image tags, uploads/imports, retries, tag categories, persistence, character
  binding, new global uploads appearing live, admin tag editing, viewer restrictions,
  multiple character tags, linked image roles, unused tags and mobile layout.
- 50 local emulator checks cover public reads, authenticated batch creation,
  uploader updates/deletion, admin tag edits, denied cross-user writes,
  immutable uploader identity and invalid metadata.
- Production build and API TypeScript check passed. The repository-wide
  TypeScript check has pre-existing errors (including the installed TypeScript
  version rejecting `ignoreDeprecations: "6.0"`); with that option overridden,
  no errors were reported in the new gallery modules.

```powershell
npx vitest run src/lib/gallery.test.ts src/lib/galleryPersistence.test.ts src/lib/pixhostResolver.test.ts
npx playwright test --config playwright.demo-game.config.ts gallery.spec.ts
npm run typecheck:api
```

## Character image tags

Click a character image, right-click it, or use **Edit tags** to open the shared
tag editor. Global tags autocomplete from Character, Meta and General categories;
new tags are created alongside the image publication. **Save tags** immediately
saves the image tags without saving unrelated sheet drafts. Adding a shared tag
to an old private character image publishes that image to the public gallery,
while the character remains private. Existing linked posts retain their uploader.
Character owners can add local tags to other users' linked images; changing their
shared tags requires uploader or admin access.

Character Specific tags are stored separately in `characterSpecificTags` and do
not enter shared image tags or `galleryTags`. Legacy character-specific tags are
moved to that field when edited. Main, Splash Art and Token remain local roles.
The character image and shared publication are written in one Firestore
transaction. A URL-derived identifier prevents duplicate publication on retries.

## Favorites, likes, rockets and paging

Each gallery card and the image viewer have Favorite, Like and Rocket buttons.
Favorites combine with the tag search and exclusions. A like toggles on/off and
the displayed count is shared across users. Every Rocket click increments only
that user's counter; there is no shared rocket count. Rapid clicks are queued.
Image identity uses a hash of its resolved URL, so legacy-to-global publication
retains reactions. Pages contain 50 images; changing filters resets page 1.

`users/{uid}/galleryReactions/{imageKey}` stores private favorites, liked state
and rockets. `galleryLikeCounts/{imageKey}` exposes only the total likes. Firestore
transactions and `getAfter` rules bind count changes to the acting user's like;
favorite/rocket updates cannot change other users' data or forge totals. A stale
reaction transaction retries only when a fresh read proves a concurrent state change.
Publish the updated `firestore.rules` alongside this release. Guest reactions are
stored in `eldritchGalleryReactionsV1` in the current browser.

New authenticated uploads call `/api/announce-gallery-images` with global scope,
uploader name, a gallery link and direct image URLs after successful publication.
The endpoint uses the existing `DISCORD_ANNOUNCEMENT_WEBHOOK_URL`. Editing metadata
or saving guest images does not announce. If Discord fails, images stay published
and the upload dialog offers a separate announcement retry without reuploading or
republishing. Completed Discord chunks are skipped on a retry when the API has
reported them; a lost network response cannot guarantee deduplication at Discord.
Tests stub the announcement endpoint / webhook and do not send live messages.
