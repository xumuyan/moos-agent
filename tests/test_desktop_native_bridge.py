"""Preserve the limited native bridge acceptance; do not promote Catalyst to AppKit."""
from pathlib import Path
import hashlib
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DesktopNativeBridgeTests(unittest.TestCase):
    def test_reproducible_native_checkpoint(self):
        evidence = json.loads((ROOT / 'probes/nsh-validation/desktop-native-evidence.json').read_text())
        for path, digest in evidence['sourceSha256'].items():
            self.assertEqual(hashlib.sha256((ROOT / path).read_bytes()).hexdigest(), digest, path)
        for item in evidence['logs'].values():
            self.assertEqual(hashlib.sha256((ROOT / item['log']).read_bytes()).hexdigest(), item['sha256'])
        self.assertEqual(evidence['native']['assertions'], 63)
        for name in ('acceptance', 'ownerNormalExit'):
            self.assertTrue(evidence[name]['passed'])
            self.assertTrue(evidence[name]['normalChildExit'])
            self.assertFalse(evidence[name]['forced'])
            self.assertTrue(all(n == 0 for n in evidence[name]['stderrBytes']))
        self.assertEqual(set(evidence['acceptance']['reports']), {'good', 'denied', 'timeout'})
        self.assertEqual(evidence['regression']['serial']['pass'], 317)
        self.assertFalse(evidence['overallN01D1Complete'])
        self.assertFalse(evidence['defaultParallelStable'])
        self.assertTrue(all(value is False for value in evidence['protection'].values()))
        self.assertTrue(all(value is False for value in evidence['notClaimed'].values()))
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, (ROOT / 'PLAN.md').read_text())
        self.assertIn(evidence['commitSubject'], (ROOT / 'operatelog.md').read_text())

    def test_restricted_methods_and_lifecycle_are_documented(self):
        bridge = (ROOT / 'probes/nsh-validation/DesktopNativeBridge.swift').read_text()
        pipe = (ROOT / 'probes/nsh-validation/DesktopPipe.swift').read_text()
        contract = (ROOT / 'probes/nsh-validation/desktop-contract.ts').read_text()
        for name in ('projects.list', 'sessions.list', 'sessions.create', 'tasks.submit', 'tasks.cancel', 'tasks.events'):
            self.assertIn('"' + name + '"', pipe)
            self.assertIn("'" + name + "':", contract)
        self.assertNotIn('app.handle("check.', bridge)
        for guard in ('POSIX_SPAWN_CLOEXEC_DEFAULT', 'pending.count < 32', 'bytes.count <= 16384', '524288', 'callSeconds: 10', 'waitpid', 'O_NONBLOCK'):
            self.assertIn(guard, pipe)
        doc = (ROOT / 'probes/nsh-validation/DESKTOP-NATIVE-BRIDGE.md').read_text()
        for limitation in ('Mac Catalyst', 'SIGTERM', 'terminal && !hasMore', '未安装', 'AppKit'):
            self.assertIn(limitation, doc)
