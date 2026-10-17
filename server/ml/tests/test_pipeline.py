import datetime as dt
import json
import math
import unittest

import numpy as np

from forecaster.contract import InvalidInput, parse_request
from forecaster.gee import DATASETS
from forecaster.pipeline import HINDCAST_MONTHS, MODEL_VERSION, run

from .helpers import run_cli, synthetic_request, synthetic_table
from .notebook_cell54 import run_cell54

NOW = dt.datetime(2026, 10, 17, 12, 0, tzinfo=dt.timezone.utc)
NAMES = {'ridge': 'Ridge', 'nn': 'NN', 'gbm': 'GBM'}  # contract name -> notebook name


def finite(values):
    return all(isinstance(v, float) and math.isfinite(v) for v in values)


class MatchesNotebookCell54(unittest.TestCase):
    """The pipeline against the notebook's own code on the same table."""

    @classmethod
    def setUpClass(cls):
        table = synthetic_table(150)
        # A gap in NDVI (as when Landsat has no clear view) and drivers ending
        # early, so dropna matters as it does on real data.
        table.loc[40, 'NDVI'] = np.nan
        table.loc[len(table) - 2:, 'Rs_down_Wm2'] = np.nan
        cls.table = table
        cls.out = run(parse_request(synthetic_request(table=table)), now=NOW)
        cls.ref = run_cell54(table)

    def test_split_matches(self):
        ref, d = self.ref, self.ref['dates']
        for m in self.out['models'].values():
            self.assertEqual(m['metrics']['train']['n'], ref['n_tr'])
            self.assertEqual(m['metrics']['test']['n'], ref['n_te'])
            self.assertEqual(m['metrics']['train']['from'], d.iloc[0].strftime('%Y-%m'))
            self.assertEqual(m['metrics']['train']['to'], d.iloc[ref['n_tr'] - 1].strftime('%Y-%m'))
            self.assertEqual(m['metrics']['test']['from'], d.iloc[ref['n_tr']].strftime('%Y-%m'))
            self.assertEqual(m['metrics']['test']['to'], d.iloc[-1].strftime('%Y-%m'))

    def test_metrics_match(self):
        met = self.ref['metrics'].set_index(['Model', 'Split'])
        for name, m in self.out['models'].items():
            for split in ('Train', 'Test'):
                with self.subTest(model=name, split=split):
                    got = m['metrics'][split.lower()]
                    self.assertAlmostEqual(got['r2'], met.loc[(NAMES[name], split), 'R2'], places=4)
                    self.assertAlmostEqual(got['rmse'], met.loc[(NAMES[name], split), 'RMSE'], places=5)

    def test_importance_matches(self):
        for name, m in self.out['models'].items():
            ref = self.ref['importance'][NAMES[name]]
            for e in m['importance']:
                self.assertAlmostEqual(e['value'], ref[e['feature']], places=4)

    def test_forecast_matches(self):
        self.assertEqual(self.out['forecastTimes'], [t.strftime('%Y-%m') for t in self.ref['forecast_dates']])
        for name, m in self.out['models'].items():
            np.testing.assert_allclose(m['forecast'], self.ref['forecast'][NAMES[name]], atol=6e-6)

    def test_hindcast_matches(self):
        held = self.ref['held']
        for name, m in self.out['models'].items():
            hc = m['hindcast']
            self.assertEqual(hc['times'], [t.strftime('%Y-%m') for t in self.ref['hindcast_dates']])
            np.testing.assert_allclose(hc['predicted'], self.ref['hindcast'][NAMES[name]], atol=6e-6)
            np.testing.assert_allclose(hc['observed'], held['NDVI'].values, atol=6e-6)


class ForecastWindow(unittest.TestCase):
    def test_forecast_starts_after_last_complete_row(self):
        # ERA5 drivers end 3 months before NDVI does: the notebook drops those
        # rows, so the forecast starts right after the last complete month.
        table = synthetic_table(120)
        table.loc[len(table) - 3:, 'Rs_down_Wm2'] = np.nan
        out = run(parse_request(synthetic_request(table=table, models=['ridge'])), now=NOW)
        last_complete = table['date'].iloc[-4][:7]
        self.assertEqual(out['issued'], last_complete)
        self.assertEqual(out['forecastTimes'][0], table['date'].iloc[-3][:7])
        self.assertEqual(out['dataUntil']['Rs_down_Wm2'], last_complete)
        self.assertEqual(out['dataUntil']['NDVI'], table['date'].iloc[-1][:7])
        self.assertEqual(out['models']['ridge']['metrics']['test']['to'], last_complete)
        # history still shows every observed NDVI, including after `issued`.
        self.assertEqual(out['history']['times'][-1], table['date'].iloc[-1][:7])
        self.assertEqual(len(out['history']['observed']), len(table))

    def test_hindcast_is_the_last_12_complete_rows(self):
        table = synthetic_table(120)
        table.loc[len(table) - 1:, 'AirTemp_C'] = np.nan
        out = run(parse_request(synthetic_request(table=table, models=['ridge'])), now=NOW)
        hc = out['models']['ridge']['hindcast']
        expect = table.iloc[-13:-1]
        self.assertEqual(hc['times'], [d[:7] for d in expect['date']])
        np.testing.assert_allclose(hc['observed'], expect['NDVI'].values, atol=6e-6)
        self.assertEqual(hc['times'][-1], out['issued'])

    def test_lags_drop_rows_after_a_gap(self):
        table = synthetic_table(120)
        table.loc[50, 'NDVI'] = np.nan
        out = run(parse_request(synthetic_request(table=table, models=['ridge'])), now=NOW)
        m = out['models']['ridge']['metrics']
        # Rows 0-1 (no lags), 50 (no NDVI), 51-52 (missing lag) are dropped.
        self.assertEqual(m['train']['n'] + m['test']['n'], 120 - 5)
        self.assertIsNone(out['history']['observed'][50])

    def test_missing_calendar_month_is_invalid(self):
        table = synthetic_table(120)
        table.loc[table['date'].str[5:7] == '03', 'NDVI'] = np.nan
        with self.assertRaises(InvalidInput):
            run(parse_request(synthetic_request(table=table, models=['ridge'])), now=NOW)


class ShapesAndDeterminism(unittest.TestCase):
    def test_shapes_follow_horizon(self):
        for horizon in (1, 7, 24):
            out = run(parse_request(synthetic_request(horizon=horizon, models=['ridge'])), now=NOW)
            self.assertEqual(len(out['forecastTimes']), horizon)
            self.assertEqual(len(out['models']['ridge']['forecast']), horizon)
            hc = out['models']['ridge']['hindcast']
            for key in ('times', 'observed', 'predicted'):
                self.assertEqual(len(hc[key]), HINDCAST_MONTHS)

    def test_response_fields(self):
        out = run(parse_request(synthetic_request(n=96)), now=NOW)
        self.assertEqual(out['version'], 2)
        self.assertEqual(out['target'], 'NDVI')
        self.assertEqual(out['modelVersion'], MODEL_VERSION)
        self.assertEqual(out['provenance']['datasets'], DATASETS)
        self.assertEqual(out['provenance']['areaKm'], '2 × 2 km')
        self.assertEqual(out['provenance']['generated'], '2026-10-17T12:00:00Z')
        self.assertIn('GEE_Data_Pipeline_Lat_Long_08_10_26', out['provenance']['pipeline'])
        self.assertEqual(len(out['history']['times']), 96)
        self.assertEqual(out['history']['times'][0], '2010-01')
        self.assertEqual(len(out['features']), 17)
        for name, m in out['models'].items():
            self.assertTrue(finite(m['forecast']), name)
            self.assertTrue(finite(m['hindcast']['predicted']), name)
            imp = [e['value'] for e in m['importance']]
            self.assertEqual(imp, sorted(imp, reverse=True))
        self.assertTrue(any('Landsat' in a for a in out['assumptions']))
        self.assertTrue(any('ERA5-Land' in a for a in out['assumptions']))

    def test_models_follow_request_order(self):
        out = run(parse_request(synthetic_request(models=['gbm', 'ridge'])), now=NOW)
        self.assertEqual(list(out['models']), ['gbm', 'ridge'])

    def test_same_input_same_output(self):
        req = synthetic_request()
        code1, a, _ = run_cli(req)
        code2, b, _ = run_cli(req)
        self.assertEqual((code1, code2), (0, 0))
        # Only the generation timestamp may differ between runs.
        for body in (a, b):
            body['provenance'].pop('generated')
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))


if __name__ == '__main__':
    unittest.main()
