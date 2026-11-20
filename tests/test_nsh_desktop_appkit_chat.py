import hashlib
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
        for name, expected in self.evidence['inputs'].items():
            self.assertEqual(expected, sha(ROOT / name), name)
        self.assertEqual(self.evidence['check']['entry'], sha(PROBE / 'appkit-hostcheck/ChatCheck.tsx'))
        for name, expected in self.evidence['artifacts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, sha(path), name)
