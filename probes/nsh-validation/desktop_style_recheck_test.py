"""Portable contracts; not live NSH or user visual acceptance."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('recheck', Path(__file__).with_name('desktop-style-recheck.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class RecheckTests(unittest.TestCase):
    def frames(self):
        return [{'name': name, 'state': {'scaleFactor': 1, 'contentBounds': {
            'size': {'width': size[0], 'height': size[1]}}}, 'synthetic': True}
                for name, size in m.SCENES.items()]

    def log(self, frames):
        return '\n'.join('STYLE_FRAME ' + json.dumps(f) for f in frames)

    def test_all_twelve_frames_and_metadata_are_required(self):
        frames = self.frames()
        self.assertEqual(len(m.validate_frames(self.log(frames))), 12)
        for invalid in (frames[:-1], frames + [frames[0]]):
            with self.assertRaises(ValueError):
                m.validate_frames(self.log(invalid))
        for key, value in (('scaleFactor', 2), ('contentBounds', {'size': {'width': 1, 'height': 1}})):
            invalid = self.frames()
            invalid[0]['state'][key] = value
            with self.assertRaises(ValueError):
                m.validate_frames(self.log(invalid))
        frames[0]['synthetic'] = False
        with self.assertRaises(ValueError):
            m.validate_frames(self.log(frames))

    def test_inputs_reject_mutation_and_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            p = root / 'input'
            p.write_bytes(b'original')
            expected = m.digest(p)
            m.verify_hashes(root, {'input': expected})
            p.write_bytes(b'mutated!')
            with self.assertRaises(ValueError):
                m.verify_hashes(root, {'input': expected})
            with self.assertRaises(ValueError):
                m.verify_hashes(root, {'../outside': expected})

    def test_refuses_overwrite_before_loading_private_art_or_pillow(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'refuse overwriting'):
                m.build(Path(tmp), Path(tmp), Path(tmp), Path(tmp))

    def test_crops_are_bounded_and_wide_comparisons_unscaled(self):
        self.assertEqual(len(m.SHARED), 5)
        for rect in m.REGIONS.values():
            x1, y1, x2, y2 = rect
            self.assertTrue(0 <= x1 < x2 <= 1240 and 0 <= y1 < y2 <= 820)


if __name__ == '__main__':
    unittest.main()
