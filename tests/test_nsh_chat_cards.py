"""Check the isolated chat styling receipt without requiring local image files."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def manifest(tag):
    return json.loads((PROBE / f'desktop-{tag}-verification.json').read_text())


class ChatCardEvidenceTests(unittest.TestCase):
    def test_inputs_match_current_and_preserve_prior_hashes(self):
        cards = manifest('chat-cards')
        icons = manifest('sidebar-icons')
        prior = {}
        for tag in ('scroll', 'live-sidebar', 'sidebar-tree', 'sidebar-footer', 'typography', 'window-chrome', 'sidebar-activity'):
            prior.update(manifest(tag)['inputs'])
        for path, record in cards['inputs'].items():
            if path in prior:
                self.assertEqual(cards['previousInputs'][path], prior[path]['sha256'], path)
            if path in icons['previousInputs']:
                self.assertEqual(icons['previousInputs'][path], record['sha256'], path)
                record = icons['inputs'][path]
            data = (ROOT / path).read_bytes()
            self.assertEqual(record['sha256'], hashlib.sha256(data).hexdigest(), path)
            self.assertEqual(record['bytes'], len(data), path)
        self.assertEqual(cards['protected'], manifest('sidebar-activity')['protected'])
        self.assertTrue(cards['inputs'].keys().isdisjoint(cards['protected']))

    def test_native_capture_dimensions_geometry_and_acceptance_limits(self):
        cards = manifest('chat-cards')
        self.assertTrue(cards['candidate']['synthetic'])
        self.assertTrue(all(not accepted for accepted in cards['acceptance'].values()))
        self.assertEqual(cards['tests']['firstAttempt']['failed'], 2)
        for name in ('withArt', 'fallback'):
            capture = cards['candidate'][name]
            self.assertEqual(capture['passed'], 2)
            self.assertTrue(capture['runnerPassed'])
            self.assertEqual(len(capture['images']), 4)
            for image in capture['images']:
                self.assertEqual(image['pixels'], [1240, 820] if '-wide' in image['file'] else [680, 720])
            self.assertEqual({b['scheme'] for b in capture['geometry']}, {'light', 'dark'})
            for b in capture['geometry']:
                self.assertGreater(b['user']['origin']['x'], b['assistant']['origin']['x'])
                self.assertEqual(b['error']['origin']['x'], b['assistant']['origin']['x'])
                self.assertLess(b['error']['size']['height'], b['assistant']['size']['height'])
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('CHAT-CARDS.md', (ROOT / name).read_text())
