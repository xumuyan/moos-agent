"""Check the isolated candidate scope and bind its scripted native evidence."""
import hashlib
import json
from pathlib import Path
import unittest

from nsh_composer_provenance import PROBE, ROOT, current_composer_input, wenkai_evidence


class DesktopPIIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.receipt = json.loads((PROBE / 'desktop-pi-integration-evidence.json').read_text())

    def verified(self, record):
        path = ROOT / record['path']
        self.assertTrue(path.is_relative_to(ROOT / 'artifacts/nsh-validation/pi-ui'))
        if path.is_file():  # Native artifacts are intentionally local, not distributed.
            data = path.read_bytes()
            self.assertEqual(len(data), record['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])
            return data
        return None

    def test_build_uses_same_sources_without_adopting_owner_inputs(self):
        e = self.receipt
        self.assertEqual(e['protected'], wenkai_evidence()['protected'])
        self.assertTrue(e['protected'].keys().isdisjoint(e['newInputs']))
        self.assertEqual(set(e['newInputs']), {f'probes/nsh-validation/{name}' for name in
                         ('DesktopPIHost.swift', 'desktop-pi-check.tsx', 'verify-desktop-pi.mjs')})
        for path, record in e['newInputs'].items():
            record = current_composer_input(self, path, record, after=wenkai_evidence)
            source = (ROOT / path).read_bytes()
            self.assertEqual(len(source), record['bytes'])
            self.assertEqual(hashlib.sha256(source).hexdigest(), record['sha256'])
        for mode, run in e['runs'].items():
            self.assertEqual(run['status'], 0)
            self.assertEqual(run['bundleIdentifier'], 'dev.muma.probe.nsh.piui')
            methods = e['methods'] + ([] if mode == 'buildOnly' else ['piui.disconnect', 'piui.report'])
            self.assertEqual(run['capabilities']['host'], methods)
            self.verified(run['runLog'])
            inputs = self.verified(run['inputReceipt'])
            if inputs is not None:
                actual = json.loads(inputs)
                self.assertEqual(actual['head'], e['base'])
                self.assertIs(actual['artwork'], mode != 'fallback')
                self.assertIs(actual['acceptance'], mode != 'buildOnly')
                for path, record in e['newInputs'].items():
                    self.assertEqual(actual['inputs'][path], record)
                for filename in ('desktop-ui-controller.ts', 'desktop-ui-transport.ts'):
                    path = f'probes/nsh-validation/{filename}'
                    self.assertEqual(actual['inputs'][path]['sha256'], e['protected'][path])
            output = self.verified(run['resultReceipt'])
            if output is not None:
                self.assertEqual(json.loads(output), run['result'])

    def test_window_evidence_is_not_manual_or_deployment_acceptance(self):
        e = self.receipt
        self.assertEqual(e['platform']['kind'], 'Mac Catalyst')
        self.assertEqual({k for k, v in e['acceptance'].items() if v},
                         {'scriptedWindow', 'realPiSdk', 'loopbackFixtureOnly'})
        self.assertEqual(e['methods'], ['projects.list', 'sessions.list', 'sessions.create',
                         'tasks.submit', 'tasks.cancel', 'tasks.events'])
        self.assertEqual(set(e['runs']), {'withArt', 'fallback', 'buildOnly'})
        self.assertEqual(e['runs']['buildOnly']['result'],
                         dict(built=True, launched=False, installed=False, acceptance=False))
        for mode in ('withArt', 'fallback'):
            result = e['runs'][mode]['result']
            self.assertTrue(result['passed'] and result['normalChildExit'])
            self.assertFalse(result['forced'])
            self.assertEqual(result['stderrBytes'], 0)
            self.assertEqual(len(set(result['checks'])), 17)
            self.assertTrue({'native window layout', 'real write/read', 'foreign task denied',
                             'public text once', 'session round trip', 'real multi-page drain',
                             'stop active command', 'send again after stop', 'no polling after drain',
                             'active EOF drained', 'disconnect not success', 'JS waiters disposed'}
                            <= set(result['checks']))
            self.assertGreater(result['backlogEvents'], 150)
            self.assertGreater(result['backlogPages'], 0)
            self.assertEqual(result['backlogPolls'], result['backlogPages'] + 1)
            for key in ('startup', 'max:tasks.submit', 'max:tasks.events', 'stop drain', 'same session recovery'):
                self.assertGreaterEqual(result['timings'][key], 0)
