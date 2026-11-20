"""Local AppKit font resolution evidence, not signed delivery acceptance."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import unittest

from nsh_composer_provenance import PROBE, ROOT, settings_evidence, wenkai_evidence, current_composer_input


def digest(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


class DesktopWenKaiTests(unittest.TestCase):
    def verified(self, item):
        data = (ROOT / item['path']).read_bytes()
        self.assertEqual(digest(data), {k: item[k] for k in ('bytes', 'sha256')}, item['path'])
        return data

    def test_candidate_ui_font_and_code_fallbacks(self):
        theme = (PROBE / 'desktop-theme.ts').read_text()
        self.assertIn('fontFamily: \'"LXGW WenKai", system-ui, "PingFang SC", "Hiragino Sans GB", sans-serif\'', theme)
        self.assertIn('monoFont: \'Menlo, "PingFang SC", monospace\'', theme)
        view = (PROBE / 'DesktopView.tsx').read_text()
        for token in ('code: { fontFamily: t.monoFont }', 'codeBlockCode: { fontFamily: t.monoFont }'):
            self.assertIn(token, view)
        self.assertNotIn('ornamentFont', view)
        for path in ('DesktopView.tsx', 'DesktopSettings.tsx', 'DesktopModelPicker.tsx'):
            self.assertNotIn('registerFont', (PROBE / path).read_text())

    def test_native_font_captures_and_successor_inputs(self):
        evidence = wenkai_evidence()
        self.verified(evidence['predecessorReceipt'])
        self.assertEqual(evidence['protected'], settings_evidence()['protected'])
        self.assertTrue(evidence['protected'].keys().isdisjoint(evidence['inputs']))
        self.assertTrue(all(value is False for value in evidence['acceptance'].values()))
        for path, summary in evidence['inputs'].items():
            current = current_composer_input(self, path, summary, after=wenkai_evidence)
            self.assertEqual(digest((ROOT / path).read_bytes()), current, path)
        for path, sha in evidence['previousInputs'].items():
            before = subprocess.check_output(['git', 'show', f"{evidence['base']}:{path}"], cwd=ROOT)
            self.assertEqual(digest(before)['sha256'], sha, path)
        self.assertIn('LXGW WenKai: LXGWWenKai-Regular', self.verified(evidence['fontLookup']).decode())
        self.assertEqual(set(evidence['matrices']), {'withArt', 'fallback'})
        for mode, run in evidence['matrices'].items():
            capture = json.loads(self.verified(run['capture']))
            self.assertEqual(capture['head'], evidence['base'])
            self.assertTrue(capture['synthetic'] and not capture['piExecuted'])
            for name, summary in capture['workspaceHashes'].items():
                self.assertEqual(digest((PROBE / name).read_bytes()), summary, name)
            self.assertEqual(digest(self.verified(run['sampleSource'])), capture['sourceHashes']['ThemeFontSamples.tsx'])
            result = json.loads(self.verified(run['result']))
            self.assertTrue(result['passed'] and not result['installed'])
            self.assertIs(result['artwork'], mode == 'withArt')
            self.assertIn('3 tests: 3 passed, 0 failed', self.verified(run['testLog']).decode())
            pixels = json.loads(self.verified(run['pixels']))
            self.assertEqual(set(pixels), {'regularText', 'semiboldText', 'input', 'markdown'})
            for cell in pixels.values():
                self.assertEqual(cell['vsWenKai'], 0)
                self.assertEqual(cell['missingVsFallback'], 0)
                self.assertGreaterEqual(cell['vsFallback'], 100)
            images = {'type-font-samples.png': (976, 200)}
            for scheme in ('light', 'dark'):
                for state in ('wide-idle', 'wide-chat', 'wide-settings', 'narrow-chat', 'narrow-long-title'):
                    images[f'type-{scheme}-{state}.png'] = (680, 720) if state.startswith('narrow') else (1240, 820)
            self.assertEqual({Path(item['path']).name for item in run['images']}, images.keys())
            for item in run['images']:
                data = self.verified(item)
                self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
                self.assertEqual(struct.unpack('>II', data[16:24]), images[Path(item['path']).name])
        for item in evidence['verificationLogs']:
            self.verified(item)
