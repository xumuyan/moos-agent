"""Validate portable geometry/provenance; no local art or user data required."""
import hashlib
import json
from pathlib import Path
import unittest

from nsh_composer_provenance import current_composer_input

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def evidence(tag):
    return json.loads((PROBE / f'desktop-{tag}-verification.json').read_text())


class ComposerEvidenceTests(unittest.TestCase):
    def test_exact_inputs_preserve_prior_receipts_and_protected_files(self):
        composer = evidence('composer')
        old = {}
        for name in ('window-chrome', 'chat-cards', 'sidebar-icons'):
            old.update(evidence(name)['inputs'])
        assertions = 'probes/nsh-validation/desktop-style-assert.ts'
        old[assertions] = evidence('style-recheck')['captureInputs']['workspaceHashes'][Path(assertions).name]
        self.assertEqual(composer['previousInputs'], {
            path: old[path]['sha256'] for path in composer['inputs'].keys() & old.keys()
        })
        self.assertEqual(composer['protected'], evidence('sidebar-icons')['protected'])
        self.assertTrue(composer['inputs'].keys().isdisjoint(composer['protected']))
        self.assertEqual(len(composer['inputs']), 7)
        for path, expected in composer['inputs'].items():
            expected = current_composer_input(self, path, expected)
            data = (ROOT / path).read_bytes()
            self.assertEqual(expected, {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, path)

    def test_both_capture_matrices_keep_clear_envelopes_and_fixed_bow(self):
        candidate = evidence('composer')['candidate']
        expected = {f'composer-{s}-{state}' for s in ('light', 'dark')
                    for state in ('wide-idle', 'narrow-draft', 'narrow-running', 'wide-stopped')}
        self.assertTrue(candidate['synthetic'])
        self.assertFalse(candidate['piExecuted'])
        self.assertFalse(candidate['installed'])
        self.assertEqual(candidate['scaleFactor'], 1)
        for variant in ('withArt', 'fallback'):
            run = candidate[variant]
            art = variant == 'withArt'
            self.assertEqual(run['artwork'], art)
            self.assertEqual(run['passed'], 2)
            self.assertEqual(len(run['images']), 8)
            self.assertEqual({i['file'] for i in run['images']}, {f'{n}.png' for n in expected})
            self.assertEqual({g['name'] for g in run['geometry']}, expected)
            for image in run['images']:
                self.assertEqual(image['pixels'], [1240, 820] if '-wide-' in image['file'] else [680, 720])
                self.assertRegex(image['sha256'], r'^[a-f0-9]{64}$')
            for row in run['geometry']:
                b, active = row['bounds'], row['active']
                wide = '-wide-' in row['name']
                self.assertEqual(active, row['name'].endswith(('-running', '-stopped')))
                self.assertEqual('bottom-trim' in b, not active)
                if not active:
                    self.assertEqual(b['bottom-trim'], [0, 760, 960, 60] if wide else [0, 660, 496, 60])
                self.assertEqual(b['send'][2:], [38, 38] if active else [44, 44])
                self.assertEqual(b['stop'][3], 36)
                self.assertGreaterEqual(b['prompt'][3], 32)
                self.assertLessEqual(b['prompt'][1] + b['prompt'][3], b['composer-actions'][1])
                self.assertEqual('composer-bow' in b, art)
                if art:
                    x, y, w, h = b['composer-bow']
                    self.assertLess(abs(w - 360 * 72 / 170), 1)
                    self.assertAlmostEqual(x + w / 2, b['composer-frame'][2] / 2, delta=1)
                    self.assertLess(b['composer-frame'][1] + y + h, b['prompt'][1])

    def test_art_is_local_and_product_acceptance_remains_open(self):
        record = evidence('composer')
        self.assertEqual(record['reference']['license'], 'CC BY-NC-SA 4.0')
        self.assertFalse(record['reference']['hooksExecuted'])
        self.assertFalse(record['reference']['newInstalledCapture'])
        self.assertTrue(all(not a['redistributed'] for a in record['reference']['assets']))
        self.assertEqual(record['firstAttempt']['failed'], 2)
        self.assertTrue(all(value is False for value in record['acceptance'].values()))
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {task}', plan)
        for filename in ('PLAN.md', 'operatelog.md'):
            self.assertIn('DESKTOP-COMPOSER.md', (ROOT / filename).read_text())
