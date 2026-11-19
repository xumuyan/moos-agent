"""Check the window chrome evidence chain without requiring local capture files."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def evidence(name):
    return json.loads((PROBE / f'desktop-{name}-verification.json').read_text())


class DesktopWindowChromeTests(unittest.TestCase):
    def test_evidence_tracks_exact_source_and_prior_checkpoints(self):
        m = evidence('window-chrome')
        original = evidence('typography')['inputs']
        layers = 'probes/nsh-validation/desktop-theme-layers.tsx'
        recheck = evidence('style-recheck')['captureInputs']['workspaceHashes']
        self.assertEqual(m['previousInputs'], {
            **{n: original[n]['sha256'] for n in m['inputs'].keys() & original.keys()},
            layers: recheck[Path(layers).name]['sha256'],
        })
        self.assertEqual(len(m['inputs']), 5)
        self.assertEqual(len(m['protected']), 7)
        self.assertTrue(m['inputs'].keys().isdisjoint(m['protected']))
        activity = evidence('sidebar-activity')
        cards = evidence('chat-cards')
        for name, record in m['inputs'].items():
            if name in activity['previousInputs']:
                self.assertEqual(activity['previousInputs'][name], record['sha256'])
                record = activity['inputs'][name]
            if name in cards['previousInputs']:
                self.assertEqual(cards['previousInputs'][name], record['sha256'])
                record = cards['inputs'][name]
            data = (ROOT / name).read_bytes()
            self.assertEqual(record['bytes'], len(data), name)
            self.assertEqual(record['sha256'], hashlib.sha256(data).hexdigest(), name)
        self.assertTrue(all(r['unchanged'] for r in m['protected'].values()))

    def test_full_frame_and_reserved_controls_in_both_capture_matrices(self):
        candidate = evidence('window-chrome')['candidate']
        expected_names = {f'chrome-{scheme}-{size}-{view}'
                          for scheme in ('light', 'dark') for size in ('wide', 'narrow')
                          for view in ('idle', 'chat')}
        for group in ('withArt', 'fallback'):
            run = candidate[group]
            self.assertEqual({g['name'] for g in run['geometry']}, expected_names)
            self.assertEqual({Path(i['file']).stem for i in run['images']}, expected_names)
            self.assertEqual(run['closeRequestEvents'], 2)
            for g in run['geometry']:
                self.assertEqual(g['bounds'], g['contentBounds'])
                w, h = (1240, 820) if '-wide-' in g['name'] else (680, 720)
                self.assertEqual(g['bounds']['size'], {'width': w, 'height': h})
                self.assertEqual(g['scaleFactor'], 1)
                self.assertEqual(g['artwork'], group == 'withArt')
                self.assertEqual(g['active'], g['name'].endswith('-chat'))
                chrome, drag, header = g['chrome'], g['drag'], g['header']
                self.assertEqual(chrome['height'], 32)
                self.assertGreater(chrome['left'], 0)
                self.assertEqual(drag['origin']['y'], 0)
                self.assertGreaterEqual(drag['origin']['x'], chrome['left'] + 8)
                self.assertEqual(drag['size']['height'], chrome['height'])
                self.assertLessEqual(drag['origin']['x'] + drag['size']['width'], w - chrome['right'] - 8)
                trim = (76 if g['active'] else 48) if g['artwork'] else 0
                self.assertEqual(header['origin']['y'], max(trim, chrome['height']) + 8)

    def test_keeps_fixture_and_unverified_behavior_separate(self):
        m = evidence('window-chrome')
        view = (PROBE / 'DesktopView.tsx').read_text()
        self.assertIn("style: 'hidden', height: 32", view)
        self.assertIn('desktop={{ windowDrag: true }}', view)
        self.assertNotIn('closeOnPress', view)
        self.assertTrue(m['candidate']['synthetic'])
        self.assertFalse(m['candidate']['piExecuted'])
        self.assertFalse(m['candidate']['installed'])
        self.assertFalse(m['rights']['artPublished'])
        self.assertFalse(m['limits']['dragProbeMovedWindow'])
        self.assertTrue(m['limits']['closeFixtureVetoedLastWindow'])
        self.assertEqual(m['tests']['chromeFirst']['failed'], 2)
        self.assertEqual(m['tests']['chromeEarlySerial']['failed'], 2)
        self.assertEqual(m['tests']['chrome']['passed'], 2)
        self.assertEqual(m['tests']['fallback']['passed'], 2)
        self.assertTrue(all(not value for value in m['acceptance'].values()))
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('DESKTOP-WINDOW-CHROME.md', (ROOT / name).read_text())
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {task}', (ROOT / 'PLAN.md').read_text())
