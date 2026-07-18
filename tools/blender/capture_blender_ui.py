"""Capture only Blender's own window for article-ready progress records.

Run through the localhost Blender bridge.  This deliberately avoids macOS
desktop capture so other applications and Spaces can never enter the image.
"""

import bpy
from pathlib import Path


PROJECT = Path("/Users/h_miruky/Library/Mobile Documents/com~apple~CloudDocs/develop/100リポジトリ作成計画トップ/hibana")
DEFAULT_PATH = PROJECT / "tools/blender/screenshots/blender-progress.png"
EXEC_ARGS = globals().get("args", {})
output = Path(EXEC_ARGS.get("output", str(DEFAULT_PATH))).resolve()
allowed = (PROJECT / "tools/blender/screenshots").resolve()
if allowed not in output.parents:
    raise RuntimeError(f"Blender screenshot must remain below {allowed}")
output.parent.mkdir(parents=True, exist_ok=True)

try:
    bpy.ops.screen.screenshot(filepath=str(output), full=True)
except TypeError:
    bpy.ops.screen.screenshot(filepath=str(output))

result = {"output": str(output), "exists": output.exists(), "bytes": output.stat().st_size if output.exists() else 0}
