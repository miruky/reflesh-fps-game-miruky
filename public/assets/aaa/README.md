# Hibana AAA asset drop zone

`manifest.json` is the runtime contract for optional high-density environment assets.
Models must be original or properly licensed glTF/GLB files. Meshopt is supported by default;
KTX2 and Draco are enabled when their local transcoder/decoder directories are declared in the manifest.

The game always retains its procedural environment as a deterministic fallback. Missing, invalid, or
unsupported assets therefore never block a match from starting.
