"""Portable footer provenance, not licensed art, GUI or full product acceptance."""
import hashlib
import json
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class SidebarFooterTests(unittest.TestCase):
    def test_exact_inputs_and_historical_transition(self):
        m = json.loads((NSH / 'desktop-sidebar-footer-verification.json').read_text())
        tree = json.loads((NSH / 'desktop-sidebar-tree-verification.json').read_text())
        self.assertEqual(len(m['inputs']), 5)
        typography = json.loads((NSH / 'desktop-typography-verification.json').read_text())
        chrome = json.loads((NSH / 'desktop-window-chrome-verification.json').read_text())
        activity = json.loads((NSH / 'desktop-sidebar-activity-verification.json').read_text())
        for name, rec in m['inputs'].items():
            expected = rec['sha256']
            if name in typography['previousInputs']:
                self.assertEqual(typography['previousInputs'][name], expected)
                expected = typography['inputs'][name]['sha256']
            if name in chrome['previousInputs']:
                self.assertEqual(chrome['previousInputs'][name], expected)
                expected = chrome['inputs'][name]['sha256']
            if name in activity['previousInputs']:
                self.assertEqual(activity['previousInputs'][name], expected)
                expected = activity['inputs'][name]['sha256']
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), expected)
        for name, sha in m['previousInputs'].items():
            self.assertEqual(sha, tree['inputs'][name]['sha256'])
        self.assertEqual(len(m['protected']), 7)
        self.assertTrue(all(r['unchanged'] for r in m['protected'].values()))
        self.assertFalse(m['rights']['artCommitted'])
        self.assertFalse(m['rights']['hooksExecuted'])

    def test_tree_rule_and_native_geometry_are_not_overclaimed(self):
        m = json.loads((NSH / 'desktop-sidebar-footer-verification.json').read_text())
        self.assertIn(':has([role="tree"])', m['sourceRule']['selector'])
        self.assertEqual(m['sourceRule']['declaration'], 'display: none')
        view = (NSH / 'DesktopView.tsx').read_text()
        self.assertIn('footer().mascotVisible && <Art', view)
        self.assertIn('sidebarFooter(layout().sidebar, true)', view)
        self.assertIn('marginBottom: -16', view)
        self.assertIn('each={messageRows()}', view)
        self.assertNotIn('NSH 0.5.0 · 独立验证', view)
        check = (NSH / 'desktop-live-sidebar-check.tsx').read_text()
        for token in ('bottom(footer) - b.sidebar.size.height', 'id:sidebar-mascot', 'id:settings-unavailable', 'toBe(false)', 'app.scroll'):
            self.assertIn(token, check)
        self.assertEqual(len(m['candidate']['images']), 8)
        self.assertTrue(m['candidate']['synthetic'])
        self.assertFalse(m['candidate']['piExecuted'])
        self.assertTrue(all(not v for v in m['acceptance'].values()))

    def test_regressions_and_open_product_status(self):
        m = json.loads((NSH / 'desktop-sidebar-footer-verification.json').read_text())
        self.assertEqual(m['tests']['coreFirst']['failed'], 1)
        self.assertEqual(m['tests']['coreFinal'], {'passed': 362, 'failed': 0})
        self.assertEqual(m['tests']['headlessArtFirst']['failed'], 1)
        self.assertEqual(m['tests']['electron']['skipped'], 10)
        self.assertEqual(m['tests']['rust']['missing'], 'defmt')
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('SIDEBAR-FOOTER.md', (ROOT / name).read_text())
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, plan)
        doc = (NSH / 'SIDEBAR-FOOTER.md').read_text()
        for token in ('未部署', '用户视觉认可', '不执行 Host/PI', '不宣称已定位', 'CC BY-NC-SA 4.0'):
            self.assertIn(token, doc)
