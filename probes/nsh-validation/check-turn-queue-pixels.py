"""Verify wide queue hover is confined to the dock in local 1× AppKit captures."""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


def verify(directory):
    result = json.loads((directory / 'result.json').read_text())
    prefix = 'TURN_QUEUE_GEOMETRY '
    records = [json.loads(line[len(prefix):]) for line in (directory / 'test.log').read_text().splitlines()
               if line.startswith(prefix)]
    measurements = {record['name']: record for record in records}
    assert len(records) == len(measurements) == 9
    # 280pt sidebar and 64pt header at 1240. The art adds 76pt trim + 8pt inset;
    # fallback has the 32pt native titlebar + 8pt inset.
    parent = (280, 64 + (84 if result['artwork'] else 40))
    paint = {}
    for scheme in ('light', 'dark'):
        name = f'turn-queue-{scheme}-1240'
        rest, hover = (measurements[f'{name}-{state}'] for state in ('single', 'hover'))
        assert rest['dock'] == hover['dock'] and rest['safe'] == hover['safe']
        box = rest['dock']
        x, y = (round(parent[i] + box['origin'][axis]) for i, axis in enumerate(('x', 'y')))
        w, h = (round(box['size'][axis]) for axis in ('width', 'height'))
        crop = (x, y, x + w, y + h)
        with Image.open(directory / f'{name}-single.png') as a, Image.open(directory / f'{name}-hover.png') as b:
            assert a.size == b.size == (1240, 820)
            diff = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
            delta = diff.getbbox()
            assert delta and crop[0] <= delta[0] < delta[2] <= crop[2] and crop[1] <= delta[1] < delta[3] <= crop[3], (name, crop, delta)
            changed = sum(pixel != (0, 0, 0) for pixel in diff.crop(crop).get_flattened_data())
            assert changed > w * h * .6, (name, changed)
        paint[scheme] = dict(crop=crop, changedBounds=delta, changedPixels=changed)
    return paint


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1])), indent=2))
