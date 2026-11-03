"""Sign only the disposable M01 uni-app x base using an existing local identity.

No private key export or cloud build. Profiles and IPA outputs must stay ignored.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile

BUNDLE_ID = 'dev.moos.m01mobile'


def validate_profile(profile, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    expiry = profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc)
    if expiry <= now:
        raise ValueError('Development profile is expired')
    entitlements = profile['Entitlements']
    if entitlements.get('application-identifier', '').split('.', 1)[-1] != BUNDLE_ID:
        raise ValueError('Profile must match the M01 bundle identifier')
    if not entitlements.get('get-task-allow') or not profile.get('ProvisionedDevices'):
        raise ValueError('A development profile with registered devices is required')
    if 'com.apple.developer.applesignin' in entitlements or 'aps-environment' in entitlements:
        raise ValueError('M01 must not request Apple Sign In or push notification capabilities')
    return entitlements


def run(args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        # Preserve no raw account/certificate output in command results or logs.
        raise RuntimeError('Command failed: ' + Path(args[0]).name + ', exit=' + str(result.returncode))
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    profile = plistlib.loads(run(['security', 'cms', '-D', '-i', str(args.profile)]))
    entitlements = validate_profile(profile)
    identities = run(['security', 'find-identity', '-v', '-p', 'codesigning']).decode()
    valid = set(re.findall(r'\b[0-9A-F]{40}\b', identities))
    candidates = [hashlib.sha1(cert).hexdigest().upper() for cert in profile['DeveloperCertificates']]
    identity = next((candidate for candidate in candidates if candidate in valid), None)
    if identity is None:
        raise RuntimeError('No valid local identity matches the development profile')
    with tempfile.TemporaryDirectory(prefix='moos-m01-sign-') as temp:
        root = Path(temp)
        run(['/usr/bin/ditto', '-x', '-k', str(args.base), str(root)])
        apps = list((root / 'Payload').glob('*.app'))
        if len(apps) != 1:
            raise ValueError('Expected one app in the official runtime base')
        app = apps[0]
        info_path = app / 'Info.plist'
        info = plistlib.loads(info_path.read_bytes())
        if info.get('CFBundleExecutable') != 'UniAppX':
            raise ValueError('This script only accepts the uni-app x runtime base')
        info['CFBundleIdentifier'] = BUNDLE_ID
        info['CFBundleDisplayName'] = 'Moos M01'
        info['NSLocalNetworkUsageDescription'] = '连接同一 Wi-Fi 下的 Mac，验证 Moos 测试服务连通性。'
        info['NSAppTransportSecurity'] = {'NSAllowsLocalNetworking': True}
        info_path.write_bytes(plistlib.dumps(info))
        shutil.copyfile(args.profile, app / 'embedded.mobileprovision')
        entitlement_file = root / 'm01.entitlements'
        entitlement_file.write_bytes(plistlib.dumps(entitlements))
        nested = list(app.rglob('*.framework')) + list(app.rglob('*.dylib'))
        if list(app.rglob('*.appex')):
            raise ValueError('Unexpected extensions require separate profiles; refusing')
        for item in sorted(nested, key=lambda path: len(path.parts), reverse=True):
            run(['codesign', '--force', '--sign', identity, '--timestamp=none', str(item)])
        run(['codesign', '--force', '--sign', identity, '--timestamp=none',
             '--entitlements', str(entitlement_file), str(app)])
        run(['codesign', '--verify', '--deep', '--strict', str(app)])
        args.output.parent.mkdir(parents=True, exist_ok=True)
        # Archive only Payload, never the loose entitlement/profile staging files.
        run(['/usr/bin/ditto', '-c', '-k', '--keepParent', str(root / 'Payload'), str(args.output)])
    print(json.dumps({'signedBaseVerified': True, 'bundleId': BUNDLE_ID,
                      'privateKeyExported': False, 'nestedComponentsSigned': len(nested)}))


if __name__ == '__main__':
    main()
