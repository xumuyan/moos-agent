import hashlib
import json
import subprocess
import unittest

from nsh_composer_provenance import PROBE, ROOT, session_preview_evidence, turn_queue_evidence


def record(path):
    data = path.read_bytes()
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


class TurnQueueTests(unittest.TestCase):
    def assert_record(self, entry):
        self.assertEqual(record(ROOT / entry['path']), {k: entry[k] for k in ('bytes', 'sha256')})

    def test_input_provenance_and_owner_boundary(self):
        e = turn_queue_evidence()
        self.assertEqual(set(e['inputs']), set(e['previousInputs']) | set(e['added']))
        self.assertEqual(e['protected'], session_preview_evidence()['protected'])
        self.assertTrue(e['protected'].keys().isdisjoint(e['inputs']))
        self.assert_record(e['predecessorReceipt'])
        for path, previous in e['previousInputs'].items():
            data = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(hashlib.sha256(data).hexdigest(), previous, path)
        for path, expected in e['inputs'].items():
            self.assertEqual(record(ROOT / path), expected, path)

    def test_native_receipts_bind_exact_inputs_and_layout_without_delivery_claim(self):
        e = turn_queue_evidence()
        self.assertTrue(e['candidate']['synthetic'])
        self.assertFalse(e['candidate']['installed'] or e['candidate']['piExecuted'])
        self.assertTrue(all(value is False for value in e['acceptance'].values()))
        expected = {f'turn-queue-{scheme}-{state}.png' for scheme in ('light', 'dark')
                    for state in ('1240-single', '1240-hover', '680-multiple', '680-edit')}
        expected.add('turn-queue-dark-680-paused.png')
        for key, art in (('withArt', True), ('fallback', False)):
            run = e['candidate'][key]
            self.assertIs(run['artwork'], art)
            self.assertEqual((run['passed'], run['failed']), (4, 0))
            directory = ROOT / run['directory']
            self.assertEqual({im['file'] for im in run['images']}, expected)
            for image in run['images']:
                self.assert_record({**image, 'path': directory / image['file']})
            for entry in run['artifacts']:
                self.assert_record(entry)
            hashes = json.loads((directory / 'capture-inputs.json').read_text())['workspaceHashes']
            for path, entry in e['inputs'].items():
                if not path.endswith(('.test.mjs', '.py')):
                    self.assertEqual(hashes[(ROOT / path).name], entry, path)
            lines = (directory / 'test.log').read_text().splitlines()
            geometry = [json.loads(line[len('TURN_QUEUE_GEOMETRY '):]) for line in lines if line.startswith('TURN_QUEUE_GEOMETRY ')]
            self.assertEqual({g['name'] + '.png' for g in geometry}, expected)
            for g in geometry:
                dock, safe = g['dock'], g['safe']
                self.assertEqual(safe['size']['width'] - dock['size']['width'], 20)
                self.assertEqual(dock['origin']['x'] - safe['origin']['x'], 10)
                self.assertLess(dock['origin']['y'] + dock['size']['height'], safe['origin']['y'] + g['composer']['origin']['y'] - 20)
            for paint in run['paint'].values():
                x, y, r, b = paint['crop']
                a, c, d, f = paint['changedBounds']
                self.assertTrue(x <= a < d <= r and y <= c < f <= b)
                self.assertGreater(paint['changedPixels'], (r - x) * (b - y) * .6)
        self.assertEqual(len(e['failedAttempts']), 6)
        for entry in e['failedAttempts']:
            self.assert_record(entry)
        self.assertIn('不落盘', (ROOT / 'PLAN.md').read_text())
        self.assertIn('QueueDock', (PROBE / 'DESKTOP-TURN-QUEUE.md').read_text())
        self.assertIn(e['commitSubject'], (ROOT / 'operatelog.md').read_text())
