"""Check hover paint and right-hand card in local 1x AppKit fixture captures."""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


def box(bounds, path):
    x, y = (round(sum(bounds[node]['origin'][axis] for node in path)) for axis in ('x', 'y'))
    size = bounds[path[-1]]['size']
    return x, y, x + round(size['width']), y + round(size['height'])


def changed(left, right, crop):
    delta = ImageChops.difference(left.crop(crop), right.crop(crop))
    return sum(pixel != (0, 0, 0) for pixel in delta.get_flattened_data())

PREFIX = 'SESSION_PREVIEW_GEOMETRY '
MATRIX = {f'session-preview-{scheme}-{width}': (width, height)
          for scheme in ('light', 'dark') for width, height in ((1240, 820), (680, 720))}


def verify(directory):
    entries = [json.loads(line[len(PREFIX):]) for line in (directory / 'test.log').read_text().splitlines()
               if line.startswith(PREFIX)]
    if len(entries) != len(MATRIX) or {d['label']: (d['width'], d['height']) for d in entries} != MATRIX:
        raise ValueError('Incomplete session preview viewport/color matrix')
    result = {}
    for entry in entries:
        name, bounds = entry['label'], entry['bounds']
        frames = {}
        for state in ('rest', 'hover', 'leave'):
            with Image.open(directory / f'{name}-{state}.png') as image:
                assert image.size == MATRIX[name], (name, image.size)
                frames[state] = image.convert('RGB')
        # Project list follows the measured workspace heading by the sidebar's 10pt gap.
        workspace = bounds['workspace-heading']
        top = workspace['origin']['y'] + workspace['size']['height'] + 10
        x, y, r, b = box(bounds, ('project-group-a', 'sessions', 'session-row-other-a'))
        row = (x + 16, y + top + 36, r + 16, b + top + 36)  # padding and second row stride
        sibling = (row[0], row[1] - 36, row[2], row[3] - 36)
        changed_row = changed(frames['rest'], frames['hover'], row)
        changed_sibling = changed(frames['rest'], frames['hover'], sibling)
        assert changed_row > (r - x) * (b - y) * .6 and changed_sibling == 0, (name, changed_row, changed_sibling)
        # The opaque card fill forms a continuous line below the rounded top corners.
        sx = bounds['sidebar']['size']['width']
        sample_y = row[1] + 13
        card = (sx + 2, sample_y, sx + 246, sample_y + 1)
        assert all(frames['hover'].getpixel((i, sample_y)) == (41, 41, 43) for i in range(card[0], card[2])), (name, card)
        card_changes = changed(frames['rest'], frames['hover'], card)
        restored = changed(frames['rest'], frames['leave'], row) + changed(frames['rest'], frames['leave'], card)
        assert card_changes >= 230 and restored == 0, (name, card_changes, restored)
        result[name] = dict(row=row, rowChangedPixels=changed_row, siblingChangedPixels=changed_sibling,
                            cardSample=card, cardChangedPixels=card_changes, leaveChangedPixels=restored)
    return result


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1])), indent=2))
