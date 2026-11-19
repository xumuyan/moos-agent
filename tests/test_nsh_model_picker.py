import hashlib
import unittest

from nsh_composer_provenance import ROOT, controls_evidence, picker_evidence


class NativeModelPickerTests(unittest.TestCase):
    def test_input_chain_and_protected_owner_seam(self):
        evidence = picker_evidence()
        old = controls_evidence()
        receipt = evidence['predecessorReceipt']
        data = (ROOT / receipt['path']).read_bytes()
        self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (receipt['bytes'], receipt['sha256']))
        previous = evidence['previousInputs']
        self.assertEqual(set(evidence['inputs']), set(previous) | set(evidence['added']))
        self.assertTrue(set(previous).isdisjoint(evidence['added']))
        for path in set(previous) & set(old['inputs']):
            self.assertEqual(previous[path], old['inputs'][path]['sha256'], path)
        self.assertEqual(evidence['protected'], old['protected'])
        self.assertTrue(set(evidence['protected']).isdisjoint(evidence['inputs']))
        for path, record in evidence['inputs'].items():
            data = (ROOT / path).read_bytes()
            self.assertEqual(record, dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest()), path)

    def test_native_menu_matrix_does_not_replace_action(self):
        evidence = picker_evidence()
        states = ('wide-idle', 'wide-menu', 'wide-stopped', 'narrow-menu', 'narrow-models', 'narrow-effort',
                  'narrow-draft', 'narrow-running')
        schemes = ('light', 'dark')
        self.assertTrue(evidence['candidate']['synthetic'])
        self.assertFalse(evidence['candidate']['piExecuted'])
        for key in ('withArt', 'fallback'):
            run = evidence['candidate'][key]
            self.assertEqual(run['artwork'], key == 'withArt')
            self.assertEqual({i['file'] for i in run['images']},
                             {f'composer-{scheme}-{state}.png' for scheme in schemes for state in states})
            for item in run['images']:
                self.assertEqual(item['pixels'], [1240, 820] if '-wide-' in item['file'] else [680, 720])
            self.assertEqual(len(run['geometry']), 8)
            for g in run['geometry']:
                x, y, w, h = g['rect']
                self.assertEqual((w, h), (240, 360 if g['state'].endswith('models') else 78))
                self.assertGreaterEqual(x, 12)
                self.assertGreaterEqual(y, 12)
                self.assertLessEqual(x + w, g['viewport'][0] - 12)
                self.assertAlmostEqual(y + h + 8, g['triggerOrigin'][1], delta=1)
            by_state = {b['name']: b for b in run['actionBounds']}
            for b in by_state.values():
                self.assertEqual(b['picker'][3], 32)
                self.assertLessEqual(b['picker'][0] + b['picker'][2], b['action'][0])
                self.assertEqual(b['action'][2:], [38, 38] if b['active'] else [44, 44])
                self.assertEqual(b['bow'][2:] if b['bow'] else None, [152, 72] if run['artwork'] else None)
            for scheme in schemes:
                self.assertEqual(by_state[f'{scheme}-narrow-running']['action'], by_state[f'{scheme}-narrow-drained']['action'])

    def test_private_pipe_is_not_gui_or_delivery(self):
        evidence = picker_evidence()
        host, tests = evidence['host'], evidence['regressions']
        self.assertEqual(host['status'], 'passed')
        self.assertEqual(len(host['checks']), 12)
        self.assertIn('allowlisted model effort reaches loopback and binds replay', host['checks'])
        self.assertFalse(host['nativeGUI'])
        self.assertFalse(host['productionData'])
        self.assertEqual(tests['host']['pass'], 14)
        self.assertEqual(tests['core']['pass'], 365)
        self.assertEqual(tests['headless']['passed'], 20)
        for test in ('composer-art', 'composer-fallback'):
            self.assertEqual((tests[test]['exit'], tests[test]['passed'], tests[test]['failed']), (0, 2, 0))
        self.assertEqual(tests['electron']['skipped'], 10)
        self.assertEqual(tests['rust']['exit'], 101)
        self.assertIn('fallback-stable', evidence['retainedAttempts'])
        self.assertTrue(all(v is False for v in evidence['acceptance'].values()))
        for task in ('N01-D1 ', 'N01-D2 ', 'N01-D3 '):
            self.assertIn('- [ ] ' + task, (ROOT / 'PLAN.md').read_text())
        self.assertIn(evidence['commitSubject'], (ROOT / 'operatelog.md').read_text())
