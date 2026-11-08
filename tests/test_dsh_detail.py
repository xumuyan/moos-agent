"""Retained historical DSH visual acceptance evidence."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class DshDetailTests(unittest.TestCase):
    def test_visual_acceptance_keeps_measurements_separate_from_limits(self):
        evidence = json.loads((ROOT / 'docs/evidence/desktop/p03-dsh-detail.json').read_text())
        self.assertFalse(evidence['reference']['pixelDiffAutomation'])
        self.assertFalse(evidence['limits']['nativeVibrancyReplicated'])
        self.assertFalse(evidence['motion']['systemReducedMotionChanged'])
        self.assertTrue(evidence['gui']['tableLastColumnVisibleAfterThumbDrag'])
        self.assertTrue(evidence['gui']['fixtureOriginalAddressRestored'])
        self.assertEqual(evidence['gui']['paidModelCalls'], 0)
        self.assertEqual(evidence['process']['ownedNodeHosts'], 1)
        self.assertRegex(evidence['build']['binarySha256'], r'^[a-f0-9]{64}$')
        report = (ROOT / evidence['report']).read_text()
        for finding in ('V01', 'V02', 'V03', 'V04', 'V05'):
            self.assertIn(finding, report)
