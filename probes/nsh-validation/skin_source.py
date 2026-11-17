"""N01-D3 read-only skin provenance collector. Never imports/executes skin hooks.
Only explicit skin-selection metadata and known skin/package assets are read.
Output contains metadata/style facts, not artwork or complete scripts.
"""
import argparse
import hashlib
import json
import re
import struct
from pathlib import Path


def sha(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def blocks(text, start=0, end=None, parents=()):
    """Static CSS blocks, including media/keyframes; strings/comments are inert."""
    end = len(text) if end is None else end
    pos = start
    while pos < end:
        begin = pos
        quote = None
        i = pos
        while i < end:
            if quote:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == quote:
                    quote = None
            elif text.startswith('/*', i):
                close = text.find('*/', i + 2)
                if close < 0:
                    raise ValueError('unclosed CSS comment')
                i = close + 2
                continue
            elif text[i] in '\"\'':
                quote = text[i]
            elif text[i] == '{':
                break
            i += 1
        if i == end:
            break
        header = re.sub(r'/\*.*?\*/', '', text[begin:i], flags=re.S).strip()
        opened = i
        depth = 1
        i += 1
        quote = None
        while i < end and depth:
            if quote:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == quote:
                    quote = None
            elif text.startswith('/*', i):
                close = text.find('*/', i + 2)
                if close < 0:
                    raise ValueError('unclosed CSS comment')
                i = close + 2
                continue
            elif text[i] in '\"\'':
                quote = text[i]
            elif text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
            i += 1
        if depth:
            raise ValueError('unclosed CSS block')
        line = text.count('\n', 0, opened) + 1
        if header.startswith(('@media', '@supports', '@keyframes', '@layer')):
            yield from blocks(text, opened + 1, i - 1, parents + (header,))
        else:
            body = re.sub(r'/\*.*?\*/', '', text[opened + 1:i - 1], flags=re.S).strip()
            yield {"selector": header, "line": line, "conditions": list(parents), "declarations": body}
        pos = i


def webp_dimensions(path):
    data = path.read_bytes()
    if data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        raise ValueError('not WebP')
    offset = 12
    while offset + 8 <= len(data):
        kind = data[offset:offset + 4]
        size = struct.unpack_from('<I', data, offset + 4)[0]
        body = data[offset + 8:offset + 8 + size]
        if kind == b'VP8X' and len(body) >= 10:
            return [1 + int.from_bytes(body[4:7], 'little'), 1 + int.from_bytes(body[7:10], 'little')]
        if kind == b'VP8L' and len(body) >= 5 and body[0] == 47:
            bits = int.from_bytes(body[1:5], 'little')
            return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
        if kind == b'VP8 ' and len(body) >= 10 and body[3:6] == b'\x9d\x01\x2a':
            return [int.from_bytes(body[6:8], 'little') & 0x3fff, int.from_bytes(body[8:10], 'little') & 0x3fff]
        offset += 8 + size + size % 2
    raise ValueError('unsupported WebP dimensions')


def safe_file(base, relative):
    p = base / relative
    if not p.resolve().is_relative_to(base.resolve()) or not p.is_file():
        raise ValueError('source missing or escapes approved directory: ' + relative)
    return p


def collect(home, app):
    selection_path = safe_file(home, 'skin-center-active.json')
    selection = json.loads(selection_path.read_text())
    skin_id = selection.get('active')
    if not isinstance(skin_id, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', skin_id):
        raise ValueError('blocked: no valid persisted active skin')
    skin = home / 'skins' / skin_id
    manifest = json.loads(safe_file(skin, 'skin.json').read_text())
    if manifest['id'] != skin_id:
        raise ValueError('blocked: selection/manifest mismatch')
    plugin = home / 'profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center'
    package = json.loads(safe_file(plugin, 'package.json').read_text())
    files = {name: sha(safe_file(skin, name)) for name in ['skin.json', 'skin.css', 'patches.css', 'hooks.mjs', 'LICENSE', 'NOTICE']}
    assets = []
    for p in sorted((skin / 'assets').glob('*.webp')):
        safe_file(skin, str(p.relative_to(skin)))
        assets.append({"path": str(p.relative_to(skin)), **sha(p), "pixels": webp_dimensions(p), "license": manifest['license'], "redistributed": False})
    rules = []
    # Curated style facts; the full skin and artwork are not copied into Git.
    selectors = ['[id="root"]', 'body', 'body:before', 'body:after', '[data-skin-chrome="character-stage"]',
        '[data-maid-character]', '[data-maid-character="left"]', '[data-maid-character="right"]',
        '[data-skin-chrome="top-trim"]', '[data-skin-trim-layer="landing"]', '[data-skin-trim-layer="workspace"]',
        '[data-skin-chrome="bottom-trim"]', '[data-skin-chrome="sidebar-mascot"]',
        ':is([data-pane="sidebar"], [class*="sidebarCol"])', ':is([data-pane="sidebar"], [class*="sidebarCol"]) > div',
        ':is([data-pane="details"], [class*="detailsCol"])', '[data-maid-workspace-row]',
        'button[class*="newSession"]', '[class*="userRow"] [class*="bubble"]',
        '[data-chat-flow-kind="assistant-step"] > * > * > * > div[class*="markdown"]',
        '[data-composer-card],\n[data-phase="hero"] [data-composer-card]', '[data-composer-card]:before',
        '[data-composer-card]:after', '[data-composer-card] [class*="trailing"] button[aria-haspopup="menu"]',
        '[data-skin-chrome="sidebar-corners"]', '[data-skin-chrome="sidebar-corners"] > [data-skin-corner]',
        '[data-maid-sidebar-footer]', '[data-maid-sidebar-footer]:before']
    for name in ['skin.css', 'patches.css']:
        for rule in blocks(safe_file(skin, name).read_text()):
            # Full token declarations + exact selected component facts and state variants.
            if name == 'skin.css' or rule['selector'] in selectors or any(
                term in rule['selector'] for term in ['data-maid-chat-active', 'data-maid-better-sidebar-open',
                    'data-maid-low-power', 'data-maid-viewport-resizing', 'data-maid-workspace-row',
                    'data-maid-workspace-active', 'data-maid-session', 'data-maid-sidebar-size']) or any(
                rule['selector'] == 'body[data-ds-dark-theme] ' + s for s in selectors):
                rules.append({"file": name, **rule})
    frontend = app / 'Contents/Resources/host-runtime/dsh/node_modules/@deepseek-ai/dsh-web-frontend'
    frontend_package = json.loads(safe_file(frontend, 'package.json').read_text())
    defaults = app / 'Contents/Resources/host-runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme'
    default_text = safe_file(defaults, 'lib/client.js').read_text()
    default_package = json.loads(safe_file(defaults, 'package.json').read_text())
    shell = home / 'profiles/web/node_modules/moos-electron-shell'
    shell_package = json.loads(safe_file(shell, 'package.json').read_text())
    animations = [dict(file='patches.css', **r) for r in blocks(safe_file(skin, 'patches.css').read_text())
        if any('keyframes' in c for c in r['conditions']) or re.search(r'(?:animation|transition)\s*:', r['declarations'])]
    result = {
        "schemaVersion": 1, "task": "N01-D3/skin_source", "method": "read-only static inspection; no hooks executed; no GUI/computed styles",
        "authorization": "User explicitly permitted narrow reading of production skin selection and skin files for this task; does not authorize other private data or redistribution.",
        "sourcePaths": {"dshHome": "$REAL_USER/Library/Application Support/dev.moos.agent.electron/dsh", "selection": "skin-center-active.json", "skin": 'skins/' + skin_id, "skinCenter": "profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center", "frontend": "/Applications/沐码.app/Contents/Resources/host-runtime/dsh/node_modules/@deepseek-ai/dsh-web-frontend"},
        "selection": {"active": skin_id, "initialized": selection.get('initialized'), "backgroundOverridePresent": 'background' in selection, "sha256": sha(selection_path)['sha256'], "runtimeActiveVerified": False, "runtimeThemeMode": "unknown", "runtimePreviewOrOtherWallpaper": "unknown"},
        "identity": {k: manifest[k] for k in ['id', 'name', 'version', 'author', 'license', 'sourceUrl', 'licenseUrl', 'noticeUrl', 'attribution', 'skinManifestVersion']},
        "skinCenter": {"name": package['name'], "version": package['version'], "license": package.get('license'), "files": {n: sha(safe_file(plugin, n)) for n in ['package.json', 'lib/index.js', 'lib/client.js']}},
        "frontend": {"name": frontend_package['name'], "version": frontend_package['version'], "files": {n: sha(safe_file(frontend, n)) for n in ['package.json', 'LICENSE']}},
        "defaultTheme": {"name": default_package['name'], "version": default_package['version'], "license": default_package.get('license'),
            "source": "installed host-runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js",
            "files": {n: sha(safe_file(defaults, n)) for n in ['package.json', 'lib/client.js']},
            "declarations": re.findall(r'--(?:dsh-font-family-(?:text-default|code-default)|dsw-font-family|dsw-font-s-14|dsw-radius-[a-z0-9-]+)\s*:[^;{}]+', default_text)},
        "electronShell": {"name": shell_package['name'], "version": shell_package['version'],
            "source": "DSH_HOME/profiles/web/node_modules/moos-electron-shell/client.js", "file": sha(safe_file(shell, 'client.js'))},
        "files": files, "requires": manifest.get('requires'), "stylesheet": manifest['contributes'].get('stylesheet'),
        "patches": manifest['contributes'].get('patches'), "backgroundMedia": manifest['contributes']['backgroundMedia'], "assets": assets, "styleFacts": rules,
        "animationFacts": animations,
        "blocked": ["Runtime DOM skin stamp, dark/light mode, preview and hooks health not observed", "Native renderer fidelity, runtime fonts and visual acceptance not tested", "Art not bundled or redistributed; publication/commercial licensing requires separate review"],
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dsh-home', type=Path, required=True, help='explicit REAL user DSH directory; no HOME guessing')
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True, help='metadata JSON only; no source files copied')
    args = parser.parse_args()
    result = collect(args.dsh_home, args.app)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({"skin": result['identity']['id'], "version": result['identity']['version'], "assets": len(result['assets']), "rules": len(result['styleFacts']), "runtimeVerified": False}))


if __name__ == '__main__':
    main()
