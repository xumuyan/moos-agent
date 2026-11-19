import hashlib
import json
import struct
import subprocess
import unittest

from nsh_composer_provenance import ROOT, statistics_evidence, turn_queue_evidence


def record(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class ComposerStatisticsTests(unittest.TestCase):
    def assert_artifact(self, artifact):
        data = (ROOT / artifact['path']).read_bytes()
        self.assertEqual(record(data), {k: artifact[k] for k in ('bytes', 'sha256')}, artifact['path'])
        return data

    def test_input_provenance_and_owner_boundary(self):
        evidence = statistics_evidence()
        self.assertEqual(set(evidence['inputs']), set(evidence['previousInputs']) | set(evidence['added']))
        self.assertTrue(set(evidence['previousInputs']).isdisjoint(evidence['added']))
        self.assertEqual(evidence['protected'], turn_queue_evidence()['protected'])
        self.assertTrue(evidence['protected'].keys().isdisjoint(evidence['inputs']))
        self.assert_artifact(evidence['predecessorReceipt'])
        for path, previous in evidence['previousInputs'].items():
            data = subprocess.check_output(['git', 'show', f"{evidence['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(data)['sha256'], previous, path)
        for path, expected in evidence['inputs'].items():
            self.assertEqual(record((ROOT / path).read_bytes()), expected, path)

    def test_native_receipt_binds_both_matrices_without_claiming_delivery(self):
        evidence = statistics_evidence()
        candidate = evidence['candidate']
        self.assertTrue(candidate['synthetic'])
        self.assertFalse(candidate['installed'] or candidate['piExecuted'] or candidate['manualGUI'])
        self.assertTrue(all(value is False for value in evidence['acceptance'].values()))
        windows = {(scheme, width) for scheme in ('light', 'dark') for width in (680, 1240)}
        expected_frames = {f'statistics-{scheme}-{width}-{state}.png': (width, 720 if width == 680 else 820)
                           for scheme, width in windows for state in ('empty', 'drained', 'timing')}
        for mode, has_artwork in (('withArt', True), ('fallback', False)):
            run = candidate['matrices'][mode]
            self.assertIs(run['artwork'], has_artwork)
            self.assertEqual((run['passed'], run['failed'], run['scale']), (4, 0, 1))
            for artifact in run['artifacts']:
                self.assert_artifact(artifact)
            directory = ROOT / run['directory']
            capture = json.loads((directory / 'capture-inputs.json').read_text())
            self.assertEqual(capture['head'], evidence['base'])
            for filename, expected in capture['workspaceHashes'].items():
                self.assertEqual(record((ROOT / 'probes/nsh-validation' / filename).read_bytes()), expected, filename)
            self.assertEqual({i['file']: tuple(i['pixels']) for i in run['images']}, expected_frames)
            for image in run['images']:
                data = self.assert_artifact({**image, 'path': directory / image['file']})
                self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                self.assertEqual(struct.unpack('>II', data[16:24]), tuple(image['pixels']))
            lines = (directory / 'test.log').read_text().splitlines()
            geometry = [json.loads(line.removeprefix('STATISTICS_GEOMETRY ')) for line in lines
                        if line.startswith('STATISTICS_GEOMETRY ')]
            self.assertEqual(geometry, run['geometry'])
            self.assertEqual({(item['scheme'], item['width']) for item in geometry}, windows)
            for item in geometry:
                popup = item['popup']
                self.assertGreaterEqual(popup['origin']['x'], 0)
                self.assertGreaterEqual(popup['origin']['y'], 0)
                self.assertEqual(popup['size']['width'], 280)
                self.assertLessEqual(popup['origin']['x'] + popup['size']['width'], item['width'])
                self.assertLess(popup['origin']['y'] + popup['size']['height'], item['height'])
        for group in ('artifacts', 'failedAttempts', 'earlierPresentation'):
            for artifact in evidence[group]:
                self.assert_artifact(artifact)
        self.assertIn(evidence['commitSubject'], (ROOT / 'operatelog.md').read_text())
