"""Offline fixture tests only. No production home, shell, hooks, network or GUI."""
import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('skin_source', HERE / 'skin_source.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SNAPSHOT = json.loads((HERE / 'skin-source.json').read_text())


class SourceTests(unittest.TestCase):
    def test_css_nested_conditions_comments_strings_and_duplicates(self):
        css = '/* { */ @media (width <= 700px) { a { content: "} {"; color:red; } } a {color: blue;}'
        rules = list(m.blocks(css))
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules[0]['conditions'], ['@media (width <= 700px)'])
        self.assertIn('content: "} {"', rules[0]['declarations'])
        self.assertEqual(rules[1]['conditions'], [])
        self.assertEqual(rules[1]['selector'], 'a')

    def test_css_truncation_rejected(self):
        for css in ['a { x:y;', '/* missing end', 'a { /* missing end']:
            with self.subTest(css=css), self.assertRaises(ValueError):
                list(m.blocks(css))

    def test_webp_all_three_encodings(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'fixture.webp'
            for kind, body, expected in [
                (b'VP8X', b'\x00' * 4 + (9).to_bytes(3, 'little') + (19).to_bytes(3, 'little'), [10, 20]),
                (b'VP8L', b'\x2f' + (9 | (19 << 14)).to_bytes(4, 'little'), [10, 20]),
                (b'VP8 ', b'\x00' * 3 + b'\x9d\x01\x2a' + struct.pack('<HH', 10, 20), [10, 20]),
            ]:
                data = b'WEBP' + kind + struct.pack('<I', len(body)) + body
                p.write_bytes(b'RIFF' + struct.pack('<I', len(data)) + data)
                self.assertEqual(m.webp_dimensions(p), expected)
            p.write_bytes(b'not artwork')
            with self.assertRaises(ValueError):
                m.webp_dimensions(p)

    def test_missing_and_path_or_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / 'source'
            base.mkdir()
            private = Path(tmp) / 'not-authorized'
            private.write_text('sentinel')
            (base / 'escape').symlink_to(private)
            for relative in ['missing', '../not-authorized', 'escape']:
                with self.subTest(relative=relative), self.assertRaises(ValueError):
                    m.safe_file(base, relative)

    def test_bad_or_missing_selection_stops_without_other_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            for active in [None, '../private', '/absolute', 'x/y', 12]:
                (home / 'skin-center-active.json').write_text(json.dumps({'active': active}))
                with self.assertRaisesRegex(ValueError, 'active skin'):
                    m.collect(home, home / 'app')
            (home / 'skin-center-active.json').unlink()
            with self.assertRaises(ValueError):
                m.collect(home, home / 'app')

    def test_manifest_mismatch_stops(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / 'skin-center-active.json').write_text('{"active":"maid-atelier"}')
            skin = home / 'skins/maid-atelier'
            skin.mkdir(parents=True)
            (skin / 'skin.json').write_text('{"id":"other"}')
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                m.collect(home, home / 'app')

    def test_collection_projects_metadata_without_executing_hooks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            home, app = root / 'home', root / 'app'
            home.mkdir()
            (home / 'skin-center-active.json').write_text(json.dumps({
                'active': 'maid-atelier', 'initialized': True, 'unrelated': 'DO-NOT-EXPORT'}))
            skin = home / 'skins/maid-atelier'
            skin.mkdir(parents=True)
            (skin / 'assets').mkdir()
            manifest = {**SNAPSHOT['identity'], 'contributes': {'backgroundMedia': SNAPSHOT['backgroundMedia']}}
            (skin / 'skin.json').write_text(json.dumps(manifest))
            for name, text in [('skin.css', ':root { --maid-gold: #c5a468; }'),
                    ('patches.css', '@media (width <= 700px) { body { color:red; } }'),
                    ('hooks.mjs', 'throw new Error("MUST NEVER EXECUTE");'),
                    ('LICENSE', 'fixture license'), ('NOTICE', 'fixture notice')]:
                (skin / name).write_text(text)
            package_dirs = [
                home / 'profiles/web/node_modules/@linxin666/dsh-client-ui-skin-center',
                home / 'profiles/web/node_modules/moos-electron-shell',
                app / 'Contents/Resources/host-runtime/dsh/node_modules/@deepseek-ai/dsh-web-frontend',
                app / 'Contents/Resources/host-runtime/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme',
            ]
            for p in package_dirs:
                (p / 'lib').mkdir(parents=True)
                (p / 'package.json').write_text(json.dumps({'name': p.name, 'version': 'fixture', 'license': 'test'}))
                for name in ['LICENSE', 'client.js', 'lib/client.js', 'lib/index.js']:
                    (p / name).write_text('fixture')
            before = {str(p): m.sha(p) for p in root.rglob('*') if p.is_file()}
            result = m.collect(home, app)
            self.assertNotIn('DO-NOT-EXPORT', json.dumps(result))
            self.assertFalse(result['selection']['runtimeActiveVerified'])
            self.assertEqual(result['files']['hooks.mjs'], m.sha(skin / 'hooks.mjs'))
            self.assertEqual(before, {str(p): m.sha(p) for p in root.rglob('*') if p.is_file()})

    def test_snapshot_identity_and_honest_runtime_boundary(self):
        s = SNAPSHOT
        self.assertEqual(s['identity']['id'], 'maid-atelier')
        self.assertEqual(s['identity']['version'], '0.3.2')
        self.assertEqual(s['skinCenter']['version'], '0.4.16')
        self.assertEqual(s['requires']['contracts'], [{'apiVersion': 'x-org.linxin666.skin-center/v1alpha1', 'kind': 'SkinHooks', 'optional': True}])
        self.assertEqual(s['stylesheet'], 'skin.css')
        self.assertEqual(s['patches'], 'patches.css')
        self.assertEqual(s['electronShell']['version'], '0.1.52')
        self.assertEqual(s['defaultTheme']['version'], '0.2.2-rc.1')
        self.assertFalse(s['selection']['runtimeActiveVerified'])
        self.assertEqual(s['selection']['runtimeThemeMode'], 'unknown')
        self.assertFalse(s['selection']['backgroundOverridePresent'])
        self.assertGreaterEqual(len(s['blocked']), 3)

    def test_source_hashes_license_and_dimensions(self):
        s = SNAPSHOT
        self.assertEqual(s['identity']['license'], 'CC BY-NC-SA 4.0')
        self.assertEqual(s['identity']['attribution'], '上善 → zipzip → Small-tailqwq')
        self.assertEqual(len(s['assets']), 17)
        for item in list(s['files'].values()) + s['assets']:
            self.assertRegex(item['sha256'], r'^[0-9a-f]{64}$')
            self.assertGreater(item['bytes'], 0)
        for a in s['assets']:
            self.assertFalse(a['redistributed'])
            self.assertEqual(a['license'], s['identity']['license'])
            self.assertTrue(all(isinstance(n, int) and n > 0 for n in a['pixels']))
        palace = next(a for a in s['assets'] if 'palace-day' in a['path'])
        self.assertEqual(palace['pixels'], [1586, 992])

    def test_precise_style_facts_not_generic_blue(self):
        rules = SNAPSHOT['styleFacts']
        def get(selector):
            return next(r['declarations'] for r in rules if r['selector'] == selector and not r['conditions'])
        self.assertIn('--maid-gold: #c5a468;', get(':root'))
        self.assertIn('background: #0a173b;', get(':is([data-pane="sidebar"], [class*="sidebarCol"])'))
        self.assertIn('height: clamp(560px, 96vh, 1180px);', get('[data-maid-character="left"]'))
        self.assertIn('border-image-slice: 170 120 115;', get('[data-composer-card]:before'))
        self.assertTrue(any('width <= 700px' in ' '.join(r['conditions']) for r in rules))
        self.assertTrue(any('keyframes' in ' '.join(r['conditions']) for r in SNAPSHOT['animationFacts']))
        self.assertTrue(any('14px/22px' in x for x in SNAPSHOT['defaultTheme']['declarations']))

    def test_collector_has_no_execution_or_private_config_reads(self):
        source = (HERE / 'skin_source.py').read_text()
        for forbidden in ['subprocess', 'eval(', 'exec(', 'importlib', 'requests', 'urllib', 'providers.json', 'credentials.json', '.sqlite', 'rglob(']:
            self.assertNotIn(forbidden, source)
        # Broad metadata is projected to explicit skin-selection keys, never emitted whole.
        self.assertNotIn('"selection": selection', source)
        self.assertNotIn('copyfile', source)
        self.assertFalse(any(p.suffix in ['.webp', '.jpg', '.woff2'] for p in HERE.glob('skin-source*')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
