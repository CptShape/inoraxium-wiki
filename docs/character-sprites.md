# Character sprites

Character Sheet > Bio > Sprites stores an optional version-1 sprite profile with
the character. Apply animation validates a draft; the normal Character Sheet Save
persists applied clips. Default-preset selection is saved with the same profile.
Only users allowed to edit the character may change it. Encounter imports copy
the profile with the character snapshot; existing encounters are not live-linked.

## Format and limits

- One transparent PNG or lossless WebP sprite sheet per animation. Equal cells,
  no padding, row-major order: left to right, then top to bottom.
- Recommended frame: 128 x 128 pixels, 12 FPS. Frames need not be square.
- Maximum frame: 256 x 256. Maximum sheet: 4096 x 4096. Maximum 64 frames.
- FPS is an integer from 1 to 30. Last-row unused cells must still be present.
- Upload limit: 8 MB for local files sent to Pixhost. Remote URLs are checked for
  dimensions, not transfer size (image hosts need not expose size/CORS headers).
- Anchor X/Y: normalized 0-1 coordinates; default 0.5/1 anchors bottom center to
  the tile. Display height: 32-160 world units; width is also capped at 160 while
  preserving aspect ratio. Texture resolution does not determine map footprint.
- Real image dimensions must match columns * frame width and ceil(frames/columns)
  * frame height. They are checked in the editor and again in the renderer.

## Hosting

Use full-size HTTPS `i.imgur.com` or `imgN.pixhost.to` PNG/WebP links. A single
Imgur image-page URL is normalized to its direct PNG URL. Pixhost BBCode is accepted
when it contains the thumbnail's server number, which resolves the full-size image.
A Pixhost show-page URL alone cannot reliably identify that server; use BBCode or
the direct URL. Albums, thumbnails and HTML pages are not used as sprite sheets.
Pixhost upload requests original preservation; returned dimensions are still
verified before applying. Remote hosts can remove/recompress images, so keep originals.

## Animation states

Idle and Move loop. Attack, Cast, Hit, Dodge and Recover play once; Downed plays
once and holds the last frame. Battle Settings selects Attack/Cast. HP loss/gain
produces Hit/Recover; a resisted configured action without HP change produces
Dodge. Downed is driven by explicit combatant state, not an assumed HP-zero rule.

Default clips reuse the existing licensed PNG sprites, with procedural lunge,
cast, recoil, dodge, fall and recovery poses/effects. They are not a new hand-drawn
attack sprite pack. A missing/failed custom clip falls back to the default pose.
Preset Knight/Mage/Monster is the fallback; an encounter-specific preset override
takes precedence over the character's default preset, not its custom clips.

Animation events are persisted with successful commands for inspection, but are
not replayed on initial load or Undo. Visual timers never spend resources, apply
damage or emit commands. New events interrupt previous visual playback. Reduced
motion disables transient playback and freezes custom sheets at the first frame.
