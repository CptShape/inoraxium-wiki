# Page Editor Export Workflow

This project now supports repo-side importing for exported user page workspaces.

The key idea is:

- official hand-authored chapters stay in code
- imported user pages stay isolated under each system's `user-pages` folder
- imported user pages are registered through `registry.json`, not per-page `.ts` files

## Granting editor access

The app checks Firebase for one of these documents:

- `editorPermissions/{uid}`
- `userPermissions/{uid}`
- `users/{uid}`

The document can grant access with any one of these shapes:

```json
{ "canEdit": true }
```

```json
{ "edit": true }
```

```json
{ "role": "editor" }
```

```json
{ "roles": ["editor"] }
```

```json
{ "permissions": ["edit"] }
```

You can also allow specific users with:

```env
VITE_EDITOR_UIDS=uid1,uid2
```

## What the editor exports

When a user clicks `Export Workspace ZIP`, the editor downloads a workspace package like:

```text
workspace-name-export/
  manifest.json
  publish-info.txt
  pages/
    page-a/
      page.md
      body.md
      assets/
        image-1.png
    page-b/
      page.md
      body.md
      assets/
        image-2.jpg
```

### File meanings

- `manifest.json`
  Contains page metadata such as `id`, `title`, `system`, `parentId`, sidebar visibility, width, and infobox configuration.
- `pages/<page-id>/page.md`
  The final compiled markdown for that page, including the generated `<infobox>` block plus the main body text.
- `pages/<page-id>/body.md`
  Only the main body content.
- `pages/<page-id>/assets/*`
  Uploaded image files used by that page.

## Where imported user pages live

Imported user pages are kept per system so they do not interfere with hand-authored code chapters.

### Inoraxium

- `src/data/inoraxium/user-pages/registry.json`
- `src/data/inoraxium/user-pages/workspaces/<workspace-id>/<page-id>/page.md`
- `src/data/inoraxium/user-pages/workspaces/<workspace-id>/<page-id>/body.md`
- `src/data/inoraxium/user-pages/workspaces/<workspace-id>/<page-id>/assets/*`

### Horaghfus

- `src/data/horaghfus/user-pages/registry.json`
- `src/data/horaghfus/user-pages/workspaces/<workspace-id>/<page-id>/page.md`
- `src/data/horaghfus/user-pages/workspaces/<workspace-id>/<page-id>/body.md`
- `src/data/horaghfus/user-pages/workspaces/<workspace-id>/<page-id>/assets/*`

## How to import a user workspace

Run:

```powershell
npm run import:user-pages -- "C:\path\to\workspace-export.zip"
```

You can also pass an already extracted export folder:

```powershell
npm run import:user-pages -- "C:\path\to\workspace-export"
```

## What the importer does

The importer:

1. reads `manifest.json`
2. detects each page's target system
3. copies markdown and assets into that system's `user-pages/workspaces/...` folder
4. updates that system's `registry.json`
5. removes older entries for the same imported workspace before replacing them

This means you do **not** need to:

- create one `.ts` file per page
- manually add imports to `src/data/inoraxium/chapters.ts`
- manually add imports to `src/data/horaghfus/chapters.ts`

The app now reads imported user pages from the per-system registries automatically.

## How imported pages appear in the site

At runtime:

- `src/data/inoraxium/chapters.ts` merges `src/data/inoraxium/user-pages/registry.json`
- `src/data/horaghfus/chapters.ts` merges `src/data/horaghfus/user-pages/registry.json`

Each imported page can be:

- visible in the sidebar if `sidebarVisible` is `true`
- hidden but still linkable if `sidebarVisible` is `false`

Imported pages can also use `parentId` to attach themselves under another chapter.

## Recommended content rules for editors

- Page `id` should stay stable within its system.
- Internal links should use:

```html
<a href="#" data-go-chapter="target-id">Link text</a>
```

- Links to a specific part should use:

```html
<a href="#" data-go-chapter="target-id" data-go-chapter-part="target-part">Link text</a>
```

- Page section anchors should use:

```html
<h2 data-part="target-part">Section Title</h2>
```

- Infoboxes are already compiled into `page.md` by the editor export.

## Editing imported workspaces later

The next recommended step is loading imported workspaces back into the visual editor.

The registry now stores:

- `workspaceId`
- `workspaceTitle`
- page metadata
- content path

That will make it possible for the editor to show existing imported workspaces and let users revise them instead of rebuilding from scratch.

That part is not fully implemented yet, but the import structure is now designed for it.

