"""Stock AppKit runner measurement and separate native PI pipe evidence."""
import hashlib
import json
import subprocess
import unittest
from pathlib import Path

from nsh_composer_provenance import ROOT

PROBE = ROOT / 'probes/nsh-validation'


class DesktopAppKitEvidenceTests(unittest.TestCase):
    def record(self, path):
        data = path.read_bytes()
        return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())

    def artifact(self, receipt):
        path = Path(receipt['path'])
        self.assertFalse(path.is_absolute() or '..' in path.parts)
        self.assertEqual(path.parts[:2], ('artifacts', 'nsh-validation'))
        self.assertTrue(path.parts[2].startswith('appkit-spike.'))
        if (ROOT / path).is_file():
            self.assertEqual(self.record(ROOT / path), {k: receipt[k] for k in ('bytes', 'sha256')})
            return (ROOT / path).read_text()
        return None

    def setUp(self):
        self.e = json.loads((PROBE / 'desktop-appkit-evidence.json').read_text())

    def test_stock_sizes_and_explicitly_unavailable_host(self):
        run = self.e['run']
        baseline = run['baseline']
        self.assertEqual((run['version'], run['arch'], run['id']),
                         ('nsh 0.5.0 (f4d68f7)', 'arm64', 'dev.muma.probe.nsh.appkit.baseline'))
        self.assertEqual(baseline['runner'], baseline['stripped'])
        self.assertEqual(baseline['signed'], 'ad-hoc deep strict')
        self.assertEqual((baseline['available'], baseline['error'], baseline['headlessPassed'], baseline['quit']),
                         (False, 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', 1, True))
        self.assertFalse(run['externalModel'] or run['installed'])
        self.assertGreater(baseline['bundleKiB'] * 1024, baseline['runner']['bytes'])
        self.assertLess(baseline['zipBytes'], baseline['runner']['bytes'])
        receipt = self.e['artifacts']
        for name, record in receipt.items():
            data = self.artifact(record)
            if data is not None and name == 'result.json':
                self.assertEqual(json.loads(data), run)
            if data is not None and name == 'baseline-exit.log':
                self.assertIn('APPKIT_BASELINE false ERR_FEATURE_UNAVAILABLE_ON_PLATFORM', data)
            if data is not None and name == 'pipe-run.log':
                self.assertEqual(json.loads(data), run['transport'])

    def test_pipe_inputs_and_blocked_custom_build_remain_distinct(self):
        run = self.e['run']
        for name, record in run['inputs'].items():
            self.assertEqual(Path(name).name, name)
            self.assertEqual(self.record(PROBE / name), record, name)
        for name in ('DesktopPipe.swift', 'desktop-host-stdio.mjs'):
            data = subprocess.check_output(['git', 'show', f"{self.e['base']}:probes/nsh-validation/{name}"], cwd=ROOT)
            self.assertEqual(hashlib.sha256(data).hexdigest(), run['inputs'][name]['sha256'])
        t = run['transport']
        self.assertTrue(t['passed'])
        self.assertEqual((t['stage'], t['nshEmbedded'], t['hostExit'], t['forced'], t['stderrBytes']),
                         ('complete', False, 0, False, 0))
        self.assertEqual(len(t['checks']), 7)
        self.assertIn('Stop then terminal and full drain', t['checks'])
        self.assertIn('same-session Send after drain', t['checks'])
        build = self.e['optimizedBuild']
        self.assertEqual((build['offline'], build['status'], build['missing'], build['version']), (True, 1, 'nsh-core', '0.5.0'))
        log = self.artifact(build['log'])
        if log is not None:
            self.assertIn('no matching package named `nsh-core` found', log)
        self.assertTrue({'custom AppKit NSH embedding', 'optimized LTO shell size', 'complete AppKit PI bundle',
                         'manual GUI', 'formal deployment'} <= set(self.e['notAccepted']))
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {task}', plan)
