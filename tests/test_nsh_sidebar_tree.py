"""Portable provenance for tree checkpoint; not GUI or licensed-art acceptance."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NSH = ROOT / 'probes/nsh-validation'


class SidebarTreeTests(unittest.TestCase):
    def test_inputs_transition_and_protected_ownership(self):
        m = json.loads((NSH / 'desktop-sidebar-tree-verification.json').read_text())
        live = json.loads((NSH / 'desktop-live-sidebar-verification.json').read_text())
        scroll = json.loads((NSH / 'desktop-scroll-verification.json').read_text())
        for name, record in m['inputs'].items():
            self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), record['sha256'])
        for name, sha in m['previousInputs'].items():
            self.assertEqual(sha, (live['inputs'].get(name) or scroll['inputs'][name])['sha256'])
        self.assertEqual(len(m['protected']), 7)
        self.assertTrue(all(r['unchanged'] for r in m['protected'].values()))
        self.assertFalse(m['rights']['artCommitted'])
        self.assertFalse(m['rights']['hooksExecuted'])

    def test_actual_dense_scroll_and_failures_not_relabelled(self):
        m = json.loads((NSH / 'desktop-sidebar-tree-verification.json').read_text())
        self.assertEqual(m['tests']['coreFirst']['failed'], 3)
        self.assertEqual(m['tests']['coreFinal'], {'passed': 358, 'failed': 2})
        self.assertEqual(m['tests']['scheduler']['failed'], 2)
        self.assertEqual(m['tests']['electron']['skipped'], 10)
        self.assertEqual(m['tests']['rust']['missing'], 'defmt')
        self.assertTrue(m['candidate']['synthetic'])
        self.assertFalse(m['candidate']['piExecuted'])
        self.assertEqual(len(m['candidate']['images']), 8)
        self.assertTrue(all(not v for v in m['acceptance'].values()))
        source = (NSH / 'desktop-live-sidebar-check.tsx').read_text()
        for token in ('app.scroll', 'session-合成会话 16', 'project-主题验证 H', 'id:create-session', 'id:session-第二会话', 'toBe(false)', 'SIDEBAR_TREE_BOUNDS'):
            self.assertIn(token, source)
        view = (NSH / 'DesktopView.tsx').read_text()
        self.assertIn('projectTreeHeight', view)
        self.assertIn('snapshot().projectId === p().id', view)
        self.assertIn('each={messageRows()}', view)
        self.assertIn('nav-${id}-unavailable', view)

    def test_plan_and_log_keep_product_and_visual_open(self):
        for name in ('PLAN.md', 'operatelog.md'):
            self.assertIn('SIDEBAR-TREE.md', (ROOT / name).read_text())
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertIn('- [ ] ' + task, (ROOT / 'PLAN.md').read_text())
        doc = (NSH / 'SIDEBAR-TREE.md').read_text()
        for token in ('未部署', '用户视觉认可', '不执行 Host/PI', '不伪造', '根因未定', '36'):
            self.assertIn(token, doc)
