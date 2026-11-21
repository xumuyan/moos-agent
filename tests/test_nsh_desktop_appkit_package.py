import hashlib
import json
from pathlib import Path
import unittest

from nsh_composer_provenance import desktop_archive_evidence, desktop_management_evidence, desktop_team_goal_evidence, idle_host_evidence, successor_input


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


class AppKitPackageEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.evidence = json.loads((PROBE / 'desktop-appkit-package-evidence.json').read_text())

    def test_same_brand_and_same_runner_with_isolated_signed_app(self):
        original, slim = (self.evidence[key] for key in ('full', 'trimmed'))
        for variant in (original, slim):
            self.assertEqual(variant['identity']['displayName'], '沐码')
            self.assertEqual(variant['identity']['bundleIdentifier'], 'dev.muma.probe.nsh.appkit.package.check')
            self.assertEqual(variant['signed'], 'ad-hoc deep strict')
            self.assertEqual(variant['runtime']['icon']['sha256'], hashlib.sha256(
                (ROOT / 'apps/electron/assets/moos.icns').read_bytes()).hexdigest())
            self.assertTrue(variant['relocated'])
            self.assertTrue(variant['fixtureOnly'])
            self.assertFalse(variant['installed'])
            self.assertEqual(variant['downloadsAtFirstRun'], 0)
            self.assertIn('PI continuation uses prior context', variant['checks'])
            self.assertIn('Stop then terminal and fully drained', variant['checks'])
            self.assertIn('both protocols on packaged Node/PI using loopback', variant['checks'])
        # The bundle signatures seal different resources. The compared
        # executables match after removing the signatures on isolated copies.
        self.assertEqual(original['runner']['bytes'], slim['runner']['bytes'])
        self.assertRegex(self.evidence['comparison']['unsignedRunnerSha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(original['runtime'], slim['runtime'])

    def test_size_claim_and_comparison_boundaries(self):
        original, slim = (self.evidence[key] for key in ('full', 'trimmed'))
        self.assertFalse(original['trimMaps'])
        self.assertTrue(slim['trimMaps'])
        self.assertEqual(original['nodeKiB'], slim['nodeKiB'])
        self.assertGreater(original['dependencyKiB'], slim['dependencyKiB'])
        self.assertGreater(original['bundleKiB'], slim['bundleKiB'])
        self.assertGreater(original['zipBytes'], slim['zipBytes'])
        self.assertGreater(self.evidence['comparison']['removedMapCount'], 0)
        self.assertTrue(self.evidence['comparison']['remainingDependencyEntriesIdentical'])
        for key in ('developerID', 'notarized', 'humanGUI', 'externalModels', 'productionCutover', 'matchedPerformance'):
            self.assertFalse(self.evidence['boundaries'][key])

    def test_bind_current_inputs_and_available_logs(self):
        successor = idle_host_evidence()
        goal_team = desktop_team_goal_evidence()
        for name, expected in self.evidence['inputs'].items():
            data = (ROOT / name).read_bytes()
            current = successor_input(self, successor, name, expected)
            current = successor_input(self, goal_team, name, current)
            current = successor_input(self, desktop_management_evidence(), name, current)
            current = successor_input(self, desktop_archive_evidence(), name, current)
            self.assertEqual(current, hashlib.sha256(data).hexdigest(), name)
        for name, expected in self.evidence['artifacts'].items():
            path = ROOT / name
            if path.is_file():
                self.assertEqual(expected, hashlib.sha256(path.read_bytes()).hexdigest(), name)
