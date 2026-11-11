"""Read-only candidate acceptance; no input/capture, production mutation or permission request."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / '.generated/moos-electron/build-QBaZWa/沐码.app'
RES = APP / 'Contents/Resources'
OUT = ROOT / 'artifacts/m06-transaction/final/package-acceptance.json'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def invoke(*args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=120)
    return p.returncode, p.stdout

code, _ = invoke('/usr/bin/codesign', '--verify', '--deep', '--strict', str(APP))
assert code == 0, 'strict signature failed'
info = plistlib.loads((APP / 'Contents/Info.plist').read_bytes())
assert info['CFBundleShortVersionString'] == '0.1.43'
assert info['CFBundleIdentifier'] == 'dev.moos.agent.electron'
metadata = json.loads((RES / 'moos-runtime.json').read_text())
assert metadata['includesPiFixture'] is False
matches = {}
for source, target in [
    *[(f'packages/pi-runtime/{n}.mjs', f'pi-runtime/packages/pi-runtime/{n}.mjs') for n in
      ['desktop-transaction', 'desktop-queue', 'desktop-tools', 'sdk-runtime']],
    ('apps/electron/pi-turn.mjs', 'app/pi-turn.mjs'),
    ('apps/electron/plugin/host.js', 'profile-template/profiles/web/node_modules/moos-electron-shell/host.js'),
    ('apps/electron/plugin/package.json', 'profile-template/profiles/web/node_modules/moos-electron-shell/package.json'),
]:
    assert digest(ROOT / source) == digest(RES / target), source
    matches[source] = digest(ROOT / source)
helper = RES / 'bin/moos-desktop-helper'
code, text = invoke(str(helper), 'permissions')
assert code == 0
permissions = json.loads(text)
assert permissions['helperVersion'] == '2'
# Never post input, even if this launch context later obtains permissions.
blocked = None
if not permissions['accessibilityGranted']:
    code, text = invoke(str(helper), 'focus')
    assert code == 3
    blocked = {'mode': 'focus', 'exit': code, 'payload': json.loads(text)}
    assert blocked['payload']['permission'] == 'accessibility'
fixture = {'pid': 42, 'bundleId': 'com.example.synthetic', 'windowId': 7,
           'window': {'x': 0, 'y': 0, 'width': 800, 'height': 600},
           'element': {'x': 20, 'y': 20, 'width': 100, 'height': 30}, 'role': 'AXTextField', 'path': [0, 2]}
plans = []
for change in [{}, {'pid': 43}, {'windowId': 8}, {'path': [1, 2]}]:
    code, text = invoke(str(helper), 'plan-focus', '--expect-focus', json.dumps(fixture),
                        '--actual-focus', json.dumps({**fixture, **change}), '--typing')
    result = json.loads(text)
    assert code == 0 and result['posted'] is False and result['accepted'] == (not change)
    plans.append({'changedFields': list(change), **result})
logical = sum(p.stat().st_size for p in APP.rglob('*') if p.is_file() and not p.is_symlink())
allocated = int(subprocess.check_output(['/usr/bin/du', '-sk', str(APP)], text=True).split()[0])
production = plistlib.loads(Path('/Applications/沐码.app/Contents/Info.plist').read_bytes())
result = {
    'recordedAt': datetime.datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),
    'build': str(APP.relative_to(ROOT)), 'version': info['CFBundleShortVersionString'],
    'bundleId': info['CFBundleIdentifier'], 'strictDeepSignatureVerified': True, 'includesPiFixture': False,
    'helperSha256': digest(helper), 'helperSourceSha256': digest(ROOT / 'apps/electron/desktop-helper.swift'),
    'sourceMatches': matches, 'permissions': permissions, 'blockedFocus': blocked, 'nonPostingFocusPlans': plans,
    'logicalFileBytesExcludingSymlinks': logical, 'allocatedKiB': allocated,
    'distributionArchiveBytes': None, 'firstLaunchDownloadBytes': None,
    'productionVersionReadOnly': production['CFBundleShortVersionString'],
    'nativeInputOrScreenCaptureExecuted': False,
}
OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
