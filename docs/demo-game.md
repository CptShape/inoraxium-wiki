# Demo Game: first playable foundation

Route: `#tools/demo-game`. The Tools navigation opens a dedicated game workspace;
the back arrow returns to Tools. This is a **local demo**, not a deployed multiplayer
session. DM view / Player preview is a local UI and command-permission simulation.
It is not an authentication or confidentiality boundary.

## Implemented

- Isometric 2.5D Battle presentation using projected 2D tiles and animated PNG
  sprites, with depth ordering, raised terrain, shadows, wall cutaway, four view
  rotations and zoom. Roleplay keeps normalized-coordinate portrait movement.
- Three selectable sprite presets: Knight, Mage and Monster. Four-frame idle/run
  animations from 0x72's CC0 DungeonTileset II v1.7 are vendored locally; provenance
  is in `public/demo-game/sprites/LICENSE.txt`. These are side-facing 2D sprites,
  mirrored during movement, not eight-direction character models.
- Attack, cast, hit, dodge, downed and recovery poses using these default sprites,
  plus per-character sprite sheets under Character Sheet > Bio > Sprites. Each
  animation can override the preset independently. See [Character Sprites](character-sprites.md)
  for supported Imgur/Pixhost links, frame layout, limits and save behavior.
- DM scene creation (initial floor: 6-100 tiles per axis, up to 12 scenes), independent
  map copies and per-scene placements. Scene creation/switching requires ending battle.
  Initial dimensions do not limit later expansion: extend any edge, optionally fill
  it, or paint floor outside existing bounds. Empty cells are not traversable. Pan
  with the hand tool, middle mouse or Alt-drag; reset view restores the camera.
- Independent character snapshots loaded through existing account access helpers.
  Source characters are never written by Demo Game. Multiple instances can use the
  same source character, with separate combatant IDs and state.
- Imported characters enter the roster unplaced. Select one and click an empty
  floor tile to spawn it (a ghost previews the placement). Remove token keeps its
  character/resources in the roster; Remove from encounter deletes the snapshot
  from all scene placements after confirmation. Only placed actors join initiative,
  block movement, trigger reactions or qualify as battle targets. New scenes start
  without tokens; switching back restores that scene's placement or absence.
- Existing sheet stat stacking via `buildCharacterFormulaContext`, resource bar
  base-versus-effective values, and time/replenishment via `characterTime`.
- Configurable HP/MAP/CAP/RAP bindings and movement costs, terrain, walls,
  step elevation, simple height-aware LOS, manual fog and token locks.
- Weighted pathfinding via `ngraph.path`. Preview and execution share traversal.
  Movement cannot cut blocked diagonal corners or finish on occupied tiles.
- Initiative and turn progression; explicit DM state / death-save controls.
- Adapters for character macros, equipped item macros/actions, spells and active
  status actions. Passive attributes remain part of sheet calculation.
- Explicit battle extensions: range, target, cost resource, defense reference,
  damage formula, LOS requirement and adjacency-leave reaction trigger.
- Shared **Battle Settings** editor on all item, spell and status actions in Character
  Sheet and Asset Creator. Configured actions support area preview, faction filters,
  saves/opposed rolls and separate landed/resisted outcome steps. See
  [Battle Settings](battle-settings.md) for formula scopes and examples.
- Selected multi-target actions, conditional availability, ordered follow-up
  checks, outcome conditions, once-per-action caster effects and push/pull/teleport
  operations. All checks resolve before mutations; invalid operations roll back
  the entire action, including AP and uses.
- Rolls use `@dice-roller/rpg-dice-roller`; expressions use an allowlisted `jsep`
  AST interpreter, including `if`, rounding, `DC` with inclusive comparison,
  `@actor.*`, `@target.*`, `@session.round`, and `@@local` references. Character
  formulas are syntax-checked before use by the existing sheet evaluator.
- Input prompts, bar updates, item-array selection, status application, use
  consumption, logs, ten-second result toast and latest-command undo.
- Persisted reaction continuation and command deduplication. Refreshing the page
  does not lose an awaiting reaction. Each movement step spends its own MAP.
- Account-keyed IndexedDB saves, atomic transactions across tabs, revision conflict checking,
  export, and one local backup before a reset.

## Boundaries and semantics

`types.ts` defines the versioned world, session, commands and action metadata.
`adapter.ts` translates existing character objects without rewriting their schema.
`engine.ts` validates and applies an entire command to a clone, so a failed action
cannot partially spend AP, uses or change a target. It does not write storage.
`store.ts` serializes local commands and is the replacement point for a future
remote transaction adapter. Renderers never write raw character documents.

Saves use the `inoraxium-demo-game` IndexedDB database (`sessions` store), not
localStorage. On first load, the account's legacy save and reset backup are moved
in one transaction; legacy copies are removed only after a successful commit.
An invalid legacy save remains exportable and can be backed up by Reset. Failed
writes leave the previous save and backup unchanged. Reset and its backup are
atomic and revisions remain monotonic. BroadcastChannel notifies other tabs;
focus/visibility refresh and a polling fallback cover browsers without it.
Close/reload older app tabs after upgrading: the old localStorage adapter cannot
participate in IndexedDB transactions. Storage is still browser-local and finite;
export important encounters before clearing browser data or changing browsers.

`isometric.ts` is a pure presentation transform over unchanged logical grid
coordinates. `IsometricBoard` depth-sorts terrain prisms (walls and elevated floors)
together. Sprites are composited with per-actor masks from foreground terrain above
their feet. Supporting/flat floors cannot hide a walking sprite; higher foreground
terrain can. Wall geometry, floor footprints and empty-grid previews share the same
projection; occluded sprite hit areas redirect to the foreground terrain. `GameEvent.motion`
contains only successfully traversed points, including partial paths stopped by
reactions. Animation never mutates the world or spends AP. Teleport, undo and
initial load snap directly to the saved state. New commands interrupt visual
replay; reduced-motion preferences disable it. Player preview skips visual replay
through hidden tiles. Sprite presets are optional for backward compatibility;
missing presets fall back without resetting saved encounters. Custom sprite sheets
are optional snapshot metadata and never change movement or action resolution.

Undo restores the latest command's world and appends an undo event. Only eight undo
snapshots, 250 log events and 500 command IDs are retained in this demo. This is a
bounded local history, not a complete audit archive or event-sourcing system.

The state reducer currently invokes dice and time helpers once during a serialized
local command. Before using retrying remote transactions, extract recorded random
results, generated IDs and timestamps into an immutable resolution record. Do not
reroll or emit external messages inside a retried transaction.

The existing sheet end-turn helper decrements that actor's round durations and
runs `round-end` scripts. Demo Game preserves this behavior; a future campaign
clock needs distinct owner-turn/global-round events and an explicit migration.
HP zero never forces a downed/death rule. Set state manually in combatant settings.
Standard hit-vs-defense and damage are an explicit extension preset, not inferred
from spell names or descriptions. Text cost fields are displayed but not parsed
as authoritative AP costs: configure the extension first.

Legacy actions without enabled Battle Settings expose each macro separately;
their effect bundle is another action. Configured actions instead execute one
explicit check/outcome pipeline and consume uses/AP once, regardless of target
count. Their ordinary macros are not automatically executed too. Status auto-links and script instances
already materialized in the source snapshot are retained. Full value-watch script
reconciliation and auto-link lifecycle editing are not exposed in this demo.

Fog hides tiles/tokens only in player preview. All local data is accessible in the
browser. Token movement in Roleplay uses normalized background coordinates and
does not spend AP. Scene switching preserves placements and requires ending battle.

## Next implementation slices

1. Campaign/session membership, authoritative commands, retry-safe recorded rolls,
   persistent cross-client reaction ownership, timeout/disconnect handling and
   per-viewer data separation. Deploy and test Security Rules before enabling joins.
2. Campaign clocks, generic pre/post events, rule modifier priorities, bounded
   reaction nesting, value-watch scripts and automatic linked status lifecycle.
3. Footprint sizes, traversal profiles,
   directional cover, line-of-effect and automatic per-player vision.
4. Map asset catalog, scene-specific actors, target-local status
   bindings, damage/resistance pipelines and controlled character-sheet sync.
5. Discord/Sheets notifications only after authoritative commit, with delivery IDs.

## Verification

- `npm run test:demo-game`: engine/formula regression tests.
- `npm run test:demo-game:ui`: Edge/Playwright integration tests, including 1920,
  1280 and 390 pixel layouts, image loading, reaction reload and cross-tab updates.
- `npm run build`: production bundle; Demo Game is lazy loaded.

UI artifacts are written to `.artifacts/demo-game/` (ignored by Git). The existing
repository-wide TypeScript check has pre-existing errors outside the new module.
