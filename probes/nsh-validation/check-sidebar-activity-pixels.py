"""Verify native motion only in the activity gutter of the 1240x820 fixtures.

Requires local Pillow. Pass an existing --sidebar-activity run directory;
this never captures a window or reads installed app state.
"""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


def verify(directory):
    # Screen coordinates of the first row's status gutter at 1×.
    box = (20, 420, 36, 438)
    core = (25, 426, 31, 434)
    center = (27, 430)
    report = {}
    for scheme in ('light', 'dark'):
        frames = {}
        for suffix in ('idle', 'working', 'working-next', 'unselected', 'narrow-working', 'narrow'):
            with Image.open(directory / f'tree-{scheme}-{suffix}.png') as image:
                expected = (680, 720) if suffix.startswith('narrow') else (1240, 820)
                if image.size != expected:
                    raise ValueError(f'Unexpected fixture frame size: {image.size}')
                frames[suffix] = image.convert('RGB')
        working = frames['working']
        following = frames['working-next']
        difference = ImageChops.difference(working.crop(box), following.crop(box))
        count = sum(pixel != (0, 0, 0) for pixel in difference.get_flattened_data())
        fixed_core = ImageChops.difference(working.crop(core), following.crop(core)).getbbox() is None
        blue_core = working.getpixel(center)
        visible = blue_core[2] - blue_core[0] > 65 and blue_core[0] < 50
        for suffix in ('unselected', 'narrow-working'):
            assert frames[suffix].getpixel(center) == blue_core, (scheme, suffix)
        for suffix in ('idle', 'narrow'):
            assert frames[suffix].getpixel(center) != blue_core, (scheme, suffix)
        report[scheme] = dict(crop=box, changedPixels=count, fixedCore=fixed_core,
                              visibleCore=visible, reducedMotion=scheme == 'dark')
        if not (fixed_core and visible and (count > 0) == (scheme == 'light')):
            raise AssertionError(report[scheme])
    return report


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1])), indent=2))
