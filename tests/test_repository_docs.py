"""仓库文档契约检查。运行：python3 -m unittest discover -s tests -v。"""
from pathlib import Path
import re
import json
import hashlib
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RepositoryDocsTests(unittest.TestCase):
    def test_required_documents_are_nonempty_utf8(self):
        for name in ('AGENTS.md', 'operatelog.md', 'PLAN.md'):
            with self.subTest(name=name):
                self.assertTrue((ROOT / name).read_text(encoding='utf-8').strip())

    def test_five_numbered_rules_and_required_obligations(self):
        text = (ROOT / 'AGENTS.md').read_text(encoding='utf-8')
        rules = re.findall(r'^([1-5])\. (.+)$', text, re.MULTILINE)
        self.assertEqual([number for number, _ in rules], list('12345'))
        expected = [('Git commit', '回滚'), ('测试', '验收', '全部通过'),
                    ('operatelog.md', '北京时间', '密码', '令牌', '原始抓包载荷'),
                    ('PLAN.md', '依赖', '证据', '解除条件'), ('推送', 'GitHub')]
        for (_, rule), terms in zip(rules, expected):
            for term in terms:
                with self.subTest(term=term):
                    self.assertIn(term, rule)

    def test_log_records_required_audit_fields(self):
        text = (ROOT / 'operatelog.md').read_text(encoding='utf-8')
        self.assertRegex(text, r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+08:00')
        for field in ('修改或新增内容', '遇到的难题', '处理方式', '验证结果', '遗留问题', '对应 Git 提交'):
            self.assertIn('- ' + field + '：', text)
        self.assertNotIn('待执行本轮自动检查', text)

    def test_push_status_has_log_and_acceptance_evidence(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        log = (ROOT / 'operatelog.md').read_text(encoding='utf-8')
        if '远程推送受阻：' in plan:
            self.assertIn('- [ ] 推送 origin/main', plan)
            self.assertIn('解除条件', plan)
            self.assertIn('HTTP 403', log)
        if '- [x] 推送 origin/main' in plan:
            self.assertIn('git ls-remote', plan)
            hashes = re.findall(r'`([0-9a-f]{40})`', plan)
            self.assertTrue(hashes)
            self.assertIn(hashes[-1], log)
            self.assertIn('远程推送阻塞已解除', plan)

    def test_plan_contains_dependencies_and_acceptance_evidence(self):
        text = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        for term in ('依赖', '验收标准', '证据', '受阻原因', '解除条件'):
            self.assertIn(term, text)
        self.assertRegex(text, r'- \[x\]')
        self.assertRegex(text, r'- \[ \]')


    def test_mvp_stages_have_ordered_dependencies_and_acceptance(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        stages = re.findall(r'^### (M\d{2})｜[^\n]+\n(.*?)(?=^### |^## |\Z)',
                            plan, re.MULTILINE | re.DOTALL)
        self.assertEqual([stage for stage, _ in stages],
                         [f'M{i:02}' for i in range(1, 10)])
        seen = set()
        for stage, body in stages:
            with self.subTest(stage=stage):
                dependency = re.search(r'^依赖：(.+)$', body, re.MULTILINE)
                self.assertIsNotNone(dependency)
                for required in re.findall(r'M\d{2}', dependency.group(1)):
                    self.assertIn(required, seen, '依赖必须存在且先于当前阶段')
                self.assertIn('测试与实际验收：', body)
                self.assertIn('- [ ] ' + stage, body)
                seen.add(stage)

    def test_mvp_completed_subtasks_require_evidence(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        stages = plan.split('## MVP 开发任务', 1)[1]
        for line in re.findall(r'^- \[x\].+$', stages, re.MULTILINE):
            self.assertIn('证据：', line)
            evidence_ids = re.findall(r'E\d{2}', line)
            self.assertTrue(evidence_ids)
            for evidence_id in evidence_ids:
                self.assertIn('| ' + evidence_id + ' |', plan)
        self.assertIn('- [ ] M01 整体验收', stages)
        self.assertIn('- [ ] M01.6', stages)
        self.assertIn('- [ ] M01.8', stages)
        rows = re.findall(r'^\| (A\d{2}) \|.*?\| ([^|]+) \|$',
                          plan, re.MULTILINE)
        self.assertEqual([row[0] for row in rows],
                         [f'A{i:02}' for i in range(1, 11)])
        self.assertTrue(all(status.strip() == '未执行' for _, status in rows))

    def test_confirmed_execution_constraints_are_consistent(self):
        agents = (ROOT / 'AGENTS.md').read_text(encoding='utf-8')
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        for term in ('Tauri 2', 'Ant Design X', 'uni-app x', 'PI',
                     'GLM Coding Plan', 'OpenAI 中转站', '两轮修复',
                     '无需', '同一 Wi-Fi', '同一', '串行', '全局',
                     '停止', '凭据', '体积'):
            with self.subTest(term=term):
                self.assertIn(term, agents)
                self.assertIn(term, plan)
        self.assertNotIn('当前受阻原因：用户尚未提供业务开发', plan)

    def test_each_log_entry_has_audit_fields_and_commit_reference(self):
        log = (ROOT / 'operatelog.md').read_text(encoding='utf-8')
        entries = re.split(r'^## ', log, flags=re.MULTILINE)[1:]
        self.assertGreaterEqual(len(entries), 4)
        for entry in entries:
            with self.subTest(entry=entry.splitlines()[0]):
                self.assertRegex(entry, r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+08:00')
                for field in ('修改或新增内容', '遇到的难题', '处理方式',
                              '验证结果', '遗留问题', '对应 Git 提交'):
                    self.assertIn('- ' + field + '：', entry)

    def test_m01_report_does_not_confuse_fixture_terminal_and_gui_acceptance(self):
        report = json.loads((ROOT / 'probes/m01/evidence/report.json').read_text())
        self.assertEqual(report['packagedResult']['pi']['status'], 'passed')
        self.assertFalse(report['packagedResult']['pi']['realProviderVerified'])
        self.assertEqual(report['desktop']['captureScope'], 'probe-window-only')
        self.assertFalse(report['normalGuiLaunch']['desktopInputVerified'])
        self.assertFalse(report['normalGuiLaunch']['screenCaptureGranted'])
        self.assertFalse(report['normalGuiLaunch']['accessibilityGranted'])
        screenshot = ROOT / 'probes/m01/evidence/native-window.png'
        self.assertEqual(hashlib.sha256(screenshot.read_bytes()).hexdigest(),
                         report['desktop']['screenshotSha256'])
        self.assertGreater(report['sizes']['appLogicalBytes'], report['sizes']['nodeBytes'])
        self.assertGreater(report['sizes']['appAllocatedBytes'], 0)


    def test_ios_preflight_distinguishes_usb_pairing_from_app_acceptance(self):
        preflight = json.loads((ROOT / 'probes/m01/evidence/ios-preflight.json').read_text())
        self.assertEqual(set(preflight['device']), {
            'platform', 'productType', 'osVersion', 'pairingState', 'transportType',
            'tunnelState', 'developerModeStatus'})
        self.assertEqual(preflight['device']['pairingState'], 'paired')
        self.assertEqual(preflight['device']['tunnelState'], 'connected')
        self.assertFalse(preflight['appInstalledByThisCheck'])
        self.assertFalse(preflight['lanVerified'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertIn('| E06 |', plan)
        if (preflight['device']['developerModeStatus'] != 'enabled'
                or preflight['validCodeSigningIdentities'] == 0):
            self.assertIn('- [ ] M01.8', plan)
        self.assertNotIn('当前无连接设备', plan)
        self.assertNotIn('devicectl 无设备', plan)

    def test_enabled_developer_mode_does_not_claim_signed_app_or_lan_acceptance(self):
        evidence = json.loads((ROOT / 'probes/m01/evidence/ios-preflight-enabled.json').read_text())
        self.assertEqual(evidence['device']['developerModeStatus'], 'enabled')
        self.assertEqual(evidence['device']['tunnelState'], 'connected')
        self.assertFalse(evidence['appInstalledByThisCheck'])
        self.assertFalse(evidence['lanVerified'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertIn('| E07 |', plan)
        if evidence['validCodeSigningIdentities'] == 0:
            self.assertIn('- [ ] M01.8', plan)
            historical_row = re.search(r'^\| E07 \|.*$', plan, re.MULTILINE)
            self.assertIsNotNone(historical_row)
            self.assertRegex(historical_row.group(0), r'有效签名身份.*0')

    def test_signing_identity_readiness_is_not_app_install_acceptance(self):
        evidence = json.loads((ROOT / 'probes/m01/evidence/ios-signing-ready.json').read_text())
        signing = evidence['signing']
        self.assertEqual(signing['validIdentitiesBeforeRepair'], 0)
        self.assertGreaterEqual(signing['validIdentitiesAfterRepair'], 1)
        self.assertTrue(signing['appleDevelopmentIdentityDetected'])
        self.assertEqual(signing['officialIntermediateVerifyExitCode'], 0)
        self.assertFalse(signing['trustSettingsChanged'])
        self.assertFalse(signing['privateKeyExported'])
        self.assertFalse(evidence['appInstalledByThisCheck'])
        self.assertFalse(evidence['lanVerified'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertIn('| E08 |', plan)
        self.assertIn('- [ ] M01.8 验证', plan)


if __name__ == '__main__':
    unittest.main()
