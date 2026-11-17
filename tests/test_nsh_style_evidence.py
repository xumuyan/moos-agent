import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class NSHStyleEvidenceDocumentationTests(unittest.TestCase):
    def test_evidence_scope_and_source_are_honest(self):
        evidence = json.loads((NSH / 'desktop-style-verification.json').read_text())
        self.assertEqual(len(evidence['images']), 7)
        self.assertEqual(len(evidence['boards']), 5)
        self.assertLess(evidence['visualBytes'], evidence['budgetBytes'])
        for key in ['manualGui', 'visualAccepted', 'cleanCheckoutIntegrated', 'performanceMeasured', 'installed', 'deployed', 'overallN01Complete']:
            self.assertFalse(evidence['acceptance'][key], key)
        self.assertEqual(evidence['rights']['license'], 'CC BY-NC-SA 4.0')
        self.assertFalse(evidence['rights']['artCommitted'])
        for image in evidence['images']:
            self.assertEqual(image['frame']['state']['scaleFactor'], 1)
            self.assertRegex(image['sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(evidence['tests']['electron']['skipped'], 10)
        self.assertEqual(evidence['tests']['rust']['status'], 'blocked')

    def test_review_and_root_documents_preserve_unfinished_gates(self):
        review = (NSH / 'DESKTOP-STYLE-EVIDENCE.md').read_text()
        self.assertIn('不是实时系统截图', review)
        self.assertIn('fileURLToPath', review)
        self.assertIn('353/354', review)
        self.assertIn('蕾丝与标题基线仍相交', review)
        for name in ['PLAN.md', 'operatelog.md']:
            text = (ROOT / name).read_text()
            self.assertIn('style_evidence', text)
            self.assertIn('354/354', text)
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ['N01-D1', 'N01-D2', 'N01-D3']:
            self.assertIn('- [ ] ' + task, plan)

    def test_source_only_checks_do_not_require_local_art_or_captures(self):
        evidence = json.loads((NSH / 'desktop-style-verification.json').read_text())
        # Byte equality is recorded for the mixed-worktree checkpoint; do not require
        # other owners' untracked files or licensed local art in a clean checkout.
        self.assertEqual(len(evidence['protectedFiles']), 10)
        for protected in evidence['protectedFiles'].values():
            self.assertRegex(protected['sha256'], r'^[0-9a-f]{64}$')
        self.assertIn('NOT Electron/DOM/computed style', evidence['reference'])


if __name__ == '__main__':
    unittest.main()
