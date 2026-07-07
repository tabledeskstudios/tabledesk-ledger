#!/usr/bin/env python3
"""Generate the TableDesk Ledger pixel icon set (192/512 PWA + 180 apple-touch)."""
from PIL import Image

# 16x16 pixel grid. . = cream bg, # = ink frame, G = screen green,
# $ = light pixel (dollar sign), s = stand ink, d = desk ink, k = key row
GRID = [
    "................",
    ".############...",
    ".#GGGGGGGGGG#...",
    ".#GGGG$GGGGG#...",
    ".#GG$$$$$GGG#...",
    ".#GG$GGGGGGG#...",
    ".#GGG$$$GGGG#...",
    ".#GGGGGG$GGG#...",
    ".#GG$$$$$GGG#...",
    ".#GGGG$GGGGG#...",
    ".#GGGGGGGGGG#...",
    ".############...",
    "......ss........",
    ".....ssss.......",
    "..dddddddddd....",
    "................",
]
COLORS = {
    ".": (242, 234, 216),   # cream
    "#": (34, 37, 45),      # ink navy
    "G": (18, 138, 62),     # ledger green screen
    "$": (234, 246, 216),   # light pixel
    "s": (34, 37, 45),
    "d": (34, 37, 45),
}

def render(px_size, out, pad_ratio=0.0):
    base = Image.new("RGB", (16, 16), COLORS["."])
    for y, row in enumerate(GRID):
        for x, ch in enumerate(row):
            base.putpixel((x, y), COLORS[ch])
    if pad_ratio:
        inner = int(px_size * (1 - 2 * pad_ratio))
        inner -= inner % 16
        img = Image.new("RGB", (px_size, px_size), COLORS["."])
        scaled = base.resize((inner, inner), Image.NEAREST)
        off = (px_size - inner) // 2
        img.paste(scaled, (off, off))
    else:
        s = px_size - (px_size % 16)
        img = Image.new("RGB", (px_size, px_size), COLORS["."])
        scaled = base.resize((s, s), Image.NEAREST)
        off = (px_size - s) // 2
        img.paste(scaled, (off, off))
    img.save(out)
    print("wrote", out)

render(512, "icons/icon-512.png")
render(192, "icons/icon-192.png")
render(180, "icons/apple-touch-icon.png", pad_ratio=0.05)
