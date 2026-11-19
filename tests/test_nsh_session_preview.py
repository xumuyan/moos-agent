import hashlib
import subprocess
import unittest

from nsh_composer_provenance import PROBE, ROOT, session_preview_evidence, current_composer_input


def record(path):
    data = path.read_bytes()
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


class SessionPreviewTests(unittest.TestCase):
    def test_input_provenance_and_owner_boundary(self):
        e = session_preview_evidence()
        self.assertEqual(set(e['inputs']), set(e['previousInputs']) | set(e['added']))
        self.assertEqual(len(e['protected']), 7)
        self.assertTrue(e['protected'].keys().isdisjoint(e['inputs']))
        old = e['predecessorReceipt']
        self.assertEqual(record(ROOT / old['path']), {k: old[k] for k in ('bytes', 'sha256')})
        for path, previous in e['previousInputs'].items():
            data = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(hashlib.sha256(data).hexdigest(), previous, path)
        for path, expected in e['inputs'].items():
            self.assertEqual(record(ROOT / path), current_composer_input(self, path, expected, after=session_preview_evidence), path)

    def test_both_native_matrices_and_no_delivery_claim(self):
        e = session_preview_evidence()
        candidate = e['candidate']
        self.assertTrue(candidate['synthetic'])
        self.assertFalse(candidate['piExecuted'] or candidate['installed'])
        self.assertTrue(all(v is False for v in e['acceptance'].values()))
        for kind in ('withArt', 'fallback'):
            run = candidate[kind]
            self.assertEqual(run['passed'], 2)
            self.assertEqual(run['artwork'], kind == 'withArt')
            self.assertEqual(len(run['images']), 14)
            self.assertEqual(len(run['paint']), 4)
            for image in run['images']:
                self.assertEqual(record(ROOT / run['directory'] / image['file']),
                                 {k: image[k] for k in ('bytes', 'sha256')})
            for paint in run['paint'].values():
                x, y, r, b = paint['row']
                self.assertGreater(paint['rowChangedPixels'], (r - x) * (b - y) * .6)
                self.assertEqual(paint['siblingChangedPixels'], 0)
                self.assertEqual(paint['leaveChangedPixels'], 0)
                self.assertEqual(paint['cardChangedPixels'], 244)
        self.assertEqual(len(e['failedAttempts']), 4)
        for item in e['failedAttempts'] + candidate['withArt']['artifacts'] + candidate['fallback']['artifacts']:
            self.assertEqual(record(ROOT / item['path']), {k: item[k] for k in ('bytes', 'sha256')})
        self.assertIn('500ms', (PROBE / 'SIDEBAR-SESSION-PREVIEW.md').read_text())
        self.assertIn(e['commitSubject'], (ROOT / 'operatelog.md').read_text())
        self.assertIn('- [ ] N01-D3 ', (ROOT / 'PLAN.md').read_text())
