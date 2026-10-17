"""Acceptance: the flood model reproduces what flood_disaster.ipynb (Part B)
printed, from the committed dataset in server/data/hazards/flood.

    ./hazards-python -m unittest -v tests.test_hazards_flood_acceptance

Expected values are copied from the notebook's outputs (cells 28, 34, 36).
They are printed to 3 decimals, so a value passes when it rounds to the
printed one (|got - printed| <= 0.0005).

Environment (see README.md, "Hazards"):
- scikit-learn <= 1.8 is required. 1.9 changed how forests draw bootstrap
  samples with class weights: the thresholds and every threshold-based test
  metric stay the same, but the out-of-fold balanced accuracies become
  0.781 / 0.804 and the soil model's ROC AUC / AP 0.689 / 0.869. Skipped
  otherwise.
- Bit-exact on x86-64 (as Colab). On arm64 (Apple Silicon) the soil model's
  out-of-fold balanced accuracy is 0.804 instead of 0.800 (floating-point
  differences in tree building flip a split); everything else matches. That
  one check is skipped on arm64, and so is the "snapshot is current" check.
"""

import unittest

from .hazards_helpers import FLOOD_DIR, NOTEBOOK_EVENTS, committed_run, notebook_sklearn, x86_64

TOL = 0.0005 + 1e-12

# cell 34 output: days, flood_label_rate, soil_data_fraction
CELL34 = {
    '01_mozambique_limpopo': (69, 0.899, 0.913),
    '02_china_guangxi': (13, 0.462, 1.000),
    '03_pakistan_punjab': (17, 0.588, 1.000),
    '04_usa_indiana': (15, 0.533, 0.533),
    '06_india_bihar_patna': (55, 0.873, 1.000),
    '07_india_bihar_bhagalpur': (27, 0.741, 1.000),
    '08_usa_wabash': (17, 0.588, 1.000),
    '09_thailand_bangkok': (14, 0.500, 1.000),
    '10_bangladesh_chattogram': (21, 0.667, 0.429),
}

# cell 36: "Rainfall only: threshold=0.550; OOF balanced accuracy=0.777" etc.
THRESHOLDS = {'rain': (0.550, 0.777), 'rain_soil': (0.750, 0.800)}

# cell 36, first table (overall held-out test metrics)
TEST = {
    'rain': {'threshold': 0.55, 'rows': 45, 'actualPositiveRate': 0.733, 'predictedPositiveRate': 0.978,
             'accuracy': 0.756, 'balancedAccuracy': 0.542, 'precision': 0.750, 'recall': 1.0, 'f1': 0.857,
             'rocAuc': 0.692, 'averagePrecision': 0.877},
    'rain_soil': {'threshold': 0.75, 'rows': 45, 'actualPositiveRate': 0.733, 'predictedPositiveRate': 0.956,
                  'accuracy': 0.778, 'balancedAccuracy': 0.583, 'precision': 0.767, 'recall': 1.0, 'f1': 0.868,
                  'rocAuc': 0.692, 'averagePrecision': 0.874},
}

# cell 36, second table (per held-out event): n, actual/predicted positive
# rate, balanced accuracy, precision, recall, f1
EVENT_TEST = {
    ('02_china_guangxi', 'rain'): (10, 0.600, 1.000, 0.500, 0.600, 1.0, 0.750),
    ('07_india_bihar_bhagalpur', 'rain'): (24, 0.833, 0.958, 0.625, 0.870, 1.0, 0.930),
    ('09_thailand_bangkok', 'rain'): (11, 0.636, 1.000, 0.500, 0.636, 1.0, 0.778),
    ('02_china_guangxi', 'rain_soil'): (10, 0.600, 0.900, 0.625, 0.667, 1.0, 0.800),
    ('07_india_bihar_bhagalpur', 'rain_soil'): (24, 0.833, 0.958, 0.625, 0.870, 1.0, 0.930),
    ('09_thailand_bangkok', 'rain_soil'): (11, 0.636, 1.000, 0.500, 0.636, 1.0, 0.778),
}

SKIP = None if notebook_sklearn() else (
    'needs scikit-learn <= 1.8 (scikit-learn 1.9 changed random-forest sampling); use server/ml/.venv-hazards '
    '(requirements-hazards.txt)')


@unittest.skipIf(SKIP, SKIP)
class FloodNotebookAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = committed_run()

    def near(self, got, want, what):
        self.assertIsNotNone(got, what)
        self.assertLessEqual(abs(got - want), TOL, f'{what}: got {got}, notebook printed {want}')

    def test_cell28_records_and_positive_rate(self):
        self.assertEqual(self.out['data']['records'], 221)
        self.near(self.out['data']['positiveRate'], 0.837, 'positive rate')
        self.assertEqual(self.out['data']['rows'], 248)

    def test_cell34_per_event_table(self):
        events = self.out['data']['events']
        self.assertEqual(sorted(events), sorted(CELL34))  # Nepal left out, as in the notebook
        for e, (n, rate, soil) in CELL34.items():
            self.assertEqual(events[e]['days'], n, e)
            self.near(events[e]['floodLabelRate'], rate, f'{e} flood_label_rate')
            self.near(events[e]['soilDataFraction'], soil, f'{e} soil_data_fraction')

    def test_cell36_rainfall_threshold_and_oof(self):
        t, ba = THRESHOLDS['rain']
        m = self.out['models']['rain']
        self.near(m['thresholdExact'], t, 'rain threshold')
        self.assertEqual(m['threshold'], t)
        self.near(m['oof']['balancedAccuracy'], ba, 'rain OOF balanced accuracy')

    def test_cell36_soil_threshold(self):
        t, _ = THRESHOLDS['rain_soil']
        m = self.out['models']['rain_soil']
        self.near(m['thresholdExact'], t, 'rain_soil threshold')
        self.assertEqual(m['threshold'], t)

    @unittest.skipUnless(x86_64(), 'bit-exact only on x86-64 (as Colab): on arm64 this is 0.804 (see module docstring)')
    def test_cell36_soil_oof_balanced_accuracy(self):
        self.near(self.out['models']['rain_soil']['oof']['balancedAccuracy'], THRESHOLDS['rain_soil'][1],
                  'rain_soil OOF balanced accuracy')

    def test_cell36_test_metrics_table(self):
        for m, want in TEST.items():
            got = self.out['models'][m]['test']
            for k, v in want.items():
                self.near(got[k], v, f'{m} test {k}')

    def test_cell36_per_event_test_table(self):
        names = ('rows', 'actualPositiveRate', 'predictedPositiveRate', 'balancedAccuracy', 'precision', 'recall', 'f1')
        for (e, m), want in EVENT_TEST.items():
            r = self.out['events'][e]
            self.assertEqual(r['role'], 'test')
            got = r['models'][m]['metrics']
            for k, v in zip(names, want):
                self.near(got[k], v, f'{e} {m} {k}')

    def test_the_build_self_check_agrees(self):
        check = self.out['provenance']['notebookCheck']
        self.assertTrue(check['applicable'])
        if x86_64():
            self.assertEqual(check['mismatches'], [])
        else:
            self.assertEqual([x['value'] for x in check['mismatches']], ['rain_soil.oof_balanced_accuracy'])

    @unittest.skipUnless(x86_64(), 'the committed snapshot was built on x86-64')
    def test_committed_snapshot_is_current(self):
        """model/forecast.json equals a fresh run (apart from when and where it ran)."""
        import json

        saved = json.loads((FLOOD_DIR / 'model' / 'forecast.json').read_text())
        fresh = json.loads(json.dumps(self.out))  # same float/None round trip as the file
        for d in (saved, fresh):
            d['provenance'].pop('generated')
            d['provenance'].pop('environment')
        self.assertEqual(sorted(saved['events']), NOTEBOOK_EVENTS)
        self.assertEqual(saved, fresh)


if __name__ == '__main__':
    unittest.main()
