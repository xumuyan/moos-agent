"""Sign the local M01 app with an existing Apple Development identity for stable TCC identity."""
from pathlib import Path
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'probes/m01/desktop/src-tauri/target/release/bundle/macos/Moos M01 Probe.app'


def main():
    result = subprocess.run(['security', 'find-identity', '-v', '-p', 'codesigning'],
                            capture_output=True, text=True, check=True)
    identities = re.findall(r'([0-9A-F]{40}) "Apple Development:[^"]+"', result.stdout)
    if len(identities) != 1:
        raise RuntimeError('Expected one existing valid Apple Development identity; no signing performed')
    identity = identities[0]
    # Do not export private keys, alter key ACLs, or replace user trust settings.
    for target in (APP / 'Contents/MacOS/moos-native', APP / 'Contents/MacOS/node', APP):
        signed = subprocess.run(['codesign', '--force', '--sign', identity, '--timestamp=none', str(target)],
                                capture_output=True)
        if signed.returncode:
            raise RuntimeError('Local development signing failed; inspect the system keychain prompt')
    checked = subprocess.run(['codesign', '--verify', '--deep', '--strict', str(APP)], capture_output=True)
    if checked.returncode:
        raise RuntimeError('Local app signature verification failed')
    print(json.dumps({'developmentSigned': True, 'signatureVerified': True,
                      'privateKeyExported': False, 'notarized': False}))


if __name__ == '__main__':
    main()
