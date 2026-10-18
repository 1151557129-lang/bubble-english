#!/usr/bin/env python3
"""生成 PWA 图标 icon-192.png / icon-512.png（天空蓝渐变 + 粉色泡泡 + ABC）"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONT = "/System/Library/Fonts/Supplemental/Comic Sans MS Bold.ttf"


def make_icon(size, path):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)

    # 天空蓝渐变背景
    top = (126, 200, 247)      # #7ec8f7
    bottom = (223, 243, 255)   # #dff3ff
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b))

    # 泡泡：粉色外环 + 白色内圆 + 高光
    cx = cy = size // 2
    R = int(size * 0.42)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(255, 143, 171))  # #ff8fab
    r2 = int(R * 0.80)
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(255, 255, 255))
    hx = cx - int(R * 0.34)
    hy = cy - int(R * 0.40)
    hr = int(R * 0.20)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(255, 255, 255))

    # ABC 文字
    font = ImageFont.truetype(FONT, int(size * 0.30))
    text = "ABC"
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), text, font=font, fill=(255, 143, 171))

    img.save(path)
    print(f"已生成 {path} ({size}x{size})")


if __name__ == "__main__":
    make_icon(192, ROOT / "icon-192.png")
    make_icon(512, ROOT / "icon-512.png")
