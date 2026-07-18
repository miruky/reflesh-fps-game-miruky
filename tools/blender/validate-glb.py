#!/usr/bin/env python3
"""Validate generated Hibana GLB structure and release budgets."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


def load_document(path: Path) -> dict:
    raw = path.read_bytes()
    if len(raw) < 20:
        raise ValueError("file is too small")
    magic, version, declared = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67 or version != 2 or declared != len(raw):
        raise ValueError("invalid GLB header")
    length, kind = struct.unpack_from("<II", raw, 12)
    if kind != 0x4E4F534A or 20 + length > len(raw):
        raise ValueError("invalid JSON chunk")
    return json.loads(raw[20:20 + length].decode("utf-8").rstrip(" \t\r\n\0"))


def inspect(path: Path) -> dict:
    document = load_document(path)
    accessors = document.get("accessors", [])
    primitives = [primitive for mesh in document.get("meshes", []) for primitive in mesh.get("primitives", [])]
    triangles = 0
    vertices = 0
    for primitive in primitives:
        position = primitive.get("attributes", {}).get("POSITION")
        indices = primitive.get("indices")
        if isinstance(position, int) and position < len(accessors):
            vertices += int(accessors[position].get("count", 0))
        if isinstance(indices, int) and indices < len(accessors):
            triangles += int(accessors[indices].get("count", 0)) // 3
        elif isinstance(position, int) and position < len(accessors):
            triangles += int(accessors[position].get("count", 0)) // 3
    surface_materials = []
    pbr_errors = []
    for material in document.get("materials", []):
        name = material.get("name", "")
        kind = name.rsplit("_", 1)[-1]
        if kind not in {"floor", "road", "wall", "alt", "obstacle", "natural", "terrain", "water"}:
            continue
        surface_materials.append(name)
        pbr = material.get("pbrMetallicRoughness", {})
        if "metallicRoughnessTexture" not in pbr:
            pbr_errors.append(f"{name}:roughness-map")
        if "normalTexture" not in material:
            pbr_errors.append(f"{name}:normal-map")
        if kind == "water" and material.get("alphaMode") != "BLEND":
            pbr_errors.append(f"{name}:alpha-blend")
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "nodes": len(document.get("nodes", [])),
        "meshes": len(document.get("meshes", [])),
        "primitives": len(primitives),
        "materials": len(document.get("materials", [])),
        "vertices": vertices,
        "triangles": triangles,
        "surfaceMaterials": len(surface_materials),
        "pbrErrors": pbr_errors,
    }


def validate_manifest(path: Path, assets: list[Path], expected_count: int | None) -> dict:
    document = json.loads(path.read_text(encoding="utf-8"))
    entries = document.get("assets", [])
    errors = []
    ids = [entry.get("id") for entry in entries]
    if len(ids) != len(set(ids)):
        errors.append("duplicate-asset-id")
    if expected_count is not None and len(entries) != expected_count:
        errors.append(f"asset-count:{len(entries)}!={expected_count}")
    root = path.parent
    referenced = set()
    for entry in entries:
        urls = [entry.get("url")] + [lod.get("url") for lod in entry.get("lods", [])]
        if not isinstance(entry.get("replacesDistantMatte"), bool):
            errors.append(f"{entry.get('id')}:distant-matte-gate")
        for url in urls:
            if not isinstance(url, str):
                errors.append(f"{entry.get('id')}:missing-url")
                continue
            target = (root / url).resolve()
            referenced.add(target)
            if not target.is_file():
                errors.append(f"missing:{url}")
    lod0_assets = {asset.resolve() for asset in assets}
    unreferenced = sorted(str(asset) for asset in lod0_assets if asset not in referenced)
    if unreferenced:
        errors.extend(f"unreferenced:{asset}" for asset in unreferenced)
    return {"path": str(path), "entries": len(entries), "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--max-bytes", type=int, default=5_500_000)
    parser.add_argument("--max-triangles", type=int, default=260_000)
    parser.add_argument("--max-materials", type=int, default=24)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--expect-count", type=int)
    args = parser.parse_args()
    reports = []
    failed = False
    for path in args.paths:
        try:
            report = inspect(path)
            errors = []
            if report["bytes"] > args.max_bytes:
                errors.append("file-size")
            if report["triangles"] > args.max_triangles:
                errors.append("triangles")
            if report["materials"] > args.max_materials:
                errors.append("materials")
            errors.extend(report.pop("pbrErrors", []))
            report["errors"] = errors
        except Exception as exc:  # noqa: BLE001
            report = {"path": str(path), "errors": [str(exc)]}
        failed = failed or bool(report["errors"])
        reports.append(report)
    manifest_report = None
    if args.manifest:
        try:
            manifest_report = validate_manifest(args.manifest, args.paths, args.expect_count)
        except Exception as exc:  # noqa: BLE001
            manifest_report = {"path": str(args.manifest), "errors": [str(exc)]}
        failed = failed or bool(manifest_report["errors"])
    print(json.dumps({"ok": not failed, "assets": reports, "manifest": manifest_report}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
