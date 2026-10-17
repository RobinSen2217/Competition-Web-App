"""Everything in forecaster.gee that runs without Earth Engine: areas and the
AOI box, the chunk/retry rules, the table merges, credentials handling, CLI."""

import datetime as dt
import json
import math
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

from forecaster import features
from forecaster.gee import aggregate, auth, tables
from forecaster.gee.areas import AREAS_FILE, AreaError, aoi_bounds, district_name, find_area, load_areas

from .helpers import ML_DIR, run_cli

# Notebook cell 9 output for Jaisalmer (ee.Geometry.Rectangle(...).bounds()).
JAISALMER_BBOX = [[70.91991491010725, 26.902729282670403], [70.94006308989276, 26.920817074859226]]


class AreasAndBox(unittest.TestCase):
    def test_jaisalmer_box_matches_notebook(self):
        w, s, e, n = aoi_bounds(26.911773, 70.929989, 1)
        (w0, s0), (e0, n0) = JAISALMER_BBOX
        for got, want in ((w, w0), (s, s0), (e, e0)):
            self.assertAlmostEqual(got, want, places=12)
        # Without a projection ee.Geometry.Rectangle has geodesic edges, so the
        # top edge (a great circle) bulges north and bounds() reports its apex:
        # tan(lat_max) = tan(north) / cos(width / 2). Same corners, same box.
        apex = math.degrees(math.atan(math.tan(math.radians(n)) / math.cos(math.radians(e - w) / 2)))
        self.assertAlmostEqual(apex, n0, places=12)
        self.assertAlmostEqual(n, n0, places=6)
        self.assertEqual(district_name(26.911773, 70.929989), 'aoi_26p9118_70p9300')

    def test_areas_file(self):
        areas = load_areas()
        self.assertEqual([a['id'] for a in areas], ['jaipur', 'jodhpur', 'jaisalmer', 'bikaner', 'udaipur', 'delhi'])
        self.assertTrue(all(a['halfWidthKm'] == 1 for a in areas))
        j = find_area('jaisalmer')
        self.assertEqual((j['lat'], j['lon']), (26.911773, 70.929989))  # the notebook's centre

    def test_unknown_and_bad_areas(self):
        with self.assertRaises(AreaError):
            find_area('mumbai')
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'areas.json'
            for bad in ([{'id': 'Bad Id', 'lat': 1, 'lon': 1, 'halfWidthKm': 1}],
                        [{'id': 'x', 'lat': 91, 'lon': 1, 'halfWidthKm': 1}],
                        [{'id': 'x', 'lat': 1, 'lon': 1, 'halfWidthKm': 500}],
                        [{'id': 'x', 'lat': 1, 'lon': 1, 'halfWidthKm': 1}] * 2, {}):
                p.write_text(json.dumps(bad))
                with self.assertRaises(AreaError, msg=bad):
                    load_areas(p)


class ChunksAndRetries(unittest.TestCase):
    def test_chunks_match_notebook_printout(self):
        # 2010-01-01 .. 2026-09-01 is 200 months; cell 39 printed 34 chunks,
        # the last "2026-07-01 to 2026-09-01".
        chunks = aggregate.chunk_offsets(200, 6)
        self.assertEqual(len(chunks), 34)
        self.assertEqual(chunks[0], (0, 6))
        self.assertEqual(chunks[-1], (198, 200))

        def month(offset):
            return dt.date(2010 + offset // 12, offset % 12 + 1, 1).isoformat()
        self.assertEqual((month(chunks[-1][0]), month(chunks[-1][1])), ('2026-07-01', '2026-09-01'))

    def test_retries_only_the_concurrency_limit(self):
        sleeps = []
        calls = iter([RuntimeError('Too many concurrent aggregations.'), RuntimeError('Too many concurrent aggregations.'), 'ok'])

        def fn():
            v = next(calls)
            if isinstance(v, Exception):
                raise v
            return v
        self.assertEqual(aggregate.with_retries(fn, 3, sleeps.append), 'ok')
        self.assertEqual(sleeps, [5, 10])

        def other():
            raise RuntimeError('User memory limit exceeded.')
        with self.assertRaises(RuntimeError):
            aggregate.with_retries(other, 3, sleeps.append)

        def always():
            raise RuntimeError('Too many concurrent aggregations.')
        sleeps.clear()
        with self.assertRaises(RuntimeError):
            aggregate.with_retries(always, 3, sleeps.append)
        self.assertEqual(sleeps, [5, 10])

    def test_records_to_frame_sorts_by_date(self):
        result = {'features': [
            {'properties': {'date': '2010-02-01', 'Albedo': 0.24}},
            {'properties': {'date': '2010-01-01', 'Albedo': 0.22}},
            {'properties': {'date': '2010-03-01'}},   # no pixels that month: band left out
        ]}
        df = aggregate.records_to_frame(result)
        self.assertEqual(df['date'].tolist(), ['2010-01-01', '2010-02-01', '2010-03-01'])
        self.assertTrue(np.isnan(df['Albedo'].iloc[2]))


def month_frame(dates, **cols):
    return pd.DataFrame({'date': dates, **cols})


class Merges(unittest.TestCase):
    D = ['2010-01-01', '2010-02-01', '2010-03-01']

    def satellite(self, statics=None):
        d = self.D
        return tables.merge_satellite(
            month_frame(d, Emissivity_31=[0.9712] * 3, Emissivity_32=[0.9759] * 3, LST_Day_C=[25.0, 30.0, 40.0],
                        LST_Night_C=[10.0, 14.0, 23.0]),
            month_frame(list(reversed(d)), Albedo=[0.25, 0.24, 0.23]),
            month_frame(d, NDVI=[0.12, np.nan, 0.11], NDWI=[-0.2, np.nan, -0.21]),
            month_frame(d, AirTemp_C=[17.0, 20.0, 29.0], Precip_mm=[1.0, 2.0, 0.0], Dewpoint_C=[7.0, 2.0, 5.0],
                        WindSpeed_ms=[1.6, 0.3, 1.7], Rs_down_Jm2=[5.0e8, 5.4e8, 7.2e8]),
            # The aerosol table has dates only (no Sentinel-5P before 2018).
            pd.DataFrame({'date': d}),
            statics or {'landcover_mode': 49.99999999999985, 'soil_texture_mode': 6,
                        'population_total': 2875.643088200513, 'population_density_mean': 6.371052134209671})

    def test_final_table_layout(self):
        sat = self.satellite()
        self.assertEqual(sat['Albedo'].tolist(), [0.23, 0.24, 0.25])   # aligned by date
        v5 = tables.merge_v5(
            sat, month_frame(self.D, Soil_Moisture_Subsurface_mm=[np.nan] * 3, Soil_Moisture_Surface_mm=[np.nan] * 3),
            month_frame(self.D, Urban_Fraction=[np.nan] * 3, Vegetation_Fraction=[np.nan] * 3),
            month_frame(self.D, PDSI=[-1.953714, -1.698714, -1.841]))
        self.assertEqual(tables.missing_columns(v5), ['UV_Aerosol_Index'])
        final = tables.final_table(v5)
        self.assertEqual(list(final.columns), features.FINAL_COLUMNS)
        self.assertEqual(final.shape, (3, 33))
        self.assertEqual(final['date'].tolist(), self.D)
        self.assertTrue(final['UV_Aerosol_Index'].isna().all())
        self.assertEqual(final['soil_texture_mode'].tolist(), [6, 6, 6])
        self.assertAlmostEqual(final['Rs_down_Wm2'].iloc[0], 5.0e8 / (31 * 86400))
        self.assertAlmostEqual(final['Rs_down_Wm2'].iloc[1], 5.4e8 / (28 * 86400))

    def test_null_statics_and_mixed_date_formats(self):
        sat = self.satellite({'landcover_mode': None, 'soil_texture_mode': None,
                              'population_total': None, 'population_density_mean': None})
        pdsi = month_frame(pd.to_datetime(self.D), PDSI=[-1.0, -1.1, -1.2])   # datetimes, not strings
        v5 = tables.merge_v5(sat, month_frame(self.D, Soil_Moisture_Subsurface_mm=[1.0] * 3,
                                              Soil_Moisture_Surface_mm=[1.0] * 3),
                             month_frame(self.D, Urban_Fraction=[0.1] * 3, Vegetation_Fraction=[0.2] * 3), pdsi)
        final = tables.final_table(v5)
        self.assertEqual(len(final), 3)
        self.assertEqual(final['PDSI'].tolist(), [-1.0, -1.1, -1.2])
        self.assertTrue(final['landcover_mode'].isna().all())


class FakeEE:
    def __init__(self, fail=None):
        self.calls, self.fail = [], fail

    def ServiceAccountCredentials(self, email, key_file):
        self.calls.append(('creds', email, key_file))
        return 'CREDS'

    def Initialize(self, credentials=None, project=None):
        self.calls.append(('init', credentials, project))
        if self.fail:
            raise Exception(self.fail)


class Credentials(unittest.TestCase):
    def test_defaults(self):
        self.assertEqual(auth.settings({}), ('miicproject2', None))
        self.assertEqual(auth.settings({'GEE_PROJECT': 'other', 'GEE_SERVICE_ACCOUNT_KEY': ' k.json '}),
                         ('other', 'k.json'))

    def test_service_account_key(self):
        with tempfile.TemporaryDirectory() as d:
            key = Path(d) / 'key.json'
            key.write_text(json.dumps({'type': 'service_account', 'client_email': 'web-app-gee@x.iam.gserviceaccount.com'}))
            fake = FakeEE()
            project, how = auth.initialize({'GEE_SERVICE_ACCOUNT_KEY': str(key)}, fake)
            self.assertEqual(project, 'miicproject2')
            self.assertIn('web-app-gee@', how)
            self.assertEqual(fake.calls, [('creds', 'web-app-gee@x.iam.gserviceaccount.com', str(key)),
                                          ('init', 'CREDS', 'miicproject2')])

    def test_stored_user_credentials(self):
        fake = FakeEE()
        auth.initialize({'GEE_PROJECT': 'p2'}, fake)
        self.assertEqual(fake.calls, [('init', None, 'p2')])

    def test_credentials_from_env_var(self):
        # GEE_CREDENTIALS = contents of ~/.config/earthengine/credentials (personal login)
        import types
        calls = []

        class EnvEE:
            oauth = types.SimpleNamespace(TOKEN_URI='https://oauth2.googleapis.com/token', CLIENT_ID='cid',
                                          CLIENT_SECRET='secret', SCOPES=['https://www.googleapis.com/auth/earthengine'])

            @staticmethod
            def Initialize(credentials=None, project=None):
                calls.append((credentials.refresh_token, credentials.client_id, project))

        project, how = auth.initialize({'GEE_CREDENTIALS': json.dumps({'refresh_token': 'tok'}), 'GEE_PROJECT': 'p3'}, EnvEE)
        self.assertEqual((project, how), ('p3', 'GEE_CREDENTIALS (personal login)'))
        self.assertEqual(calls, [('tok', 'cid', 'p3')])
        # a key file still wins over the env login
        self.assertEqual(auth.settings({'GEE_SERVICE_ACCOUNT_KEY': 'k.json', 'GEE_CREDENTIALS': '{}'})[1], 'k.json')
        for bad, needle in (('{oops', 'not valid JSON'), ('{"client_id": "x"}', 'refresh_token')):
            with self.subTest(bad=bad), self.assertRaises(auth.CredentialsError) as ctx:
                auth.initialize({'GEE_CREDENTIALS': bad}, EnvEE)
            self.assertIn(needle, str(ctx.exception))

    def test_errors_explain_the_setup(self):
        with self.assertRaises(auth.CredentialsError) as ctx:
            auth.initialize({'GEE_SERVICE_ACCOUNT_KEY': '/nope/key.json'}, FakeEE())
        self.assertIn('/nope/key.json', str(ctx.exception))
        self.assertIn('earthengine authenticate', str(ctx.exception))
        with tempfile.TemporaryDirectory() as d:
            key = Path(d) / 'key.json'
            key.write_text('{"installed": {}}')
            with self.assertRaises(auth.CredentialsError) as ctx:
                auth.initialize({'GEE_SERVICE_ACCOUNT_KEY': str(key)}, FakeEE())
            self.assertIn('client_email', str(ctx.exception))
        with self.assertRaises(auth.CredentialsError) as ctx:
            auth.initialize({}, FakeEE(fail='Please authorize access to your Earth Engine account'))
        self.assertIn('GEE_SERVICE_ACCOUNT_KEY', str(ctx.exception))


class Cli(unittest.TestCase):
    def env(self, **extra):
        return {**os.environ, 'GEE_SERVICE_ACCOUNT_KEY': '/nonexistent/key.json', **extra}

    def test_unknown_area_is_invalid(self):
        code, body, _ = run_cli(None, 'forecaster.gee', ['extract', '--area', 'mumbai'], env=self.env())
        self.assertEqual(code, 2)
        self.assertIn('mumbai', body['error']['message'])

    def test_bad_arguments_are_invalid(self):
        for args in (['extract'], ['extract', '--area', 'jaipur', '--all'],
                     ['extract', '--area', 'jaipur', '--end', '2026-13-01'], ['frobnicate']):
            with self.subTest(args=args):
                code, body, _ = run_cli(None, 'forecaster.gee', args, env=self.env())
                self.assertEqual(code, 2)
                self.assertEqual(body['error']['code'], 'invalid_input')

    def test_missing_credentials_fail_with_help(self):
        for args in (['extract', '--area', 'jaisalmer'], ['check']):
            with self.subTest(args=args):
                code, body, _ = run_cli(None, 'forecaster.gee', args, env=self.env())
                self.assertEqual(code, 1)
                self.assertEqual(body['error']['code'], 'credentials')
                self.assertIn('README', body['error']['message'])


class _Chain:
    """Stands in for the whole `ee` module: every call returns itself, ids are
    recorded, and getInfo() answers the static reductions of cells 30-31."""

    def __init__(self):
        self.ids = []

    def __call__(self, *args, **kwargs):
        self.ids += [a for a in args if isinstance(a, str) and '/' in a]
        return self

    def __getattr__(self, name):
        if name == 'getInfo':
            return lambda: {'Map': 49.99999999999985, 'b0': 6, 'population': 2875.643088200513}
        return self


class ExtractionWiring(unittest.TestCase):
    """extract_area end to end with Earth Engine replaced: checks every dataset,
    band list and scale against the notebook, and the table that comes out."""

    def test_datasets_bands_and_scales(self):
        from forecaster.gee import DATASETS, extract

        calls = []
        dates = ['2010-01-01', '2010-02-01', '2010-03-01']

        def fake_monthly(collection, geometry, start, end, bands, reducer, scale, **kw):
            calls.append((tuple(bands), scale, kw.get('chunk_months')))
            return pd.DataFrame({'date': dates, **{b: [1.0, 2.0, 3.0] for b in bands}})

        chain = _Chain()
        with mock.patch.object(extract, 'ee', chain), \
                mock.patch.object(extract, 'aggregate_monthly', fake_monthly), \
                mock.patch.object(extract, 'aggregate_monthly_chunked', fake_monthly):
            ex = extract.extract_area(find_area('jaisalmer'), end_date='2010-04-01', sleep=lambda s: None)

        self.assertEqual(calls, [
            (('LST_Day_C', 'LST_Night_C', 'Emissivity_31', 'Emissivity_32'), 1000, None),
            (('Albedo',), 500, None),
            (('UV_Aerosol_Index',), 1000, None),
            (('NDVI', 'NDWI'), 30, None),
            (('AirTemp_C', 'Precip_mm', 'Dewpoint_C', 'WindSpeed_ms', 'Rs_down_Jm2'), 9000, None),
            (('Soil_Moisture_Surface_mm', 'Soil_Moisture_Subsurface_mm'), 10000, None),
            (('Urban_Fraction', 'Vegetation_Fraction'), 100, 6),
            (('PDSI',), 4000, None),
        ])
        self.assertEqual(sorted(set(chain.ids)), sorted(DATASETS))
        self.assertEqual(ex.statics['soil_texture_mode'], 6)
        self.assertEqual(ex.final.shape, (3, 33))
        self.assertEqual(list(ex.final.columns), features.FINAL_COLUMNS)
        self.assertAlmostEqual(ex.final['population_total'].iloc[0], 2875.643088200513)

        with tempfile.TemporaryDirectory() as d:
            path = extract.write_csv(ex.final, Path(d) / 'sub' / 'jaisalmer.features.csv')
            back = pd.read_csv(path)
            self.assertEqual(list(back.columns), features.FINAL_COLUMNS)
            self.assertEqual(back['date'].tolist(), dates)
            self.assertEqual([p.name for p in path.parent.iterdir()], ['jaisalmer.features.csv'])

    def test_default_end_date_is_first_of_month(self):
        from forecaster.gee.extract import default_end_date
        self.assertEqual(default_end_date(dt.date(2026, 10, 17)), '2026-10-01')


class BuildRequestTool(unittest.TestCase):
    def test_builds_v2_request_from_csv(self):
        from forecaster.contract import parse_request

        from .helpers import build_request, synthetic_table
        with tempfile.TemporaryDirectory() as d:
            table = synthetic_table(36)
            path = Path(d) / 'jaisalmer.features.csv'
            table.to_csv(path, index=False)
            req = build_request('jaisalmer', csv_path=path)
        self.assertEqual(req['columns'], features.FINAL_COLUMNS)
        self.assertEqual(len(req['rows']), 36)
        self.assertEqual(req['rows'][0][4], '2010-01-01')
        self.assertIsNone(req['rows'][0][req['columns'].index('UV_Aerosol_Index')])
        self.assertEqual(req['area']['halfWidthKm'], 1)
        self.assertEqual(req['area']['center'], {'lat': 26.911773, 'lon': 70.929989})
        parse_request(req)

    def test_areas_file_is_the_servers(self):
        self.assertEqual(AREAS_FILE, ML_DIR.parent / 'data' / 'gee' / 'areas.json')


if __name__ == '__main__':
    unittest.main()
