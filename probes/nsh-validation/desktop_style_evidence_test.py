import importlib.util
import json
import struct
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).with_name('desktop-style-evidence.py')
spec = importlib.util.spec_from_file_location('style_evidence', path)
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class StyleEvidenceTests(unittest.TestCase):
    def test_png_magic_and_size_are_original_not_preview(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'sample.png'
            p.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\x00\x00\x00\rIHDR' + struct.pack('>II', 1240, 820))
            self.assertEqual(evidence.png_size(p), (1240, 820))
            self.assertEqual(evidence.digest(p)['bytes'], 24)
            p.write_bytes(b'JPEG preview, not a PNG')
            with self.assertRaises(ValueError):
                evidence.png_size(p)

    def test_component_crops_in_content_bounds_and_source_selectors_exist(self):
        facts = json.loads(path.with_name('skin-source.json').read_text())
        for name, scene, rect, selector in evidence.REGIONS:
            width, height = evidence.SCENES[scene]
            x1, y1, x2, y2 = rect
            self.assertTrue(0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height, name)
            self.assertTrue(any(f['selector'] == selector for f in facts['styleFacts']), selector)
        self.assertEqual(len(evidence.SCENES), 7)
        self.assertEqual(len(evidence.REGIONS), 5)

    def test_output_refuses_replacing_existing_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Refusal occurs before opening images or writing any file; no Pillow required.
            with self.assertRaises(ValueError):
                evidence.build(Path(tmp), Path(tmp), path.with_name('skin-source.json'))


if __name__ == '__main__':
    unittest.main()
