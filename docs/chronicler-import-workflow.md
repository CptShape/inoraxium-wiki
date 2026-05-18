# Chronicler Import Workflow

This project can now import a Chronicler vault folder or a zipped Chronicler vault directly into a site workspace.

The goal of this importer is:

- keep Chronicler as the authoring tool
- keep this website as the published reader-facing wiki
- avoid hand-registering every page with TypeScript imports

## Command

Import a Chronicler vault into a system with:

```powershell
npm run import:chronicler -- "C:\path\to\ChroniclerVault" -System inoraxium
```

or with a zip:

```powershell
npm run import:chronicler -- "C:\path\to\ChroniclerVault.zip" -System horaghfus
```

Optional overrides:

```powershell
npm run import:chronicler -- "C:\path\to\ChroniclerVault.zip" -System inoraxium -WorkspaceTitle "My Imported Vault" -WorkspaceId imported-vault
```

## What the importer does

The importer:

1. extracts the zip if needed
2. scans the Chronicler vault recursively
3. ignores known non-content folders like `.obsidian` and `_system`
4. imports every markdown file as a user page
5. copies vault assets into the workspace asset folder
6. keeps imported pages hidden by default and exposes only `main.md` in the sidebar
7. rewrites common image references to workspace-safe `assets/...` paths
8. registers everything in:

- `src/data/inoraxium/user-pages/registry.json`
- `src/data/horaghfus/user-pages/registry.json`

depending on the chosen target system

## Where imported vaults are stored

For an Inoraxium import:

- `src/data/inoraxium/user-pages/workspaces/<workspace-id>/assets/...`
- `src/data/inoraxium/user-pages/workspaces/<workspace-id>/<page-id>/page.md`
- `src/data/inoraxium/user-pages/workspaces/<workspace-id>/<page-id>/body.md`

For a Horaghfus import:

- `src/data/horaghfus/user-pages/workspaces/<workspace-id>/assets/...`
- `src/data/horaghfus/user-pages/workspaces/<workspace-id>/<page-id>/page.md`
- `src/data/horaghfus/user-pages/workspaces/<workspace-id>/<page-id>/body.md`

The sidebar entry is built automatically from the registry after import.
Imported workspaces appear under a shared `User Pages` chapter in the sidebar.

## Sidebar behavior for Chronicler imports

For Chronicler imports, the importer looks for a markdown file named:

```text
main.md
```

Behavior:

- `main.md` becomes the only sidebar-visible chapter for that imported workspace
- that visible sidebar label uses the workspace/zip name
- every other imported page is hidden but still linkable
- readers are expected to navigate to the hidden pages through links from `main`
- internal imported page ids are namespaced by workspace and file path so different workspaces can safely have their own `main.md`

If no `main.md` exists, the importer falls back to making the first imported markdown page visible.

## Workspace main-page tools

Each imported workspace `main` page gets workspace-scoped helper tabs inside the page:

- `Content`
- `Tags`
- `Folders`

### Tags tab

- reads tags from imported page frontmatter
- shows only tags from that workspace
- clicking a tag lists matching pages from that workspace
- clicking a listed page fast-travels to that page

### Folders tab

- shows the imported folder structure for that workspace
- folders are collapsible
- pages inside folders are clickable
- clicking a page fast-travels to that page

If you import two workspaces, each `main` page only shows its own tags and folders.

## Current compatibility

### Supported well

- markdown pages
- wiki links like `[[Page Name]]`
- aliased wiki links like `[[Page Name|Link Text]]`
- header links like `[[Page Name#Header]]`
- image embeds like `![[map.png]]`
- frontmatter-driven infoboxes
- frontmatter fields like `title`, `subtitle`, `infobox`, `image`, `layout`
- page tags from frontmatter
- infobox image carousels from:
  - `image: [a.jpg, b.jpg, c.jpg]`
  - `image: [[a.jpg, "Caption A"], [b.jpg, "Caption B"]]`
- `layout` headers
- `layout` groups
- spoiler syntax like `||hidden text||`

### Supported with graceful adaptation

- Chronicler infoboxes render using this site's own infobox component and styling
- shared vault images are resolved from workspace-level assets
- carousel captions render below the active image
- captioned infobox carousels use tab-like navigation when every slide has a caption

### Not full parity yet

- every advanced HTML component Chronicler supports inside YAML
- full infobox image carousel behavior
- every advanced table/image sizing option
- complete `{{insert: Page Name}}` page-insert behavior
- map pins and any app-specific interactive tooling

Those can be added incrementally, but this importer already gives a usable vault-to-site pipeline.

## Important note about updates

Re-importing with the same `WorkspaceId` replaces the old imported workspace for that system.

That means:

- edited pages are updated
- added pages are imported
- removed pages are removed from the site for that workspace

## Recommended workflow

1. Build and edit the world in Chronicler.
2. Zip the vault folder or keep it as a folder.
3. Import it into the correct system with `npm run import:chronicler`.
4. Review the imported pages in the local site.
5. Deploy when it looks correct.
