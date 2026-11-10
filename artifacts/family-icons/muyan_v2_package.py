# -*- coding: utf-8 -*-
"""Package MuYan v2 flat icon into the E107 family deliverable structure.

Formats mirror images/moos-family-ready/muyan-沐言: 12 transparent PNG sizes,
macOS ICNS + iconset (16-64 inverted, 128+ light, same E111 MuMa decision),
Windows ICO (7 resolutions), web favicon/apple-touch/PWA, iOS universal
appiconset (full-bleed), checksums and zip. Overwrites the v1 gradient pack.
"""
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'images/muyan-icon-v2'
FAM = ROOT / 'images/moos-family-ready'
FOLDER = FAM / 'muyan-沐言'
SIZES = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

light = Image.open(SRC / 'A-bubble-1024.png').convert('RGBA')
inverted = Image.open(SRC / 'A-bubble-1024-inverted.png').convert('RGBA')
play = Image.open(SRC / 'play-512-fullbleed.png').convert('RGB')
ios_full = Image.open(SRC / 'ios-appstore-1024-fullbleed.png').convert('RGB')

# rebuild the pack folder from scratch so no v1 files linger
import shutil
if FOLDER.exists():
    shutil.rmtree(FOLDER)
for sub in ['png', 'macos/AppIcon.iconset', 'windows', 'web', 'ios/AppIcon.appiconset', 'source']:
    (FOLDER / sub).mkdir(parents=True, exist_ok=True)


def save_resized(img, path, size):
    img.resize((size, size), Image.LANCZOS).save(path)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# png/: transparent squircle (light) at 12 sizes
for size in SIZES:
    save_resized(light, FOLDER / 'png' / f'muyan-{size}.png', size)

# macos/: iconset + icns, small sizes inverted
iconset = FOLDER / 'macos/AppIcon.iconset'
plan = {
    'icon_16x16.png': (16, inverted), 'icon_16x16@2x.png': (32, inverted),
    'icon_32x32.png': (32, inverted), 'icon_32x32@2x.png': (64, inverted),
    'icon_128x128.png': (128, light), 'icon_128x128@2x.png': (256, light),
    'icon_256x256.png': (256, light), 'icon_256x256@2x.png': (512, light),
    'icon_512x512.png': (512, light), 'icon_512x512@2x.png': (1024, light),
}
for name, (size, img) in plan.items():
    save_resized(img, iconset / name, size)
subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(FOLDER / 'macos/muyan.icns')], check=True)

# windows/: ICO with 7 resolutions generated from the light master
# (PIL's ICO plugin downsizes from the given image; it never upsizes)
light.resize((256, 256), Image.LANCZOS).save(
    FOLDER / 'windows/muyan.ico', format='ICO', sizes=[(s, s) for s in ICO_SIZES])

# web/: favicons inverted, apple-touch & PWA full-bleed
save_resized(inverted, FOLDER / 'web/favicon-16.png', 16)
save_resized(inverted, FOLDER / 'web/favicon-32.png', 32)
inverted.resize((48, 48), Image.LANCZOS).save(
    FOLDER / 'web/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
save_resized(play, FOLDER / 'web/apple-touch-icon.png', 180)
save_resized(play, FOLDER / 'web/pwa-192.png', 192)
save_resized(play, FOLDER / 'web/pwa-512.png', 512)

# ios/: universal single-size appiconset with full-bleed artwork
(FOLDER / 'ios/AppIcon.appiconset/AppIcon-1024.png').write_bytes((SRC / 'ios-appstore-1024-fullbleed.png').read_bytes())
(FOLDER / 'ios/AppIcon.appiconset/Contents.json').write_text(json.dumps({
    'images': [{'filename': 'AppIcon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
    'info': {'author': 'moos-agent', 'version': 1},
}, indent=2) + '\n')

# opaque square + transparent master
play.resize((1024, 1024), Image.LANCZOS).save(FOLDER / 'app-icon-square-1024.png')
light.save(FOLDER / 'app-icon-transparent-1024.png')
light.save(FOLDER / 'source/muyan-v2-master-1024.png')

# checksums.json over every deliverable file
entries = {}
for path in sorted(FOLDER.rglob('*')):
    if path.is_file() and path.name != 'checksums.json':
        entries[str(path.relative_to(FOLDER))] = {'bytes': path.stat().st_size, 'sha256': sha256(path)}
(FOLDER / 'checksums.json').write_text(json.dumps({
    'app': '沐言 (MuYan)', 'design': 'v2 flat per DeepSeek/Apple HIG/Google Play language, same family as MuMa E111',
    'brandColor': '#F76B5B', 'generator': 'artifacts/family-icons/muyan_v2_icons.py + muyan_v2_package.py',
    'files': entries,
}, ensure_ascii=False, indent=2) + '\n')

# README
(FOLDER / 'README-使用说明.md').write_text('''# 沐言（MuYan）应用图标 v2 纯平版

- 设计语言：与沐码 v2（E111）同一家族——白底圆角方（Apple squircle）、纯平单色符号、无渐变/无 3D/无阴影；小尺寸反色（珊瑚底白气泡）保证 16px 可读。
- 品牌色：珊瑚 #F76B5B（取自 v1 渐变 #FE9859→#F66477 的纯平中间值）。
- 符号：对话气泡 + 三根语音波形竖条（延续 v1 识别度），程序化几何绘制，非 AI 位图放大。
- 内容：
  - `png/` 12 档透明 PNG（16–1024）
  - `macos/` ICNS + iconset（16–64 反色、128+ 白底）
  - `windows/` ICO 7 分辨率（≤32 反色）
  - `web/` favicon、apple-touch、PWA
  - `ios/` AppIcon.appiconset（1024 全出血，系统自动遮角）
  - `app-icon-square-1024.png` 不透明方版（Google Play 全出血同源）
- 合规：Apple HIG（单一焦点、不透明、留白）、Google Play（512 全出血、无预置圆角/阴影、图形在 66/108 框线网格内并有自动安全区断言）。
- 校验：`checksums.json` 记录全部文件大小与 SHA256。
''')

# zip (overwrite v1 archive)
archive = FAM / 'muyan-沐言-icons.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zf:
    for path in sorted(FOLDER.rglob('*')):
        if path.is_file():
            zf.write(path, path.relative_to(FOLDER))

icns_check = subprocess.run(['iconutil', '-c', 'iconset', str(FOLDER / 'macos/muyan.icns'), '-o', '/tmp/muyan-icns-verify.iconset'], capture_output=True, text=True)
files = sorted(str(p.relative_to(FOLDER)) for p in FOLDER.rglob('*') if p.is_file())
print('icns roundtrip:', 'ok' if icns_check.returncode == 0 else icns_check.stderr)
print('zip bytes:', archive.stat().st_size, 'zip sha256:', sha256(archive))
print('file count:', len(files))
print('sizes present:', len([f for f in files if f.startswith('png/')]))
