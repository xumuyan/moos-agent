"""Source-only presentation checkpoint; not visual, performance or GUI acceptance."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


class NativeStyleCheckpointTests(unittest.TestCase):
    def test_checkpoint_does_not_claim_product_or_visual_acceptance(self):
        evidence = json.loads((PROBE / 'desktop-theme-verification.json').read_text())
        for key in ('visualAccepted', 'resourcesMeasured', 'installed', 'deployed',
                    'externalModel', 'cleanCheckoutIntegrated', 'overallN01Complete',
                    'thirdPartyArtCommitted'):
            self.assertIs(evidence['acceptance'][key], False)
        self.assertEqual(evidence['task'], 'N01-D3/native_style')
        self.assertEqual(evidence['source']['skin'], 'maid-atelier')
        self.assertEqual(evidence['source']['version'], '0.3.2')
        self.assertEqual(evidence['source']['license'], 'CC BY-NC-SA 4.0')
        self.assertTrue(evidence['protectedWorktree']['allNonOwnedUnchanged'])
        self.assertEqual(evidence['results']['rust']['status'], 'blocked')
        self.assertEqual(evidence['results']['electron']['skipped'], 10)

    def test_documented_handoff_retains_ownership_and_pending_gates(self):
        review = (PROBE / 'desktop-theme-review.md').read_text()
        for marker in ('Mac Catalyst', 'pointerEvents', 'CC BY-NC-SA 4.0',
                       'nine-slice', 'verify-desktop-ui.mjs', 'desktop-theme-layers.tsx',
                       '中文组合输入', '完整落盘', '不勾选', '用户视觉认可', '混合工作区'):
            self.assertIn(marker, review)
        plan = (ROOT / 'PLAN.md').read_text()
        for marker in ('desktop-theme-verification.json', 'SKIN-SOURCE.md',
                       '- [ ] N01-D1', '- [ ] N01-D2', '- [ ] N01-D3'):
            self.assertIn(marker, plan)
        self.assertIn('native_style', (ROOT / 'operatelog.md').read_text())

    def test_default_art_is_empty_and_no_original_artwork_is_in_source(self):
        module = (PROBE / 'desktop-theme-art.ts').read_text()
        self.assertIn('artAvailable = false', module)
        self.assertIn('= {}', module)
        self.assertNotIn('Application Support', module)
        inventory = json.loads((PROBE / 'skin-source.json').read_text())
        for asset in inventory['assets']:
            self.assertEqual(list(PROBE.rglob(Path(asset['path']).name)), [])
        self.assertFalse((PROBE / 'assets/local-art').exists())
        self.assertIn('本机授权素材预览', (PROBE / 'DesktopView.tsx').read_text())
