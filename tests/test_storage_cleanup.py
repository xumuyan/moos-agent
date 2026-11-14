"""Audit consistency only; actual local deletion checks ran separately."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StorageCleanupAuditTests(unittest.TestCase):
    def test_evidence_limits_cleanup_to_confirmed_build_copies(self):
        report = json.loads((ROOT / 'docs/evidence/desktop/storage-cleanup-20261115.json').read_text())
        self.assertEqual(report['baseCommit'], 'bba813c822b4ca0ea57eb16102610815c76265fc')
        self.assertEqual([s['path'] for s in report['scopes']],
                         ['.generated/moos-electron', 'artifacts/collapse-turn-tail'])
        builds, copies = report['scopes']
        self.assertEqual(builds['deletedBuilds'], 35)
        self.assertEqual(builds['retainedVersion'], '0.1.49')
        self.assertEqual(copies['deletedAppCopies'], 38)
        self.assertEqual(copies['retainedFileCount'], 7761)
        self.assertTrue(copies['retainedContentAndModesUnchanged'])
        reduction = sum(s['beforeAllocatedKiB'] - s['afterAllocatedKiB'] for s in report['scopes'])
        self.assertEqual(reduction, 50528960)
        for key in ('noTrackedDeletion', 'targetsIgnoredByGit', 'noActiveTargetBeforeDeletion', 'allTargetsAbsentAfterDeletion'):
            self.assertTrue(report['checks'][key])
        for key in ('productionAppTouched', 'userDataTouched', 'installationBackupsTouched', 'signingMaterialsTouched', 'nshToolchainTouched'):
            self.assertFalse(report['checks'][key])
        self.assertIn('APFS', report['measurement'])
        self.assertIn('重建', report['recovery'])
