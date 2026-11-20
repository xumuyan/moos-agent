"""Bind the scripted two-launch history proof without promoting cutover."""
import hashlib
import json
import struct
import subprocess
import unittest

from nsh_composer_provenance import ROOT, current_composer_input, desktop_persistent_evidence


def record(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


class PersistentWindowReceiptTests(unittest.TestCase):
    def artifact(self, info):
        path = ROOT / info['path']
        self.assertTrue(path.is_relative_to(ROOT / 'artifacts/nsh-validation/pi-ui'))
        if path.is_file():
            data = path.read_bytes()
            self.assertEqual(record(data), {k: info[k] for k in ('bytes', 'sha256')})
            return data
        return None

    def test_source_successors_and_available_native_capture(self):
        e = desktop_persistent_evidence()
        for path, current in e['inputs'].items():
            expected = current_composer_input(self, path, current, after=desktop_persistent_evidence)
            self.assertEqual(record((ROOT / path).read_bytes()), expected, path)
        for path, prior in e['previousInputs'].items():
            self.assertIn(path, e['inputs'])
            old = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(old)['sha256'], prior, path)
        n = e['native']
        self.assertEqual(n['status'], 0)
        data = self.artifact(n['inputs'])
        if data is not None:
            capture = json.loads(data)
            self.assertEqual(capture['head'], e['base'])
            self.assertTrue(capture['persistent'] and capture['acceptance'])
            self.assertEqual(capture['modelMode'], 'fixture')
            for path, info in capture['inputs'].items():
                if path in e['inputs']:
                    self.assertEqual(e['inputs'][path], info, path)
            for path, info in e['protectedRuntimeInputs'].items():
                self.assertEqual(capture['inputs'][path], info, path)
        data = self.artifact(n['screenshot'])
        if data is not None:
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual(list(struct.unpack('>II', data[16:24])), n['screenshot']['pixels'])
        data = self.artifact(n['report'])
        if data is not None:
            self.assertEqual(json.loads(data), n['result'])
        for key in ('first', 'reopened'):
            data = self.artifact(n[key])
            if data is not None:
                self.assertEqual(json.loads(data), n['result'][key])
        self.artifact(n['log'])
        disposable = e['disposableRegression']
        self.assertEqual((disposable['status'], disposable['passedChecks']), (0, 17))
        data = self.artifact(disposable['inputs'])
        if data is not None:
            capture = json.loads(data)
            self.assertFalse(capture['persistent'])
            self.assertTrue(capture['acceptance'])
            self.assertEqual(capture['head'], e['base'])
            for path, info in e['inputs'].items():
                if path in capture['inputs']:
                    self.assertEqual(capture['inputs'][path], info, path)
        data = self.artifact(disposable['result'])
        if data is not None:
            result = json.loads(data)
            self.assertTrue(result['passed'] and result['normalChildExit'])
            self.assertEqual((result['forced'], result['stderrBytes']), (False, 0))
            self.assertEqual(len(set(result['checks'])), 17)
        self.artifact(disposable['log'])

    def test_continuation_is_scoped_and_not_migration(self):
        e = desktop_persistent_evidence()
        self.assertEqual((e['task'], e['bundleIdentifier']),
                         ('N01-D2', 'dev.muma.probe.nsh.piui.persistent'))
        r = e['native']['result']
        self.assertTrue(r['reopened']['restart'])
        self.assertFalse(r['first']['restart'])
        self.assertEqual(r['first']['scope'], r['reopened']['scope'])
        for turn in (r['first'], r['reopened']):
            self.assertTrue(turn['passed'] and turn['normalChildExit'])
            self.assertFalse(turn['forced'])
            self.assertEqual(turn['stderrBytes'], 0)
        self.assertEqual(len(r['first']['checks']), 3)
        self.assertEqual(set(r['reopened']['checks']), {
            'restored history without replay', 'other project stays empty', 'same session selected again',
            'old user and assistant rows laid out', 'old messages captured before Send',
            'PI continuation uses old context', 'live turn excluded from historical page',
        })
        for k in ('installed', 'portable', 'manualQuit'):
            self.assertIs(r[k], False)
        self.assertEqual(set(e['notAccepted']), {'manual GUI', 'unclean exit recovery', 'real upstream persistence',
                                                'portable package', 'formal migration', 'formal cutover'})
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn(f'- [ ] {task}', plan)
        self.assertIn('实际迁移尚未执行，正式版暂不退出', plan)
