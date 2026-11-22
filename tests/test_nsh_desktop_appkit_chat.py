import hashlib
import json
from pathlib import Path
import unittest

from nsh_composer_provenance import desktop_composer_layout_evidence, desktop_session_completion_evidence, desktop_analysis_caption_evidence, desktop_command_preview_evidence, desktop_archive_evidence, desktop_first_draft_evidence, desktop_session_switch_evidence, desktop_startup_splash_evidence, desktop_import_evidence, desktop_turn_layout_evidence, desktop_workspace_layout_evidence, desktop_workspace_migration_evidence, desktop_management_evidence, desktop_team_goal_evidence, idle_host_evidence, successor_input


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


class AppKitChatEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.evidence = json.loads((PROBE / 'desktop-appkit-chat-evidence.json').read_text())

    def test_actual_view_restarts_and_gates_resend_on_drain(self):
        check = self.evidence['check']
        first, reopened = check['launches']
        self.assertEqual(first['scope'], reopened['scope'])
        self.assertFalse(first['restart'])
        self.assertTrue(reopened['restart'])
        self.assertIn('empty profile', first['checks'])
        self.assertIn('first public reply', first['checks'])
        self.assertIn('no replay before Send', reopened['checks'])
        self.assertIn('exact pre-Send history', reopened['checks'])
        self.assertIn('old rows laid out', reopened['checks'])
        self.assertIn('other project stays empty', reopened['checks'])
        self.assertIn('PI continued from prior context', reopened['checks'])
        self.assertIn('controller observes terminal backlog', reopened['checks'])
        self.assertIn('terminal backlog blocks Send until drained', reopened['checks'])
        self.assertIn('resend write/read on original scope', reopened['checks'])
        self.assertEqual(reopened['checks'][-1], 'no polling after drain')
        self.assertTrue(check['registeredToolGone'])

    def test_signed_modes_separate_automation_and_scope(self):
        check, interactive = (self.evidence[s] for s in ('check', 'interactive'))
        for mode in (check, interactive):
            self.assertEqual(mode['identity']['displayName'], '沐码')
            self.assertEqual(mode['identity']['bundleIdentifier'], 'dev.muma.probe.nsh.appkit.chat')
            self.assertEqual(mode['signed'], 'ad-hoc deep strict')
            self.assertFalse(mode['installed'])
            self.assertTrue(mode['fixtureOnly'])
            self.assertEqual(mode['upstreamRequests'], 0)
            self.assertEqual(set(mode['resources']['host']) - {'n01.complete'}, {
                'projects.list', 'sessions.list', 'sessions.create', 'sessions.history',
                'tasks.submit', 'tasks.cancel', 'tasks.events',
            })
        self.assertIn('n01.complete', check['resources']['host'])
        self.assertNotIn('n01.complete', interactive['resources']['host'])
        self.assertEqual(interactive['launches'], [])  # builder does not launch
        self.assertEqual(check['viewInputs'], interactive['viewInputs'])
        self.assertEqual(check['hostInputs'], interactive['hostInputs'])
        self.assertEqual(self.evidence['window']['click'], 'target-occluded')
        self.assertFalse(self.evidence['window']['sendDispatched'])
        self.assertFalse(any(self.evidence['boundaries'].values()))

    def test_bind_new_inputs_and_available_logs(self):
        compression = json.loads((PROBE / 'desktop-appkit-chat-compression-evidence.json').read_text())
        strip = json.loads((PROBE / 'desktop-appkit-chat-node-strip-evidence.json').read_text())
        prune = json.loads((PROBE / 'desktop-appkit-chat-prune-evidence.json').read_text())
        idle_host = idle_host_evidence()
        team_goal = desktop_team_goal_evidence()
        for name, expected in self.evidence['inputs'].items():
            current = successor_input(self, compression, name, expected)
            current = successor_input(self, strip, name, current)
            current = successor_input(self, prune, name, current)
            current = successor_input(self, idle_host, name, current)
            current = successor_input(self, team_goal, name, current)
            current = successor_input(self, desktop_management_evidence(), name, current)
            current = successor_input(self, desktop_archive_evidence(), name, current)
            current = successor_input(self, desktop_import_evidence(), name, current)
            current = successor_input(self, desktop_workspace_layout_evidence(), name, current)
            current = successor_input(self, desktop_workspace_migration_evidence(), name, current)
            current = successor_input(self, desktop_turn_layout_evidence(), name, current)
            current = successor_input(self, desktop_first_draft_evidence(), name, current)
            current = successor_input(self, desktop_session_switch_evidence(), name, current)
            current = successor_input(self, desktop_startup_splash_evidence(), name, current)
            current = successor_input(self, desktop_command_preview_evidence(), name, current)
            current = successor_input(self, desktop_analysis_caption_evidence(), name, current)
            current = successor_input(self, desktop_session_completion_evidence(), name, current)
            current = successor_input(self, desktop_composer_layout_evidence(), name, current)
            self.assertEqual(current, sha(ROOT / name), name)
        entry = 'probes/nsh-validation/appkit-hostcheck/ChatCheck.tsx'
        entry_hash = successor_input(self, team_goal, entry, self.evidence['check']['entry'])
        entry_hash = successor_input(self, desktop_management_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_archive_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_import_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_workspace_layout_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_workspace_migration_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_turn_layout_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_first_draft_evidence(), entry, entry_hash)
        entry_hash = successor_input(self, desktop_session_switch_evidence(), entry, entry_hash)
        self.assertEqual(successor_input(self, desktop_startup_splash_evidence(), entry, entry_hash), sha(ROOT / entry))
        for name, expected in self.evidence['artifacts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)

    def test_team_goal_acceptance_keeps_single_mode_unlimited_and_scope_truthful(self):
        evidence = desktop_team_goal_evidence()
        self.assertEqual(evidence['publicMode'], '团队目标')
        self.assertEqual(evidence['cumulativeModelLimits'], {'tokens': None, 'requests': None})
        self.assertGreater(evidence['localModelUsageTest']['reportedInputTokens'], 2000000)
        self.assertEqual(evidence['packageAcceptance']['checks'], [6, 15])
        self.assertEqual(evidence['packageAcceptance']['shutdownExitCodes'], [0, 0])
        self.assertTrue(evidence['localModelUsageTest']['successful'])
        self.assertFalse(evidence['productionChanged'])
        self.assertFalse(evidence['externalModel'])
        self.assertFalse(evidence['longHaulMeasured'])
        self.assertIn('desktop-team-goal-evidence.json', (ROOT / 'PLAN.md').read_text())

    def test_window_retry_and_inverse_mode_guard_do_not_imply_gui_acceptance(self):
        retry = json.loads((PROBE / 'desktop-appkit-interaction-evidence.json').read_text())
        self.assertEqual(retry['interactive']['bundleIdentifier'], self.evidence['interactive']['identity']['bundleIdentifier'])
        self.assertFalse(retry['interactive']['scriptedCheck'])
        self.assertEqual(retry['interactive']['wrongMode'], {
            'exitCode': 1, 'diagnostic': 'N01 AppKit chat launch mode mismatch', 'createdStateRoots': False,
        })
        window = retry['window']
        self.assertEqual(window['transactionResult'], 'focus-unavailable')
        self.assertFalse(window['focusProbe']['frontmost'])
        self.assertTrue(window['focusProbe']['exactRunningBundle'])
        self.assertFalse(any(window[k] for k in ('inputDispatched', 'reacquiredFocus', 'humanAcceptance')))
        self.assertFalse(any(retry['scope'].values()))
        rerun = retry['scriptedRerun']
        self.assertEqual(rerun['exitCode'], 0)
        self.assertTrue(rerun['fixtureOnly'] and rerun['registeredToolGone'])
        self.assertEqual(rerun['upstreamRequests'], 0)
        first, reopened = rerun['launches']
        self.assertEqual(first['scope'], reopened['scope'])
        for new, old in zip(rerun['launches'], self.evidence['check']['launches']):
            self.assertEqual(new['checks'], old['checks'])
        self.assertTrue(retry['localReceipts'])
        for name, expected in retry['localReceipts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)

    def test_pruned_launch_records_guard_without_claiming_interaction(self):
        data = json.loads((PROBE / 'desktop-appkit-chat-pruned-window-evidence.json').read_text())
        ref = data['buildEvidence']
        self.assertEqual(ref['name'], 'desktop-appkit-chat-prune-evidence.json')
        path = PROBE / ref['name']
        self.assertEqual(ref['sha256'], sha(path))
        build = json.loads(path.read_text())['prunedInteractive']
        launch = data['interactive']
        self.assertEqual(launch['bundleIdentifier'], build['identity']['bundleIdentifier'])
        self.assertEqual(launch['signature'], build['signed'])
        self.assertEqual(launch['mode'], build['mode'])
        self.assertEqual(launch['bundleKiB'], build['sizes']['bundleKiB'])
        self.assertFalse(launch['scriptedCheck'])
        self.assertTrue(launch['launchByExactPath'] and launch['separateProfileAndStorage'] and launch['hostStarted'])
        window = data['window']
        self.assertTrue(window['candidatePIDMatches'] and window['transactionAutoEnded'])
        self.assertEqual(window['size'], [1240, 820])
        self.assertEqual(window['taskState'], 'idle · 已排空 · 0 事件')
        self.assertEqual(window['transactionResult'], 'target-occluded')
        self.assertFalse(any(window[k] for k in ('inputDispatched', 'reacquiredFocus', 'humanAcceptance')))
        self.assertEqual(set(data['notVerified']), {'Send', 'Stop', 'resend', 'IME', 'normal Quit', 'reopen history', 'matched performance'})
        self.assertFalse(any(data['scope'].values()))
        for name, expected in data['localReceipts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)
        self.assertIn('desktop-appkit-chat-pruned-window-evidence.json', (ROOT / 'PLAN.md').read_text())

    def test_archive_audit_distinguishes_archive_savings_from_payload_savings(self):
        data = json.loads((PROBE / 'desktop-appkit-chat-archive-audit-evidence.json').read_text())
        ref = data['buildEvidence']
        self.assertEqual(ref['name'], 'desktop-appkit-chat-prune-evidence.json')
        path = PROBE / ref['name']
        self.assertEqual(ref['sha256'], sha(path))
        prune = json.loads(path.read_text())
        build = prune['prunedInteractive']
        audit = data['archiveExperiment']
        baseline, trial = (audit[key] for key in ('control', 'experiment'))
        self.assertEqual(baseline['sha256'], prune['localReceipts'][baseline['path']])
        self.assertEqual(baseline['bytes'], build['sizes']['zipBytes'])
        self.assertEqual(baseline['bytes'] - trial['bytes'], audit['savedBytes'])
        self.assertGreater(audit['savedBytes'], 0)
        self.assertLess(audit['savedBytes'] / baseline['bytes'], 0.002)
        for archive in (baseline, trial):
            self.assertEqual(archive['extractedKiB'], build['sizes']['bundleKiB'])
            archive_path = ROOT / archive['path']
            if archive_path.is_file():
                self.assertEqual(archive['bytes'], archive_path.stat().st_size)
                self.assertEqual(archive['sha256'], sha(archive_path))
        comparison = audit['comparison']
        self.assertTrue(comparison['typeModeContentAndLinkTargetsIdentical'])
        self.assertEqual(comparison['logicalRegularBytes'], prune['comparison']['prunedLogicalBytes'])
        self.assertGreater(comparison['byType']['link'], 0)
        for name in ('unzipIntegrity', 'dittoExtraction', 'deepStrictSignatures'):
            self.assertTrue(audit['checks'][name], name)
        self.assertEqual(audit['checks']['bundleIdentifier'], build['identity']['bundleIdentifier'])
        self.assertFalse(audit['checks']['scriptedCheck'])
        self.assertEqual(audit['checks']['bundledNode'], build['node'])
        self.assertFalse(audit['adopted'])
        self.assertFalse(any(data['boundaries'].values()))

        inventory = data['productionInventory']
        collisions = inventory['duplicateNames']
        self.assertEqual(inventory['installed'] - inventory['names'], sum(len(p) - 1 for p in collisions.values()))
        self.assertEqual(inventory['optionalProductionLockEntries'], 0)
        self.assertTrue(inventory['sameVersionIdentical'])
        pair = [p for p in collisions['@smithy/node-http-handler'] if p['version'] == '4.14.1']
        self.assertEqual(len(pair), 2)
        self.assertEqual(pair[0]['logicalBytes'], pair[1]['logicalBytes'])
        self.assertLess(pair[0]['allocatedBytes'], 1024 * 1024)
        resolution = data['entryResolution']
        self.assertTrue(resolution['genaiImport'].endswith('/dist/node/index.mjs'))
        self.assertTrue(resolution['genaiRequire'].endswith('/dist/node/index.cjs'))
        self.assertTrue(resolution['genaiWeb'].endswith('/dist/web/index.mjs'))
        self.assertTrue(resolution['piSdk'].endswith('/dist/index.js'))
        self.assertTrue(resolution['piRpc'].endswith('/dist/bundle/rpc-entry.js'))
        self.assertTrue(resolution['piBinLink'].endswith('/dist/bundle/cli.js'))
        for name, expected in data['localReceipts'].items():
            receipt = ROOT / name
            if receipt.is_file():
                self.assertEqual(expected, sha(receipt), name)
        self.assertIn('desktop-appkit-chat-archive-audit-evidence.json', (ROOT / 'PLAN.md').read_text())

    def test_compression_reduces_archive_and_app_without_changing_runtime(self):
        data = json.loads((PROBE / 'desktop-appkit-chat-compression-evidence.json').read_text())
        full, compact, scripted = (data[key] for key in ('fullInteractive', 'compactInteractive', 'compactCheck'))
        for bundle in (full, compact, scripted):
            self.assertTrue(bundle['extractedFromZip'] and bundle['fixtureOnly'])
            self.assertFalse(bundle['installed'])
            self.assertEqual(bundle['signed'], 'ad-hoc deep strict')
            self.assertEqual(bundle['upstreamRequests'], 0)
            self.assertEqual(bundle['viewInputs'], full['viewInputs'])
            self.assertEqual(bundle['hostInputs'], full['hostInputs'])
        self.assertFalse(full['trimMaps'])
        self.assertTrue(compact['trimMaps'] and scripted['trimMaps'])
        self.assertEqual(full['entry'], compact['entry'])
        audit = data['comparison']
        self.assertTrue(audit['retainedEntriesIdentical'])
        self.assertGreater(audit['retainedEntries'], 0)
        self.assertGreater(audit['removedMapLogicalBytes'], 0)
        self.assertGreater(audit['fullLogicalBytes'], audit['compactLogicalBytes'])
        self.assertRegex(audit['unsignedRunnerSha256'], r'^[0-9a-f]{64}$')
        self.assertIn('Contents/_CodeSignature/CodeResources', audit['resealedEntries'])
        self.assertLessEqual(set(audit['resealedEntries']),
                             {'Contents/_CodeSignature/CodeResources', 'Contents/MacOS/AppKitPI'})
        self.assertGreater(compact['removedMaps'], 0)
        self.assertEqual(full['removedMaps'], 0)
        self.assertEqual(compact['removedMaps'], scripted['removedMaps'])
        self.assertEqual(full['sizes']['nodeKiB'], compact['sizes']['nodeKiB'])
        for field in ('bundleKiB', 'dependencyKiB', 'zipBytes'):
            self.assertLess(compact['sizes'][field], full['sizes'][field], field)
        self.assertEqual(full['launches'], [])
        self.assertEqual(compact['launches'], [])
        self.assertEqual(compact['mode'], '--interactive')
        self.assertNotIn('n01.complete', compact['resources']['host'])
        self.assertEqual(scripted['mode'], '--check')
        self.assertTrue(scripted['registeredToolGone'])
        self.assertEqual(len(scripted['launches']), 2)
        self.assertEqual(scripted['launches'][0]['scope'], scripted['launches'][1]['scope'])
        self.assertEqual([launch['checks'] for launch in scripted['launches']],
                         [launch['checks'] for launch in self.evidence['check']['launches']])
        self.assertFalse(any(data['boundaries'].values()))
        self.assertEqual(len(data['archives']), 3)
        strip = json.loads((PROBE / 'desktop-appkit-chat-node-strip-evidence.json').read_text())
        prune = json.loads((PROBE / 'desktop-appkit-chat-prune-evidence.json').read_text())
        goal_team = desktop_team_goal_evidence()
        for name, expected in data['inputs'].items():
            current = successor_input(self, strip, name, expected)
            current = successor_input(self, prune, name, current)
            current = successor_input(self, goal_team, name, current)
            current = successor_input(self, desktop_management_evidence(), name, current)
            current = successor_input(self, desktop_archive_evidence(), name, current)
            current = successor_input(self, desktop_import_evidence(), name, current)
            current = successor_input(self, desktop_workspace_layout_evidence(), name, current)
            current = successor_input(self, desktop_workspace_migration_evidence(), name, current)
            current = successor_input(self, desktop_turn_layout_evidence(), name, current)
            current = successor_input(self, desktop_first_draft_evidence(), name, current)
            current = successor_input(self, desktop_session_switch_evidence(), name, current)
            current = successor_input(self, desktop_startup_splash_evidence(), name, current)
            current = successor_input(self, desktop_command_preview_evidence(), name, current)
            current = successor_input(self, desktop_analysis_caption_evidence(), name, current)
            current = successor_input(self, desktop_session_completion_evidence(), name, current)
            current = successor_input(self, desktop_composer_layout_evidence(), name, current)
            self.assertEqual(current['sha256'], sha(ROOT / name), name)
        for name, expected in {**data['localReceipts'], **data['archives']}.items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)
        self.assertIn('desktop-appkit-chat-compression-evidence.json', (ROOT / 'PLAN.md').read_text())

    def test_node_strip_only_changes_runtime_symbols_and_reseals(self):
        data = json.loads((PROBE / 'desktop-appkit-chat-node-strip-evidence.json').read_text())
        base, slim, check = (data[k] for k in ('baseline', 'strippedInteractive', 'strippedCheck'))
        for bundle in (base, slim, check):
            self.assertEqual(bundle['identity'], base['identity'])
            self.assertEqual(bundle['head'], base['head'])
            self.assertEqual(bundle['nativeBuild'], base['nativeBuild'])
            self.assertTrue(bundle['trimMaps'] and bundle['fixtureOnly'] and bundle['extractedFromZip'])
            self.assertFalse(bundle['installed'])
            self.assertEqual(bundle['removedMaps'], base['removedMaps'])
            self.assertEqual(bundle['signed'], 'ad-hoc deep strict')
            self.assertEqual(bundle['upstreamRequests'], 0)
            self.assertEqual(bundle['sizes']['dependencyKiB'], base['sizes']['dependencyKiB'])
        self.assertGreater(base['removedMaps'], 0)
        self.assertIsNone(base['nodeStrip'])
        self.assertEqual(base['entry'], slim['entry'])
        self.assertEqual(base['resources'], slim['resources'])
        self.assertEqual(base['mode'], '--interactive')
        self.assertEqual(slim['mode'], '--interactive')
        self.assertEqual(base['launches'], [])
        self.assertEqual(slim['launches'], [])
        self.assertEqual(check['mode'], '--check')
        trim = slim['nodeStrip']
        self.assertEqual(trim, check['nodeStrip'])
        self.assertEqual(trim['before']['sha256'], base['nodeSha256'])
        self.assertEqual(trim['after']['sha256'], slim['nodeSha256'])
        self.assertEqual(slim['nodeSha256'], check['nodeSha256'])
        self.assertNotEqual(trim['before']['sha256'], trim['after']['sha256'])
        self.assertEqual(trim['before']['mode'], trim['after']['mode'])
        self.assertEqual(trim['after']['mode'] & 0o111, 0o111)
        self.assertGreater(trim['before']['bytes'], trim['after']['bytes'])
        self.assertGreater(trim['exportCount'], 0)
        self.assertRegex(trim['exportsSha256'], r'^[0-9a-f]{64}$')
        for field in ('bundleKiB', 'nodeKiB', 'zipBytes'):
            self.assertLess(slim['sizes'][field], base['sizes'][field], field)
        audit = data['comparison']
        self.assertTrue(audit['retainedEntriesIdentical'])
        self.assertGreater(audit['retainedEntries'], 0)
        self.assertEqual(audit['baselineLogicalBytes'] - audit['stripLogicalBytes'],
                         trim['before']['bytes'] - trim['after']['bytes'])
        self.assertRegex(audit['unsignedRunnerSha256'], r'^[0-9a-f]{64}$')
        self.assertRegex(audit['mapInventorySha256'], r'^[0-9a-f]{64}$')
        required = {'Contents/_CodeSignature/CodeResources', 'Contents/MacOS/moos-node'}
        self.assertLessEqual(required, set(audit['changedEntries']))
        self.assertLessEqual(set(audit['changedEntries']), required | {'Contents/MacOS/AppKitPI'})
        self.assertFalse(data['nativeAddon']['calledMethods'])
        exports = data['nativeAddon']['exportsByBuild']
        self.assertEqual(set(exports), {'baseline', 'strip-interactive', 'strip-check'})
        for names in exports.values():
            self.assertEqual(names, ['getFilePaths', 'getImage', 'getText', 'isModifierPressed', 'setText'])
        self.assertFalse(any(data['boundaries'].values()))
        self.assertTrue(check['registeredToolGone'])
        self.assertEqual(check['launches'][0]['scope'], check['launches'][1]['scope'])
        self.assertEqual([run['checks'] for run in check['launches']],
                         [run['checks'] for run in self.evidence['check']['launches']])
        prune = json.loads((PROBE / 'desktop-appkit-chat-prune-evidence.json').read_text())
        goal_team = desktop_team_goal_evidence()
        for name, expected in data['inputs'].items():
            current = successor_input(self, prune, name, expected)
            current = successor_input(self, goal_team, name, current)
            current = successor_input(self, desktop_management_evidence(), name, current)
            current = successor_input(self, desktop_archive_evidence(), name, current)
            current = successor_input(self, desktop_import_evidence(), name, current)
            current = successor_input(self, desktop_workspace_layout_evidence(), name, current)
            current = successor_input(self, desktop_workspace_migration_evidence(), name, current)
            current = successor_input(self, desktop_turn_layout_evidence(), name, current)
            current = successor_input(self, desktop_first_draft_evidence(), name, current)
            current = successor_input(self, desktop_session_switch_evidence(), name, current)
            current = successor_input(self, desktop_startup_splash_evidence(), name, current)
            current = successor_input(self, desktop_command_preview_evidence(), name, current)
            current = successor_input(self, desktop_analysis_caption_evidence(), name, current)
            current = successor_input(self, desktop_session_completion_evidence(), name, current)
            current = successor_input(self, desktop_composer_layout_evidence(), name, current)
            self.assertEqual(current['sha256'], sha(ROOT / name), name)
        self.assertTrue(data['localReceipts'])
        for name, expected in data['localReceipts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)
        self.assertIn('desktop-appkit-chat-node-strip-evidence.json', (ROOT / 'PLAN.md').read_text())

    def test_prune_removes_only_allowlisted_payload_and_retests_packaged_pi(self):
        data = json.loads((PROBE / 'desktop-appkit-chat-prune-evidence.json').read_text())
        base, slim, check = (data[k] for k in ('baseline', 'prunedInteractive', 'prunedCheck'))
        for report in (base, slim, check):
            for field in ('identity', 'head', 'nativeBuild', 'nodeSha256', 'removedMaps'):
                self.assertEqual(base[field], report[field], field)
            self.assertTrue(report['trimMaps'] and report['fixtureOnly'] and report['extractedFromZip'])
            self.assertEqual(report['signed'], 'ad-hoc deep strict')
            self.assertEqual(report['upstreamRequests'], 0)
            self.assertFalse(report['installed'])
            self.assertEqual(base['sizes']['nodeKiB'], report['sizes']['nodeKiB'])
        self.assertFalse(base['pruneRuntime'])
        self.assertEqual(base['prunedFiles'], 0)
        self.assertEqual(base['mode'], slim['mode'])
        self.assertEqual(base['entry'], slim['entry'])
        self.assertEqual(base['launches'], slim['launches'])
        self.assertEqual(slim['launches'], [])
        self.assertEqual(check['mode'], '--check')
        self.assertTrue(slim['pruneRuntime'] and check['pruneRuntime'])
        self.assertEqual(slim['prunedFiles'], check['prunedFiles'])
        for field in ('bundleKiB', 'dependencyKiB', 'zipBytes'):
            self.assertLess(slim['sizes'][field], base['sizes'][field], field)
        self.assertEqual(check['sizes']['dependencyKiB'], slim['sizes']['dependencyKiB'])
        audit = data['comparison']
        self.assertTrue(audit['retainedEntriesIdentical'])
        self.assertGreater(audit['retainedEntries'], 0)
        self.assertEqual(set(audit['removedByReason']), {'duplicate-sdk-source', 'non-darwin-arm64-addon'})
        self.assertGreater(audit['removedByReason']['duplicate-sdk-source'], 0)
        self.assertEqual(audit['removedByReason']['non-darwin-arm64-addon'], 5)
        self.assertEqual(sum(audit['removedByReason'].values()), slim['prunedFiles'])
        self.assertGreaterEqual(audit['baselineLogicalBytes'] - audit['prunedLogicalBytes'], audit['removedBytes'])
        seal = {'Contents/_CodeSignature/CodeResources'}
        self.assertLessEqual(seal, set(audit['changedEntries']))
        self.assertLessEqual(set(audit['changedEntries']), seal | {'Contents/MacOS/AppKitPI'})
        self.assertEqual(audit['nativeAddonExports'], ['getFilePaths', 'getImage', 'getText', 'isModifierPressed', 'setText'])
        self.assertTrue(check['registeredToolGone'] and check['dualProtocolLoopback'])
        self.assertEqual(check['launches'][0]['scope'], check['launches'][1]['scope'])
        self.assertEqual([run['checks'] for run in check['launches']],
                         [run['checks'] for run in self.evidence['check']['launches']])
        self.assertFalse(any(data['boundaries'].values()))
        goal_team = desktop_team_goal_evidence()
        for name, expected in data['inputs'].items():
            expected = successor_input(self, goal_team, name, expected)
            expected = successor_input(self, desktop_management_evidence(), name, expected)
            expected = successor_input(self, desktop_archive_evidence(), name, expected)
            expected = successor_input(self, desktop_import_evidence(), name, expected)
            expected = successor_input(self, desktop_workspace_layout_evidence(), name, expected)
            expected = successor_input(self, desktop_workspace_migration_evidence(), name, expected)
            expected = successor_input(self, desktop_turn_layout_evidence(), name, expected)
            expected = successor_input(self, desktop_first_draft_evidence(), name, expected)
            expected = successor_input(self, desktop_session_switch_evidence(), name, expected)
            expected = successor_input(self, desktop_startup_splash_evidence(), name, expected)
            expected = successor_input(self, desktop_command_preview_evidence(), name, expected)
            expected = successor_input(self, desktop_analysis_caption_evidence(), name, expected)
            expected = successor_input(self, desktop_session_completion_evidence(), name, expected)
            expected = successor_input(self, desktop_composer_layout_evidence(), name, expected)
            self.assertEqual(expected['sha256'], sha(ROOT / name), name)
        self.assertEqual(sum(p.endswith('/pruned-runtime.json') for p in data['localReceipts']), 2)
        for name, expected in data['localReceipts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)
        self.assertIn('desktop-appkit-chat-prune-evidence.json', (ROOT / 'PLAN.md').read_text())
