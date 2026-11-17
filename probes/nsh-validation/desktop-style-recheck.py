"""Post-repair evidence only. Original native PNGs stay intact; crops/comparisons
are explicitly derived review aids, never passed off as a captured app window.
No production directory, PI, network, or hook access. Pillow is local/optional.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

SCENES = {f'{scheme}-{state}': (680, 720) if 'narrow' in state else (1240, 820)
          for scheme in ('light', 'dark')
          for state in ('idle', 'chat', 'details', 'narrow-idle-sidebar', 'narrow-idle', 'narrow-chat')}
SHARED = ('light-idle', 'light-chat', 'light-details', 'dark-chat', 'dark-details')
REGIONS = {'top-title': (280, 0, 1240, 160), 'composer-bottom': (280, 500, 1240, 820),
           'sidebar': (0, 0, 280, 820)}


def digest(path):
    data = path.read_bytes()
    return {'path': str(path.resolve()), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def png_size(path):
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        raise ValueError('not original PNG: ' + str(path))
    return struct.unpack('>II', data[16:24])


def validate_frames(log):
    frames = {}
    for line in log.splitlines():
        if 'STYLE_FRAME ' not in line:
            continue
        frame = json.loads(line.split('STYLE_FRAME ', 1)[1])
        name = frame['name']
        if name in frames:
            raise ValueError('duplicate capture name: ' + name)
        frames[name] = frame
    for name, expected in SCENES.items():
        frame = frames.get(name)
        if frame is None:
            raise ValueError('missing capture frame: ' + name)
        state = frame['state']
        size = state['contentBounds']['size']
        if state['scaleFactor'] != 1 or (size['width'], size['height']) != expected:
            raise ValueError('content size or scale mismatch: ' + name)
        if not frame['synthetic']:
            raise ValueError('synthetic provenance required: ' + name)
    return frames


def verify_hashes(root, records):
    root = root.resolve()
    for name, expected in records.items():
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError('input escapes source tree')
        actual = digest(path)
        if any(actual[k] != expected[k] for k in ('bytes', 'sha256')):
            raise ValueError('input changed since capture: ' + name)


def build(run, old, out, repo):
    run, old, out, repo = (p.resolve() for p in (run, old, out, repo))
    if out.exists():
        raise ValueError('output exists; refuse overwriting historical evidence')
    # Both comparison inputs are explicit, distinct capture runs.
    if run == old:
        raise ValueError('old and new runs must differ')
    provenance = json.loads((run / 'capture-inputs.json').read_text())
    result = json.loads((run / 'result.json').read_text())
    if not (result['passed'] and result['evidence'] and result['artwork']):
        raise ValueError('successful explicit-art native evidence run required')
    if provenance['piExecuted'] or not provenance['synthetic']:
        raise ValueError('synthetic capture required')
    verify_hashes(repo / 'probes/nsh-validation', provenance['workspaceHashes'])
    verify_hashes(run / 'source', provenance['sourceHashes'])
    frames = validate_frames((run / 'test.log').read_text())
    images = []
    for name, frame in frames.items():
        path = run / (name + '.png')
        expected = SCENES.get(name, (frame['expectedContent']['width'], frame['expectedContent']['height']))
        if png_size(path) != expected:
            raise ValueError('original PNG size mismatch: ' + name)
        images.append({**digest(path), 'name': name, 'pixels': list(expected), 'format': 'PNG',
                       'kind': 'original native content capture', 'frame': frame})
    old_images = []
    for name in SHARED:
        path = old / (name + '.png')
        if png_size(path) != (1240, 820):
            raise ValueError('old comparison must be 1240x820: ' + name)
        old_images.append({**digest(path), 'name': name, 'pixels': [1240, 820]})
    from PIL import Image, ImageDraw
    out.mkdir(parents=True, mode=0o700)
    comparisons, crops = [], []
    for name in SHARED:
        canvas = Image.new('RGB', (2480, 850), '#eeeeee')
        draw = ImageDraw.Draw(canvas)
        draw.text((8, 8), 'DERIVED REVIEW ONLY | OLD run-JGWPko | synthetic native content', fill='black')
        draw.text((1248, 8), 'NEW ' + run.name + ' | synthetic native content | NOT visual acceptance', fill='black')
        for index, source in enumerate((old, run)):
            with Image.open(source / (name + '.png')) as im:
                canvas.paste(im.convert('RGB'), (index * 1240, 30))  # 1:1, no retouch/resize
        path = out / (name + '-old-new.png')
        canvas.save(path)
        comparisons.append({**digest(path), 'scene': name, 'pixels': [2480, 850],
                            'kind': 'derived labelled comparison, unscaled 1240x820 originals'})
    for name in ('light-idle', 'light-chat'):
        for tag, source in (('old', old), ('new', run)):
            for region, rect in REGIONS.items():
                path = out / f'{tag}-{name}-{region}.png'
                with Image.open(source / (name + '.png')) as im:
                    im.crop(rect).save(path)  # no alpha/color edits
                crops.append({**digest(path), 'source': str(source / (name + '.png')),
                              'rect': list(rect), 'kind': 'derived lossless crop'})
    for scheme in ('light', 'dark'):
        name = scheme + '-narrow-idle-sidebar'
        path = out / (name + '-project-crop.png')
        rect = (0, 220, 184, 340)
        with Image.open(run / (name + '.png')) as im:
            im.crop(rect).save(path)
        crops.append({**digest(path), 'source': str(run / (name + '.png')), 'rect': list(rect),
                      'kind': 'derived lossless crop'})
    manifest = {'schemaVersion': 1, 'task': 'N01-D3/style_evidence-recheck',
                'captureInputs': provenance, 'captureInputsFile': digest(run / 'capture-inputs.json'),
                'captureKind': 'NSH native development test-host content; not system screen recording',
                'reference': 'historical NSH run-JGWPko, NOT current Electron live reference',
                'originals': images, 'oldOriginals': old_images, 'comparisons': comparisons, 'crops': crops,
                'acceptance': {k: False for k in ('visualAccepted', 'manualGUI', 'allTestsPassed', 'externalModel',
                                                 'cleanCheckoutIntegrated', 'installed', 'deployed',
                                                 'performanceMeasured', 'overallN01Complete')},
                'rights': {'license': 'CC BY-NC-SA 4.0', 'attribution': '上善 → zipzip → Small-tailqwq',
                           'artCommitted': False, 'scope': 'authorized local preview only'},
                'visualStatus': 'failed-return-to-native-style-fix',
                'permissions': 'screen recording and accessibility not granted; no bypass or Electron capture',
                'observations': []}
    (out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('run', 'old', 'out'):
        parser.add_argument('--' + key, required=True, type=Path)
    args = parser.parse_args()
    manifest = build(args.run, args.old, args.out, Path(__file__).resolve().parents[2])
    print(args.out.resolve())
    print(f"{len(manifest['originals'])} originals; {len(manifest['comparisons'])} comparisons; "
          f"{len(manifest['crops'])} crops; visual acceptance remains failed/pending review")
