"""Bind isolated model checkpoints without treating a build as upstream acceptance."""
import hashlib
import json
import subprocess
import unittest

from nsh_composer_provenance import PROBE, ROOT, live_models_evidence


def record(data):
    return dict(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())


class DesktopLiveModelsTests(unittest.TestCase):
    def optional_artifact(self, receipt):
        path = ROOT / receipt['path']
        self.assertTrue(path.is_relative_to(ROOT / 'artifacts/nsh-validation'))
        if path.is_file():
            data = path.read_bytes()
            self.assertEqual(record(data), {k: receipt[k] for k in ('sha256', 'bytes')})
            return data
        return None

    def test_receipt_advances_only_known_inputs(self):
        e = live_models_evidence()
        for path, item in e['inputs'].items():
            self.assertEqual(record((ROOT / path).read_bytes()), item)
        for path, before in e['previousInputs'].items():
            predecessor = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(predecessor)['sha256'], before)
        self.assertEqual({k for k, v in e['checks'].items() if v},
                         {'liveBuild', 'realPiSdk', 'fixtureWindow', 'dualLoopback'})
        example = json.loads((PROBE / 'desktop-live-providers.example.json').read_text())
        self.assertEqual(set(example), {'glm-coding', 'openai-relay'})
        self.assertEqual(example['glm-coding']['api'], 'openai-responses')
        self.assertTrue(example['openai-relay']['baseUrl'].startswith('https://relay.example.invalid/'))
        self.assertTrue(all(set(profile) == {'baseUrl', 'model', 'api', 'contextWindow', 'maxTokens'}
                            for profile in example.values()))

    def test_local_copy_is_not_upstream_acceptance_or_history_migration(self):
        plan = (ROOT / 'PLAN.md').read_text()
        local = next(line for line in plan.splitlines() if '本机配置：经用户明确要求一次性只读' in line)
        for claim in ('原文件字节未变', '未发外部请求', '不是自动导入或持续同步', '真实两家联调仍待验收'):
            self.assertIn(claim, local)
        self.assertIn('- [ ] N01-D2', plan)
        migration = next(line for line in plan.splitlines() if '正式项目/聊天迁移另设门禁' in line)
        self.assertIn('实际迁移尚未执行', migration)

    def test_real_provider_receipt_is_backend_only_and_binds_both_routes(self):
        e = json.loads((PROBE / 'desktop-real-models-evidence.json').read_text())
        self.assertEqual(e['task'], 'N01-D2')
        for path, item in e['inputs'].items():
            data = subprocess.check_output(['git', 'show', f"{e['base']}:{path}"], cwd=ROOT)
            self.assertEqual(record(data), item, path)
        self.optional_artifact(e['harness'])
        self.assertEqual(e['report']['status'], 0)
        local = self.optional_artifact(e['report'])
        if local is not None:
            self.assertEqual(json.loads(local), e['result'])
        self.assertEqual({k for k, v in e['limits'].items() if v},
                         {'realUpstreamBackends', 'syntheticProjectsOnly'})
        result = e['result']
        self.assertNotIn('blockedStage', result)
        self.assertTrue(result['externalModeTasksAdmitted'])
        self.assertEqual(result['cleanup'], dict(cleanExit=True, stderrBytes=0,
                                                 temporaryStateRemoved=True, watchdog=False))
        self.assertEqual(set(result['routes']), {'glm-coding', 'openai-relay'})
        for route in result['routes'].values():
            self.assertEqual(set(route), {'text', 'workspace', 'stop', 'resend'})
            for name, turn in route.items():
                self.assertTrue(turn['running'] and turn['drained'])
                self.assertGreater(turn['textEvents'], 0)
                self.assertGreater(turn['firstTextMs'], 0)
                self.assertLessEqual(turn['firstTextMs'], turn['elapsedMs'])
                if name == 'stop':
                    self.assertEqual((turn['status'], turn['code'], turn['stop']),
                                     ('cancelled', 'cancelled', 'after-public-text'))
                    self.assertGreaterEqual(turn['stopToDrainMs'], 0)
                else:
                    self.assertEqual((turn['status'], turn['code']), ('succeeded', None))
                    self.assertTrue(turn['expectedText'])
            self.assertEqual(route['workspace']['tools'], dict(read=True, edit=True, bash=True))
            self.assertEqual(route['workspace']['toolErrors'], 0)
            self.assertTrue(route['workspace']['fileContentCorrect'])
        self.assertIn('- [ ] N01-D2', (ROOT / 'PLAN.md').read_text())

    def test_live_build_and_fixture_window_are_separate(self):
        e = live_models_evidence()
        self.assertEqual(e['missingConfig']['status'], 1)
        self.assertEqual(e['missingConfig']['stdout']['bytes'], 0)
        self.optional_artifact(e['missingConfig']['stdout'])
        stderr = self.optional_artifact(e['missingConfig']['stderr'])
        if stderr is not None:
            self.assertEqual(stderr, b'Isolated desktop model Host startup failed; check private configuration and permissions\n')
        focused = self.optional_artifact(e['focused']['log'])
        if focused is not None:
            self.assertIn(f"pass {e['focused']['passed']}".encode(), focused)
        self.assertEqual(set(e['runs']), {'liveBuild', 'fixtureWindow'})
        for mode, run in e['runs'].items():
            is_live = mode == 'liveBuild'
            self.assertEqual(run['status'], 0)
            self.optional_artifact(run['log'])
            capture = self.optional_artifact(run['inputs'])
            if capture is not None:
                actual = json.loads(capture)
                self.assertEqual(actual['head'], e['base'])
                self.assertEqual(actual['modelMode'], 'external' if is_live else 'fixture')
                self.assertIs(actual['acceptance'], not is_live)
                for path, item in e['inputs'].items():
                    if path.startswith('probes/'):
                        self.assertEqual(actual['inputs'][path], item)
            config = self.optional_artifact(run['nsConfig'])
            if config is not None:
                actual = json.loads(config)
                self.assertEqual(actual['id'], 'dev.muma.probe.nsh.piui' + ('.live' if is_live else ''))
                self.assertEqual(actual['capabilities']['host'], ['projects.list', 'sessions.list',
                                 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events']
                                 + ([] if is_live else ['piui.disconnect', 'piui.report']))
            result = self.optional_artifact(run['output'])
            if result is not None:
                self.assertEqual(json.loads(result), run['result'])
        self.assertEqual(e['runs']['liveBuild']['result'],
                         dict(built=True, launched=False, installed=False, acceptance=False))
        result = e['runs']['fixtureWindow']['result']
        self.assertTrue(result['passed'] and result['normalChildExit'] and not result['forced'])
        self.assertEqual(len(result['checks']), 17)
        self.assertEqual(result['stderrBytes'], 0)
