"""Keep the pinned AppKit source-build receipt separate from the stock and Catalyst trials."""
import hashlib
import json
import re
import unittest
from pathlib import Path

from nsh_composer_provenance import ROOT

PROBE = ROOT / 'probes/nsh-validation'


class DesktopAppKitSourceEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.e = json.loads((PROBE / 'desktop-appkit-source-evidence.json').read_text())

    def artifact(self, key):
        entry = self.e['artifacts'][key]
        path = Path(entry['path'])
        self.assertEqual(path.parts[:3], ('artifacts', 'nsh-validation', 'appkit-source.C2fZxl'))
        self.assertNotIn('..', path.parts)
        self.assertRegex(entry['sha256'], r'^[0-9a-f]{64}$')
        self.assertGreater(entry['bytes'], 0)
        if (ROOT / path).is_file():
            data = (ROOT / path).read_bytes()
            self.assertEqual(len(data), entry['bytes'], key)
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'], key)
            return data
        return None

    def test_locked_source_and_native_shell_measurements(self):
        src = self.e['source']
        self.assertEqual(src['commit'], 'f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1')
        self.assertEqual(src['verifiedGitBlobs'], 2865)
        self.assertEqual((src['version'], src['cargo'], src['features'], src['profile']),
                         ('0.5.0', '1.100.0', ['js'], {'lto': 'fat', 'codegenUnits': 1}))
        manifest = self.artifact('stock-sizes.json')
        sizes = self.e['sourceShellOnly']
        if manifest is not None:
            self.assertEqual(json.loads(manifest), sizes)
        release, stripped = (sizes[k] for k in ('source-release', 'source-stripped'))
        for size in (release, stripped):
            self.assertEqual((size['exit'], size['hostAvailable'], size['signed']),
                             (0, False, 'ad-hoc deep strict'))
            self.assertLess(size['zipBytes'], size['runnerBytes'])
        for field in ('runnerBytes', 'allocatedKiB', 'zipBytes'):
            self.assertLess(stripped[field], release[field])
        for key in ('build-baseline.log', 'build-retry.status', 'source-release/launch.log', 'source-stripped/launch.log'):
            log = self.artifact(key)
            if log is None:
                continue
            marker = {'build-baseline.log': b'unicode-ccc/0.4.0/download', 'build-retry.status': b'0\n'}
            self.assertIn(marker.get(key, b'APPKIT_BASELINE false ERR_FEATURE_UNAVAILABLE_ON_PLATFORM'), log)

    def test_custom_runner_receipt_includes_drain_and_active_quit(self):
        proof = self.e['custom']
        self.assertEqual((proof['exit'], proof['hostExit'], proof['forced'], proof['stderrBytes']), (0, 0, False, 0))
        self.assertEqual(proof['checks'], [
            'positive AppKit layout and host availability', 'ungranted method denied',
            'scoped project and session', 'SDK text and successful write/read', 'foreign project denied',
            'active bash cancelled, terminal backlog fully drained', 'same-session Send after drain',
            'AppKit Quit with active bash and normal Host exit',
        ])
        for name, source in proof['inputs'].items():
            self.assertFalse(Path(name).is_absolute() or '..' in Path(name).parts)
            data = (PROBE / name).read_bytes()
            self.assertEqual({'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}, source, name)
        for name, marker in (
            ('link-first/build-custom.log', b'Undefined symbols for architecture arm64'),
            ('layout-first/custom-run.log', b'N01_APPKIT_TSX_FAILED boot'),
            ('layout-retry-build.log', b'.nsh/out'),
            ('layout-final-build.log', b'into build'),
            ('build-custom-retry.status', b'0\n'),
            ('custom-run.status', b'0\n'),
            ('custom-repeat.status', b'0\n'),
        ):
            receipt = self.artifact(name)
            if receipt is not None:
                self.assertIn(marker, receipt)
        for name in ('custom-run.log', 'custom-repeat.log'):
            log = self.artifact(name)
            if log is not None:
                self.assertIn(b'profiles.import` is not granted', log)
                self.assertIn(b'N01_APPKIT_TSX_COMPLETE\nN01_HOST_EXIT 0 forced=false stderrBytes=0\n', log)
                self.assertNotIn(b'N01_APPKIT_TSX_FAILED', log)
        for name in ('custom/appkit-host', 'custom/libN01AppKitPipe.dylib', 'custom/tsx/build/bundle.js'):
            self.artifact(name)

    def test_receipt_does_not_promote_probe_to_product(self):
        scope = self.e['scope']
        self.assertEqual((scope['platform'], scope['arch'], scope['model']), ('27.0.1', 'arm64', 'loopback fixture'))
        for key in ('installed', 'standaloneAppKitPiPackage', 'humanGui', 'externalProvider', 'formalDataAccess'):
            self.assertIs(scope[key], False)
        plan = (ROOT / 'PLAN.md').read_text()
        for task in ('N01-D1', 'N01-D2', 'N01-D3'):
            self.assertRegex(plan, re.escape(f'- [ ] {task}'))
