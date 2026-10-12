#!/usr/bin/env python3
"""Generate launcher icons, Android TV banner and splash screens (needs Pillow)."""
import glob
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
BG = (11, 15, 23)
A1, A2 = (79, 140, 255), (124, 92, 255)


def gradient(w, h):
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(1, w - 1) + y / max(1, h - 1)) / 2
            px[x, y] = tuple(int(A1[i] + (A2[i] - A1[i]) * t) for i in range(3))
    return img


def logo(size, bg=True, scale=1.0):
    """TV screen with a play triangle — mirrors public/icon.svg."""
    s = size * 4  # supersample
    img = Image.new('RGBA', (s, s), BG + (255,) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg:
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.215), fill=255)
        img.putalpha(mask)
    k = s / 512 * scale
    off = s / 2 - 256 * k
    box = [off + 72 * k, off + 120 * k, off + 440 * k, off + 360 * k]
    scr = gradient(int(box[2] - box[0]), int(box[3] - box[1])).convert('RGBA')
    m = Image.new('L', scr.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, scr.size[0] - 1, scr.size[1] - 1], radius=int(34 * k), fill=255)
    img.paste(scr, (int(box[0]), int(box[1])), m)
    d.polygon([(off + 226 * k, off + 190 * k), (off + 226 * k, off + 290 * k), (off + 310 * k, off + 240 * k)], fill='white')
    d.rounded_rectangle([off + 186 * k, off + 386 * k, off + 326 * k, off + 408 * k], radius=int(11 * k), fill=A1)
    return img.resize((size, size), Image.LANCZOS)


def font(px):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(f):
            return ImageFont.truetype(f, px)
    return ImageFont.load_default()


def wordmark(w, h, logo_px, text_px):
    img = Image.new('RGB', (w, h), BG)
    lg = logo(logo_px, bg=False, scale=1.25)
    f = font(text_px)
    d = ImageDraw.Draw(img)
    tw1 = d.textlength('Pete', font=f)
    tw2 = d.textlength('TV', font=f)
    total = logo_px + text_px * 0.3 + tw1 + tw2
    if total > w * 0.9:  # shrink to fit narrow canvases (portrait splash)
        return wordmark(w, h, int(logo_px * 0.85), int(text_px * 0.85))
    x = (w - total) / 2
    img.paste(lg, (int(x), int((h - logo_px) / 2)), lg)
    tx = x + logo_px + text_px * 0.3
    ty = (h - text_px) / 2 - text_px * 0.12
    d.text((tx, ty), 'Pete', font=f, fill='white')
    d.text((tx + tw1, ty), 'TV', font=f, fill=A1)
    return img


icons = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for dens, px in icons.items():
    d = os.path.join(ROOT, f'mipmap-{dens}')
    os.makedirs(d, exist_ok=True)
    logo(px).save(os.path.join(d, 'ic_launcher.png'))
    # round icon
    r = logo(px)
    m = Image.new('L', (px, px), 0)
    ImageDraw.Draw(m).ellipse([0, 0, px - 1, px - 1], fill=255)
    r.putalpha(m)
    r.save(os.path.join(d, 'ic_launcher_round.png'))
    # adaptive foreground: 108dp canvas, art inside the 66dp safe zone
    fg_px = int(px * 108 / 48)
    fg = Image.new('RGBA', (fg_px, fg_px), (0, 0, 0, 0))
    art = logo(int(fg_px * 0.62), bg=False, scale=1.2)
    fg.paste(art, ((fg_px - art.size[0]) // 2, (fg_px - art.size[1]) // 2), art)
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'))

# Android TV / Fire TV launcher banner (320x180dp; xhdpi = 640x360)
os.makedirs(os.path.join(ROOT, 'drawable-xhdpi'), exist_ok=True)
wordmark(640, 360, 160, 92).save(os.path.join(ROOT, 'drawable-xhdpi', 'banner.png'))
wordmark(320, 180, 80, 46).save(os.path.join(ROOT, 'drawable', 'banner.png'))

# Splash screens: overwrite every generated splash.png keeping its size
for p in glob.glob(os.path.join(ROOT, 'drawable*', 'splash.png')):
    w, h = Image.open(p).size
    wordmark(w, h, int(min(w, h) * 0.2), int(min(w, h) * 0.11)).save(p)

# Adaptive icon background colour
with open(os.path.join(ROOT, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B0F17</color>\n</resources>\n')
print('ok')
