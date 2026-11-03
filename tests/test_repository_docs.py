"""仓库文档契约检查。运行：python3 -m unittest discover -s tests -v。"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RepositoryDocsTests(unittest.TestCase):
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

    def test_plan_contains_dependencies_and_acceptance_evidence(self):
        text = (ROOT / 'PLAN.md').read_text(encoding='utf-8')
        for term in ('依赖', '验收标准', '证据', '受阻原因', '解除条件'):
            self.assertIn(term, text)
        self.assertRegex(text, r'- \[x\]')
        self.assertRegex(text, r'- \[ \]')


if __name__ == '__main__':
    unittest.main()
