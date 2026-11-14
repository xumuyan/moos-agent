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

    def test_ios_followup_distinguishes_connection_package_and_install(self):
        report = (PROBE / 'IOS-CHECK.md').read_text()
        for marker in ('wired', 'paired', '--no-auto-mount-ddis', 'MuMaNSHProbe',
                       'e0a5039702ad3c53fa938d8dfba488856e8be8632f5fac1538f241df6f6bb53d',
                       '无开发签名', 'Signature=adhoc', 'iPhone安装/启动', '全量没有在本轮重跑'):
            self.assertIn(marker, report)
        for private_field in ('serialNumber', 'udid', 'uniqueDeviceID'):
            self.assertNotIn(private_field, report)
        readme = (PROBE / 'README.md').read_text()
        self.assertIn('--target ios --name MuMaNSHProbe', readme)
        self.assertIn('尚未签名/安装/运行', readme)

    def test_installation_does_not_claim_launch_or_security_bypass(self):
        report = (PROBE / 'IOS-INSTALL.md').read_text()
        for marker in ('用户明确授权', 'dev.muma.probe.nsh', 'profile',
                       'codesign --verify --deep --strict', 'outcome=success',
                       'exit1', '复合诊断', 'launched=false', '不绕过安全授权',
                       '全量本轮未重跑', 'N01继续未完成'):
            self.assertIn(marker, report)
        self.assertIn('IOS-INSTALL.md', (PROBE / 'README.md').read_text())
        self.assertIn('启动被iOS Security拒绝', (ROOT / 'PLAN.md').read_text())

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
