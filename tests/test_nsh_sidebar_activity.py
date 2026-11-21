"""Provenance for the isolated sidebar state captures (not live GUI acceptance)."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import unittest

from nsh_composer_provenance import current_composer_input, sidebar_jewel_evidence

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
            record = current_composer_input(self, path, record)
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

    def test_native_jewel_has_fixed_core_and_independent_rays(self):
        evidence = sidebar_jewel_evidence()
        def verified(artifact):
            data = (ROOT / artifact['path']).read_bytes()
            self.assertEqual(len(data), artifact['bytes'], artifact['path'])
            self.assertEqual(hashlib.sha256(data).hexdigest(), artifact['sha256'], artifact['path'])
            return data

        verified(evidence['predecessorReceipt'])
        self.assertEqual(evidence['protected'],
                         {path: item['sha256'] for path, item in manifest('sidebar-activity')['protected'].items()})
        self.assertTrue(evidence['protected'].keys().isdisjoint(evidence['inputs']))
        self.assertTrue(all(value is False for value in evidence['acceptance'].values()))
        self.assertEqual(evidence['inputs'].keys(), evidence['previousInputs'].keys())
        for path, current in evidence['inputs'].items():
            previous = subprocess.check_output(['git', 'show', f"{evidence['base']}:{path}"], cwd=ROOT)
            self.assertEqual(hashlib.sha256(previous).hexdigest(), evidence['previousInputs'][path], path)
            record = current_composer_input(self, path, current, after=sidebar_jewel_evidence)
            verified({**record, 'path': path})
        self.assertEqual(evidence['matrices'].keys(), {'withArt', 'fallback'})
        for mode, run in evidence['matrices'].items():
            capture = json.loads(verified(run['capture']))
            self.assertEqual(capture['head'], evidence['base'])
            self.assertTrue(capture['synthetic'] and not capture['piExecuted'])
            for path, current in capture['workspaceHashes'].items():
                full = PROBE / path
                record = current_composer_input(self, str(full.relative_to(ROOT)), current, after=sidebar_jewel_evidence)
                verified({**record, 'path': full})
            result = json.loads(verified(run['result']))
            self.assertTrue(result['passed'] and not result['installed'])
            self.assertIs(result['artwork'], mode == 'withArt')
            motion = json.loads(verified(run['pixels']))
            self.assertTrue(all(state['fixedCore'] and state['visibleCore'] for state in motion.values()))
            self.assertFalse(motion['light']['reducedMotion'])
            self.assertGreater(motion['light']['changedPixels'], 0)
            self.assertTrue(motion['dark']['reducedMotion'])
            self.assertEqual(motion['dark']['changedPixels'], 0)
            states = ('idle', 'working', 'working-next', 'unselected', 'narrow-working', 'narrow')
            self.assertEqual({Path(image['path']).name for image in run['images']},
                             {f'tree-{scheme}-{state}.png' for scheme in ('light', 'dark') for state in states})
            for image in run['images']:
                data = verified(image)
                self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                size = (680, 720) if '-narrow' in image['path'] else (1240, 820)
                self.assertEqual(struct.unpack('>II', data[16:24]), size)
            verified(run['testLog'])
        for artifact in evidence['verificationLogs']:
            verified(artifact)

    def test_dashed_tree_and_busy_display_are_candidate_only(self):
        view = (PROBE / 'DesktopView.tsx').read_text()
        active_tree, imported_tree = view.split('visibleImported().map', 1)
        for branch in (active_tree, imported_tree):
            self.assertEqual(branch.count("borderStyle: 'dashed'"), 2)
            self.assertIn('borderLeftWidth: 1', branch)
            self.assertIn('borderTopWidth: 1', branch)
        self.assertIn('cleanup(() => motion.stop())', view)
        self.assertIn('snapshot().conversations.get(item.id)', view)
        self.assertNotIn('● ', view)
        for label in ('project', 'session'):
            self.assertRegex(view, rf'testID=\{{`{label}-label-[^`]+`\}}[^\n]*fontFamily: t\.fontFamily')
        for path in ('PLAN.md', 'operatelog.md'):
            self.assertIn('SIDEBAR-ACTIVITY.md', (ROOT / path).read_text())
