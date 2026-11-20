"""Keep persistence, disposable application regression and migration evidence separate."""
import hashlib
import json
import subprocess
import unittest

from nsh_composer_provenance import ROOT, desktop_profile_evidence


def record(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


class DesktopProfileEvidenceTests(unittest.TestCase):
    def artifact(self, receipt):
        path = ROOT / receipt['path']
        self.assertTrue(path.is_relative_to(ROOT / 'artifacts/nsh-validation/pi-ui'))
        if path.is_file():
            data = path.read_bytes()
            self.assertEqual(record(data), {k: receipt[k] for k in ('bytes', 'sha256')})
            return data
        return None

    def test_inputs_and_disposable_native_receipt(self):
        e = desktop_profile_evidence()
        for path, info in e['inputs'].items():
            self.assertEqual(record((ROOT / path).read_bytes()), info, path)
        for path, digest in e['previousInputs'].items():
            before = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(before)['sha256'], digest, path)
        native = e['nativeRegression']
        self.assertEqual((native['status'], native['passedChecks'], native['scope']), (0, 17, 'scripted disposable fixture'))
        data = self.artifact(native['inputs'])
        if data is not None:
            capture = json.loads(data)
            self.assertEqual(capture['head'], e['base'])
            self.assertEqual(capture['modelMode'], 'fixture')
            self.assertTrue(capture['acceptance'])
            for path, info in e['inputs'].items():
                if path.startswith('probes/') and not path.endswith('.test.mjs'):
                    self.assertEqual(capture['inputs'][path], info)
        data = self.artifact(native['result'])
        if data is not None:
            result = json.loads(data)
            self.assertTrue(result['passed'] and result['normalChildExit'])
            self.assertFalse(result['forced'])
            self.assertEqual(len(set(result['checks'])), 17)
        self.artifact(native['log'])

    def test_restart_does_not_promote_installation_or_migration(self):
        e = desktop_profile_evidence()
        self.assertEqual(e['task'], 'N01-D2')
        run = e['restart']
        self.assertEqual((run['scope'], run['processes'], run['status']), ('synthetic-only', 2, 0))
        self.assertIn('PI upstream prior context', run['checks'])
        self.assertIn('interrupted without replay', run['checks'])
        log = self.artifact(run['log'])
        if log is not None:
            self.assertIn(f"pass {run['focusedPassed']}".encode(), log)
        self.assertEqual(set(e['notAccepted']), {'installed persistent app', 'GUI history restore',
                         'unclean Host recovery', 'formal export/import', 'formal cutover'})
        plan = (ROOT / 'PLAN.md').read_text()
        self.assertIn('- [ ] N01-D2', plan)
        self.assertIn('实际迁移尚未执行，正式版暂不退出', plan)
