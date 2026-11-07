"""仓库文档契约检查。运行：python3 -m unittest discover -s tests -v。"""
from pathlib import Path
import re
import json
import hashlib
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RepositoryDocsTests(unittest.TestCase):
    def test_electron_migration_plan_orders_dependencies_and_requires_own_evidence(self):
        plan = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        stage = plan.split('## P03.13｜', 1)[1].split('\n## ', 1)[0]
        tasks = re.findall(r'^- \[([ x])\] P03\.13\.(\d+) (.+)$', stage, re.MULTILINE)
        self.assertEqual([int(number) for _, number, _ in tasks], list(range(1, 9)))
        for status, number, text in tasks:
            references = re.findall(r'P03\.13\.(\d+)', text)
            self.assertTrue(all(int(reference) < int(number) for reference in references))
            if status == 'x':
                evidence = re.search(r'证据 (E\d+)', text)
                self.assertIsNotNone(evidence)
                self.assertNotIn(evidence[1], ('E36', 'E37'))
                self.assertIn(f'| {evidence[1]} |', plan)

    def test_image_skin_example_matches_native_package_contract(self):
        root = ROOT / 'apps/desktop/examples/dusk-image-skin'
        manifest = json.loads((root / 'plugin.json').read_text())
        self.assertEqual(manifest['type'], 'theme')
        self.assertEqual(manifest['permissions'], [])
        self.assertNotIn('entry', manifest)
        background = manifest['backgroundMedia']
        self.assertEqual(background['type'], 'image')
        data = (root / background['src']).read_bytes()
        self.assertTrue(data.startswith(b'\x89PNG\r\n\x1a\n'))
        self.assertLessEqual(len(data), 1024 * 1024)
        self.assertIn('docs/plugins/image-skin.md', (ROOT / 'PLAN.md').read_text())
        guide = (ROOT / 'docs/plugins/image-skin.md').read_text()
        self.assertIn('皮肤会自动启用并应用', guide)
        self.assertNotIn('设置 → 主题', guide)
        self.assertIn('DSH 皮肤中心发行的 v2 皮肤使用 `skin.json`', guide)
        self.assertIn('DSH 静态皮肤', guide)

    def test_direct_source_copy_and_local_wallpaper_keep_provenance_and_boundaries(self):
        lock = json.loads((ROOT / 'apps/desktop/src/vendor/dsh/upstream-source-lock.json').read_text())
        self.assertEqual(lock['license'], 'MIT')
        self.assertEqual(lock['commit'], 'fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159')
        copied = [item for item in lock['files'] if item['mode'] == 'verbatim']
        self.assertEqual(len(copied), 44)
        for item in copied:
            self.assertEqual(hashlib.sha256((ROOT / item['local']).read_bytes()).hexdigest(), item['sha256'])
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p03-direct-source.json').read_text())
        self.assertTrue(evidence['gui']['restartImageAndMask38Restored'])
        self.assertTrue(evidence['gui']['finalReturnButtonClickedAndDisappeared'])
        self.assertTrue(evidence['installed']['allRegularFilesMatch'])
        self.assertEqual(evidence['checks']['uiFinalAffectedFile']['status'], 'passed')
        self.assertEqual(evidence['delivery']['codeCommitVerifiedOnGitHubMain'], evidence['sourceCommit'])
        self.assertIn('per-command', evidence['delivery']['resolution'])
        self.assertIn('证据：E32', (ROOT / 'PLAN.md').read_text())
        report = (ROOT / 'docs/third-party/dsh-direct-source-p037.md').read_text()
        for term in ('Lexical', 'IndexedDB', '2000万像素', '第三方hooks', '试穿页浏览器加载两次超时'):
            self.assertIn(term, report)
        app = (ROOT / 'apps/desktop/src/App.tsx').read_text()
        self.assertIn("import './vendor/dsh/theme/index.css'", app)
        self.assertIn('loadWallpaper()', app)
        self.assertNotIn("import './style.css'", app)

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
        for number in range(9, 10):
            self.assertIn(f'- [ ] P02.{number} ', plan)
        p02 = plan.split('## P02｜', 1)[1].split('## P01｜', 1)[0]
        self.assertEqual(p02.count('- [x]'), 8)
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
        for number in range(9, 10):
            self.assertIn(f'- [ ] P02.{number} ', plan)
        for term in ('测试先行', 'SDK 单运行时可行性门禁',
                     'SDK 验证通过以前不得删除已验证的 RPC 路径',
                     'Activity Monitor', '超过 10 分钟', 'plugin.json',
                     'Tauri 原生 PTY', 'npm run build:app', 'git diff --check'):
            self.assertIn(term, implementation)
        p02 = plan.split('## P02｜', 1)[1].split('## P01｜', 1)[0]
        self.assertEqual(p02.count('- [x]'), 8)

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


    def test_native_terminal_boundaries_and_bundled_license_are_recorded(self):
        plan = (ROOT / 'PLAN.md').read_text()
        self.assertIn('- [x] P02.8 ', plan)
        self.assertIn('- [ ] P02.9 ', plan)
        report = json.loads((ROOT / 'apps/desktop/evidence/p02-native-terminal.json').read_text())
        for field in ('normalQuitOwnedProcessesGone', 'projectRemovalOtherProjectSurvives',
                      'twoTabsOutputIsolated', 'interruptAndContinue', 'relaunchDoesNotReplayCommands'):
            self.assertTrue(report['gui'][field])
        self.assertFalse(report['gui']['newPaidTaskSubmitted'])
        self.assertEqual(report['boundaries']['perProjectTabs'], 4)
        self.assertTrue(report['build']['allRegularFilesMatchBuiltBundle'])
        config = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text())
        self.assertEqual(config['bundle']['resources']['../../../THIRD_PARTY_NOTICES.md'], 'THIRD_PARTY_NOTICES.md')
        notices = (ROOT / 'THIRD_PARTY_NOTICES.md').read_text()
        for text in ('portable-pty 0.9.0', '@xterm/xterm 6.0.0', '2018 Wez Furlong', 'The xterm.js authors'):
            self.assertIn(text, notices)
        spec = (ROOT / 'docs/superpowers/specs/2026-11-06-native-terminal.md').read_text()
        for text in ('1MiB', '4个', '8个', '不自动重放', '目录锁', '强制SIGKILL', 'P02.9'):
            self.assertIn(text, spec)


    def test_owner_death_evidence_does_not_claim_gui_or_real_usage(self):
        plan = (ROOT / 'PLAN.md').read_text()
        self.assertIn('- [ ] P02.9 ', plan)
        self.assertIn('| E27 |', plan)
        report = json.loads((ROOT / 'apps/desktop/evidence/p02-owner-death.json').read_text())
        self.assertEqual(report['packagedRuntime']['shortTasks'], 20)
        self.assertGreater(report['packagedRuntime']['longElapsedMs'], 600000)
        self.assertTrue(report['packagedRuntime']['fixtureUsageOnly'])
        self.assertFalse(report['packagedRuntimeOwnerDeath']['guiAppKilled'])
        self.assertFalse(report['remaining']['detachedDaemonsCovered'])
        self.assertFalse(report['remaining']['realProviderUsageVerified'])
        self.assertEqual(report['nativePty']['releaseGuardianSuitePassed'], 6)
        spec = (ROOT / 'docs/superpowers/specs/2026-11-06-pty-owner-death.md').read_text()
        for term in ('CLOEXEC', 'SID', '目录锁', '不能代替', 'P02.9'):
            self.assertIn(term, spec)


    def test_gui_stability_evidence_keeps_remaining_acceptance_open(self):
        plan = (ROOT / 'PLAN.md').read_text()
        self.assertIn('- [ ] P02.9 ', plan)
        self.assertIn('| E28 |', plan)
        report = json.loads((ROOT / 'apps/desktop/evidence/p02-gui-stability.json').read_text())
        self.assertEqual(report['gui']['shortTaskCount'], 20)
        self.assertGreater(report['gui']['longElapsedMs'], 600000)
        self.assertEqual(report['gui']['longHeartbeats'], 40)
        self.assertEqual(report['installedAppSigkill']['remainingPids'], [])
        self.assertTrue(report['installedAppSigkill']['unrelatedSurvived'])
        self.assertTrue(report['installedAppSigkill']['proxyClosed'])
        self.assertTrue(report['build']['allRegularFilesMatch'])
        self.assertTrue(report['plugins']['crashFixtureUninstalledWithUserActionTimeConfirmation'])
        self.assertFalse(report['realProvider']['requestSent'])
        self.assertFalse(report['realProvider']['usageVerified'])
        self.assertFalse(report['plugins']['themeAppliedMarkerOnFallbackSynchronized'])
        followup = report['realProviderFollowup']
        self.assertTrue(followup['requestSucceeded'])
        self.assertEqual(followup['inputTokens'], 208)
        self.assertEqual(followup['outputTokens'], 8)
        self.assertEqual(followup['cacheReadTokens'], 25856)
        self.assertIsNone(followup['costUsd'])
        self.assertFalse(followup['glmVerified'])
        self.assertFalse(followup['billingReconciled'])


    def test_selection_state_fix_has_real_gui_evidence_and_remaining_scope(self):
        report = json.loads((ROOT / 'apps/desktop/evidence/p02-selection-state.json').read_text())
        for key in ('missingKeyErrorVisibleBeforeSwitch', 'conversationSwitchClearsError',
                    'projectSwitchClearsError', 'defaultThemeMarkedAppliedAfterLocalThemeDisabled', 'graphiteRestored'):
            self.assertTrue(report['gui'][key])
        self.assertFalse(report['gui']['newModelRequestSent'])
        self.assertFalse(report['limits']['p029Complete'])
        self.assertTrue(report['build']['allRegularFilesMatch'])
        self.assertIn('| E29 |', (ROOT / 'PLAN.md').read_text())


    def test_moos_icon_source_is_square_rgba_and_not_claimed_as_installed(self):
        import struct
        data = (ROOT / 'apps/desktop/design/moos-icon-v1.png').read_bytes()
        self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
        width, height, depth, color = struct.unpack('>IIBB', data[16:26])
        self.assertEqual(width, height)
        self.assertGreaterEqual(width, 1024)
        self.assertEqual((depth, color), (8, 6))
        note = (ROOT / 'apps/desktop/design/README.md').read_text()
        self.assertIn('尚未替换', note)
        self.assertIn('代码括号', note)


    def test_packaged_moos_icon_uses_explicit_native_assets(self):
        import struct
        config = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text())
        for name, size in [('32x32.png', 32), ('128x128.png', 128), ('128x128@2x.png', 256)]:
            relative = f'icons/moos-v1/{name}'
            self.assertIn(relative, config['bundle']['icon'])
            data = (ROOT / 'apps/desktop/src-tauri' / relative).read_bytes()
            self.assertEqual(struct.unpack('>II', data[16:24]), (size, size))
            self.assertEqual(data[25], 6)
        data = (ROOT / 'apps/desktop/src-tauri/icons/moos-v1/icon.icns').read_bytes()
        self.assertEqual(data[:4], b'icns')
        self.assertEqual(struct.unpack('>I', data[4:8])[0], len(data))
        self.assertEqual((ROOT / 'apps/desktop/src-tauri/icons/moos-v1/icon.ico').read_bytes()[:4], b'\x00\x00\x01\x00')


    def test_full_dsh_design_keeps_scope_and_rightbar_confirmation_explicit(self):
        plan = (ROOT / 'PLAN.md').read_text()
        spec = (ROOT / 'docs/superpowers/specs/2026-11-07-dsh-full-frontend-design.md').read_text()
        for number in range(1, 6):
            self.assertIn(f'- [x] P03.{number} ', plan)
        for term in ('右栏按需打开', 'Codex', 'Moos UI Adapter', 'fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159',
                     '不安装或启动DSH服务', 'private/credentials.json', '逐页对照', 'MIT'):
            self.assertIn(term, spec)
        self.assertIn('尚未实施', spec)


    def test_dsh_transplant_records_source_license_and_installed_gui_limits(self):
        report = json.loads((ROOT / 'apps/desktop/evidence/p03-dsh-frontend.json').read_text())
        self.assertTrue(report['build']['allRegularFilesMatch'])
        self.assertEqual(report['process']['nodeHostsOwnedByApp'], 1)
        self.assertFalse(report['process']['newProductionWebServer'])
        self.assertEqual(len(report['gui']['settingsSections']), 9)
        for field in ('rightInitiallyClosed', 'rightFilesTaskPluginTabs', 'halfScreenRightOverlayVisibleAndCloseable',
                      'localPiWriteAndBashTaskSucceeded', 'toolCancellation', 'cancelledToolExited', 'graphiteRestored'):
            self.assertTrue(report['gui'][field])
        self.assertFalse(report['limits']['allOriginalStatesPixelCompared'])
        self.assertFalse(report['limits']['arbitraryFileEditorOrGitAdded'])
        app = (ROOT / 'apps/desktop/src/App.tsx').read_text()
        for old in ('workbench.css', 'codex-cards.css', 'dsh-alignment.css'):
            self.assertNotIn(old, app)
        notice = (ROOT / 'docs/third-party/dsh-full-frontend-sources.md').read_text()
        self.assertIn('Copyright (c) 2026 DeepSeek', notice)
        self.assertIn('Permission is hereby granted', notice)
        self.assertIn('layout/dsh-columns.ts', notice)

    def test_pi_online_benchmark_records_matched_inputs_and_separate_acceptance(self):
        report = json.loads((ROOT / 'apps/desktop/evidence/p03-pi-crossfile-benchmark.json').read_text())
        self.assertIn('| E52 |', (ROOT / 'PLAN.md').read_text())
        self.assertEqual(report['case']['allowedFiles'], ['parse-count.mjs', 'summary.mjs', 'summary.test.mjs'])
        self.assertEqual(report['case']['independentTests'], 5)
        self.assertEqual(report['model'], 'gpt-6.1-sol')
        self.assertEqual(report['effort'], 'high')
        self.assertTrue(report['sameEndpointAndCredential'])
        self.assertFalse(report['limits']['cacheControlled'])
        self.assertFalse(report['limits']['supportsGeneralSpeedClaim'])
        moos, dsh = report['moos'], report['dsh']
        self.assertEqual([moos['mode'], dsh['mode']], ['electron-gui', 'headless'])
        self.assertEqual(moos['baselineTree'], dsh['baselineTree'])
        self.assertEqual(moos['promptSha256'], dsh['promptSha256'])
        self.assertEqual(moos['toolAcceptance']['npmTest'], 'sandbox-denied')
        self.assertEqual(moos['toolAcceptance']['nodeTest'], 'passed')
        self.assertEqual(dsh['toolAcceptance']['npmTest'], 'passed')
        self.assertGreater(moos['approvalWaitMs'], 0)
        self.assertEqual(moos['requestSpanMs'] - moos['approvalWaitMs'], moos['requestSpanExcludingApprovalMs'])
        for side in (moos, dsh):
            self.assertEqual(side['requests'], side['http200'])
            self.assertEqual(side['totalTokens'], side['inputTokens'] + side['outputTokens'])
            self.assertLessEqual(side['cacheReadTokens'], side['inputTokens'])
            self.assertLess(side['firstActionMs'], side['requestSpanMs'])
            self.assertEqual(side['changedFiles'], report['case']['allowedFiles'])
            self.assertEqual(side['publicTests']['exit'], 0)
            self.assertEqual(side['publicTests']['failed'], 0)
            self.assertEqual(side['independentTests']['passed'], report['case']['independentTests'])
            self.assertEqual(side['independentTests']['failed'], 0)


    def test_pi_desktop_benchmark_compares_native_apps_on_matching_inputs(self):
        report = json.loads((ROOT / 'apps/desktop/evidence/p03-pi-desktop-benchmark.json').read_text())
        reference = json.loads((ROOT / 'apps/desktop/evidence/p03-pi-crossfile-benchmark.json').read_text())
        self.assertIn('| E55 |', (ROOT / 'PLAN.md').read_text())
        self.assertEqual(report['runOrder'], ['dsh', 'moos'])
        for field in ('model', 'effort', 'case'):
            self.assertEqual(report[field], reference[field])
        self.assertTrue(report['sameEndpointAndCredential'])
        self.assertEqual(report['permissionLabel'], '工作区内修改')
        self.assertTrue(report['limits']['sameApplicationMode'])
        self.assertFalse(report['limits']['supportsGeneralSpeedClaim'])
        self.assertFalse(report['limits']['cacheControlled'])
        self.assertEqual(report['limits']['pairedSamples'], 1)
        self.assertEqual(report['moos']['taskStatus'], 'succeeded')
        self.assertEqual(report['dsh']['taskStatus'], 'completed')
        for name in report['runOrder']:
            side = report[name]
            self.assertEqual(side['mode'], 'electron-gui')
            self.assertEqual(side['baselineTree'], reference[name]['baselineTree'])
            self.assertEqual(side['promptSha256'], reference[name]['promptSha256'])
            self.assertGreater(side['requests'], 0)
            for field in ('effectiveHighRequests', 'http200', 'usageResponses'):
                self.assertEqual(side[field], side['requests'])
            self.assertLess(side['firstActionMs'], side['requestSpanMs'])
            self.assertEqual(side['totalTokens'], side['inputTokens'] + side['outputTokens'])
            self.assertLessEqual(side['cacheReadTokens'], side['inputTokens'])
            self.assertEqual(side['changedFiles'], report['case']['allowedFiles'])
            self.assertEqual(side['toolAcceptance']['npmTest'], 'passed')
            self.assertEqual(side['toolAcceptance']['approvalRequests'], 0)
            self.assertEqual(side['publicTests']['exit'], 0)
            self.assertEqual(side['independentTests'], {
                'passed': report['case']['independentTests'], 'failed': 0, 'exit': 0,
            })


    def test_pi_desktop_multiturn_comparison_records_each_round(self):
        report = json.loads((ROOT / 'apps/desktop/evidence/p03-pi-desktop-multiturn.json').read_text())
        reference = json.loads((ROOT / 'apps/desktop/evidence/p03-pi-desktop-benchmark.json').read_text())
        self.assertIn('| E58 |', (ROOT / 'PLAN.md').read_text())
        self.assertEqual(report['runOrder'], list(reversed(reference['runOrder'])))
        for field in ('model', 'effort', 'permissionLabel', 'sameEndpointAndCredential'):
            self.assertEqual(report[field], reference[field])
        self.assertEqual(report['mode'], 'electron-gui')
        self.assertFalse(report['limits']['cacheControlled'])
        self.assertFalse(report['limits']['supportsGeneralSpeedClaim'])
        for name, status in (('moos', 'succeeded'), ('dsh', 'completed')):
            side = report[name]
            self.assertTrue(side['sameSession'])
            initial, followup = side['rounds']
            self.assertEqual(initial['promptSha256'], reference[name]['promptSha256'])
            self.assertNotEqual(initial['promptSha256'], followup['promptSha256'])
            self.assertNotEqual(initial['diffSha256'], followup['diffSha256'])
            for turn in side['rounds']:
                self.assertEqual(turn['taskStatus'], status)
                self.assertEqual(turn['baselineTree'], reference[name]['baselineTree'])
                self.assertEqual(turn['changedFiles'], report['allowedFiles'])
                self.assertGreater(turn['requests'], 0)
                self.assertEqual(turn['http200'], turn['requests'])
                self.assertLess(turn['firstActionMs'], turn['requestSpanMs'])
                self.assertEqual(turn['totalTokens'], turn['inputTokens'] + turn['outputTokens'])
                self.assertTrue(turn['npmTestPassedInApp'])
                self.assertEqual(turn['approvalRequests'], 0)
                self.assertEqual(turn['projectTests']['exit'], 0)
                self.assertEqual(turn['baselineIndependentTests'], {'passed': 5, 'failed': 0, 'exit': 0})
            self.assertEqual(followup['optionsIndependentTests'], {'passed': 4, 'failed': 0, 'exit': 0})
        self.assertEqual(report['moos']['rounds'][1]['promptSha256'], report['dsh']['rounds'][1]['promptSha256'])


    def test_pi_vision_probe_keeps_provider_capabilities_and_product_scope_separate(self):
        evidence = ROOT / 'apps/desktop/evidence/p03-pi-vision-provider-probe.json'
        report = json.loads(evidence.read_text())
        self.assertIn('| E62 |', (ROOT / 'PLAN.md').read_text())
        self.assertEqual(report['mode'], 'isolated-pi-sdk-probe')
        self.assertFalse(report['limits']['productImageInputVerified'])
        self.assertFalse(report['limits']['otherModelCapabilitiesVerified'])
        self.assertFalse(report['limits']['glmRejectionReasonVerified'])
        self.assertEqual(report['case']['stripes'], 6)
        self.assertTrue(report['case']['independentRandomImagePerService'])
        gpt, glm = report['providers']
        self.assertNotEqual(gpt['imageSha256'], glm['imageSha256'])
        for provider in (gpt, glm):
            control, image = provider['control'], provider['image']
            self.assertTrue(control['exact'])
            self.assertFalse(control['requests'][0]['containsImage'])
            self.assertEqual(control['requests'][0]['status'], 200)
            for sample in (control, image):
                self.assertEqual(len(sample['requests']), 1)
                self.assertEqual(sample['requests'][0]['model'], provider['model'])
                self.assertEqual(sample['tools'], 0)
            self.assertTrue(image['requests'][0]['containsImage'])
        self.assertEqual((gpt['model'], gpt['api']), ('gpt-6.1-sol', 'openai-responses'))
        self.assertEqual(gpt['image']['requests'][0]['reasoningEffort'], 'high')
        self.assertEqual(gpt['image']['requests'][0]['status'], 200)
        self.assertTrue(gpt['image']['exact'])
        self.assertEqual((glm['model'], glm['api']), ('glm-5.3', 'openai-completions'))
        self.assertEqual(glm['image']['requests'][0]['status'], 400)
        self.assertFalse(glm['image']['exact'])

    def test_pi_desktop_attachments_record_gui_routing_and_recovery_separately_from_benchmarks(self):
        evidence = ROOT / 'apps/desktop/evidence/p03-pi-desktop-attachments.json'
        report = json.loads(evidence.read_text())
        self.assertIn('| E65 |', (ROOT / 'PLAN.md').read_text())
        self.assertEqual(report['mode'], 'electron-gui')
        self.assertEqual(report['modelSelection'], 'auto')
        self.assertTrue(report['nativeFilePicker'])
        image, text = report['turns']
        self.assertEqual((image['attachment'], image['model']), ('image/png', 'gpt-6.1-sol'))
        self.assertEqual((text['attachment'], text['model']), ('text/plain', 'glm-5.3'))
        for turn in (image, text):
            self.assertEqual(turn['status'], 'succeeded')
            self.assertTrue(turn['exactAnswer'])
            self.assertEqual(turn['toolCalls'], 0)
            self.assertGreater(turn['reportedTotalTokens'], 0)
            self.assertRegex(turn['sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(report['afterRestart'], {
            'sameConversation': True, 'attachmentsAndAnswersVisible': True,
            'taskCount': len(report['turns']), 'usageEventCount': len(report['turns']),
        })
        self.assertEqual(report['defaultInstalledExtensions'], ['@linxin666/dsh-client-ui-skin-center'])
        self.assertTrue(report['addPluginEntryVisible'])
        self.assertFalse(report['limits']['supportsSpeedComparison'])

    def test_pi_desktop_ledger_benchmark_uses_equal_scope_and_independent_acceptance(self):
        evidence = ROOT / 'apps/desktop/evidence/p03-pi-desktop-ledger-benchmark.json'
        report = json.loads(evidence.read_text())
        self.assertIn('| E66 |', (ROOT / 'PLAN.md').read_text())
        self.assertEqual(report['runOrder'], ['dsh', 'moos'])
        self.assertEqual((report['model'], report['effort']), ('gpt-6.1-sol', 'high'))
        self.assertTrue(report['sameEndpointAndCredential'])
        self.assertEqual(report['permissionLabel'], '工作区内修改')
        moos, dsh = report['moos'], report['dsh']
        self.assertEqual(moos['baselineTree'], dsh['baselineTree'])
        self.assertEqual(moos['promptSha256'], dsh['promptSha256'])
        self.assertEqual(len(report['case']['allowedFiles']), 5)
        self.assertEqual(report['case']['independentTestsFailedOnBaseline'], 8)
        self.assertTrue(dsh['includesTitleRequest'])
        for side, status in ((moos, 'succeeded'), (dsh, 'completed')):
            self.assertEqual(side['mode'], 'electron-gui')
            self.assertEqual(side['taskStatus'], status)
            self.assertEqual(side['changedFiles'], report['case']['allowedFiles'])
            self.assertEqual(side['independentTests'], {'passed': 11, 'failed': 0, 'exit': 0})
            self.assertEqual(side['publicTests']['exit'], 0)
            self.assertEqual(side['toolAcceptance'], {
                'npmTest': 'passed', 'approvalRequests': 0, 'gitDiffCheck': 'passed',
            })
            for field in ('effectiveHighRequests', 'http200', 'usageResponses'):
                self.assertEqual(side[field], side['requests'])
            self.assertEqual(side['totalTokens'], side['inputTokens'] + side['outputTokens'])
            self.assertLess(side['longestRequestMs'], side['requestSpanMs'])
        self.assertEqual(report['limits']['pairedSamples'], 1)
        self.assertFalse(report['limits']['cacheControlled'])
        self.assertFalse(report['limits']['supportsGeneralSpeedClaim'])


if __name__ == '__main__':
    unittest.main()
