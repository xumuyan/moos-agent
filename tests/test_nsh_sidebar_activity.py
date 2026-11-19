"""Provenance for the isolated sidebar state captures (not live GUI acceptance)."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def manifest(tag):
    return json.loads((PROBE / f'desktop-{tag}-verification.json').read_text())


class SidebarActivityTests(unittest.TestCase):
    def test_exact_inputs_and_protected_ownership(self):
        activity = manifest('sidebar-activity')
        cards = manifest('chat-cards')
        icons = manifest('sidebar-icons')
        composer = manifest('composer')
        for path, record in activity['inputs'].items():
            if path in cards['previousInputs']:
                self.assertEqual(cards['previousInputs'][path], record['sha256'])
                record = cards['inputs'][path]
            if path in icons['previousInputs']:
                self.assertEqual(icons['previousInputs'][path], record['sha256'])
                record = icons['inputs'][path]
            if path in composer['previousInputs']:
                self.assertEqual(composer['previousInputs'][path], record['sha256'])
                record = composer['inputs'][path]
            data = (ROOT / path).read_bytes()
            self.assertEqual(record['bytes'], len(data), path)
            self.assertEqual(record['sha256'], hashlib.sha256(data).hexdigest(), path)
        prior = {}
        for tag in ('scroll', 'live-sidebar', 'sidebar-tree', 'sidebar-footer', 'typography', 'window-chrome'):
            prior.update(manifest(tag)['inputs'])
        self.assertEqual({p: prior[p]['sha256'] for p in activity['inputs'].keys() & prior.keys()},
                         {p: activity['previousInputs'][p] for p in activity['inputs'].keys() & prior.keys()})
        self.assertEqual(activity['protected'], manifest('window-chrome')['protected'])
        self.assertTrue(activity['inputs'].keys().isdisjoint(activity['protected']))

    def test_both_appkit_capture_matrices_include_reduced_motion(self):
        activity = manifest('sidebar-activity')
        held = activity['candidate']
        self.assertTrue(held['synthetic'])
        self.assertFalse(held['piExecuted'])
        self.assertFalse(held['installed'])
        self.assertTrue(all(not value for value in activity['rights'].values()))
        self.assertTrue(all(not value for value in activity['acceptance'].values()))
        cases = {(scheme, state) for scheme in ('light', 'dark')
                 for state in ('idle', 'working', 'working-next', 'unselected', 'narrow')}
        for variant in ('withArt', 'fallback'):
            run = held[variant]
            self.assertEqual({Path(i['file']).stem for i in run['images']},
                             {f'tree-{scheme}-{state}' for scheme, state in cases})
            for image in run['images']:
                self.assertEqual(image['pixels'], [680, 720] if image['file'].endswith('-narrow.png') else [1240, 820])
            self.assertFalse(run['motion']['light']['reducedMotion'])
            self.assertGreater(run['motion']['light']['changedPixels'], 0)
            self.assertTrue(run['motion']['dark']['reducedMotion'])
            self.assertEqual(run['motion']['dark']['changedPixels'], 0)
        self.assertEqual(activity['tests']['nativeFirst']['failed'], 1)
        self.assertFalse(activity['tests']['richFirst']['runnerPassed'])
        for mode in ('activity', 'fallback'):
            self.assertEqual(activity['tests'][mode]['passed'], 2)
            self.assertTrue(activity['tests'][mode]['runnerPassed'])

    def test_dashed_tree_and_busy_display_are_candidate_only(self):
        view = (PROBE / 'DesktopView.tsx').read_text()
        self.assertEqual(view.count("borderStyle: 'dashed'"), 2)
        self.assertIn('cleanup(() => motion.stop())', view)
        self.assertIn('snapshot().conversations.get(item.id)', view)
        self.assertNotIn('● ', view)
        self.assertIn('Songti SC', (PROBE / 'desktop-sidebar-tree.ts').read_text())
        for path in ('PLAN.md', 'operatelog.md'):
            self.assertIn('SIDEBAR-ACTIVITY.md', (ROOT / path).read_text())
