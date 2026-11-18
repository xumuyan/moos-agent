"""Portable checkpoint contract; does not require licensed art or untracked UI."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class ScrollFixTests(unittest.TestCase):
    def test_regression_keeps_old_failure_and_limits(self):
        m = json.loads((NSH / 'desktop-scroll-verification.json').read_text())
        self.assertEqual(m['cause']['baseline']['failed'], 4)
        self.assertEqual(m['cause']['isolation']['passed'], 4)
        self.assertEqual(m['tests']['rich']['passed'], 6)
        self.assertEqual(m['tests']['core']['passed'], 356)
        self.assertEqual(m['tests']['electron']['skipped'], 10)
        self.assertEqual(m['tests']['rust']['status'], 'blocked')
        self.assertTrue(all(not v for v in m['acceptance'].values()))
        self.assertEqual(len(m['protectedFiles']), 7)
        self.assertTrue(all(v['unchanged'] for v in m['protectedFiles'].values()))
        self.assertFalse(m['rights']['artCommitted'])
        self.assertFalse(m['rights']['hooksExecuted'])
        self.assertEqual(len(m['images']), 35)
        for image in m['images']:
            self.assertIn(image['pixels'], ([1240, 820], [680, 720]))
            self.assertRegex(image['sha256'], r'^[a-f0-9]{64}$')

    def test_source_snapshots_and_real_scroll_assertions(self):
        m = json.loads((NSH / 'desktop-scroll-verification.json').read_text())
        for name, record in m['inputs'].items():
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), record['sha256'])
        view = (NSH / 'DesktopView.tsx').read_text()
        self.assertIn('each={messageRows()}', view)
        self.assertIn('paddingRight: 36', view)
        rich = (NSH / 'desktop-theme-rich-check.tsx').read_text()
        for token in ('contentSize.height', 'offset.y', 'app.wait(900)', 'app.setViewport', 'tool_end · read · 错误'):
            self.assertIn(token, rich)
        runner = (NSH / 'verify-desktop-theme.mjs').read_text()
        self.assertIn(".repeat(35)", runner)
        self.assertIn(".repeat(30)", runner)

    def test_plan_and_report_do_not_claim_product_completion(self):
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('SCROLL-FIX.md', (ROOT / name).read_text())
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, plan)
        report = (NSH / 'SCROLL-FIX.md').read_text()
        for token in ('不是干净检出完整交付', '不执行PI', '没有CPU/内存', '整体视觉验收仍未通过'):
            self.assertIn(token, report)
