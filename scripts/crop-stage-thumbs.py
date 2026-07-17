#!/usr/bin/env python3
"""Crop a 2x2 imagegen atlas into Hibana's 320:184 stage-card ratio."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("ids", nargs=4, metavar=("TL", "TR", "BL", "BR"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with Image.open(args.atlas) as source:
        image = source.convert("RGB")
        half_w = image.width // 2
        half_h = image.height // 2
        cells = (
            (0, 0, half_w, half_h),
            (half_w, 0, image.width, half_h),
            (0, half_h, half_w, image.height),
            (half_w, half_h, image.width, image.height),
        )
        for stage_id, box in zip(args.ids, cells, strict=True):
            cell = image.crop(box)
            target_ratio = 320 / 184
            crop_h = round(cell.width / target_ratio)
            top = max(0, (cell.height - crop_h) // 2)
            card = cell.crop((0, top, cell.width, min(cell.height, top + crop_h)))
            card = card.resize((640, 368), Image.Resampling.LANCZOS)
            card.save(
                args.output / f"{stage_id}.webp",
                "WEBP",
                quality=86,
                method=6,
            )


if __name__ == "__main__":
    main()
