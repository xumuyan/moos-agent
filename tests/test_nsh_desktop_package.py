"""Bind the local branded package evidence without implying a public release."""
import hashlib
import json
import struct
import subprocess
import unittest

from nsh_composer_provenance import ROOT, desktop_package_evidence


def record(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


class DesktopPackageTests(unittest.TestCase):
    def artifact(self, receipt):
        path = ROOT / receipt['path']
        self.assertTrue(path.is_relative_to(ROOT / 'artifacts/nsh-validation/pi-ui'))
        if path.is_file():
            data = path.read_bytes()
            self.assertEqual(record(data), {k: receipt[k] for k in ('bytes', 'sha256')})
            return data
        return None

    def test_sources_cached_build_and_brand_identity(self):
        e = desktop_package_evidence()
        for path, digest in e['previousInputs'].items():
            prior = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(prior)['sha256'], digest, path)
        for path, expected in e['inputs'].items():
            self.assertEqual(record((ROOT / path).read_bytes()), expected, path)
        for mode in ('relocated', 'release'):
            info = e[mode]
            self.assertEqual(info['status'], 0)
            package = info['package']
            check = mode == 'relocated'
            identity = package['identity']
            self.assertEqual(identity, dict(displayName='沐码', bundleName='MuMa', artifactName='moos.icns',
                                            bundleIdentifier='dev.muma.probe.nsh.package' + ('.check' if check else '')))
            self.assertEqual(package['runtime']['icon'], e['inputs']['apps/electron/assets/moos.icns'])
            self.assertTrue(package['runtime']['offlineDependencies'] and package['verified'])
            self.assertEqual((package['signed'], package['modelMode']), ('ad-hoc', 'fixture'))
            self.assertEqual((package['testOnly'], package['relocated'], package['notarized'], package['installed']),
                             (check, check, False, False))
            self.assertGreater(package['bytesOnDisk'], 0)
            for key in ('packageReceipt', 'inputReceipt', 'log'):
                data = self.artifact(info[key])
                if data is not None and key == 'packageReceipt':
                    self.assertEqual(json.loads(data), package)
                if data is not None and key == 'inputReceipt':
                    inputs = json.loads(data)
                    self.assertEqual(inputs['head'], e['base'])
                    self.assertEqual((inputs['packaged'], inputs['persistent'], inputs['acceptance'], inputs['artwork']),
                                     (True, True, check, False))
                    for path, expected in (e['inputs'] | e['protectedRuntimeInputs']).items():
                        if path == 'tests/nsh_composer_provenance.py':
                            self.assertNotIn(path, inputs['inputs'])
                        else:
                            self.assertEqual(inputs['inputs'][path], expected, path)
        self.assertEqual(e['release']['inspectStatus'], 0)
        self.artifact(e['release']['inspectLog'])
        build = self.artifact(e['release']['buildReceipt'])
        if build is not None:
            self.assertEqual(json.loads(build), e['release']['build'])
        self.assertEqual(e['release']['build'], dict(built=True, launched=False, installed=False, acceptance=False))

    def test_relocated_fixture_reopens_but_is_not_manual_or_formal_acceptance(self):
        e = desktop_package_evidence()
        rel = e['relocated']
        result = rel['restartResult']
        self.assertEqual((result['portable'], result['manualQuit'], result['installed']), (True, False, False))
        self.assertEqual(result['first']['scope'], result['reopened']['scope'])
        self.assertEqual((len(result['first']['checks']), len(result['reopened']['checks'])), (3, 7))
        for which, restart in (('first', False), ('reopened', True)):
            report = result[which]
            self.assertTrue(report['passed'] and report['normalChildExit'])
            self.assertEqual((report['restart'], report['forced'], report['stderrBytes']), (restart, False, 0))
            data = self.artifact(rel[which])
            if data is not None:
                self.assertEqual(json.loads(data), report)
        for name in ('restored history without replay', 'PI continuation uses old context'):
            self.assertIn(name, result['reopened']['checks'])
        data = self.artifact(rel['restartReceipt'])
        if data is not None:
            self.assertEqual(json.loads(data), result)
        png = self.artifact(rel['screenshot'])
        if png is not None:
            self.assertEqual(list(struct.unpack('>II', png[16:24])), rel['screenshot']['pixels'])
        regression = e['disposableRegression']
        self.assertEqual((regression['status'], regression['passedChecks']), (0, 17))
        self.artifact(regression['log'])
        data = self.artifact(regression['result'])
        if data is not None:
            r = json.loads(data)
            self.assertIn('send again after stop', r['checks'])
            self.assertEqual((r['backlogEvents'], r['backlogPages'], r['backlogPolls']), (204, 2, 3))
        self.assertTrue({'formal migration', 'formal cutover', 'manual GUI', 'Developer ID and notarization',
                         'cross-machine distribution', 'release profile GUI startup'} <= set(e['notAccepted']))
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {task}', plan)
