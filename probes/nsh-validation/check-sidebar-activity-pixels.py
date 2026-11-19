"""Verify native motion only in the activity gutter of the 1240x820 fixtures.

Requires local Pillow. Pass an existing --sidebar-activity run directory;
this never captures a window or reads installed app state.
"""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


def verify(directory):
    # Contains the first session's 12pt marker anchored on the tree elbow.
    box = (26, 420, 42, 438)
    report = {}
    for scheme in ('light', 'dark'):
        frames = []
        for suffix in ('working', 'working-next'):
            with Image.open(directory / f'tree-{scheme}-{suffix}.png') as image:
                if image.size != (1240, 820):
                    raise ValueError(f'Unexpected fixture frame size: {image.size}')
                frames.append(image.convert('RGB').crop(box))
        difference = ImageChops.difference(*frames)
        count = sum(pixel != (0, 0, 0) for pixel in difference.getdata())
        report[scheme] = dict(crop=box, changedPixels=count, reducedMotion=scheme == 'dark')
        if (count > 0) != (scheme == 'light'):
            raise AssertionError(report[scheme])
    return report


if __name__ == '__main__':
    print(json.dumps(verify(Path(sys.argv[1])), indent=2))
