import hashlib
import unittest

from nsh_composer_provenance import ROOT, PROBE, controls_evidence, current_composer_input


class ComposerControlsTests(unittest.TestCase):
    def test_current_inputs_and_frozen_predecessors(self):
        evidence = controls_evidence()
        self.assertEqual(evidence['inputs'].keys(), evidence['previousInputs'].keys())
        self.assertEqual(len(evidence['protected']), 7)
        self.assertTrue(evidence['protected'].keys().isdisjoint(evidence['inputs']))
        for path, record in evidence['inputs'].items():
            record = current_composer_input(self, path, record, after=controls_evidence)
            data = (ROOT / path).read_bytes()
            self.assertEqual(record, dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest()), path)
        for name, digest in evidence['historical'].items():
            self.assertEqual(hashlib.sha256((PROBE / name).read_bytes()).hexdigest(), digest, name)

    def test_both_native_capture_matrices(self):
        evidence = controls_evidence()
        candidate = evidence['candidate']
        self.assertTrue(candidate['synthetic'])
        self.assertFalse(candidate['piExecuted'])
        self.assertFalse(candidate['installed'])
        expected = {f'composer-{scheme}-{state}.png' for scheme in ('light', 'dark')
                    for state in ('wide-idle', 'wide-stopped', 'narrow-draft', 'narrow-models', 'narrow-running')}
        for key, art in (('withArt', True), ('fallback', False)):
            run = candidate[key]
            self.assertIs(run['artwork'], art)
            self.assertEqual((run['passed'], run['failed']), (2, 0))
            self.assertEqual({im['file'] for im in run['images']}, expected)
            for im in run['images']:
                self.assertEqual(im['pixels'], [1240, 820] if '-wide-' in im['file'] else [680, 720])
            geometry = {m['name']: m['bounds'] for m in run['geometry']}
            for scheme in ('light', 'dark'):
                run_bounds = geometry[f'composer-{scheme}-narrow-running']
                stopped_bounds = geometry[f'composer-{scheme}-narrow-drained']
                self.assertEqual(run_bounds['primary-action'], stopped_bounds['primary-action'])
            for m in run['geometry']:
                b = m['bounds']
                self.assertEqual(b['primary-action'][2:], [38, 38] if m['active'] else [44, 44])
                self.assertEqual(b['model-picker'][3], 32)
                self.assertLessEqual(b['model-picker'][0] + b['model-picker'][2], b['primary-action'][0])
                if art:
                    self.assertEqual(b['composer-bow'][2:], [152, 72])
                else:
                    self.assertNotIn('composer-bow', b)

    def test_host_evidence_separate_from_ui_and_incomplete_gates(self):
        evidence = controls_evidence()
        host = evidence['host']
        self.assertEqual(host['targetedPass'], 14)
        self.assertEqual(len(host['privatePipe']['checks']), 11)
        self.assertIn('selected model reaches PI and loopback upstream', host['privatePipe']['checks'])
        self.assertFalse(host['privatePipe']['nativeGUI'])
        self.assertFalse(host['privatePipe']['productionData'])
        self.assertTrue(host['swiftCompatibility']['ownerExit']['normalChildExit'])
        self.assertEqual(evidence['retainedFailures']['firstFallback']['failed'], 2)
        self.assertEqual(evidence['retainedFailures']['beforeWaitFallback']['failed'], 1)
        self.assertTrue(all(not accepted for accepted in evidence['acceptance'].values()))
        self.assertEqual(evidence['regressions']['native']['sidebar-activity']['failed'], 2)
        self.assertEqual(evidence['regressions']['rust']['exit'], 101)
        plan = (ROOT / 'PLAN.md').read_text()
        for gate in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {gate}', plan)
        self.assertIn(evidence['commitSubject'], (ROOT / 'operatelog.md').read_text())
