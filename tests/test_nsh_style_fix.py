"""Portable repair record checks, not live visual or native acceptance."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class NativeStyleFixTests(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((NSH / 'desktop-style-fix-verification.json').read_text())

    def test_partial_checkpoint_never_claims_complete_acceptance(self):
        self.assertEqual(self.record['task'], 'N01-D3/native_style_fix')
        self.assertTrue(all(v is False for v in self.record['acceptance'].values()))
        results = self.record['results']
        self.assertEqual(results['nativeSafe']['passed'], 9)
        self.assertEqual(results['richDiagnostic']['status'], 'failed')
        self.assertIn('timeout', [a.get('status') for a in results['richDiagnostic']['attempts']])
        self.assertEqual(results['electron']['skipped'], 10)
        self.assertEqual(results['rust']['status'], 'blocked')
        self.assertEqual(len(self.record['images']), 12)
        for image in self.record['images']:
            self.assertEqual(image['format'], 'PNG')
            self.assertIn(image['pixels'], [[680, 720], [1240, 820]])
            self.assertRegex(image['sha256'], r'^[a-f0-9]{64}$')

    def test_protection_and_licensed_art_opt_in(self):
        self.assertTrue(self.record['protectedWorktree']['allNonOwnedUnchanged'])
        self.assertEqual(len(self.record['protectedWorktree']['untrackedOwnedByOthers']), 7)
        self.assertEqual(self.record['source']['license'], 'CC BY-NC-SA 4.0')
        self.assertFalse(self.record['source']['hooksExecuted'])
        self.assertFalse(self.record['source']['artPublished'])
        view = (NSH / 'DesktopView.tsx').read_text()
        self.assertNotIn('Application Support', view)
        self.assertIn('onGeometry?', view)
        self.assertIn("width: 'fit-content'", view)
        self.assertIn('会话统计', (NSH / 'DesktopComposerStatistics.tsx').read_text())
        layers = (NSH / 'desktop-theme-layers.tsx').read_text()
        self.assertIn('pointerEvents: \'none\'', layers)
        self.assertIn('width: 130, height: 130', layers)
        self.assertIn("left: '50%'", layers)

    def test_diagnostic_remains_reproducible_and_bounds_are_parent_local(self):
        runner = (NSH / 'verify-desktop-theme.mjs').read_text()
        self.assertIn("process.argv.includes('--rich')", runner)
        self.assertIn('desktop-theme-rich-check.tsx', runner)
        self.assertIn('ThemeGeometry.tsx', runner)
        checks = (NSH / 'desktop-style-assert.ts').read_text()
        for marker in ('body.origin.y + outer.origin.y', 'safe.frameBottom',
                       "b['composer-actions'].origin.y", "b['message-PI 公开文本']"):
            self.assertIn(marker, checks)
        review = (NSH / 'NATIVE-STYLE-FIX.md').read_text()
        for marker in ('SA01', 'SA09', 'M11', '根因未定', '未通过', '用户视觉认可',
                       'onLayout为父容器局部坐标', '无体积/CPU/内存收益结论'):
            self.assertIn(marker, review)
        for name in ('PLAN.md', 'operatelog.md'):
            text = (ROOT / name).read_text()
            self.assertIn('native_style_fix', text)
            self.assertIn('NATIVE-STYLE-FIX.md', text)
