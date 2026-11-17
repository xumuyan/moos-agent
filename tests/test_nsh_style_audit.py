"""Portable audit contract checks; not visual/GUI or performance acceptance."""
import hashlib
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class NSHStyleAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit = json.loads((NSH / 'desktop-style-audit.json').read_text())
        cls.review = (NSH / 'desktop-style-fix-review.md').read_text()

    def test_source_facts_match_pinned_inventory_not_live_private_files(self):
        source = json.loads((NSH / 'skin-source.json').read_text())
        self.assertEqual(self.audit['skin']['assetsChecked'], len(source['assets']))
        self.assertEqual(self.audit['skin']['textFilesChecked'], len(source['files']))
        self.assertEqual(self.audit['skin']['license'], 'CC BY-NC-SA 4.0')
        self.assertFalse(self.audit['skin']['hooksExecuted'])
        self.assertFalse(self.audit['skin']['artPublished'])
        for fact in self.audit['facts']:
            self.assertTrue(any(all(item[key] == fact[key] for key in fact)
                                for item in source['styleFacts']), fact)

    def test_issues_matrix_and_evidence_limits_are_explicit(self):
        self.assertEqual([i['id'] for i in self.audit['issues']],
                         [f'SA{i:02d}' for i in range(1, 10)])
        self.assertEqual([m['id'] for m in self.audit['matrix']],
                         [f'M{i:02d}' for i in range(1, 13)])
        for item in self.audit['issues'] + self.audit['matrix']:
            self.assertIn(item['status'], ('open', 'pending'))
            self.assertIn(item['id'], self.review)
        self.assertTrue(all(v is False for v in self.audit['acceptance'].values()))
        for text in ['idle 蕾丝与标题交叠', '底部预览说明与框饰交叠',
                     '不是 Electron 窗口或 DOM 渲染', 'fit-content', 'flat特例',
                     '没有dark-idle及dark-narrow', '不跑性能专项', '手机',
                     'style_layout', 'style_layers', 'style_evidence', 'desktop_integration']:
            self.assertIn(text, self.review)
        self.assertEqual(len(self.audit['images']), 2)
        for image in self.audit['images']:
            self.assertEqual(image['pixels'], [1240, 820])
            self.assertEqual(image['format'], 'PNG')
            self.assertRegex(image['sha256'], r'^[a-f0-9]{64}$')
            self.assertIn('NOT live Electron', image['source'])
        # No captures, artwork or private application directory required by tests.

    def test_historical_audit_protects_non_owned_inputs_and_original_testids(self):
        untracked = self.audit['untrackedOwnedByOthers']
        self.assertEqual(len(untracked), 7)
        self.assertEqual(len(self.audit['protected']), 16)
        # Audit hashes freeze its old workspace, not a ban on later authorized repairs.
        repair = json.loads((NSH / 'desktop-style-fix-verification.json').read_text())
        authorized = set(repair['modifiedAuditInputs'])
        self.assertEqual(authorized, {str(Path('probes/nsh-validation') / name) for name in (
            'DesktopView.tsx', 'desktop-theme.ts', 'desktop-theme-layers.tsx',
            'desktop-theme.test.tsx', 'desktop-style-capture.tsx', 'verify-desktop-theme.mjs')})
        for name, record in self.audit['protected'].items():
            if name in untracked or name in authorized:
                continue  # Never require/adopt another owner's untracked inputs.
            data = (ROOT / name).read_bytes()
            self.assertEqual(len(data), record['bytes'], name)
            self.assertEqual(hashlib.sha256(data).hexdigest(), record['sha256'], name)
        view = (NSH / 'DesktopView.tsx').read_text()
        layers = (NSH / 'desktop-theme-layers.tsx').read_text()
        baseline_ids = ('desktop-root sidebar sidebar-brand create-session search-unavailable projects selection sessions sidebar-footer settings-unavailable chat-column chat-header toggle-navigation toggle-details status error empty-state messages message composer composer-frame prompt stop send art-status details-panel skin-layers palace-background wallpaper-scrim character-left character-right top-trim bottom-trim').split()
        for token in baseline_ids:
            self.assertIn('testID="' + token + '"', view + layers)
        contract = (NSH / 'desktop-contract.ts').read_text()
        methods = re.findall(r"^  '([^']+)': \{ params:", contract, re.M)
        self.assertEqual(len(methods), 6)
        for method in methods:
            self.assertIn(method, self.review)

    def test_root_documents_keep_audit_and_pending_product_gates(self):
        for name in ('PLAN.md', 'operatelog.md'):
            text = (ROOT / name).read_text()
            self.assertIn('style_audit', text)
            self.assertIn('desktop-style-fix-review.md', text)
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, plan)


if __name__ == '__main__':
    unittest.main()
