# -*- coding: utf-8 -*-
"""DeepSeek-style flat MuYan icon, same v2 language as MuMa (E111).

Family rules: white Apple squircle, single flat brand color mark, generous
padding, inverted small sizes, full-bleed Play/iOS variants with keyline
safe-area assertion. MuYan brand color sampled from the E107 gradient
(#FE9859 -> #F66477); flat midpoint coral used here. Mark keeps the original
identity: speech bubble + three voice bars, redrawn as flat geometry.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'images' / 'muyan-icon-v2'
OUT.mkdir(parents=True, exist_ok=True)

S = 4
CANVAS = 1024 * S
BOX = 824 * S
MARGIN = (1024 - 824) // 2 * S
RADIUS = int(824 * 0.2258) * S
BRAND = (247, 107, 91)      # #F76B5B coral, flat midpoint of the E107 gradient
HAIRLINE = (233, 236, 239)
WHITE = (255, 255, 255)


def squircle_mask():
    mask = Image.new('L', (CANVAS, CANVAS), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([MARGIN, MARGIN, MARGIN + BOX, MARGIN + BOX],
                        radius=RADIUS, fill=255)
    return mask


def rounded_poly(draw, pts, width, fill):
    pts = [(int(round(x)), int(round(y))) for x, y in pts]
    draw.line(pts, fill=fill, width=int(width), joint='curve')
    r = int(width) // 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def marks():
    """1024-space geometries. bubble: filled body + tail + three voice bars."""
    return {
        'A-bubble': dict(
            body=[268, 344, 756, 660], body_radius=92,
            tail=[(352, 606), (330, 770), (452, 646)], tail_tip_r=26,
            bars=[((400, 452, 400, 552)), ((512, 428, 512, 576)), ((624, 452, 624, 552))],
            bar_width=54),
        'B-quote': dict(
            body=[268, 344, 756, 660], body_radius=92,
            tail=[(352, 606), (330, 770), (452, 646)], tail_tip_r=26,
            bars=[], quote=True),
    }


def render_mark(layer, spec, color, scale=S, offset=(0, 0), size_hint=1024, inner=None):
    d = ImageDraw.Draw(layer)
    sc = scale / size_hint * size_hint  # keep semantics; scale is absolute
    sc = scale
    ox, oy = offset[0] * sc, offset[1] * sc
    inner = inner or WHITE
    bx0, by0, bx1, by1 = [v * sc + o for v, o in zip(spec['body'], (ox, ox, ox, ox))]
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=spec['body_radius'] * sc, fill=color)
    pts = [(x * sc + ox, y * sc + oy) for x, y in spec['tail']]
    d.polygon(pts, fill=color)
    tx, ty = pts[-2]
    r = spec['tail_tip_r'] * sc
    d.ellipse([tx - r, ty - r, tx + r, ty + r], fill=color)
    r = spec.get('bar_width', 0) * sc // 2
    for bar in spec['bars']:
        x0, y0, x1, y1 = [v * sc + (ox if i % 2 == 0 else oy) for i, v in enumerate(bar)]
        d.line([(x0, y0), (x1, y1)], fill=inner, width=int(spec['bar_width'] * sc))
        for x, y in ((x0, y0), (x1, y1)):
            d.ellipse([x - r, y - r, x + r, y + r], fill=inner)
    if spec.get('quote'):
        # two rounded speech quotes inside the bubble
        qw = 96 * sc
        for qx in (420, 552):
            x0 = qx * sc + ox
            d.rounded_rectangle([x0, 452 * sc + oy, x0 + qw, 552 * sc + oy],
                                radius=qw // 2, fill=inner)


def bbox_of(spec):
    x0, y0, x1, y1 = spec['body']
    for x, y in spec['tail']:
        x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
    tx, ty = spec['tail'][1]
    r = spec['tail_tip_r']
    x0 = min(x0, tx - r); y0 = min(y0, ty - r); x1 = max(x1, tx + r); y1 = max(y1, ty + r)
    return (x0, y0, x1, y1)


def make_icon(slug, spec, invert=False, size=1024):
    bg = BRAND if invert else WHITE
    fg = WHITE if invert else BRAND
    im = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    layer = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([MARGIN, MARGIN, MARGIN + BOX, MARGIN + BOX],
                        radius=RADIUS, fill=bg + (255,))
    if not invert:
        ring = Image.new('L', (CANVAS, CANVAS), 0)
        rd = ImageDraw.Draw(ring)
        rd.rounded_rectangle([MARGIN, MARGIN, MARGIN + BOX, MARGIN + BOX],
                             radius=RADIUS, outline=255, width=3 * S)
        inward = squircle_mask().point(lambda v: 255 if v > 200 else 0)
        d.bitmap([0, 0], Image.composite(ring, Image.new('L', (CANVAS, CANVAS), 0), inward),
                 fill=HAIRLINE + (255,))
    x0, y0, x1, y1 = bbox_of(spec)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    render_mark(layer, spec, fg, offset=(512 - cx, 512 - cy), inner=bg)
    im = Image.composite(layer, im, squircle_mask())
    return im.resize((size, size), Image.LANCZOS)


def make_full_bleed(slug, spec, invert=True, size=512):
    bg = BRAND if invert else WHITE
    fg = WHITE if invert else BRAND
    im = Image.new('RGBA', (CANVAS, CANVAS), bg + (255,))
    safe_radius_1024 = 1024 * (66 / 108) / 2
    target_r = safe_radius_1024 * 0.85
    x0, y0, x1, y1 = bbox_of(spec)
    diag = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
    scale = 2 * target_r / diag
    s = int(CANVAS * scale)
    layer = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    render_mark(layer, spec, fg, scale=scale * S, inner=bg)
    layer = layer.crop(layer.getbbox())
    ox, oy = int(512 * S - layer.width / 2), int(512 * S - layer.height / 2)
    im.alpha_composite(layer, (ox, oy))
    return im.resize((size, size), Image.LANCZOS)


def assert_play_safe_area(im, invert=True, size=512):
    import math
    bg = BRAND if invert else WHITE
    cx = cy = size / 2
    safe_r = size * (66 / 108) / 2 * 0.95
    px = im.convert('RGB').load()
    worst = 0.0
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 60:
                worst = max(worst, math.hypot(x - cx, y - cy))
    return worst <= safe_r, round(worst, 1), round(safe_r, 1)


SLUG_OFFICIAL = 'A-bubble'


def main():
    for slug, spec in marks().items():
        big = make_icon(slug, spec, invert=False)
        small = make_icon(slug, spec, invert=True)
        big.save(OUT / f'{slug}-1024.png')
        small.save(OUT / f'{slug}-1024-inverted.png')
        big.resize((128, 128), Image.LANCZOS).save(OUT / f'{slug}-128.png')
        small.resize((32, 32), Image.LANCZOS).save(OUT / f'{slug}-32-inverted.png')
        small.resize((16, 16), Image.LANCZOS).save(OUT / f'{slug}-16-inverted.png')

    rows = list(marks().keys())
    cell = 340
    sheet = Image.new('RGB', (cell * 4 + 80, cell * len(rows) + 60), (250, 250, 250))
    for i, slug in enumerate(rows):
        y = 30 + i * cell
        big = Image.open(OUT / f'{slug}-1024.png').resize((cell - 40, cell - 40), Image.LANCZOS)
        sheet.paste(big, (20, y + 20), big)
        mid = Image.open(OUT / f'{slug}-128.png')
        sheet.paste(mid, (cell + 30, y + (cell - 128) // 2), mid)
        t = Image.open(OUT / f'{slug}-32-inverted.png').resize((96, 96), Image.NEAREST)
        tile = Image.new('RGB', (96, 96), (245, 245, 245))
        tile.paste(t, (0, 0), t)
        sheet.paste(tile, (2 * cell + 30, y + (cell - 96) // 2))
        dark = Image.new('RGB', (96, 96), (24, 26, 28))
        dark.paste(t, (0, 0), t)
        sheet.paste(dark, (3 * cell + 30, y + (cell - 96) // 2))
    sheet.save(OUT / 'preview-sheet.png')

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
