"""Settings provenance for isolated AppKit runs, not installed-app acceptance."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import unittest

from nsh_composer_provenance import PROBE, ROOT, current_composer_input, settings_evidence, sidebar_jewel_evidence


def record(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class DesktopSettingsTests(unittest.TestCase):
    def verified(self, item):
        data = (ROOT / item['path']).read_bytes()
        self.assertEqual(record(data), {k: item[k] for k in ('bytes', 'sha256')}, item['path'])
        return data

    def test_settings_inputs_and_appkit_captures(self):
        evidence = settings_evidence()
        self.verified(evidence['predecessorReceipt'])
        self.assertEqual(evidence['protected'], sidebar_jewel_evidence()['protected'])
        self.assertTrue(evidence['protected'].keys().isdisjoint(evidence['inputs']))
        self.assertTrue(all(value is False for value in evidence['acceptance'].values()))
        for path, summary in evidence['inputs'].items():
            current = current_composer_input(self, path, summary, after=settings_evidence)
            self.assertEqual(record((ROOT / path).read_bytes()), current, path)
        for path, sha in evidence['previousInputs'].items():
            before = subprocess.check_output(['git', 'show', f"{evidence['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(before)['sha256'], sha, path)
        self.assertEqual(set(evidence['matrices']), {'withArt', 'fallback'})
        for mode, run in evidence['matrices'].items():
            capture = json.loads(self.verified(run['capture']))
            self.assertTrue(capture['synthetic'] and not capture['piExecuted'])
            self.assertEqual(capture['head'], evidence['base'])
            for name, summary in capture['workspaceHashes'].items():
                path = PROBE / name
                current = current_composer_input(self, str(path.relative_to(ROOT)), summary, after=settings_evidence)
                self.assertEqual(record(path.read_bytes()), current, name)
            result = json.loads(self.verified(run['result']))
            self.assertTrue(result['passed'] and not result['installed'])
            self.assertIs(result['artwork'], mode == 'withArt')
            output = self.verified(run['testLog']).decode()
            self.assertIn('3 tests: 3 passed, 0 failed', output)
            self.assertIn('a hidden statistics row still accumulates drained tasks', output)
            windows = {'light-1240': (1240, 820), 'dark-680': (680, 720)}
            self.assertEqual({Path(image['path']).name for image in run['images']},
                             {f'settings-{key}-{state}.png' for key in windows
                              for state in ('open', 'switched', 'hidden')})
            for image in run['images']:
                data = self.verified(image)
                self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                key = '-'.join(Path(image['path']).stem.split('-')[1:3])
                self.assertEqual(struct.unpack('>II', data[16:24]), windows[key])
        for item in evidence['verificationLogs']:
            self.verified(item)

    def test_settings_keep_delivery_and_model_boundaries(self):
        view = (PROBE / 'DesktopView.tsx').read_text()
        settings = (PROBE / 'DesktopSettings.tsx').read_text()
        self.assertIn('model.id === directory.defaultId', view)
        self.assertIn("props.defaultModel ?? '暂未提供'", settings)
        self.assertNotIn('host.call', settings)
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('DESKTOP-SETTINGS.md', (ROOT / name).read_text())
        self.assertIn(settings_evidence()['commitSubject'], (ROOT / 'operatelog.md').read_text())
