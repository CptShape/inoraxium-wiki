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

## Workspace name and workspace id

In the visual editor, the right sidebar has a `Workspace` panel with:

- `Workspace name`
- `Workspace id`

How they are used:

- `Workspace name`
  A human-readable label shown in the editor and stored in the export manifest.
- `Workspace id`
  The stable technical identity for the workspace.
  This is what the importer uses to decide whether an export should replace an existing imported workspace or create a new one.

Important rule:

- if you are updating an existing imported workspace, keep the same `Workspace id`

The editor also has a `Match name` button to regenerate the id from the current workspace name.

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

## How to list imported workspaces

Run:

```powershell
npm run list:user-pages
```

That prints every imported workspace from both systems with:

- system
- workspace id
- workspace title
- page count
- page ids
- storage path

To list only one system:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/list-user-workspaces.ps1 -System inoraxium
```

or:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/list-user-workspaces.ps1 -System horaghfus
```

## How to delete an imported workspace

Run:

```powershell
npm run delete:user-pages -- -System inoraxium -WorkspaceId darth-maul
```

or:

```powershell
npm run delete:user-pages -- -System horaghfus -WorkspaceId example-workspace
```

This deletes:

- the workspace folder under `src/data/<system>/user-pages/workspaces/<workspace-id>/`
- all matching entries from that system's `registry.json`

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

Imported workspaces now appear in the visual editor under `Imported Workspaces`.

When an editor clicks one:

- its pages are loaded into `Created Pages`
- the workspace name and workspace id are restored
- the pages can be edited and exported again

To update an existing imported workspace instead of creating a second copy:

- load the existing imported workspace
- keep the same `Workspace id`
- export again
- run `npm run import:user-pages -- "<path-to-new-zip>"`

The importer replaces the whole matching workspace for that system.

That means:

- edited pages are updated
- newly added pages are added
- removed pages are deleted from that imported workspace
