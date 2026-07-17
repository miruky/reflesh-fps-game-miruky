#!/usr/bin/env python3
"""Build a labelled visual-audit contact sheet without changing source captures."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--crop-bottom", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    images = [path for path in args.images if path.is_file()]
    if not images:
        raise SystemExit("no input images")
    label_h = 28
    rows = math.ceil(len(images) / args.columns)
    with Image.open(images[0]) as first:
        source_ratio = first.width / first.height
    tile_h = round(args.width / source_ratio)
    sheet = Image.new("RGB", (args.columns * args.width, rows * (tile_h + label_h)), "#111318")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=15)
    for index, path in enumerate(images):
        with Image.open(path) as source:
            frame = source.convert("RGB")
            if args.crop_bottom:
                frame = frame.crop((0, frame.height // 3, frame.width, frame.height))
            frame.thumbnail((args.width, tile_h), Image.Resampling.LANCZOS)
        col = index % args.columns
        row = index // args.columns
        x = col * args.width
        y = row * (tile_h + label_h)
        sheet.paste(frame, (x, y))
        draw.text((x + 7, y + tile_h + 5), path.stem, fill="#f4f5f8", font=font)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output, "JPEG", quality=88, optimize=True)


if __name__ == "__main__":
    main()
