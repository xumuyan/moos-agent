"""Portable provenance checks, not visual acceptance or private-data requirements."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class LiveSidebarTests(unittest.TestCase):
    def test_live_reference_is_not_synthetic_candidate_or_bound_window_capture(self):
        m = json.loads((NSH / 'desktop-live-sidebar-verification.json').read_text())
        self.assertEqual(m['reference']['displayPixels'], [1920, 1080])
        self.assertEqual(m['reference']['cropRect'], [0, 30, 280, 988])
        self.assertIn('not a bound AX-window', m['reference']['source'])
        self.assertTrue(m['candidate']['synthetic'])
        self.assertFalse(m['candidate']['piExecuted'])
        self.assertEqual(len(m['candidate']['images']), 4)
        self.assertEqual(m['candidate']['outerPixels'], [1920, 1016])
        self.assertTrue(all(not v for v in m['acceptance'].values()))
        self.assertEqual(m['tests']['core']['passed'], 358)
        self.assertEqual(m['tests']['electron']['skipped'], 10)
        self.assertEqual(m['tests']['rust']['status'], 'blocked')

    def test_exact_inputs_and_historical_transition_preserved(self):
        m = json.loads((NSH / 'desktop-live-sidebar-verification.json').read_text())
        old = json.loads((NSH / 'desktop-scroll-verification.json').read_text())
        for name, record in m['inputs'].items():
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), record['sha256'])
        for name, sha in m['priorScrollInputs'].items():
            self.assertEqual(old['inputs'][name]['sha256'], sha)
        self.assertEqual(len(m['protected']), 7)
        self.assertTrue(all(v['unchanged'] for v in m['protected'].values()))
        self.assertFalse(m['rights']['artCommitted'])
        self.assertFalse(m['rights']['hooksExecuted'])
        # No screenshot/art or another owner's untracked input required here.

    def test_plan_keeps_remaining_style_and_product_open(self):
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('LIVE-SIDEBAR.md', (ROOT / name).read_text())
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, (ROOT / 'PLAN.md').read_text())
        doc = (NSH / 'LIVE-SIDEBAR.md').read_text()
        for text in ('focus-unavailable', '不是 computed-style', '项目树', '未部署', '视觉认可仍未取得'):
            self.assertIn(text, doc)
