"""Validate receipt linkage and scope; native pixel checks run separately."""
import hashlib
import unittest

from nsh_composer_provenance import ROOT, hover_evidence, picker_evidence, session_preview_evidence, successor_input


class NativeControlHoverTests(unittest.TestCase):
    def test_receipt_and_owned_inputs(self):
        hover = hover_evidence()
        picker = picker_evidence()
        prior = hover['predecessorReceipt']
        data = (ROOT / prior['path']).read_bytes()
        self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (prior['bytes'], prior['sha256']))
        self.assertEqual(hover['protected'], picker['protected'])
        previous = hover['previousInputs']
        self.assertEqual(set(hover['inputs']), set(previous) | set(hover['added']))
        self.assertTrue(set(hover['protected']).isdisjoint(hover['inputs']))
        for path in set(previous) & set(picker['inputs']):
            self.assertEqual(previous[path], picker['inputs'][path]['sha256'], path)
        successor = session_preview_evidence()
        for path, record in hover['inputs'].items():
            record = successor_input(self, successor, path, record)
            data = (ROOT / path).read_bytes()
            self.assertEqual(record, dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest()), path)

    def test_native_hover_changes_only_hovered_control_and_clears(self):
        evidence = hover_evidence()
        candidate = evidence['candidate']
        self.assertTrue(candidate['synthetic'])
        self.assertFalse(candidate['installed'])
        self.assertFalse(candidate['piExecuted'])
        controls = {'picker', 'navigation', 'settings'}
        for variant in ('withArt', 'fallback'):
            run = candidate[variant]
            self.assertEqual(run['artwork'], variant == 'withArt')
            self.assertEqual(run['passed'], 2)
            names = {f'controls-{scheme}-{width}': (width, height) for scheme in ('light', 'dark')
                     for width, height in ((1240, 820), (680, 720))}
            self.assertEqual(set(run['paint']), set(names))
            self.assertEqual({record['file']: tuple(record['pixels']) for record in run['images']},
                             {f'{name}-{state}.png': size for name, size in names.items()
                              for state in controls | {'rest', 'leave', 'open'}})
            for name, states in run['paint'].items():
                self.assertEqual(set(states), controls)
                width, height = names[name]
                for result in states.values():
                    x, y, right, bottom = result['crop']
                    self.assertTrue(0 <= x < right <= width and 0 <= y < bottom <= height)
                    self.assertGreaterEqual(result['changedPixels'], (right - x) * (bottom - y) * .6)
                    self.assertEqual((result['otherChangedPixels'], result['leaveChangedPixels']), (0, 0))
        self.assertTrue(all(value is False for value in evidence['acceptance'].values()))

    def test_visual_feedback_is_not_a_settings_action(self):
        probe = ROOT / 'probes/nsh-validation'
        view = (probe / 'DesktopView.tsx').read_text()
        surface = view.split('testID="settings-surface"', 1)[1].split('</Button>', 1)[0]
        self.assertIn('hoverStyle={controlHover}', surface)
        self.assertIn('testID="settings-unavailable" accessibilityLabel="设置" disabled', surface)
        self.assertNotIn('onPress', surface)
        self.assertNotIn('⌃', (probe / 'DesktopModelPicker.tsx').read_text())
        self.assertNotIn('⌄', (probe / 'DesktopModelPicker.tsx').read_text())
