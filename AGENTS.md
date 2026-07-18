# Hibana production policy

## Blender MCP

- Inspect the scene and target collection before editing.
- Keep Blender MCP bound to localhost, safe mode enabled, and inline Python disabled.
- Execute reviewed project scripts by absolute `script_path`; do not send arbitrary inline code.
- Save before destructive operations and never delete unrelated collections or user objects.
- Treat `src/game/stage.ts` and `src/game/stages.ts` as authoritative for collision, spawns, routes, and deterministic layout.
- Build a connection map before attached geometry. Verify bounds, contact faces, gaps, transforms, normals, and six orthographic sides.
- Use actual terrain, architecture, water, fences, or retaining structures as visual boundaries. Never use power lines as map boundaries.
- Export GLB with measured triangle, material, file-size, draw-call, and LOD budgets.
- Capture Blender renders and real browser screenshots. A Blender-only result is not accepted until the stage audit and benchmark pass.

## Environment art quality

- Follow a visibility-first production model: spend geometry on first-person silhouettes, contacts, bevels, route landmarks, and reflections; move microdetail into color/roughness/normal information and LODs.
- Build complex scenes from reusable, transformable modular parts, but vary scale, orientation, adjacency, and composition so repeated modules do not read as copies.
- Every hero surface needs deliberate color, roughness, and relief response. A flat color alone is a blockout, not a finished asset.
- Do not copy the flat-background shortcut for Hibana's playable horizon. The outside world must remain layered real 3D; image mattes are fallback-only and must be hidden after a Blender stage loads successfully.
- Water should use stage-appropriate real geometry and lightweight environment reflection. Do not add a full-scene planar reflection pass without a measured performance budget.
- Cinematic depth of field belongs to thumbnails and article renders. Normal gameplay must preserve target readability unless the existing ADS design explicitly asks for depth of field.

## Validation

- Keep routine browser validation headless, muted, and background-only.
- Preserve the procedural fail-open path until an external stage asset has loaded successfully.
- Do not replace gameplay collision with Blender mesh collision without explicit migration tests.

## Article-ready visual history

- Capture milestone screenshots of both the visible Blender production scene and the real in-game result throughout future Hibana work.
- Keep stable comparison views for before, first integration, major iteration, and final validation whenever practical.
- Store captures under `tools/blender/screenshots/` or another explicitly ignored audit directory.
- Never add or push these screenshots to GitHub.
