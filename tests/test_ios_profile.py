"""Pure profile-policy tests; never access real identities or sign anything."""
import datetime
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / 'scripts/sign-ios-probe.py'
spec = importlib.util.spec_from_file_location('sign_ios_probe', MODULE)
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class IosProfileTests(unittest.TestCase):
    def profile(self):
        return {
            'ExpirationDate': datetime.datetime(2030, 1, 1),
            'ProvisionedDevices': ['fixture-device'],
            'Entitlements': {
                'application-identifier': 'FIXTURE.dev.moos.m01mobile',
                'get-task-allow': True,
            },
        }

    def test_accepts_matching_unexpired_development_profile(self):
        profile = self.profile()
        self.assertEqual(signing.validate_profile(profile,
            datetime.datetime(2026, 11, 3, tzinfo=datetime.timezone.utc)), profile['Entitlements'])

    def test_rejects_expired_or_wrong_app_profile(self):
        profile = self.profile()
        with self.assertRaisesRegex(ValueError, 'expired'):
            signing.validate_profile(profile, datetime.datetime(2031, 1, 1, tzinfo=datetime.timezone.utc))
        profile['Entitlements']['application-identifier'] = 'FIXTURE.other.app'
        with self.assertRaisesRegex(ValueError, 'identifier'):
            signing.validate_profile(profile)

    def test_rejects_non_development_or_unregistered_device_profile(self):
        for mutation in ('no-device', 'distribution'):
            with self.subTest(mutation=mutation):
                profile = self.profile()
                if mutation == 'no-device':
                    profile['ProvisionedDevices'] = []
                else:
                    profile['Entitlements']['get-task-allow'] = False
                with self.assertRaisesRegex(ValueError, 'development profile'):
                    signing.validate_profile(profile)

    def test_rejects_unneeded_privileged_capabilities(self):
        for capability in ('aps-environment', 'com.apple.developer.applesignin'):
            with self.subTest(capability=capability):
                profile = self.profile()
                profile['Entitlements'][capability] = 'fixture'
                with self.assertRaisesRegex(ValueError, 'capabilities'):
                    signing.validate_profile(profile)
