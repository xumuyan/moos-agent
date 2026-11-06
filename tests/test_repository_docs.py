"""仓库文档契约检查。运行：python3 -m unittest discover -s tests -v。"""
from pathlib import Path
import re
import json
import hashlib
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RepositoryDocsTests(unittest.TestCase):
    def test_user_override_uses_local_private_credentials_without_keychain_migration(self):
        rules = (ROOT / 'AGENTS.md').read_text()
        main = (ROOT / 'apps/desktop/src-tauri/src/main.rs').read_text()
        self.assertIn('2026-11-06', rules)
        self.assertIn('private/credentials.json', rules)
        self.assertIn('LocalCredentials::new', main)
        self.assertNotIn('NativeKeychain', main)
        self.assertIn('**/credentials.json', (ROOT / '.gitignore').read_text())

    def test_latest_ui_installation_keeps_scope_and_source_traceable(self):
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p02-installed-ui.json').read_text())
        self.assertEqual(evidence['installedPath'], '/Applications/Moos.app')
        self.assertRegex(evidence['sourceCommit'], r'^[a-f0-9]{40}$')
        self.assertRegex(evidence['sourceAndInstalledExecutableSha256'], r'^[a-f0-9]{64}$')
        self.assertTrue(evidence['gui']['localZipAndFolderButtons'])
        self.assertTrue(evidence['process']['appFromApplications'])
        self.assertFalse(evidence['limits']['notarized'])
        self.assertFalse(evidence['limits']['nativePtyImplemented'])

    def test_confirmed_dsh_ui_plugin_design_keeps_implementation_unclaimed(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        design_path = ROOT / 'docs/superpowers/specs/2026-11-05-dsh-ui-plugin-design.md'
        design = design_path.read_text(encoding='utf-8')
        for term in ('选择性移植 DeepSeek Harness', 'Moos UI Adapter', 'Tauri 2',
                     'PI SDK', '单一隐藏运行时', 'Token', '缓存命中率',
                     'plugin.json', '沙箱', 'Tauri 原生 PTY'):
            self.assertIn(term, design)
        self.assertIn('fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159', design)
        self.assertIn('600.0 秒和 600.1 秒', design)
        self.assertIn('P02｜DSH 风格前端、插件与长任务运行时（实施中）', plan)
        self.assertIn('- [x] P02.1 ', plan)
        self.assertIn('证据：E19', plan)
        self.assertIn('- [x] P02.2 ', plan)
        self.assertIn('证据：E20', plan)
        self.assertIn('- [x] P02.3 ', plan)
        self.assertIn('证据：E21', plan)
        self.assertIn('- [x] P02.4 ', plan)
        self.assertIn('证据：E22', plan)
        self.assertIn('- [x] P02.5 ', plan)
        self.assertIn('证据：E23', plan)
        self.assertIn('- [x] P02.6 ', plan)
        self.assertIn('证据：E24', plan)
        self.assertIn('- [x] P02.7 ', plan)
        self.assertIn('证据：E25', plan)
        for number in range(8, 10):
            self.assertIn(f'- [ ] P02.{number} ', plan)
        p02 = plan.split('## P02｜', 1)[1].split('## P01｜', 1)[0]
        self.assertEqual(p02.count('- [x]'), 7)
        self.assertIn('在线插件市场不在首批范围', p02)

    def test_p02_1_records_license_adapter_and_shell_evidence(self):
        notice = (ROOT / 'THIRD_PARTY_NOTICES.md').read_text(encoding='utf-8')
        source = (ROOT / 'docs/third-party/deepseek-harness.md').read_text(encoding='utf-8')
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        for document in (notice, source):
            self.assertIn('fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159', document)
            self.assertIn('MIT', document)
            self.assertIn('Copyright (c) 2026 DeepSeek', document)
        self.assertIn('没有复制或实质性改写', source)
        self.assertIn('apps/desktop/src/ui-adapter/', source)
        self.assertIn('apps/desktop/src/layout/', source)
        self.assertIn('| E19 |', plan)
        for path in ('apps/desktop/src/ui-adapter/snapshot.ts',
                     'apps/desktop/src/ui-adapter/commands.ts',
                     'apps/desktop/src/layout/AppShell.tsx',
                     'apps/desktop/src/layout/RightPanel.tsx'):
            self.assertTrue((ROOT / path).is_file(), path)

    def test_p02_2_records_truthful_settings_and_packaged_gui_evidence(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        evidence = (ROOT / 'apps/desktop/evidence/p02-workspace-experience.json').read_text(encoding='utf-8')
        self.assertIn('- [x] P02.2 ', plan)
        self.assertIn('| E20 |', plan)
        for term in ('请求批准', '帮我批准', '完全访问权限', 'permissionPolicyBackendConnected',
                     'verifiedUsageImplemented', 'tauriReportedSizeMiB'):
            self.assertIn(term, evidence)
        for path in ('apps/desktop/src/composer/PermissionMenu.tsx',
                     'apps/desktop/src/conversation/TaskTrajectory.tsx',
                     'apps/desktop/src/settings/SettingsCenter.tsx'):
            self.assertTrue((ROOT / path).is_file(), path)

    def test_p02_3_records_single_sdk_runtime_and_process_evidence(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p02-sdk-runtime.json').read_text())
        runtime = (ROOT / 'packages/pi-runtime/sdk-runtime.mjs').read_text(encoding='utf-8')
        main = (ROOT / 'apps/desktop/src-tauri/src/main.rs').read_text(encoding='utf-8')
        self.assertIn('- [x] P02.3 ', plan)
        self.assertIn('| E21 |', plan)
        self.assertEqual(evidence['runtime']['piVersion'], '1.5.0')
        self.assertEqual(evidence['runtime']['packagedNodeHosts'], 1)
        self.assertEqual(evidence['runtime']['perTaskPiCliProcesses'], 0)
        self.assertTrue(evidence['sdkAcceptance']['conversationResumeAfterControllerRestart'])
        self.assertTrue(evidence['sdkAcceptance']['activeToolCancellationStopsOwnedChild'])
        self.assertTrue(evidence['processAcceptance']['forcedAppSigkillStoppedNodeHost'])
        self.assertFalse(evidence['limits']['taskLongerThanTenMinutesTested'])
        self.assertIn('createAgentSession', runtime)
        self.assertNotIn('DiagnosticAgent', main)
        self.assertNotIn('launch_diagnostics', main)

    def test_p02_4_records_bounded_policy_safe_errors_and_actual_long_task(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p02-long-tasks.json').read_text())
        self.assertIn('- [x] P02.4 ', plan)
        self.assertIn('| E22 |', plan)
        self.assertEqual(evidence['policy']['choicesMs'],
                         [600000, 1800000, 3600000, 7200000, 21600000, 86400000])
        self.assertEqual(evidence['policy']['defaultMs'], 7200000)
        self.assertGreater(evidence['actualLongTask']['durationMs'], 600000)
        self.assertEqual(evidence['actualLongTask']['status'], 'succeeded')
        self.assertGreaterEqual(evidence['actualLongTask']['heartbeatCount'], 40)
        self.assertTrue(evidence['safeErrors']['rawProviderTextAbsent'])
        self.assertEqual(evidence['packagedGui']['restoredTaskTimeoutMs'], 7200000)
        self.assertFalse(evidence['limits']['realChargedProviderTested'])

    def test_p02_5_records_only_verified_usage_and_preserves_real_provider_limits(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p02-verified-usage.json').read_text())
        usage = (ROOT / 'services/agent/usage.mjs').read_text(encoding='utf-8')
        self.assertIn('- [x] P02.5 ', plan)
        self.assertIn('| E23 |', plan)
        self.assertEqual(evidence['fixtureAcceptance']['openaiCompletions']['cacheHitRate'], 0.2)
        self.assertIsNone(evidence['fixtureAcceptance']['openaiResponses']['cacheHitRate'])
        self.assertFalse(evidence['fixtureAcceptance']['failedProviderRequestCreatesUsageRecord'])
        self.assertFalse(evidence['implementation']['exportContainsPromptOrCredential'])
        self.assertFalse(evidence['limits']['realGlmOrRelayProviderTested'])
        self.assertFalse(evidence['limits']['p02Complete'])
        self.assertIn('cacheReadTokens / denominator', usage)

    def test_p02_6_records_typed_slots_builtin_plugin_and_safe_theme_limits(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p02-plugin-theme-core.json').read_text())
        mounted_sources = '\n'.join(
            (ROOT / path).read_text(encoding='utf-8')
            for path in (
                'apps/desktop/src/App.tsx',
                'apps/desktop/src/layout/RightPanel.tsx',
                'apps/desktop/src/settings/SettingsCenter.tsx',
                'apps/desktop/src/settings/UsageSection.tsx',
                'apps/desktop/src/conversation/ConversationTranscript.tsx',
            )
        )
        self.assertIn('- [x] P02.6 ', plan)
        self.assertIn('| E24 |', plan)
        self.assertEqual(len(evidence['slots']['approved']), 10)
        self.assertTrue(evidence['slots']['allMounted'])
        self.assertTrue(evidence['slots']['unknownRejected'])
        self.assertTrue(evidence['slots']['duplicatePluginIdRejected'])
        self.assertTrue(evidence['slots']['incompatibleVersionRejected'])
        self.assertTrue(evidence['slots']['idempotentRevokeVerified'])
        self.assertTrue(evidence['slots']['disableCleanupVerified'])
        self.assertEqual(evidence['slots']['renderErrorLimit'], 3)
        for slot in evidence['slots']['approved']:
            self.assertIn(f'slot="{slot}"', mounted_sources)
        self.assertTrue(evidence['builtinPlugin']['runsInsideExistingWebView'])
        self.assertFalse(evidence['builtinPlugin']['startsNodeOrWebService'])
        self.assertTrue(evidence['builtinPlugin']['browserDisableRemovedContribution'])
        self.assertTrue(evidence['builtinPlugin']['browserEnableRestoredContribution'])
        self.assertFalse(evidence['themes']['previewChangedRootTheme'])
        self.assertTrue(evidence['themes']['explicitApplyPersistedAcrossReload'])
        self.assertTrue(evidence['themes']['invalidStartupFixtureFellBackToDefault'])
        self.assertFalse(evidence['themes']['horizontalOverflow'])
        self.assertFalse(evidence['limits']['thirdPartyPluginInstallImplemented'])
        self.assertFalse(evidence['limits']['zipValidationAndSandboxImplemented'])
        self.assertFalse(evidence['limits']['p02Complete'])

    def test_p02_7_records_local_installer_sandbox_lifecycle_and_limits(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p02-local-plugins.json').read_text())
        rust = (ROOT / 'apps/desktop/src-tauri/src/plugins.rs').read_text(encoding='utf-8')
        sandbox = (ROOT / 'apps/desktop/src/plugins/sandbox/runtime.ts').read_text(encoding='utf-8')
        self.assertIn('- [x] P02.7 ', plan)
        self.assertIn('| E25 |', plan)
        self.assertTrue(evidence['installer']['folderInstallVerifiedInPackagedGui'])
        self.assertTrue(evidence['installer']['zipInstallVerifiedInPackagedGui'])
        self.assertTrue(evidence['installer']['invalidUpgradePreservedInstalledVersion'])
        self.assertTrue(evidence['sandbox']['hostRendersOnlyValidatedDeclarativeUi'])
        self.assertTrue(evidence['sandbox']['workerCrashAutoDisabledInPackagedGui'])
        self.assertTrue(evidence['sandbox']['healthWatchdog'])
        self.assertFalse(evidence['sandbox']['hardPerWorkerMemoryQuotaAvailable'])
        self.assertEqual(evidence['packagedGui']['pluginNodeOrWebServiceProcesses'], 0)
        self.assertTrue(evidence['lifecycle']['installEnableDisableUpgradeRollbackUninstallAutomated'])
        self.assertFalse(evidence['lifecycle']['guiUninstallDestructiveConfirmationExecuted'])
        self.assertFalse(evidence['limits']['onlineMarketplaceImplemented'])
        for term in ('enclosed_name', 'MAX_TOTAL_BYTES', 'nlink()', 'reject_executable'):
            self.assertIn(term, rust)
        for term in ('new Worker', 'message_limit', 'worker_unresponsive', '__TAURI_INTERNALS__'):
            self.assertIn(term, sandbox)

    def test_dsh_implementation_plan_is_ordered_and_unclaimed(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        design = (ROOT / 'docs/superpowers/specs/2026-11-05-dsh-ui-plugin-design.md').read_text(encoding='utf-8')
        implementation_path = ROOT / 'docs/superpowers/plans/2026-11-05-dsh-ui-plugin-implementation.md'
        implementation = implementation_path.read_text(encoding='utf-8')
        self.assertIn(str(implementation_path.relative_to(ROOT)), plan)
        self.assertIn('macOS Keychain', design)
        self.assertNotIn('本地密钥文件', design)
        for number in range(1, 10):
            self.assertIn(f'P02.{number}', implementation)
        self.assertIn('- [x] P02.1 ', plan)
        self.assertIn('- [x] P02.2 ', plan)
        self.assertIn('- [x] P02.3 ', plan)
        self.assertIn('- [x] P02.4 ', plan)
        self.assertIn('- [x] P02.5 ', plan)
        self.assertIn('- [x] P02.6 ', plan)
        self.assertIn('- [x] P02.7 ', plan)
        for number in range(8, 10):
            self.assertIn(f'- [ ] P02.{number} ', plan)
        for term in ('测试先行', 'SDK 单运行时可行性门禁',
                     'SDK 验证通过以前不得删除已验证的 RPC 路径',
                     'Activity Monitor', '超过 10 分钟', 'plugin.json',
                     'Tauri 原生 PTY', 'npm run build:app', 'git diff --check'):
            self.assertIn(term, implementation)
        p02 = plan.split('## P02｜', 1)[1].split('## P01｜', 1)[0]
        self.assertEqual(p02.count('- [x]'), 7)

    def test_provider_diagnostics_keep_acceptance_scope_explicit(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        for term in ('模型配置诊断', '草稿', '钥匙串', '独立诊断通道', '真实模型未验收'):
            self.assertIn(term, plan)
        self.assertIn('- [ ] M04 接入 GLM Coding Plan', plan)

    def test_product_chat_evidence_preserves_unverified_real_provider_scope(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        for term in ('P01', 'npm run dev:app', 'npm run build:app', '真实模型未验收',
                     '本地模拟模型', '同真实目录串行', '手机、原生电脑操作和自动模型路由暂不接入'):
            self.assertIn(term, plan)
        self.assertIn('- [ ] M04 接入 GLM Coding Plan', plan)
        self.assertIn('- [ ] M01 整体验收', plan)


    def test_permission_routing_evidence_preserves_failed_browser_retest(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-permission-routing.json').read_text())
        self.assertTrue(report['permissionNavigation']['bothClickedInInstalledGUI'])
        self.assertNotEqual(report['permissionNavigation']['screen'], report['permissionNavigation']['accessibility'])
        self.assertEqual(report['priorGuiBrowserResult']['status'], 'passed')
        self.assertEqual(report['currentGuiBrowserResult']['reason'], 'target-url-not-observed')
        self.assertFalse(report['revokeRestoreVerified'])
        self.assertFalse(report['sizeOptimizationComplete'])
        self.assertGreater(report['sizeBeforeReplacementMiB']['allocated'], report['sizeBeforeReplacementMiB']['logical'])

    def test_git_plugin_is_deferred_with_dependencies_and_acceptance(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        section = plan.split('## 后续计划：D01｜', 1)[1].split('## 最终验收清单', 1)[0]
        for term in ('WebStorm', '暂缓开发', '未实现、未验收', '不阻塞当前 M01',
                     'M09', 'M03', 'M06', '规范化工作目录锁', '三方对比', 'bare remote',
                     'Mac 安装版', '受阻原因', '解除条件'):
            self.assertIn(term, section)
        self.assertNotIn('- [x]', section)
        for number in range(1, 9):
            self.assertIn(f'- [ ] D01.{number} ', section)

    def test_browser_keyboard_fix_keeps_gui_evidence_and_remaining_limits(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-browser-keyboard-fix.json').read_text())
        self.assertTrue(report['beforeFixDiagnostic']['textEventFlags'] & report['commandMask'])
        self.assertEqual(report['beforeFixDiagnostic']['reason'], 'target-url-not-observed')
        self.assertTrue(all(run['result']['status'] == 'passed' for run in report['runs'][:3]))
        self.assertEqual(report['runs'][-2]['result']['status'], 'cancelled')
        self.assertFalse(report['runs'][-2]['screenshotExists'])
        self.assertEqual(report['runs'][-1]['result']['status'], 'passed')
        for run in report['runs']:
            if run['result']['status'] == 'passed':
                self.assertTrue(run['result']['urlVerified'])
                self.assertTrue(run['result']['markerVerified'])
                self.assertEqual(run['result']['captureScope'], 'verified-test-page-content')
        screenshot = ROOT / report['screenshot']['path']
        self.assertEqual(hashlib.sha256(screenshot.read_bytes()).hexdigest(), report['screenshot']['sha256'])
        self.assertFalse(report['permissionRevokeRestoreVerified'])
        self.assertFalse(report['piModelPlanningVerified'])

    def test_permission_completion_requires_both_real_gui_recovery_cycles(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-permission-recovery.json').read_text())
        self.assertTrue(report['allPermissionCyclesComplete'])
        for kind, revoked_key, other_key in [
            ('screen', 'screenCaptureGranted', 'accessibilityGranted'),
            ('accessibility', 'accessibilityGranted', 'screenCaptureGranted')]:
            case = report[kind]
            self.assertTrue(case['cycleComplete'])
            revoked = case['revoked']['report']
            self.assertEqual(revoked['launchContext'], 'GUI application command')
            self.assertEqual(revoked['status'], 'blocked')
            self.assertEqual(revoked['reason'], 'system-permission-required')
            self.assertFalse(revoked[revoked_key])
            self.assertTrue(revoked[other_key])
            self.assertFalse(case['revoked']['screenshotExists'])
            restored = case['restored']['report']
            self.assertEqual(restored['status'], 'passed')
            self.assertTrue(restored['keyboardNavigation'])
            self.assertTrue(restored['urlVerified'])
            self.assertTrue(restored['markerVerified'])
            self.assertEqual(restored['captureScope'], 'verified-test-page-content')
            self.assertTrue(case['restored']['screenshotExists'])
            self.assertNotEqual(case['revoked']['id'], case['restored']['id'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertRegex(plan, r'- \[x\] M01\.6[^\n]*证据：[^\n]*E15')
        self.assertIn('- [ ] M01 整体验收', plan)
        self.assertIn('- [ ] M01.7', plan)

    def test_gui_exit_evidence_does_not_complete_crash_or_coordinate_acceptance(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-gui-exit.json').read_text())
        acceptance = report['acceptance']
        self.assertEqual(acceptance['status'], 'passed')
        self.assertTrue(acceptance['piActiveBeforeExit'])
        self.assertTrue(acceptance['hostProcessExited'])
        self.assertTrue(acceptance['piProcessExited'])
        self.assertFalse(acceptance['realProviderVerified'])
        self.assertTrue(report['unitTests']['postShutdownSpawnRejected'])
        self.assertTrue(report['unitTests']['sigkillFallbackVerified'])
        self.assertTrue(report['unitTests']['unrelatedProcessUntouched'])
        self.assertTrue(report['unitTests']['largeStderrDrained'])
        self.assertTrue(report['unitTests']['descendantOutputWaitBounded'])
        self.assertFalse(report['limits']['guiCrashCleanupVerified'])
        self.assertFalse(report['limits']['retinaAndMultiDisplayCoordinatesVerified'])
        self.assertFalse(report['limits']['m01_7Complete'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertIn('| E16 |', plan)
        self.assertIn('- [ ] M01.7', plan)

    def test_gui_crash_evidence_covers_runtime_chain_without_coordinate_acceptance(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-gui-crash.json').read_text())
        acceptance = report['acceptance']
        self.assertEqual(acceptance['status'], 'passed')
        self.assertEqual(acceptance['crashTrigger'],
                         'SIGKILL only to the packaged probe process spawned by this verification')
        self.assertTrue(acceptance['piActiveBeforeCrash'])
        self.assertTrue(acceptance['appProcessExited'])
        self.assertTrue(acceptance['hostProcessExited'])
        self.assertTrue(acceptance['piProcessExited'])
        self.assertFalse(acceptance['realProviderVerified'])
        self.assertEqual(report['verificationTests']['ownedProcessCleanupPassed'], 4)
        self.assertTrue(report['verificationTests']['cleanupWaitsForOwnedProcessExit'])
        self.assertTrue(report['verificationTests']['cleanupFailureIsReported'])
        self.assertTrue(report['verificationTests']['childExitWaitBounded'])
        self.assertTrue(report['verificationTests']['rejectedExitReturnedAsCleanupError'])
        self.assertFalse(report['cleanupPath']['productionCodeChangeRequired'])
        self.assertFalse(report['limits']['retinaAndMultiDisplayCoordinatesVerified'])
        self.assertFalse(report['limits']['m01_7Complete'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertIn('| E17 |', plan)
        self.assertRegex(plan, r'- \[x\] M01\.7b[^\n]*证据：[^\n]*E17')
        self.assertIn('- [ ] M01.7', plan)

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
        self.assertIn('- [x] M01.6', stages)
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

    def test_display_evidence_limits_acceptance_to_own_window(self):
        evidence = json.loads((ROOT / 'probes/m01/evidence/desktop-displays.json').read_text())
        self.assertEqual(evidence['status'], 'passed')
        self.assertFalse(evidence['displays']['inputInjected'])
        self.assertEqual({item['screenScale'] for item in evidence['displayTests']}, {1, 2})
        for item in evidence['displayTests']:
            self.assertTrue(item['inputVerified'])
            self.assertTrue(item['clickVerified'])
            self.assertEqual(item['captureScale'], item['screenScale'])
        self.assertTrue(any(item['clickPoint']['x'] < 0 for item in evidence['displayTests']))
        self.assertTrue(all(value is False for value in evidence['limits'].values()))
        self.assertIn('- [ ] M01.7 ', (ROOT / 'PLAN.md').read_text())

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

    def test_mobile_runtime_evidence_keeps_http_separate_from_product_acceptance(self):
        report = json.loads((ROOT / 'probes/m01/evidence/ios-mobile-runtime.json').read_text())
        self.assertTrue(report['base']['appInstalled'])
        self.assertTrue(report['base']['appLaunchVerified'])
        self.assertTrue(report['base']['signedBaseVerified'])
        self.assertFalse(report['provisioning']['privateKeyExported'])
        self.assertTrue(report['lan']['healthVerified'])
        self.assertEqual(report['lan']['clientNetworkType'], 'wifi')
        self.assertFalse(report['lan']['serverRequestFromLoopback'])
        self.assertEqual(report['lan']['transport'], 'HTTP')
        self.assertFalse(report['lan']['agentTaskApiExposed'])
        self.assertIn('TLS certificate trust', report['notVerified'])
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        self.assertIn('- [ ] M01.8 验证完整手机通信', plan)
        self.assertIn('| E09 |', plan)
        self.assertIn('| E10 |', plan)

    def test_desktop_browser_preflight_does_not_claim_gui_acceptance(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-browser-preflight.json').read_text())
        self.assertTrue(report['prepared']['packagedBuildSucceeded'])
        self.assertTrue(report['prepared']['signatureVerified'])
        self.assertFalse(report['prepared']['privateKeyExported'])
        self.assertEqual(report['prepared']['capturePolicy'], 'verified-test-page-content')
        self.assertFalse(report['guiBrowserVerified'])
        self.assertFalse(report['permissionRevocationRecoveryVerified'])
        self.assertIn('| E11 |', (ROOT / 'PLAN.md').read_text(encoding='utf-8'))

    def test_desktop_installation_is_not_permission_or_browser_acceptance(self):
        report = json.loads((ROOT / 'probes/m01/evidence/desktop-installation.json').read_text())
        self.assertEqual(report['installedPath'], '/Applications/Moos M01 Probe.app')
        self.assertEqual(report['bundleId'], 'dev.moos.m01-probe')
        self.assertTrue(report['installedSignatureVerified'])
        self.assertTrue(report['guiLaunchVerified'])
        self.assertTrue(report['runningFromInstalledPath'])
        self.assertEqual(report['runningProbeInstances'], 1)
        self.assertEqual(report['guiPiFixtureStatus'], 'passed')
        self.assertFalse(report['realProviderVerified'])
        self.assertFalse(report['guiBrowserVerified'])
        self.assertFalse(report['observedPermissions']['screenCaptureGranted'])
        self.assertFalse(report['observedPermissions']['accessibilityGranted'])


if __name__ == '__main__':
    unittest.main()
