"""The flood import (forecaster/hazards/import_flood.py) on a small synthetic
source tree, and consistency checks of the committed dataset in
server/data/hazards/flood.

With FLOOD_SOURCE_DIR set to a folder holding the team's `rainfall/` and
`soil_moisture/` folders, the committed dataset is also re-imported from them
and compared file by file:

    FLOOD_SOURCE_DIR=/path/to/flood .venv-hazards/bin/python -m unittest -v tests.test_hazards_import
"""

import csv
import json
import os
import tempfile
import unittest
from pathlib import Path

from forecaster.hazards.dataset import DatasetError
from forecaster.hazards.import_flood import import_flood

from .hazards_helpers import FLOOD_DIR, NOTEBOOK_EVENTS, has_rasterio

RAIN_README = """# Rainfall for the events

## Things to know

- **Days are UTC days** (00:00 to 24:00 UTC), not local days.
- **The rain is a satellite estimate.**
  - Not corrected with rain gauges.

## Source

Huffman, G.J. (2024). *GPM IMERG Late* V07. doi:10.5067/GPM/IMERGDL/DAY/07.

The files were made with a script.
"""

EVENT_README = """# Rainfall: River floods ({eid})

Daily rainfall.

## Things to know

- **Days are UTC days** (00:00-24:00 UTC), as in the IMERG files.
{extra}
## Source

Huffman.
"""


def write_csv(path, header, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        w.writerows(rows)


def read_csv(path):
    with open(path, newline='') as f:
        return list(csv.reader(f))


def make_sources(root, with_grid=True):
    rain, soil = Path(root) / 'rainfall', Path(root) / 'soil_moisture'
    rain.mkdir(parents=True)
    soil.mkdir(parents=True)
    (rain / 'README.md').write_text(RAIN_README)
    (soil / 'README.md').write_text('# Soil\n\n## Source\n\nNISAR L3 SME2. doi:10.5067/NIL3SME2-P1.\n')
    write_csv(rain / 'rainfall_summary.csv',
              ['event', 'window_start', 'flood_start', 'flood_end', 'reported_flood_period', 'rain_7_days_before_mm',
               'rain_during_flood_period_mm', 'wettest_day_utc', 'wettest_day_box_mean_mm', 'wettest_cell_any_day_mm', 'imerg_cells'],
              [['ev_a', '2026-07-01', '2026-07-03', '2026-07-04', '3-4 Jul', '1.5', '20.0', '2026-07-03', '12.0', '30.5', '30']])
    write_csv(soil / 'soil_moisture_summary.csv',
              ['event', 'window_start', 'flood_start', 'flood_end', 'passes', 'passes_before_flood_period', 'passes_in_flood_period',
               'mean_sm_before_flood_period', 'mean_sm_in_flood_period', 'mean_coverage_pct'],
              [['ev_a', '2026-06-21', '2026-07-03', '2026-07-04', '3', '2', '1', '0.25', '0.3', '60.0']])
    write_csv(rain / 'ev_a' / 'rainfall_daily.csv', ['date_utc', 'box_mean_mm', 'wettest_cell_mm', 'cells_with_data', 'in_flood_period'],
              [['2026-07-01', '0.10', '1.5', '30', 'False'], ['2026-07-02', '1.25', '3', '30', 'False'],
               ['2026-07-03', '12.0', '30.50', '29', 'True'], ['2026-07-04', '6.1', '10.2', '30', 'True']])
    (rain / 'ev_a' / 'README.md').write_text(EVENT_README.format(eid='ev_a', extra=(
        '- **River flood:** this flood was driven by the river, so much of the water came from rain **upstream**,\n'
        '  outside this box.\n')))
    write_csv(soil / 'ev_a' / 'soil_moisture_passes.csv',
              ['file', 'date_utc', 'track', 'coverage_pct', 'mean_sm', 'mean_sm_recommended_only', 'mean_uncertainty', 'in_reported_flood_period'],
              # Same-day passes stay in the source's order.
              [['p1.tif', '2026-06-25', '11', '50.0', '0.2500', '0.2400', '0.04', 'False'],
               ['p3.tif', '2026-07-02', '4', '70.0', '0.3', '', '0.05', 'False'],
               ['p2.tif', '2026-07-02', '11', '60.0', '0.31', '0.30', '0.05', 'False']])
    # ev_b: rainfall only, no grid; its README has only the note every event shares
    (rain / 'ev_b').mkdir()
    (rain / 'ev_b' / 'README.md').write_text(EVENT_README.format(eid='ev_b', extra=''))
    write_csv(rain / 'ev_b' / 'rainfall_daily.csv', ['date_utc', 'box_mean_mm', 'wettest_cell_mm', 'cells_with_data', 'in_flood_period'],
              [['2026-08-02', '1', '2', '4', 'False'], ['2026-08-01', '0', '0', '4', 'False']])
    if with_grid:
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin

        # float32 edges like the real grids: 74.0999984741211 -> 74.1
        west = float(np.float32(74.1))
        with rasterio.open(rain / 'ev_a' / 'rainfall_daily_grid.tif', 'w', driver='GTiff', width=6, height=6, count=4,
                           dtype='float32', crs='EPSG:4326', transform=from_origin(west, 32.2, 0.1, 0.1)) as dst:
            for i, d in enumerate(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'], start=1):
                dst.write(np.ones((6, 6), dtype='float32'), i)
                dst.set_band_description(i, f'{d} rain mm/day (UTC day)')
    return rain, soil


class ImportSynthetic(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.meta = self.root / 'meta.json'
        self.meta.write_text(json.dumps({'events': {'ev_a': {'country': {'code': 'PK', 'name': 'Pakistan'}, 'admin': 'Punjab',
                                                              'place': 'Muridke', 'cause': 'River flood', 'rainDriven': True}}}))

    def tearDown(self):
        self.tmp.cleanup()

    def run_import(self, with_grid):
        rain, soil = make_sources(self.root / 'src', with_grid=with_grid)
        out = self.root / 'out'
        return import_flood(rain, soil, out, self.meta), out

    def test_daily_values_are_copied_as_written(self):
        _, out = self.run_import(with_grid=False)
        rows = read_csv(out / 'events' / 'ev_a' / 'daily.csv')
        self.assertEqual(rows[0], ['date', 'rain_box_mm', 'rain_wettest_cell_mm', 'cells_with_data', 'in_flood_period'])
        self.assertEqual(rows[1], ['2026-07-01', '0.10', '1.5', '30', 'false'])  # "0.10" stays "0.10"
        self.assertEqual(rows[3], ['2026-07-03', '12.0', '30.50', '29', 'true'])
        # Sorted by date
        self.assertEqual([r[0] for r in read_csv(out / 'events' / 'ev_b' / 'daily.csv')[1:]], ['2026-08-01', '2026-08-02'])

    def test_soil_passes_keep_every_column_and_the_source_order(self):
        _, out = self.run_import(with_grid=False)
        rows = read_csv(out / 'events' / 'ev_a' / 'soil_passes.csv')
        self.assertEqual(rows[0], ['file', 'date', 'track', 'coverage_pct', 'mean_sm', 'mean_sm_recommended_only',
                                   'mean_uncertainty', 'in_reported_flood_period'])
        self.assertEqual([r[0] for r in rows[1:]], ['p1.tif', 'p3.tif', 'p2.tif'])
        self.assertEqual(rows[1][4:], ['0.2500', '0.2400', '0.04', 'false'])
        self.assertEqual(rows[2][5], '')  # no recommended value stays empty

    def test_events_manifest(self):
        m, out = self.run_import(with_grid=False)
        self.assertEqual(json.loads((out / 'events.json').read_text()), m)
        self.assertEqual(m['hazard'], 'flood')
        self.assertEqual(m['interval'], 'daily')
        self.assertEqual(set(m['tables']), {'daily', 'soil_passes'})
        self.assertEqual(m['tables']['soil_passes']['kind'], 'observations')
        self.assertEqual([e['id'] for e in m['events']], ['ev_a', 'ev_b'])
        a, b = m['events']
        self.assertEqual(a['name'], 'River floods (ev_a)')
        self.assertEqual(a['country'], {'code': 'PK', 'name': 'Pakistan'})
        self.assertEqual((a['admin'], a['place'], a['cause'], a['rainDriven']), ('Punjab', 'Muridke', 'River flood', True))
        self.assertEqual(a['period'], {'reported': '3-4 Jul', 'start': '2026-07-03', 'end': '2026-07-04',
                                       'windowStart': '2026-07-01', 'windowEnd': '2026-07-04', 'soilWindowStart': '2026-06-21'})
        self.assertEqual(a['coverage'], {'days': 4, 'from': '2026-07-01', 'to': '2026-07-04', 'floodDays': 2, 'soilPasses': 3,
                                         'soilPassesRecommended': 2, 'soilFrom': '2026-06-25', 'soilTo': '2026-07-02'})
        self.assertEqual(a['summary']['rain7DaysBeforeMm'], 1.5)
        self.assertEqual(a['summary']['imergCells'], 30)
        self.assertEqual(a['files'], {'daily': 'events/ev_a/daily.csv', 'soil_passes': 'events/ev_a/soil_passes.csv'})
        # A note every event README repeats belongs to the dataset; the rest to the event.
        self.assertEqual(a['notes'], ['River flood: this flood was driven by the river, so much of the water came from rain '
                                      'upstream, outside this box.'])
        self.assertIn('The rain is a satellite estimate: Not corrected with rain gauges.', m['notes'])
        self.assertEqual(m['datasets'][0]['citation'],
                         'Huffman, G.J. (2024). GPM IMERG Late V07. doi:10.5067/GPM/IMERGDL/DAY/07.')
        # Unknown to the curated meta file: imported anyway, facts left null.
        self.assertIsNone(b['country'])
        self.assertIsNone(b['bbox'])
        self.assertEqual(b['files'], {'daily': 'events/ev_b/daily.csv'})
        self.assertIn('no rainfall_daily_grid.tif, so no bbox', b['warnings'])
        self.assertTrue((out / 'README.md').read_text().startswith('# Flood events dataset'))

    @unittest.skipUnless(has_rasterio(), 'rasterio not installed (requirements-hazards.txt)')
    def test_bbox_from_the_rainfall_grid(self):
        m, _ = self.run_import(with_grid=True)
        a = m['events'][0]
        self.assertEqual(a['bbox'], [74.1, 31.6, 74.7, 32.2])
        self.assertEqual(a['center'], {'lat': 31.9, 'lon': 74.4})
        self.assertEqual(a['warnings'], [])

    def test_bad_sources_are_refused(self):
        rain, soil = make_sources(self.root / 'src', with_grid=False)
        with self.assertRaises(DatasetError):
            import_flood(self.root / 'nope', soil, self.root / 'out', self.meta)
        with open(rain / 'ev_b' / 'rainfall_daily.csv', 'a') as f:
            f.write('2026-08-01,1,1,4,False\n')
        with self.assertRaisesRegex(DatasetError, 'duplicate date'):
            import_flood(rain, soil, self.root / 'out', self.meta)
        with open(rain / 'ev_b' / 'rainfall_daily.csv', 'w') as f:
            f.write('date_utc,box_mean_mm,wettest_cell_mm,cells_with_data,in_flood_period\n2026-08-01,x,1,4,False\n')
        with self.assertRaisesRegex(DatasetError, 'not a number'):
            import_flood(rain, soil, self.root / 'out', self.meta)


class CommittedDataset(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads((FLOOD_DIR / 'events.json').read_text())

    def test_every_event_of_the_notebook_is_there(self):
        self.assertEqual([e['id'] for e in self.m['events']], NOTEBOOK_EVENTS)
        nepal = next(e for e in self.m['events'] if e['id'] == '05_nepal_trishuli')
        self.assertFalse(nepal['rainDriven'])  # kept as data; the model leaves it out

    def test_files_match_the_manifest(self):
        for e in self.m['events']:
            daily = read_csv(FLOOD_DIR / e['files']['daily'])
            self.assertEqual(daily[0], ['date', 'rain_box_mm', 'rain_wettest_cell_mm', 'cells_with_data', 'in_flood_period'])
            self.assertEqual(len(daily) - 1, e['coverage']['days'], e['id'])
            self.assertEqual(sum(r[4] == 'true' for r in daily[1:]), e['coverage']['floodDays'])
            passes = read_csv(FLOOD_DIR / e['files']['soil_passes'])
            self.assertEqual(len(passes) - 1, e['coverage']['soilPasses'], e['id'])
            w, s, ea, n = e['bbox']
            self.assertTrue(-180 <= w < ea <= 180 and -90 <= s < n <= 90, e['id'])
            self.assertEqual(e['warnings'], [])

    @unittest.skipUnless(os.environ.get('FLOOD_SOURCE_DIR') and has_rasterio(),
                         'set FLOOD_SOURCE_DIR (folder with rainfall/ and soil_moisture/) and install rasterio')
    def test_reimport_from_the_sources_gives_the_committed_files(self):
        src = Path(os.environ['FLOOD_SOURCE_DIR'])
        with tempfile.TemporaryDirectory() as d:
            m = import_flood(src / 'rainfall', src / 'soil_moisture', d)
            for e in m['events']:
                for rel in e['files'].values():
                    self.assertEqual((Path(d) / rel).read_bytes(), (FLOOD_DIR / rel).read_bytes(), rel)
            committed = dict(self.m)
            for x in (m, committed):
                x.pop('generated')
            self.assertEqual(json.loads(json.dumps(m)), committed)


if __name__ == '__main__':
    unittest.main()
