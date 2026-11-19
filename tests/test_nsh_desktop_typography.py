"""Portable typography provenance; native and OCR checks run separately."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


def manifest(tag):
    return json.loads((NSH / f'desktop-{tag}-verification.json').read_text())


class DesktopTypographyTests(unittest.TestCase):
    def test_exact_inputs_and_prior_checkpoints(self):
        m = manifest('typography')
        old = manifest('scroll')['inputs'] | manifest('sidebar-footer')['inputs']
        self.assertEqual(len(m['inputs']), 4)
        self.assertEqual(set(m['previousInputs']), m['inputs'].keys() & old.keys())
        for name, sha in m['previousInputs'].items():
            self.assertEqual(sha, old[name]['sha256'])
        chrome = manifest('window-chrome')
        activity = manifest('sidebar-activity')
        for name, record in m['inputs'].items():
            if name in chrome['previousInputs']:
                self.assertEqual(chrome['previousInputs'][name], record['sha256'])
                record = chrome['inputs'][name]
            if name in activity['previousInputs']:
                self.assertEqual(activity['previousInputs'][name], record['sha256'])
                record = activity['inputs'][name]
            data = (ROOT / name).read_bytes()
            self.assertEqual(len(data), record['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'])
        self.assertEqual(len(m['protected']), 7)
        self.assertTrue(all(r['unchanged'] for r in m['protected'].values()))

    def test_native_typography_contract_and_evidence_limits(self):
        tokens = (NSH / 'desktop-theme.ts').read_text()
        view = (NSH / 'DesktopView.tsx').read_text()
        for token in ('PingFang SC', 'Songti SC', 'Georgia', 'Menlo', 'font: 14, lineHeight: 22'):
            self.assertIn(token, tokens)
        for token in ('testID="chat-title"', 'each={messageRows()}', 'code: { fontFamily: t.monoFont }',
                      'codeBlockCode: { fontFamily: t.monoFont }', 'testID="selection"'):
            self.assertIn(token, view)
        m = manifest('typography')
        self.assertTrue(m['candidate']['synthetic'])
        self.assertFalse(m['candidate']['piExecuted'])
        self.assertFalse(m['rights']['fontsBundled'])
        self.assertEqual(len(m['candidate']['images']), 8)
        self.assertEqual(len(m['candidate']['comparisons']), 3)
        self.assertEqual({b['scheme'] for b in m['candidate']['geometry']}, {'light', 'dark'})
        for b in m['candidate']['geometry']:
            self.assertEqual(b['title']['size']['height'], 24)
            self.assertLess(b['selection']['origin']['y'] + b['selection']['size']['height'], b['header']['size']['height'])
        self.assertEqual(m['tests']['typographyFirst']['failed'], 2)
        self.assertEqual(m['tests']['typography']['passed'], 2)
        self.assertTrue(all(not value for value in m['acceptance'].values()))

    def test_plan_and_log_keep_product_open(self):
        plan = (ROOT / 'PLAN.md').read_text()
        log = (ROOT / 'operatelog.md').read_text()
        self.assertIn('DESKTOP-TYPOGRAPHY.md', plan)
        self.assertIn('DESKTOP-TYPOGRAPHY.md', log)
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, plan)
