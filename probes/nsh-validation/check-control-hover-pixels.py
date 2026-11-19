"""Verify paint-only hover in a --control-hover run (local Pillow; no desktop access)."""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


CONTROLS = {
    'picker': ('chat-column', 'chat-body', 'composer-safe-area', 'composer', 'composer-actions', 'model-picker'),
    'navigation': ('toggle-navigation',),
    'settings': ('sidebar', 'sidebar-footer', 'sidebar-settings'),
}
MATRIX = {(scheme, width, height) for scheme in ('light', 'dark') for width, height in ((1240, 820), (680, 720))}


def box(bounds, path):
    x, y = (round(sum(bounds[node]['origin'][axis] for node in path)) for axis in ('x', 'y'))
    size = bounds[path[-1]]['size']
    return x, y, x + round(size['width']), y + round(size['height'])


def changed(left, right, crop):
    delta = ImageChops.difference(left.crop(crop), right.crop(crop))
    return sum(1 for pixel in delta.getdata() if pixel != (0, 0, 0))


def verify(directory):
    prefix = 'CONTROL_GEOMETRY '
    entries = [json.loads(line[len(prefix):]) for line in (directory / 'test.log').read_text().splitlines()
               if line.startswith(prefix)]
    dimensions = {(d['colorScheme'], d['width'], d['height']) for d in entries}
    if len(entries) != len(MATRIX) or dimensions != MATRIX:
        raise ValueError('Incomplete control hover viewport/color matrix')
    report = {}
    for d in entries:
        name = f"controls-{d['colorScheme']}-{d['width']}"
        frames = {}
        for frame in ('rest', 'leave', 'open', *CONTROLS):
            with Image.open(directory / f'{name}-{frame}.png') as image:
                if image.size != (d['width'], d['height']):
                    raise ValueError(f'Unexpected frame size: {image.size}')
                frames[frame] = image.convert('RGB')
        report[name] = {}
        for control, path in CONTROLS.items():
            crop = box(d['bounds'], path)
            x, y, right, bottom = crop
            if not (0 <= x < right <= d['width'] and 0 <= y < bottom <= d['height']):
                raise AssertionError((name, control, crop))
            counts = {frame: changed(frames['rest'], frames[frame], crop) for frame in ('leave', *CONTROLS)}
            # A large fill change, not just a few antialiased glyph pixels. Other controls stay at rest.
            if counts[control] < (right - x) * (bottom - y) * .6 or any(n for frame, n in counts.items() if frame != control):
                raise AssertionError((name, control, counts))
            report[name][control] = {'crop': crop, 'changedPixels': counts[control], 'otherChangedPixels': 0, 'leaveChangedPixels': counts['leave']}
    return report


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1])), indent=2))
