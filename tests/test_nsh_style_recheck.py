"""Portable recheck records only, not live screenshots or visual acceptance."""
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class StyleRecheckDocumentationTests(unittest.TestCase):
    def test_original_matrix_and_failed_visual_status_are_retained(self):
        m = json.loads((NSH / 'desktop-style-recheck-verification.json').read_text())
        self.assertEqual(m['visualStatus'], 'failed-return-to-native-style-fix')
        self.assertTrue(all(v is False for v in m['acceptance'].values()))
        self.assertEqual(len(m['originals']), 19)
        self.assertEqual(len(m['oldOriginals']), 5)
        self.assertEqual(len(m['comparisons']), 5)
        self.assertEqual(len(m['crops']), 14)
        self.assertEqual(set(m['originalsOpened']), {i['name'] for i in m['originals']})
        self.assertEqual([r['id'] for r in m['returnToFix']], ['SE01', 'SE02'])
        for image in m['originals']:
            self.assertEqual(image['format'], 'PNG')
            self.assertIn(image['pixels'], ([1240, 820], [680, 720]))
            self.assertEqual(image['frame']['state']['scaleFactor'], 1)
            self.assertRegex(image['sha256'], r'^[a-f0-9]{64}$')
            self.assertTrue(Path(image['path']).is_absolute())
        self.assertEqual(m['tests']['electron']['skipped'], 10)
        self.assertEqual(m['tests']['rust']['status'], 'blocked')
        self.assertEqual(m['tests']['rich']['status'], 'not-rerun')
        self.assertFalse(m['captureInputs']['piExecuted'])
        self.assertEqual(m['rights']['license'], 'CC BY-NC-SA 4.0')

    def test_historical_capture_is_frozen_and_later_scroll_repair_is_linked(self):
        m = json.loads((NSH / 'desktop-style-recheck-verification.json').read_text())
        repair = json.loads((NSH / 'desktop-scroll-verification.json').read_text())
        later = json.loads((NSH / 'desktop-live-sidebar-verification.json').read_text())
        tree = json.loads((NSH / 'desktop-sidebar-tree-verification.json').read_text())
        footer = json.loads((NSH / 'desktop-sidebar-footer-verification.json').read_text())
        typography = json.loads((NSH / 'desktop-typography-verification.json').read_text())
        chrome = json.loads((NSH / 'desktop-window-chrome-verification.json').read_text())
        activity = json.loads((NSH / 'desktop-sidebar-activity-verification.json').read_text())
        for name in ('DesktopView.tsx', 'desktop-theme.ts', 'desktop-theme-layers.tsx',
                     'desktop-style-capture.tsx', 'verify-desktop-theme.mjs', 'desktop-theme-fixture.ts'):
            data = (NSH / name).read_bytes()
            path = 'probes/nsh-validation/' + name
            if name in repair['historicalInputHashes']:
                self.assertEqual(repair['historicalInputHashes'][name], m['captureInputs']['workspaceHashes'][name]['sha256'])
                expected = repair['inputs'][path]['sha256']
                if path in later['priorScrollInputs']:
                    self.assertEqual(later['priorScrollInputs'][path], expected)
                    expected = later['inputs'][path]['sha256']
                if path in tree['previousInputs']:
                    self.assertEqual(tree['previousInputs'][path], expected)
                    expected = tree['inputs'][path]['sha256']
                if path in footer['previousInputs']:
                    self.assertEqual(footer['previousInputs'][path], expected)
                    expected = footer['inputs'][path]['sha256']
                if path in typography['previousInputs']:
                    self.assertEqual(typography['previousInputs'][path], expected)
                    expected = typography['inputs'][path]['sha256']
            else:
                expected = m['captureInputs']['workspaceHashes'][name]['sha256']
            if path in chrome['previousInputs']:
                self.assertEqual(chrome['previousInputs'][path], expected)
                expected = chrome['inputs'][path]['sha256']
            if path in activity['previousInputs']:
                self.assertEqual(activity['previousInputs'][path], expected)
                expected = activity['inputs'][path]['sha256']
            self.assertEqual(hashlib.sha256(data).hexdigest(), expected)
        # Do not require another owner's untracked files in a clean checkout.
        self.assertIn('probes/nsh-validation/DesktopUIHost.swift', m['protectedFiles'])
        self.assertEqual(len(m['protectedFiles']), 119)

    def test_documents_link_failed_recheck_without_closing_product(self):
        doc = (NSH / 'STYLE-EVIDENCE-RECHECK.md').read_text()
        for word in ('SE01', 'SE02', 'run-tT4s6p', 'run-JGWPko', '视觉验收未通过', '不执行 PI', '不是系统录屏'):
            self.assertIn(word, doc)
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('STYLE-EVIDENCE-RECHECK.md', (ROOT / name).read_text())
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, (ROOT / 'PLAN.md').read_text())


if __name__ == '__main__':
    unittest.main()
