"""Native chrome access remains limited to moving the existing main window."""
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class DshDetailTests(unittest.TestCase):
    def test_overlay_chrome_does_not_expose_extra_native_commands(self):
        config = json.loads((ROOT / 'apps/desktop/src-tauri/tauri.conf.json').read_text())
        main = config['app']['windows'][0]
        self.assertEqual(main['titleBarStyle'], 'Overlay')
        self.assertTrue(main['hiddenTitle'])
        capabilities = config['app']['security']['capabilities']
        self.assertEqual(len(capabilities), 1)
        self.assertEqual(capabilities[0]['windows'], ['main'])
        self.assertEqual(capabilities[0]['permissions'], ['core:window:allow-start-dragging'])
        self.assertIn("connect-src 'self' ipc: http://ipc.localhost", config['app']['security']['csp'])

    def test_visual_acceptance_keeps_measurements_separate_from_limits(self):
        evidence = json.loads((ROOT / 'apps/desktop/evidence/p03-dsh-detail.json').read_text())
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
