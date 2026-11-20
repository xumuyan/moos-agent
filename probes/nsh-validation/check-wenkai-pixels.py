"""Check the 1x AppKit ThemeFontSamples fixture (requires Pillow)."""
import json
from pathlib import Path
import sys

from PIL import Image, ImageChops


def check(path: Path):
    with Image.open(path) as screenshot:
        image = screenshot.convert('RGB')
    if image.size != (976, 200):
        raise ValueError(f'Expected a 976×200, 1× font sample, got {image.size}')
    # Each column has the same content and fractional drawing origin. The only
    # difference is the requested family: candidate, explicit WenKai, missing
    # family plus system fallback, then system fallback alone.
    rows = {'regularText': (8, 35), 'semiboldText': (39, 67),
            'input': (73, 102), 'markdown': (104, 135)}
    result = {}
    for row, (y0, y1) in rows.items():
        cells = [image.crop((i * 244 + 8, y0, i * 244 + 220, y1)) for i in range(4)]
        counts = {}
        for label, a, b in (('vsWenKai', 0, 1), ('missingVsFallback', 2, 3), ('vsFallback', 0, 3)):
            diff = ImageChops.difference(cells[a], cells[b])
            red, green, blue = diff.split()
            unchanged = ImageChops.lighter(ImageChops.lighter(red, green), blue).histogram()[0]
            counts[label] = diff.width * diff.height - unchanged
        if counts['vsWenKai'] or counts['missingVsFallback'] or counts['vsFallback'] < 100:
            raise ValueError(f'{row}: unexpected glyph comparison {counts}')
        result[row] = counts
    return result


if __name__ == '__main__':
    print(json.dumps(check(Path(sys.argv[1])), indent=2))
