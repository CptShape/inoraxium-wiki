# Character 3D models

Add `.glb` or `.fbx` files here, for example `public/models/ayrton.glb` or
`public/models/ayrton.fbx`. Subfolders and uppercase extensions are supported.
Embed textures in GLB files so no external texture paths are needed. Keep files under GitHub's file-size
limit and optimize large textures for mobile devices.

Vite generates `models/index.json` from this folder during development and each
production build. Do not maintain the catalog manually. After adding files,
reload the model list locally; commit the files and rebuild/redeploy to make them
available on the hosted website.

In **Character Sheet → Bio → 3D Model**, choose a model and use the sheet's normal
**Save** button. The character stores its relative path (for example `ayrton.glb`),
so keep filenames stable. Choose **No 3D model** and save to clear the assignment.
Homebrew's **Overview → 3D** then opens the interactive viewer on demand.

Viewer controls: drag to orbit, scroll/pinch to zoom, right-drag or two-finger drag
to pan; arrow keys also rotate the camera. The toolbar offers zoom, reset, camera
presets, auto-rotation, fullscreen, lighting/background/shadow settings, and
animation selection/playback when the file contains animation clips.

FBX models (ASCII 7.x or binary 6400+) are prepared in the browser on demand;
geometry, skinning and animations use the same viewer and controls as GLB.
The original FBX path remains saved on the character. Embed textures when
exporting, or put referenced PNG/JPEG/WebP files beside the FBX (with matching
filenames/case). Missing textures show a recoverable error. FBX's Phong/Lambert
materials are adapted to PBR, so lighting may differ slightly from the source app.
For large models, GLB opens faster and uses less temporary browser memory.
