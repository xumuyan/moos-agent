"""N01-D1 Host checkpoint must not imply native desktop completion."""
from pathlib import Path
import hashlib
import json
import unittest

from nsh_composer_provenance import current_composer_input

ROOT = Path(__file__).resolve().parents[1]


class DesktopHostCheckpointTests(unittest.TestCase):
    def test_reviewed_host_scope_and_real_results(self):
        evidence = json.loads((ROOT / 'probes/nsh-validation/desktop-host-evidence.json').read_text())
        self.assertEqual(len(evidence['baselineSha256']), 6)
        for path, digest in evidence['sourceSha256'].items():
            digest = current_composer_input(self, path, digest)
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest)
        for result in evidence['regression'].values():
            self.assertEqual(hashlib.sha256((ROOT / result['log']).read_bytes()).hexdigest(), result['sha256'])
        self.assertEqual(evidence['regression']['targeted-final.log']['summary']['pass'], 13)
        self.assertEqual(evidence['regression']['acceptance.json']['summary']['checks'], 9)
        self.assertTrue(evidence['acceptedScope']['terminalAndNoMoreRequired'])
        self.assertFalse(evidence['overallN01D1Complete'])
        self.assertFalse(evidence['allRegressionsGreen'])
        self.assertTrue(all(v is False for v in evidence['protection'].values()))
        self.assertTrue(all(v is False for v in evidence['notClaimed'].values()))
        self.assertIn('- [ ] N01-D1 ', (ROOT / 'PLAN.md').read_text())
        self.assertIn('Host/私有管道子项', (ROOT / 'PLAN.md').read_text())
        self.assertIn('terminal && hasMore=false', (ROOT / 'probes/nsh-validation/DESKTOP-HOST.md').read_text())
        contract = (ROOT / 'probes/nsh-validation/desktop-contract.ts').read_text()
        for method in ('projects.list', 'sessions.list', 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events'):
            self.assertIn("'" + method + "':", contract)
        self.assertIn('!hasMore', contract)
        self.assertIn(evidence['commitSubject'], (ROOT / 'operatelog.md').read_text())
