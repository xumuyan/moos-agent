# -*- coding: utf-8 -*-
"""DeepSeek-style flat MuMa icon candidates.

Design spec derived from DeepSeek's actual brand assets (dsh-web-frontend
FishLogo + their app icon practice):
  - flat solid color, no gradients / 3D / gloss / glow
  - white squircle background, one brand-colored mark
  - generous padding, Apple macOS icon template geometry (824 content box)
  - readable at 16px: small representations invert to solid brand color
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'images' / 'muma-icon-v2'
OUT.mkdir(parents=True, exist_ok=True)

S = 4                      # supersample factor (4096 canvas -> 1024)
CANVAS = 1024 * S
BOX = 824 * S              # Apple content box
MARGIN = (1024 - 824) // 2 * S
RADIUS = int(824 * 0.2258) * S  # Apple corner radius ratio
BRAND = (15, 168, 146)     # #0FA892 family teal, darkened for small sizes
HAIRLINE = (233, 236, 239) # subtle gray edge so white icon separates on white
WHITE = (255, 255, 255)

SS = CANVAS // 1024  # scale from 1024-space coordinates


def squircle_mask():
    mask = Image.new('L', (CANVAS, CANVAS), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([MARGIN, MARGIN, MARGIN + BOX, MARGIN + BOX],
                        radius=RADIUS, fill=255)
    return mask


def rounded_poly(draw, pts, width, fill):
    """Polyline with round joints and round caps."""
    pts = [(int(round(x)), int(round(y))) for x, y in pts]
    draw.line(pts, fill=fill, width=int(width), joint='curve')
    r = int(width) // 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def marks():
    """Mark geometries in 1024-space, each (segments, dot, stroke_width)."""
    return {
        # A: terminal prompt ">_"
        'A-prompt': dict(
            segments=[[(312, 404), (452, 544), (312, 684)],
                      [(512, 684), (688, 684)]],
            dot=None, stroke=88),
        # B: code brackets "</>" — shallow V, ~19deg slash, even gaps
        'B-brackets': dict(
            segments=[[(296, 462), (376, 542), (296, 622)],
                      [(556, 428), (476, 656)],
                      [(640, 542), (720, 462), (720, 622)]],
            dot=None, stroke=64),
        # C: rounded M with editor cursor dot
        'C-monogram': dict(
            segments=[[(296, 672), (296, 424), (468, 600), (640, 424), (640, 672)]],
            dot=((752, 668), 44), stroke=92),
    }


def bbox_of(spec):
    xs, ys = [], []
    for seg in spec['segments']:
        for x, y in seg:
            xs.append(x); ys.append(y)
    r = spec['stroke'] / 2
    if spec['dot']:
        (x, y), rad = spec['dot']
        xs += [x - rad, x + rad]; ys += [y - rad, y + rad]
    return (min(xs) - r, min(ys) - r, max(xs) + r, max(ys) + r)


def render_mark(layer, spec, color, scale=S, offset=(0, 0)):
    d = ImageDraw.Draw(layer)
    ox, oy = offset[0] * scale, offset[1] * scale
    w = spec['stroke'] * scale
    for seg in spec['segments']:
        pts = [(x * scale + ox, y * scale + oy) for x, y in seg]
        rounded_poly(d, pts, w, color)
    if spec['dot']:
        (x, y), rad = spec['dot']
        r = rad * scale
        cx, cy = x * scale + ox, y * scale + oy
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


def make_icon(slug, spec, invert=False, size=1024):
    """invert=False: white squircle + teal mark (app icon / large sizes)
       invert=True : teal squircle + white mark (sidebar / small sizes)"""
    bg = BRAND if invert else WHITE
    fg = WHITE if invert else BRAND
    im = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    mask = squircle_mask()
    layer = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([MARGIN, MARGIN, MARGIN + BOX, MARGIN + BOX],
                        radius=RADIUS, fill=bg + (255,))
    if not invert:  # hairline edge on the white variant only
        edge = squircle_mask()
        inward = edge.point(lambda v: 255 if v > 200 else 0)
        ring = Image.new('L', (CANVAS, CANVAS), 0)
        rd = ImageDraw.Draw(ring)
        rd.rounded_rectangle([MARGIN, MARGIN, MARGIN + BOX, MARGIN + BOX],
                             radius=RADIUS, outline=255, width=3 * S)
        inner = Image.composite(ring, Image.new('L', (CANVAS, CANVAS), 0), inward)
        d2 = ImageDraw.Draw(layer)
        d2.bitmap([0, 0], inner, fill=HAIRLINE + (255,))
    # optical centering of the mark inside the squircle
    x0, y0, x1, y1 = bbox_of(spec)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    off = (512 - cx, 512 - cy)
    render_mark(layer, spec, fg, offset=off)
    im = Image.composite(layer, im, mask)
    out = im.resize((size, size), Image.LANCZOS)
    return out


def make_full_bleed(slug, spec, invert=True, size=512):
    """Google Play / iOS App Store variant: full-bleed square, opaque, no
    pre-rounded corners, no baked shadow. Play applies its own 20% mask and
    shadow; graphics stay inside the central keyline grid (66% of 108dp =
    66dp safe circle -> keep mark inside ~85% of that circle's radius)."""
    bg = BRAND if invert else WHITE
    fg = WHITE if invert else BRAND
    im = Image.new('RGBA', (CANVAS, CANVAS), bg + (255,))
    # mark target: outer bounding circle radius = 0.85 * safe radius
    safe_radius_1024 = 1024 * (66 / 108) / 2  # ~312.9px in 1024-space
    target_r = safe_radius_1024 * 0.85
    x0, y0, x1, y1 = bbox_of(spec)
    w, h = x1 - x0, y1 - y0
    diag = (w * w + h * h) ** 0.5
    scale = 2 * target_r / diag  # diagonal fits the target circle
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    # render into an oversized offscreen then paste scaled
    s = int(CANVAS * scale)
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    render_mark(layer, spec, fg, scale=scale * S)
    layer = layer.crop(layer.getbbox())
    ox, oy = int(512 * S - layer.width / 2), int(512 * S - layer.height / 2)
    im.alpha_composite(layer, (ox, oy))
    return im.resize((size, size), Image.LANCZOS)


def assert_play_safe_area(im, invert=True, size=512):
    """Every mark pixel (non-background) must lie inside the central keyline
    circle; the background itself is intentionally full-bleed."""
    import math
    bg = BRAND if invert else WHITE
    cx = cy = size / 2
    safe_r = size * (66 / 108) / 2 * 0.95  # margin against the 66% grid
    px = im.convert('RGB').load()
    worst = 0.0
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 40:
                worst = max(worst, math.hypot(x - cx, y - cy))
    return worst <= safe_r, round(worst, 1), round(safe_r, 1)


SLUG_OFFICIAL = 'A-prompt'


def main():
    mask_note = {}
    for slug, spec in marks().items():
        big = make_icon(slug, spec, invert=False)
        small = make_icon(slug, spec, invert=True)
        big.save(OUT / f'{slug}-1024.png')
        small.save(OUT / f'{slug}-1024-inverted.png')
        big.resize((128, 128), Image.LANCZOS).save(OUT / f'{slug}-128.png')
        small.resize((32, 32), Image.LANCZOS).save(OUT / f'{slug}-32-inverted.png')
        small.resize((16, 16), Image.LANCZOS).save(OUT / f'{slug}-16-inverted.png')
        mask_note[slug] = spec

    # contact sheet: rows = candidates, cols = 1024 / 128 / 32-on-light / 32-on-dark
    rows = list(marks().keys())
    cell = 340
    sheet = Image.new('RGB', (cell * 4 + 80, cell * len(rows) + 60), (250, 250, 250))
    for i, slug in enumerate(rows):
        y = 30 + i * cell
        big = Image.open(OUT / f'{slug}-1024.png').resize((cell - 40, cell - 40), Image.LANCZOS)
        sheet.paste(big, (20, y + 20), big)
        mid = Image.open(OUT / f'{slug}-128.png')
        sheet.paste(mid, (cell + 30, y + (cell - 128) // 2), mid)
        for j, (bg, name) in enumerate([((245, 245, 245), '32-inverted'), ]):
            t = Image.open(OUT / f'{slug}-32-inverted.png').resize((96, 96), Image.NEAREST)
            tile = Image.new('RGB', (96, 96), bg)
            tile.paste(t, (0, 0), t)
            sheet.paste(tile, (2 * cell + 30, y + (cell - 96) // 2))
        dark = Image.new('RGB', (96, 96), (24, 26, 28))
        t = Image.open(OUT / f'{slug}-32-inverted.png').resize((96, 96), Image.NEAREST)
        dark.paste(t, (0, 0), t)
        sheet.paste(dark, (3 * cell + 30, y + (cell - 96) // 2))
    sheet.save(OUT / 'preview-sheet.png')

    # platform variants per Apple HIG / Google Play spec (candidate A only)
    spec = marks()[SLUG_OFFICIAL]
    play = make_full_bleed(SLUG_OFFICIAL, spec, invert=True, size=512)
    ok, worst, safe = assert_play_safe_area(play)
    assert ok, f'play safe area violated: worst={worst} safe={safe}'
    play.convert('RGB').save(OUT / 'play-512-fullbleed.png')
    ios = make_full_bleed(SLUG_OFFICIAL, spec, invert=True, size=1024)
    ok2, worst2, safe2 = assert_play_safe_area(ios, size=1024)
    assert ok2, f'ios safe area violated: worst={worst2} safe={safe2}'
    ios.convert('RGB').save(OUT / 'ios-appstore-1024-fullbleed.png')
    print('play safe worst/safe px(512):', worst, '/', safe)
    print('candidates:', ', '.join(rows))
    print('sheet:', OUT / 'preview-sheet.png')


if __name__ == '__main__':
    main()
