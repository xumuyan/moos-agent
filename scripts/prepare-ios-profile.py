"""Prepare the M01 development profile with the existing local Apple account.

Uses Xcode automatic signing and device registration; does not export private keys.
All generated account/device-specific files remain under ignored .generated/.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def capture(args):
    return subprocess.run(args, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--device', help='Optional connected iPhone name or identifier, never persisted')
    args = parser.parse_args()
    if args.device:
        details = json.loads(capture(['xcrun', 'devicectl', 'device', 'info', 'details',
                                     '--device', args.device, '--quiet', '--json-output', '-']))['result']
    else:
        devices = json.loads(capture(['xcrun', 'devicectl', 'list', 'devices', '--quiet',
                                     '--json-output', '-']))['result']['devices']
        available = [device for device in devices
                     if device.get('hardwareProperties', {}).get('platform') == 'iOS'
                     and device.get('connectionProperties', {}).get('pairingState') == 'paired']
        if len(available) != 1:
            raise RuntimeError('Connect one development iPhone or explicitly select --device')
        selected = available[0]
        details = json.loads(capture(['xcrun', 'devicectl', 'device', 'info', 'details',
                                     '--device', selected['identifier'], '--quiet', '--json-output', '-']))['result']
    if details['deviceProperties'].get('developerModeStatus') != 'enabled':
        raise RuntimeError('Enable Developer Mode on the selected phone first')
    if details['connectionProperties'].get('tunnelState') != 'connected':
        raise RuntimeError('Selected iPhone is paired but not currently reachable')
    device_id = details['hardwareProperties']['udid']
    identities = capture(['security', 'find-identity', '-v', '-p', 'codesigning']).decode()
    valid = set(re.findall(r'\b[0-9A-F]{40}\b', identities))
    certificates = capture(['security', 'find-certificate', '-a', '-c', 'Apple Development', '-p']).decode()
    teams = set()
    for certificate in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', certificates, re.S):
        der = subprocess.run(['openssl', 'x509', '-outform', 'DER'], input=certificate.encode(),
                             capture_output=True, check=True).stdout
        if hashlib.sha1(der).hexdigest().upper() not in valid:
            continue
        subject = subprocess.run(['openssl', 'x509', '-noout', '-subject', '-nameopt', 'RFC2253'],
                                 input=certificate.encode(), capture_output=True, check=True).stdout.decode()
        team = re.search(r'(?:^|,)OU=([A-Z0-9]+)(?:,|$)', subject)
        if team:
            teams.add(team.group(1))
    if len(teams) != 1:
        raise RuntimeError('Expected one valid local development signing team')
    folder = ROOT / '.generated/ios-provisioning'
    folder.mkdir(parents=True, exist_ok=True)
    for name in ('main.m', 'project.yml'):
        shutil.copyfile(ROOT / 'probes/m01/ios-provisioning' / name, folder / name)
    environment = dict(os.environ, MOOS_SIGNING_TEAM=teams.pop())
    subprocess.run(['xcodegen', 'generate', '--spec', str(folder / 'project.yml')],
                   env=environment, capture_output=True, check=True)
    build = subprocess.run(['xcodebuild', '-project', str(folder / 'M01Signing.xcodeproj'),
        '-scheme', 'M01Signing', '-configuration', 'Debug', '-destination', 'id=' + device_id,
        '-derivedDataPath', str(folder / 'DerivedData'), '-allowProvisioningUpdates',
        '-allowProvisioningDeviceRegistration', 'build'], capture_output=True, text=True, timeout=300)
    profile = folder / 'DerivedData/Build/Products/Debug-iphoneos/M01Signing.app/embedded.mobileprovision'
    print(json.dumps({'xcodebuildExitCode': build.returncode,
                      'profileGenerated': build.returncode == 0 and profile.exists()}))
    if build.returncode:
        # Redact account, team and hardware identifiers from diagnostic errors.
        output = build.stdout + build.stderr
        output = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', output)
        output = re.sub(r'\b[A-Z0-9]{10}\b', '[team]', output)
        output = re.sub(r'\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}\b', '[device]', output)
        for line in output.splitlines():
            if 'error:' in line:
                print(line[:1000])
        raise SystemExit(build.returncode)


if __name__ == '__main__':
    main()
