"""N01 isolation/scope checks; not a replacement for native NSH tests."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


class NshValidationScopeTests(unittest.TestCase):
    def test_probe_has_separate_identity_and_no_external_capabilities(self):
        config = json.loads((PROBE / 'nsh.json').read_text())
        self.assertEqual(config['id'], 'dev.muma.probe.nsh')
        self.assertNotEqual(config['id'], 'dev.moos.agent.electron')
        self.assertEqual(config['capabilities'], {})
        for name in ('App.tsx', 'model.ts'):
            source = (PROBE / name).read_text()
            for forbidden in ('fetch(', 'WebView', 'credentials.json', 'child_process', 'Storage.', 'nsh/fs'):
                self.assertNotIn(forbidden, source)

    def test_entry_and_runner_remain_scoped(self):
        source = (PROBE / 'App.tsx').read_text()
        self.assertIn('cleanup(', source)
        self.assertIn('clearInterval', source)
        self.assertIn('本地模拟', source)
        self.assertIn('<List', source)
        runner = (PROBE / 'nsh.sh').read_text()
        self.assertIn('nsh 0.5.0 (f4d68f7)', runner)
        self.assertIn('artifacts/nsh-validation', runner)
        self.assertNotIn('/Applications/', runner)
        self.assertNotIn('component add', runner)
        self.assertNotIn('--run', runner)
        self.assertIn('.nsh/', (PROBE / '.gitignore').read_text())

    def test_plan_keeps_unverified_mobile_and_business_work_open(self):
        plan = (ROOT / 'PLAN.md').read_text()
        self.assertIn('- [ ] N01', plan)
        self.assertNotIn('- [x] N01', plan)
        report = (PROBE / 'VALIDATION.md').read_text()
        for limitation in ('全仓验收未全通过', '不是手机截图', '未生成 iOS 包', '没有同业务'):
            self.assertIn(limitation, report)
        self.assertIn('N01', (ROOT / 'operatelog.md').read_text())


if __name__ == '__main__':
    unittest.main()
