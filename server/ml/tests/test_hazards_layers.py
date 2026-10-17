"""Per-event map layers (forecaster/hazards/layers.py and the flood import's
--layers): the raster helpers on small arrays (numpy only), the whole import
on synthetic GeoTIFFs (needs rasterio), the CLI, and the committed layers in
server/data/hazards/flood.

With FLOOD_LAYERS_DIR set to the folder holding the notebook's
<event>_water_reference.tif files, the committed layers are also rebuilt from
them and compared byte for byte:

    FLOOD_LAYERS_DIR=/path/to/tifs ./hazards-python -m unittest -v tests.test_hazards_layers
"""

import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from forecaster.hazards.dataset import DatasetError
from forecaster.hazards.import_flood import WATER_REFERENCE, import_flood_layers, layer_event_id, run_import
from forecaster.hazards.layers import (EARTH_RADIUS_KM, bbox_window, class_stats, downsample_priority, encode_png_palette,
                                       row_pixel_areas_km2, write_layers)

from .hazards_helpers import FLOOD_DIR, has_rasterio
from .test_hazards_import import make_sources

ML_DIR = Path(__file__).resolve().parents[1]
CLASSES = [c for c in WATER_REFERENCE['legend'] if c['key'] != 'unknown']


def transform(west, north, res):
    """The parts of an affine transform the helpers read (rasterio's Affine has the same names)."""
    return SimpleNamespace(a=res, b=0, c=west, d=0, e=-res, f=north)


def decode_png(data):
    """(width, height, palette rgba, indices) of an 8-bit palette PNG with filter 0 rows."""
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, chunks = 8, {}
    while pos < len(data):
        (n,) = struct.unpack('>I', data[pos:pos + 4])
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        (crc,) = struct.unpack('>I', data[pos + 8 + n:pos + 12 + n])
        assert crc == zlib.crc32(kind + body) & 0xFFFFFFFF, kind
        chunks.setdefault(kind, b'')
        chunks[kind] += body
        pos += 12 + n
    w, h, depth, ctype = struct.unpack('>IIBB', chunks[b'IHDR'][:10])
    assert (depth, ctype) == (8, 3)
    rgb = chunks[b'PLTE']
    alpha = chunks[b'tRNS']
    palette = [tuple(rgb[i * 3:i * 3 + 3]) + (alpha[i],) for i in range(len(rgb) // 3)]
    rows = np.frombuffer(zlib.decompress(chunks[b'IDAT']), dtype=np.uint8).reshape(h, w + 1)
    assert (rows[:, 0] == 0).all()
    return w, h, palette, rows[:, 1:]


class Helpers(unittest.TestCase):
    def test_downsample_keeps_any_water_then_any_land(self):
        a = np.array([
            [0, 0, 255, 255, 1],
            [0, 1, 255, 255, 0],
            [255, 255, 0, 255, 0],
        ], dtype=np.uint8)
        out = downsample_priority(a, 2, [1, 0], 255)
        # Blocks: water wins over land, land over unknown; padding is unknown.
        self.assertEqual(out.tolist(), [[1, 255, 1], [255, 0, 0]])
        self.assertEqual(downsample_priority(a, 1, [1, 0], 255).tolist(), a.tolist())

    def test_png_round_trip(self):
        idx = np.array([[0, 1, 2], [2, 1, 0]], dtype=np.uint8)
        palette = [(26, 92, 255, 204), (0, 0, 0, 0), (1, 2, 3, 4)]
        data = encode_png_palette(idx, palette)
        w, h, pal, got = decode_png(data)
        self.assertEqual((w, h), (3, 2))
        self.assertEqual(pal, palette)
        self.assertEqual(got.tolist(), idx.tolist())
        self.assertEqual(data, encode_png_palette(idx, palette), 'same pixels, same bytes')

    def test_pixel_area_shrinks_with_latitude(self):
        res = 0.25
        eq = row_pixel_areas_km2(transform(0, 0.5, res), 4)  # rows centred at 0.375 .. -0.375
        deg_km = math.radians(1) * EARTH_RADIUS_KM
        self.assertAlmostEqual(eq.sum() * 4 / (deg_km ** 2), 1.0, places=4)  # a 1 x 1 degree cell at the equator
        sixty = row_pixel_areas_km2(transform(0, 60 + res / 2, res), 1)[0]
        self.assertAlmostEqual(sixty / eq[0], math.cos(math.radians(60)) / math.cos(math.radians(0.375)), places=9)

    def test_class_stats(self):
        a = np.array([[1, 0, 255, 0], [1, 1, 0, 0]], dtype=np.uint8)
        t = transform(10, 1, 0.5)
        s = class_stats(a, t, CLASSES, 255)
        c = s['classes']
        self.assertEqual((c['water']['pixels'], c['not_water']['pixels'], c['unknown']['pixels']), (3, 4, 1))
        self.assertEqual(c['water']['pctOfKnown'], round(100 * 3 / 7, 3))
        self.assertEqual(s['unknownPct'], 12.5)
        areas = row_pixel_areas_km2(t, 2)
        self.assertAlmostEqual(c['water']['areaKm2'], round(areas[0] + 2 * areas[1], 2))
        self.assertAlmostEqual(s['totalAreaKm2'], round(4 * areas.sum(), 2))
        part = class_stats(a, t, CLASSES, 255, [0, 1, 0, 2])
        self.assertEqual(part['classes']['water']['pixels'], 1)
        self.assertEqual(part['pixels'], 2)

    def test_bbox_window_takes_pixels_centred_inside(self):
        t = transform(10, 20, 1)
        self.assertEqual(bbox_window(t, (10, 10), [12, 15, 14.6, 18]), [2, 5, 2, 5])
        self.assertEqual(bbox_window(t, (10, 10), [0, 0, 5, 5]), None)
        self.assertEqual(bbox_window(t, (10, 10), [0, 0, 50, 50]), [0, 10, 0, 10])

    def test_event_id_from_file_name(self):
        ids = ['07_india', '07_india_bihar_bhagalpur', '02_china_guangxi']
        self.assertEqual(layer_event_id('07_india_bihar_bhagalpur_water_reference.tif', ids), '07_india_bihar_bhagalpur')
        self.assertEqual(layer_event_id('02_china_guangxi_water_reference.tif', ids), '02_china_guangxi')
        self.assertIsNone(layer_event_id('02_china_water_reference.tif', ids))

    def test_merge_keeps_other_layers(self):
        with tempfile.TemporaryDirectory() as d:
            write_layers(d, 'flood', {'a': [{'id': 'depth', 'v': 1}, {'id': 'water-reference', 'v': 1}], 'b': [{'id': 'x'}]})
            m = write_layers(d, 'flood', {'a': [{'id': 'water-reference', 'v': 2}]})
            self.assertEqual(m['layers']['a'], [{'id': 'depth', 'v': 1}, {'id': 'water-reference', 'v': 2}])
            self.assertEqual(m['layers']['b'], [{'id': 'x'}])

    def test_run_import_needs_something_to_import(self):
        with self.assertRaises(DatasetError):
            run_import()
        with self.assertRaises(DatasetError):
            run_import(rainfall='x', layers='y')


@unittest.skipUnless(has_rasterio(), 'needs rasterio (requirements-hazards.txt)')
class ImportSynthetic(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        # A real (synthetic) import first: ev_a gets the bbox [74.1, 31.6,
        # 74.7, 32.2] of its rainfall grid, ev_b has no bbox.
        from forecaster.hazards.import_flood import import_flood

        rain, soil = make_sources(self.root / 'src')
        self.out = self.root / 'out'
        import_flood(rain, soil, self.out, None)
        self.src = self.root / 'tifs'
        self.src.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write_tif(self, name, arr, west=74.098, north=31.6035, res=0.0005, crs='EPSG:4326'):
        import rasterio
        from rasterio.transform import from_origin

        with rasterio.open(self.src / name, 'w', driver='GTiff', width=arr.shape[1], height=arr.shape[0], count=1, dtype='uint8',
                           crs=crs, transform=from_origin(west, north, res, res), nodata=255) as dst:
            dst.write(arr, 1)
            dst.set_band_description(1, 'water_label')

    def test_layer_png_bounds_and_stats(self):
        arr = np.zeros((7, 9), dtype=np.uint8)
        arr[1, 1:4] = 1
        arr[6, 8] = 255
        self.write_tif('ev_a_water_reference.tif', arr)
        self.write_tif('nobody_water_reference.tif', arr)
        res = import_flood_layers(self.src, self.out)
        self.assertEqual(res['warnings'], ['nobody_water_reference.tif: no event id matches the file name; skipped'])
        layers = json.loads((self.out / 'layers.json').read_text())
        self.assertEqual(list(layers['layers']), ['ev_a'])
        rec = layers['layers']['ev_a'][0]
        self.assertEqual(rec['id'], 'water-reference')
        self.assertEqual(rec['kind'], 'mask')
        self.assertEqual(rec['file'], 'events/ev_a/layers/water-reference.png')
        self.assertEqual(rec['extent'], [[31.6, 74.098], [31.6035, round(74.098 + 9 * 0.0005, 7)]])
        self.assertEqual(rec['bounds'], rec['extent'], 'small enough: no downsampling, no padding')
        self.assertEqual(rec['stats']['classes']['water']['pixels'], 3)
        self.assertEqual(rec['stats']['classes']['unknown']['pixels'], 1)
        self.assertEqual(rec['stats']['eventBox']['bbox'], [74.1, 31.6, 74.7, 32.2])
        # Pixel centres inside the box: every row, the 5 columns east of 74.1.
        self.assertEqual(rec['stats']['eventBox']['pixels'], 7 * 5)
        self.assertEqual(rec['stats']['eventBox']['classes']['water']['pixels'], 0, 'the water is in columns 1-3')
        self.assertEqual(rec['source']['file'], 'ev_a_water_reference.tif')
        self.assertEqual(rec['source']['band'], 'water_label')
        self.assertIsNone(rec['source']['origin'])
        data = (self.out / rec['file']).read_bytes()
        self.assertEqual(rec['image']['sha256'], hashlib.sha256(data).hexdigest())
        w, h, palette, idx = decode_png(data)
        self.assertEqual((w, h), (9, 7))
        rgba = np.array(palette)[idx]
        self.assertEqual(rgba[1, 1].tolist(), [26, 92, 255, 204])  # water: #1a5cff at 0.8
        self.assertEqual(rgba[0, 0, 3], 0)  # land: transparent
        self.assertEqual(rgba[6, 8, 3], 0)  # unknown: transparent
        readme = (self.out / 'README.md').read_text()
        self.assertIn('## Layers', readme)
        self.assertIn('`ev_a` | `water-reference`', readme)
        events = json.loads((self.out / 'events.json').read_text())
        self.assertNotIn('layers', events['events'][0], 'events.json is left alone')

    def test_downsampled_bounds_include_the_padding(self):
        arr = np.zeros((5, 7), dtype=np.uint8)
        arr[4, 6] = 1
        self.write_tif('ev_a_water_reference.tif', arr)
        from forecaster.hazards.layers import mask_layer

        rec = mask_layer(self.src / 'ev_a_water_reference.tif', self.out, 'ev_a', WATER_REFERENCE, max_size=3)
        self.assertEqual(rec['image']['downsample'], 3)
        self.assertEqual((rec['image']['width'], rec['image']['height']), (3, 2))
        (s, w), (n, e) = rec['bounds']
        self.assertAlmostEqual(e - w, 9 * 0.0005)
        self.assertAlmostEqual(n - s, 6 * 0.0005)
        _, _, palette, idx = decode_png((self.out / rec['file']).read_bytes())
        self.assertEqual(palette[idx[1, 2]][3], 204, 'one water pixel keeps its block water')

    def test_refuses_unknown_values_other_crs_and_empty_folders(self):
        self.write_tif('ev_a_water_reference.tif', np.full((3, 3), 7, dtype=np.uint8))
        with self.assertRaisesRegex(DatasetError, 'not all in the legend'):
            import_flood_layers(self.src, self.out)
        self.write_tif('ev_a_water_reference.tif', np.zeros((3, 3), dtype=np.uint8), west=500000, north=1500000, res=30, crs='EPSG:32647')
        with self.assertRaisesRegex(DatasetError, 'EPSG:4326'):
            import_flood_layers(self.src, self.out)
        with self.assertRaisesRegex(DatasetError, 'No \\*_water_reference.tif'):
            import_flood_layers(self.root, self.out)
        with self.assertRaisesRegex(DatasetError, 'not found'):
            import_flood_layers(self.root / 'nope', self.out)

    def test_cli_layers_only(self):
        self.write_tif('ev_b_water_reference.tif', np.ones((2, 2), dtype=np.uint8))
        res = subprocess.run([sys.executable, '-m', 'forecaster.hazards', 'import', 'flood', '--layers', str(self.src), '--out', str(self.out)],
                             cwd=ML_DIR, capture_output=True, text=True, timeout=120)
        self.assertEqual(res.returncode, 0, res.stderr[-2000:])
        out = json.loads(res.stdout)
        self.assertEqual(out['layers'][0]['event'], 'ev_b')
        self.assertEqual(out['layers'][0]['classes']['water'], json.loads((self.out / 'layers.json').read_text())
                         ['layers']['ev_b'][0]['stats']['classes']['water']['areaKm2'])
        self.assertNotIn('eventBox', json.loads((self.out / 'layers.json').read_text())['layers']['ev_b'][0]['stats'])
        bad = subprocess.run([sys.executable, '-m', 'forecaster.hazards', 'import', 'flood', '--out', str(self.out)],
                             cwd=ML_DIR, capture_output=True, text=True, timeout=120)
        self.assertEqual(bad.returncode, 2)
        self.assertIn('Nothing to import', json.loads(bad.stdout)['error']['message'])


class CommittedLayers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.layers = json.loads((FLOOD_DIR / 'layers.json').read_text())['layers']
        cls.events = {e['id']: e for e in json.loads((FLOOD_DIR / 'events.json').read_text())['events']}

    def test_the_three_test_events_have_their_reference_water(self):
        self.assertEqual(sorted(self.layers), ['02_china_guangxi', '07_india_bihar_bhagalpur', '09_thailand_bangkok'])
        for event_id, recs in self.layers.items():
            self.assertIn(event_id, self.events)
            self.assertEqual([r['id'] for r in recs], ['water-reference'])

    def test_images_match_their_records(self):
        for event_id, recs in self.layers.items():
            for r in recs:
                data = (FLOOD_DIR / r['file']).read_bytes()
                self.assertEqual(len(data), r['image']['bytes'])
                self.assertLess(len(data), 500 * 1024)
                self.assertEqual(hashlib.sha256(data).hexdigest(), r['image']['sha256'])
                w, h, _, _ = decode_png(data)
                self.assertEqual((w, h), (r['image']['width'], r['image']['height']))
                self.assertLessEqual(max(w, h), 2048)
                c = r['stats']['classes']
                self.assertEqual(c['water']['pixels'] + c['not_water']['pixels'] + c['unknown']['pixels'], r['stats']['pixels'])
                self.assertEqual(r['stats']['eventBox']['bbox'], self.events[event_id]['bbox'])

    @unittest.skipUnless(os.environ.get('FLOOD_LAYERS_DIR') and has_rasterio(),
                         'set FLOOD_LAYERS_DIR (folder with <event>_water_reference.tif) and install rasterio')
    def test_rebuild_from_the_tifs_gives_the_committed_layers(self):
        with tempfile.TemporaryDirectory() as d:
            shutil.copy(FLOOD_DIR / 'events.json', d)
            import_flood_layers(os.environ['FLOOD_LAYERS_DIR'], d)
            got = json.loads((Path(d) / 'layers.json').read_text())['layers']
            self.assertEqual(got, self.layers)
            for recs in got.values():
                for r in recs:
                    self.assertEqual((Path(d) / r['file']).read_bytes(), (FLOOD_DIR / r['file']).read_bytes())


if __name__ == '__main__':
    unittest.main()
