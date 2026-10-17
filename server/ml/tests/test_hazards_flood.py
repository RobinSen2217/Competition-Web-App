"""The flood model (forecaster/hazards/flood.py): its building blocks on small
synthetic data, its equality with the notebook's own code on the committed
dataset, the per-day scoring rules and the CLI. The notebook's printed
numbers are checked in test_hazards_flood_acceptance.py."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from forecaster.hazards import flood
from forecaster.hazards.dataset import DatasetError, read_manifest

from .hazards_helpers import FLOOD_DIR, committed_run, export_raw_layout, notebook_sklearn, write_dataset

ML_DIR = Path(__file__).resolve().parents[1]


def days(start, n):
    return [d.strftime('%Y-%m-%d') for d in pd.date_range(start, periods=n, freq='D')]


class BuildingBlocks(unittest.TestCase):
    def frames(self, events):
        with tempfile.TemporaryDirectory() as d:
            base = write_dataset(Path(d) / 'flood', events)
            manifest = read_manifest(base)
            rain, soil = flood.load_frames(base, manifest, list(events))
            return flood.merge_soil(rain, soil)

    def test_target_is_any_flood_day_in_the_next_three(self):
        flags = [0, 0, 0, 0, 1, 1, 0, 0, 0, 0]
        data = self.frames({'a': {'daily': [(t, 1, 2, f) for t, f in zip(days('2026-01-01', 10), flags)]}})
        df = flood.add_target(data).sort_values('date_utc')
        # Day i is 1 when any of days i+1..i+3 is a flood day; the last 3 days have no target.
        self.assertEqual(df[flood.TARGET].tolist()[:7], [0, 1, 1, 1, 1, 0, 0])
        self.assertTrue(df[flood.TARGET].iloc[7:].isna().all())

    def test_rainfall_features_use_past_days_only(self):
        rain = [1, 2, 3, 4, 5, 6, 7, 8]
        data = self.frames({'a': {'daily': [(t, r, 10 * r, 0) for t, r in zip(days('2026-01-01', 8), rain)]}})
        g = data.sort_values('date_utc')
        self.assertEqual(g['box_1d'].tolist(), rain)
        self.assertEqual(g['box_3d'].tolist(), [1, 3, 6, 9, 12, 15, 18, 21])  # min_periods=1 at the start
        self.assertEqual(g['box_7d'].tolist(), [1, 3, 6, 10, 15, 21, 28, 35])
        self.assertEqual(g['box_max3d'].tolist(), [1, 2, 3, 4, 5, 6, 7, 8])
        self.assertEqual(g['wet_3d'].tolist(), [10, 30, 60, 90, 120, 150, 180, 210])

    def test_soil_join_is_backward_with_a_24_day_limit_and_last_pass_of_a_day(self):
        soil = [('2025-12-01', 0.10, 50, 0.04),    # 31 days before 1 Jan: too old
                ('2025-12-10', 0.20, 60, 0.05),    # 22 days before 1 Jan, 26 before 5 Jan
                ('2026-01-04', 0.30, 70, 0.06),    # same day twice: the last row wins
                ('2026-01-04', 0.35, 75, 0.07),
                ('2026-01-09', 0.40, 80, 0.08)]    # after the window: never used
        data = self.frames({'a': {'daily': [(t, 1, 1, 0) for t in days('2026-01-01', 6)], 'soil': soil}})
        g = data.sort_values('date_utc')
        self.assertEqual(g['soil_moisture'].tolist()[:3], [0.20, 0.20, 0.20])
        self.assertEqual(g['soil_pass_age_days'].tolist()[:3], [22.0, 23.0, 24.0])
        self.assertEqual(g['soil_moisture'].tolist()[3:], [0.35, 0.35, 0.35])
        self.assertEqual(g['soil_coverage_pct'].tolist()[3:], [75, 75, 75])
        self.assertEqual(g['soil_pass_age_days'].tolist()[3:], [0.0, 1.0, 2.0])

    def test_event_without_soil_gets_empty_soil_features(self):
        data = self.frames({'a': {'daily': [(t, 1, 1, 0) for t in days('2026-01-01', 3)]}})
        self.assertTrue(data[flood.SOIL_COLS].isna().all().all())

    def test_excluded_events_are_left_out_of_the_data(self):
        data = self.frames({
            'a': {'daily': [(t, 1, 1, 0) for t in days('2026-01-01', 3)]},
            '05_nepal_trishuli': {'daily': [(t, 1, 1, 1) for t in days('2026-01-01', 3)]},
        })
        self.assertEqual(sorted(data['event'].unique()), ['a'])

    def test_thresholds_are_the_notebooks_grid(self):
        t = flood.thresholds()
        self.assertEqual(len(t), 33)
        self.assertEqual(t[0], 0.1)
        self.assertAlmostEqual(t[-1], 0.9)
        np.testing.assert_array_equal(t, np.arange(0.1, 0.91, 0.025))

    def test_duplicate_dates_are_refused(self):
        data = pd.DataFrame({'event': ['a', 'a'], 'date_utc': ['2026-01-01', '2026-01-01'], 'in_flood_period': [0, 1]})
        with self.assertRaises(DatasetError):
            flood.add_target(data)


class CommittedDatasetRun(unittest.TestCase):
    """One run on server/data/hazards/flood (shared with the acceptance test)."""

    @classmethod
    def setUpClass(cls):
        cls.out = committed_run()

    def test_every_event_and_day_is_covered(self):
        manifest = read_manifest(FLOOD_DIR)
        for e in manifest['events']:
            r = self.out['events'][e['id']]
            if e['id'] in flood.EXCLUDED_EVENTS:
                self.assertEqual(r['role'], 'excluded')
                self.assertIn('glacier', r['reason'])
                continue
            n = e['coverage']['days']
            self.assertEqual(len(r['dates']), n, e['id'])
            self.assertEqual(r['dates'][0], e['coverage']['from'])
            self.assertEqual(r['dates'][-1], e['coverage']['to'])
            self.assertEqual(r['target'][-3:], [None, None, None])  # no 3 known days ahead
            self.assertTrue(all(t in (0, 1) for t in r['target'][:-3]))
            for m, res in r['models'].items():
                self.assertEqual(len(res['probability']), n)
                t = self.out['models'][m]['thresholdExact']
                self.assertEqual(res['class'], ['danger' if p >= t else 'no_danger' for p in res['probability']])
            for c in flood.RAIN_COLS + flood.SOIL_COLS:
                self.assertEqual(len(r['inputs'][c]), n)

    def test_roles_never_score_an_event_with_a_model_that_saw_it(self):
        split = self.out['split']
        self.assertEqual(split['testEvents'], sorted(flood.TEST_EVENTS))
        self.assertEqual(split['excludedEvents'], [{'id': '05_nepal_trishuli', 'reason': flood.EXCLUDED_EVENTS['05_nepal_trishuli']}])
        for eid, r in self.out['events'].items():
            if eid in split['testEvents']:
                self.assertEqual(r['role'], 'test')
            elif eid in split['trainEvents']:
                self.assertEqual(r['role'], 'out_of_fold')
                for m, res in r['models'].items():
                    folds = self.out['models'][m]['oof']['folds']
                    self.assertIn(eid, folds[res['fold']]['events'])
                    self.assertIn(eid, res['foldEvents'])

    def test_the_test_events_are_never_in_training(self):
        split = self.out['split']
        self.assertFalse(set(split['testEvents']) & set(split['trainEvents']))
        for m in self.out['models'].values():
            held_out = {e for f in m['oof']['folds'] for e in f['events']}
            self.assertEqual(held_out, set(split['trainEvents']))

    def test_same_as_the_notebook_code_row_by_row(self):
        """The module and a near-verbatim copy of the notebook's cells give the
        same thresholds and the same out-of-fold and test probabilities, on the
        same data, in this environment (whatever the scikit-learn version)."""
        from .notebook_flood_partb import run_notebook

        with tempfile.TemporaryDirectory() as d:
            rain_root, soil_root = export_raw_layout(FLOOD_DIR, d)
            nb = run_notebook(rain_root, soil_root)
        self.assertEqual(self.out['data']['records'], nb['records'])
        self.assertEqual(self.out['data']['positiveRate'], nb['positive_rate'])
        for m, spec in flood.MODELS.items():
            want = nb['models'][spec['label']]
            got = self.out['models'][m]
            self.assertEqual(got['thresholdExact'], want['threshold'], m)
            self.assertEqual(got['oof']['balancedAccuracy'], want['oof_balanced_accuracy'], m)
            # Same trees; only the order the notebook's n_jobs=-1 adds their
            # votes up in differs (flood.fitted), hence 1e-12, not equality.
            for kind in ('oof', 'test'):
                for _, row in want[kind].iterrows():
                    r = self.out['events'][row['event']]
                    p = r['models'][m]['probability'][r['dates'].index(row['date'])]
                    self.assertAlmostEqual(p, row['p'], delta=1e-12, msg=f'{m} {kind} {row["event"]} {row["date"]}')


class Cli(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run([sys.executable, '-m', 'forecaster.hazards', *args], cwd=ML_DIR,
                              capture_output=True, text=True, timeout=600)

    def test_unknown_hazard(self):
        res = self.run_cli('build', 'volcano')
        self.assertEqual(res.returncode, 2)
        self.assertEqual(json.loads(res.stdout)['error']['code'], 'invalid_input')

    def test_missing_dataset(self):
        with tempfile.TemporaryDirectory() as d:
            res = self.run_cli('build', 'flood', '--data', d, '--any-sklearn')
        self.assertEqual(res.returncode, 2)
        self.assertIn('events.json', json.loads(res.stdout)['error']['message'])

    @unittest.skipIf(notebook_sklearn(), 'this environment has a scikit-learn that reproduces the notebook')
    def test_build_refuses_a_scikit_learn_that_does_not_reproduce_the_notebook(self):
        res = self.run_cli('build', 'flood', '--stdout')
        self.assertEqual(res.returncode, 2)
        self.assertIn('scikit-learn', json.loads(res.stdout)['error']['message'])

    @unittest.skipUnless(notebook_sklearn(), 'needs scikit-learn <= 1.8 (requirements-hazards.txt)')
    def test_build_to_stdout_is_the_snapshot(self):
        res = self.run_cli('build', 'flood', '--stdout')
        self.assertEqual(res.returncode, 0, res.stderr[-2000:])
        out = json.loads(res.stdout)
        self.assertEqual(out['hazard'], 'flood')
        self.assertEqual(out['modelVersion'], flood.MODEL_VERSION)
        self.assertEqual(sorted(out['models']), ['rain', 'rain_soil'])


if __name__ == '__main__':
    unittest.main()
