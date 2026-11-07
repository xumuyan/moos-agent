import hashlib
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from probe import isolated_environment, original_files


class ReferenceSkinTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "skin.zip"
        self.data = b'{"fixture":true}'
        digest = hashlib.sha256(self.data).hexdigest()
        self.identity = hashlib.sha256(f"skin.json\0{digest}\n".encode()).hexdigest()

    def write_zip(self, path, data):
        with zipfile.ZipFile(self.archive, "w") as bundle:
            bundle.writestr(path, data)

    def test_original_bytes_with_and_without_wrapper(self):
        for path in ("skin.json", "maid-atelier/skin.json"):
            with self.subTest(path=path):
                self.write_zip(path, self.data)
                self.assertEqual(original_files(self.archive, self.identity), {"skin.json": self.data})

    def test_changed_bytes_are_rejected(self):
        self.write_zip("skin.json", b"modified")
        with self.assertRaisesRegex(ValueError, "differ"):
            original_files(self.archive, self.identity)

    def test_paths_and_links_are_rejected_before_extracting(self):
        link = zipfile.ZipInfo("maid-atelier/skin.json")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for path in ("maid-atelier/../outside", "/skin.json", link):
            with self.subTest(path=path):
                self.write_zip(path, self.data)
                with self.assertRaisesRegex(ValueError, "unsafe"):
                    original_files(self.archive, self.identity)

    def test_configured_normal_skin_roots_are_not_inherited(self):
        with patch.dict("os.environ", {"DSH_HOME": "/normal", "DSH_SKINS_HOME": "/custom",
                                       "DSH_SKINS_DIR": "/also-custom"}):
            env = isolated_environment(self.root)
        self.assertEqual(env["DSH_HOME"], str(self.root / "dsh"))
        self.assertEqual(env["DSH_SKINS_HOME"], env["DSH_SKINS_DIR"])
        self.assertEqual(env["DSH_SKINS_HOME"], str(self.root / "dsh" / "skins"))
