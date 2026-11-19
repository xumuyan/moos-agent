"""Portable checks for the independent icon/menu checkpoint, not visual sign-off."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def evidence(tag):
    return json.loads((PROBE / f'desktop-{tag}-verification.json').read_text())


class SidebarIconTests(unittest.TestCase):
    def test_capture_inputs_and_vector_attribution(self):
        icons = evidence('sidebar-icons')
        prior = evidence('chat-cards')
        self.assertEqual(icons['previousInputs'], {
            path: prior['inputs'][path]['sha256']
            for path in icons['inputs'].keys() & prior['inputs'].keys()
        })
        self.assertEqual(icons['protected'], prior['protected'])
        self.assertTrue(icons['inputs'].keys().isdisjoint(icons['protected']))
        for path, entry in icons['inputs'].items():
            data = (ROOT / path).read_bytes()
            self.assertEqual(entry, dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest()), path)
        notice = (PROBE / 'DSH-ICONS-LICENSE.txt').read_text()
        self.assertIn('MIT License', notice)
        self.assertIn('Copyright (c) 2026 DeepSeek', notice)
        self.assertIn('DSH-ICONS-LICENSE.txt', (ROOT / 'THIRD_PARTY_NOTICES.md').read_text())
        self.assertIn('M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',
                      (PROBE / 'desktop-icon-paths.ts').read_text())

    def test_both_matrices_and_sidebar_geometry(self):
        icons = evidence('sidebar-icons')
        self.assertFalse(icons['reference']['newInstalledCapture'])
        self.assertTrue(all(not value for value in icons['acceptance'].values()))
        candidate = icons['candidate']
        self.assertTrue(candidate['synthetic'])
        self.assertFalse(candidate['piExecuted'])
        self.assertFalse(candidate['installed'])
        for variant in ('withArt', 'fallback'):
            run = candidate[variant]
            self.assertEqual(run['artwork'], variant == 'withArt')
            self.assertEqual(run['passed'], 2)
            names = {f'icons-{scheme}-{state}.png' for scheme in ('light', 'dark')
                     for state in ('wide-idle', 'wide-chat', 'narrow-chat', 'narrow-collapsed')}
            self.assertEqual({image['file'] for image in run['images']}, names)
            for image in run['images']:
                self.assertEqual(image['pixels'], [1240, 820] if '-wide-' in image['file'] else [680, 720])
            self.assertEqual({(g['scheme'], g['width']) for g in run['geometry']},
                             {(s, w) for s in ('light', 'dark') for w in (1240, 680)})
            for g in run['geometry']:
                b = g['bounds']
                self.assertEqual([b[f'nav-{key}'][1] for key in ('plugins', 'background', 'more')], [0, 38, 76])
                self.assertEqual(b['icon-nav-plugins'], [4, 11, 16, 16])
                self.assertEqual(b['nav-label-plugins'][0], 26)
                self.assertEqual(b['add-project'][0] - b['search'][0], 64)
                x, y, w, h = b['toggle-navigation']
                self.assertEqual([y, w, h], [0, 32, 32])
                self.assertLessEqual(x + w, b['window-drag-region'][0])
        self.assertGreater(icons['motion']['light']['changedPixels'], 0)
        self.assertEqual(icons['motion']['dark']['changedPixels'], 0)

    def test_plan_and_log_keep_real_acceptance_open(self):
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {task}', plan)
        for file in ('PLAN.md', 'operatelog.md'):
            self.assertIn('SIDEBAR-ICONS.md', (ROOT / file).read_text())
