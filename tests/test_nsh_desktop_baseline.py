"""Desktop baseline gates: reference/ownership/scope, not GUI or performance acceptance."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / 'probes/nsh-validation'


class DesktopBaselineTests(unittest.TestCase):
    def test_baseline_is_unaccepted_and_desktop_only(self):
        data = json.loads((PROBE / 'desktop-baseline.json').read_text())
        self.assertEqual(data['scope']['mobile'], 'paused')
        for key in ('electronChanges', 'productionDataAccess', 'deployment', 'commonPiServicesChanges'):
            self.assertFalse(data['scope'][key])
        self.assertFalse(data['visual']['accepted'])
        self.assertFalse(data['resource']['measured'])
        self.assertFalse(data['overallN01Complete'])
        self.assertEqual(data['visual']['contentSize'], [1240, 820])
        self.assertEqual(len(data['initialWorktree']), 9)

    def test_scope_interface_and_measurement_rules_are_concrete(self):
        text = (PROBE / 'DESKTOP-BASELINE.md').read_text()
        for marker in ('N01-D1', 'N01-D2', 'N01-D3', 'desktop_baseline', 'DesktopView',
                       'DesktopUIHost.swift', 'desktop-ui-controller.ts', 'terminal && !hasMore',
                       'desktop.dispose', 'Mac Catalyst', 'thirdPartyArtCommitted=false',
                       '1240×820', '1000条', 'CPU累计时间差', 'footprint', 'fullDiskBytes',
                       'runtimeDownloadBytes', 'not-demonstrated', 'blocked',
                       '不退出、重启、安装正式应用', '真实 PI SDK + 回环模型夹具',
                       '不把图中消息文本作为模型输入'):
            self.assertIn(marker, text)
        plan = (ROOT / 'PLAN.md').read_text()
        for marker in ('DESKTOP-BASELINE.md', 'desktop-baseline.test.mjs', '- [ ] N01-D1', '- [ ] N01-D2', '- [ ] N01-D3'):
            self.assertIn(marker, plan)
        log = (ROOT / 'operatelog.md').read_text()
        self.assertIn('N01 桌面基线与兼容接口', log)
        self.assertIn('define desktop visual baseline and parity gates', log)
