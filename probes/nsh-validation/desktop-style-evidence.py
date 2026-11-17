"""Make small local review boards from native captures and static skin facts.
Not a browser/CSS renderer, not an Electron reference or pixel-equivalence test.
Only run on an explicitly named capture directory; never read a production HOME.
Requires Pillow (on this machine: /opt/homebrew/bin/python3).
"""
import argparse
import hashlib
import json
import re
import struct
import textwrap
from pathlib import Path

REGIONS = [
    ('background', 'light-idle', (280, 75, 1240, 650), 'body:before'),
    ('sidebar', 'light-chat', (0, 0, 280, 820), ':is([data-pane="sidebar"], [class*="sidebarCol"])'),
    ('messages-tools', 'light-chat', (390, 105, 1130, 525), '[class*="userRow"] [class*="bubble"]'),
    ('composer', 'light-chat', (380, 615, 1145, 810), '[data-composer-card],\n[data-phase="hero"] [data-composer-card]'),
    ('details', 'light-details', (980, 0, 1240, 820), ':is([data-pane="details"], [class*="detailsCol"])'),
]
SCENES = {'light-idle': (1240, 820), 'light-chat': (1240, 820),
          'light-details': (1240, 820), 'narrow-sidebar': (680, 720),
          'narrow-chat': (680, 720), 'dark-details': (1240, 820), 'dark-chat': (1240, 820)}


def png_size(path):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('not original PNG: ' + str(path))
    return struct.unpack('>II', data[16:24])


def digest(path):
    data = path.read_bytes()
    return {'path': str(path.resolve()), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def build(run, out, facts_path):
    run, out = run.resolve(), out.resolve()
    if out.exists():
        raise ValueError('output exists; refuse overwriting previous evidence')
    from PIL import Image, ImageDraw, ImageFont
    facts = json.loads(facts_path.read_text())
    frames = [json.loads(line.split('STYLE_FRAME ', 1)[1]) for line in (run / 'test.log').read_text().splitlines() if 'STYLE_FRAME ' in line]
    assert len(frames) == len(SCENES)
    images = []
    for frame in frames:
        name = frame['name']
        expected = SCENES[name]
        assert png_size(run / (name + '.png')) == expected
        state = frame['state']
        assert state['scaleFactor'] == 1
        assert (state['contentBounds']['size']['width'], state['contentBounds']['size']['height']) == expected
        assert state['bounds']['size']['height'] - expected[1] == 28
        images.append({**digest(run / (name + '.png')), 'scene': name, 'pixels': list(expected), 'frame': frame})
    out.mkdir(parents=True, mode=0o700)
    font_file = Path('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
    font = ImageFont.truetype(str(font_file), 16)
    small = ImageFont.truetype(str(font_file), 13)
    boards = []
    for name, scene, rect, selector in REGIONS:
        crop = Image.open(run / (scene + '.png')).convert('RGB').crop(rect)
        crop.save(out / (name + '-native.png'), optimize=True)
        matching = [f for f in facts['styleFacts'] if f['selector'] == selector and not f['conditions']]
        assert matching, selector
        # Facts are printed verbatim, not rendered as if this were the production DOM.
        lines = ['STATIC CSS/TOKEN REFERENCE / 静态事实，非 Electron 截图',
                 'maid-atelier 0.3.2 / CC BY-NC-SA 4.0',
                 'Not a CSS renderer; no hooks/DOM/layout/font-equivalence claim.',
                 'Left: native crop, may be reduced to fit this review board.',
                 'Original crop: ' + str(crop.size) + ' px; coordinates: ' + str(rect)]
        for f in matching:
            lines += ['', f['file'] + ':' + str(f['line'])]
            for part in selector.splitlines():
                lines += textwrap.wrap(part, width=68) or ['']
            declarations = f['declarations'].splitlines()
            for line in declarations[:23]:
                lines += [line[i:i+68] for i in range(0, len(line), 68)]
            if len(declarations) > 23:
                lines += ['... Full source facts in skin-source.json (not truncated there).']
        swatches = re.findall(r'#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b', '\n'.join(f['declarations'] for f in matching))[:8]
        board = Image.new('RGB', (1280, max(900, 130 + len(lines) * 20)), '#eef1f7')
        d = ImageDraw.Draw(board)
        d.text((16, 12), name + ' | NSH native capture vs static source facts (NOT visual acceptance)', font=font, fill='#172347')
        thumb = crop.copy(); thumb.thumbnail((570, 800))
        board.paste(thumb, (16, 65))
        d.text((16, 40), 'SYNTHETIC ONLY / 合成内容 / test-host content capture', font=small, fill='#ab3248')
        for i, line in enumerate(lines):
            d.text((610, 60 + 20 * i), line, font=small, fill='#172347')
        for i, color in enumerate(swatches):
            # A small independent alpha-compositing diagram, NOT a CSS layout renderer.
            rgba = tuple(int(color[j:j+2], 16) for j in (1, 3, 5)) + (int(color[7:9], 16) if len(color) == 9 else 255,)
            sample = Image.new('RGBA', (68, 22), '#eef1f7')
            sample = Image.alpha_composite(sample, Image.new('RGBA', (68, 22), rgba))
            board.paste(sample.convert('RGB'), (610+i*78, board.height-48))
            d.rectangle((610+i*78, board.height-48, 678+i*78, board.height-26), outline='#c5a468')
            d.text((610+i*78, board.height-24), color, font=small, fill='#172347')
        dest = out / (name + '-comparison.jpg'); board.save(dest, quality=86, optimize=True)
        boards.append({'region': name, 'scene': scene, 'cropContentRect': list(rect), 'crop': digest(out / (name + '-native.png')), 'comparison': digest(dest), 'facts': matching})
    # Broad side-by-side state changes; no production reference mixed in.
    contact = Image.new('RGB', (1240, 900), '#eef1f7'); d = ImageDraw.Draw(contact)
    d.text((10, 8), 'NSH SYNTHETIC STATES / native content, NOT Electron comparison or system screen capture', font=font, fill='#172347')
    for idx, scene in enumerate(['light-chat', 'light-details', 'narrow-sidebar', 'narrow-chat']):
        im = Image.open(run / (scene + '.png')).convert('RGB'); im.thumbnail((600, 400))
        x, y = (idx % 2)*620+10, (idx//2)*430+40
        d.text((x,y), scene + ' (reduced)', font=small, fill='#172347');contact.paste(im,(x,y+22))
    contact.save(out / 'states.jpg', quality=86, optimize=True)
    size = sum(p.stat().st_size for p in run.glob('*.png')) + sum(p.stat().st_size for p in out.iterdir() if p.is_file())
    assert size < 16 * 1024 * 1024, 'visual evidence exceeds 16MiB budget'
    result = {'schemaVersion': 1, 'task': 'N01-D3/style_evidence', 'captureKind': 'NSH macOS native development test-host content capture',
              'productionScreenshot': False, 'manualGui': False, 'visualAccepted': False, 'performanceConclusion': False,
              'reference': 'static source CSS/token facts with independent Pillow diagrams/text; NOT Electron/DOM/computed style rendering',
              'source': digest(facts_path), 'boardFont': digest(font_file), 'images': images, 'boards': boards,
              'statesBoard': digest(out / 'states.jpg'), 'visualBytes': size, 'budgetBytes': 16*1024*1024,
              'readOnlyProductionCapture': {'status': 'blocked', 'reason': 'desktop_permissions: screen recording and accessibility not granted; no bypass attempted'},
              'rights': {'artCommitted': False, 'license': 'CC BY-NC-SA 4.0', 'attribution': '上善 → zipzip → Small-tailqwq', 'distributionReviewPending': True}}
    (out / 'manifest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    result = build(args.run, args.out, Path(__file__).with_name('skin-source.json'))
    print(json.dumps({'manifest': str((args.out/'manifest.json').resolve()), 'visualBytes': result['visualBytes'], 'images': len(result['images']), 'boards': len(result['boards'])}))
