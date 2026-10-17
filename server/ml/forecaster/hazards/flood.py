"""Flood forecast and danger classification: the team notebook
`flood_disaster.ipynb`, Part B (cells 28-39), as a program.

    python -m forecaster.hazards build flood            -> server/data/hazards/flood/model/forecast.json
    python -m forecaster.hazards build flood --stdout   (the same JSON on stdout, nothing written)

It reads the normalized dataset (import_flood.py) and answers, for every day
of every event: the probability that the event's flood is on at least one of
the next 3 days, per model; each model's threshold; the resulting danger
class (probability >= threshold); the actual label; and the models' scores.

How the notebook does it, and how this file follows it (cell numbers are the
notebook's; its cells were run out of order in Colab, so this is the pipeline
that produced the printed results, reconstructed from the execution counts):

- **Data (cell 34, "CELL 1").** Daily rainfall per event, Nepal left out
  (`if event == "05_nepal_trishuli": continue`: a glacier collapse, not
  rain). Rainfall features per event, past and current days only: box mean
  and wettest cell, 1-day value, 3- and 7-day rolling sums and the 3-day
  rolling max (`min_periods=1`). Soil moisture = the pass's
  `mean_sm_recommended_only`, with `coverage_pct` and `mean_uncertainty`,
  joined backward (`merge_asof`, latest pass on or before the day, at most
  24 days old, same-day duplicates: the last pass), plus the pass's age.
- **Target (cell 28).** `actual_flood_within_next_3_days` = 1 if
  `in_flood_period` is 1 on any of the next 3 calendar days; days without
  all 3 next days (the last 3 of each event) have no target and drop out of
  training and scoring. 221 rows, 83.7% positive.
- **Split (the notebook's "CELL 2", deleted from the file).** Cell 35 shows
  `train_df`/`test_df` with the target column; cell 32 names the held-out
  events (`FORECAST_TEST_EVENTS`). Test = rows of 02_china_guangxi,
  07_india_bihar_bhagalpur, 09_thailand_bangkok (45 rows); train = the
  other 6 events (176 rows). This reproduces every printed number, which no
  other split we tried does.
- **Models (cell 36, "CELL 3").** "Rainfall only" (8 features) and "Rainfall
  + soil moisture" (12): median imputation + Random Forest (300 trees, depth
  6, 3 samples per leaf, `balanced_subsample`, seed 42). The threshold is
  chosen on out-of-fold probabilities: GroupKFold over the training events
  (5 folds, whole events held out), thresholds 0.100, 0.125, ..., 0.900, the
  first with the best balanced accuracy wins. The final model is fit on all
  training rows and scored on the test events.

What this adds for the website (the notebook only scored test rows): every
day of every event gets a probability. Training events use their
**out-of-fold** probability (the fold model that did not see that event), so
no event is ever scored by a model trained on it; test events use the final
model. Days without a target (the last 3) are scored the same way and have
`target: null`. Nepal stays in the dataset but gets no scores, with the
reason.

Exactness: scikit-learn 1.9 changed how forests draw bootstrap samples with
class weights, so it gives different probabilities (the threshold-based
test metrics happen to stay the same). Use scikit-learn <= 1.8
(requirements-hazards.txt). Bit-for-bit equality with the notebook also needs
an x86-64 machine (as Colab): on Apple Silicon one printed number differs
(see server/ml/README.md, "Hazards"). `build` compares its results with the
notebook's printed numbers and records the outcome in `provenance.notebookCheck`.
"""

import datetime as dt
import platform
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .dataset import DatasetError, hazard_dir, read_manifest, read_table

HAZARD = 'flood'
# Bump when the snapshot's content or meaning changes, so saved results can be told apart.
MODEL_VERSION = 'flood-notebook-partb-2026-10-17'
NOTEBOOK = 'flood_disaster.ipynb (Part B, cells 28-39)'

HORIZON_DAYS = 3
TARGET = 'actual_flood_within_next_3_days'
LABEL = 'in_flood_period'
TEST_EVENTS = ('02_china_guangxi', '07_india_bihar_bhagalpur', '09_thailand_bangkok')
EXCLUDED_EVENTS = {
    '05_nepal_trishuli': 'Not a rain flood: the Trishuli flood came from a glacier/rock collapse, so rainfall and soil '
                         'moisture cannot forecast it. The notebook leaves it out of the forecasting data (cell 34), '
                         'and so does this model.',
}
SOIL_MAX_AGE_DAYS = 24
SEED = 42
MAX_FOLDS = 5
# np.arange(0.1, 0.91, 0.025): 33 thresholds, 0.1 to 0.9 (floats as numpy makes them).
THRESHOLD_GRID = (0.1, 0.91, 0.025)
DEFAULT_THRESHOLD = 0.5  # the notebook's starting best_t, used if no out-of-fold rows exist

RAIN_COLS = ['box_1d', 'box_3d', 'box_7d', 'box_max3d', 'wet_1d', 'wet_3d', 'wet_7d', 'wet_max3d']
SOIL_COLS = ['soil_moisture', 'soil_coverage_pct', 'soil_uncertainty', 'soil_pass_age_days']

# Model id -> the notebook's FEATURE_SETS entry. Ids are the API's; labels the notebook's.
MODELS = {
    'rain': {'label': 'Rainfall only', 'features': RAIN_COLS},
    'rain_soil': {'label': 'Rainfall + soil moisture', 'features': RAIN_COLS + SOIL_COLS},
}
RF_PARAMS = {'n_estimators': 300, 'max_depth': 6, 'min_samples_leaf': 3, 'class_weight': 'balanced_subsample',
             'random_state': SEED, 'n_jobs': -1}

FEATURE_INFO = {
    'box_1d': ('Rain over the box, that day', 'mm'),
    'box_3d': ('Rain over the box, last 3 days', 'mm'),
    'box_7d': ('Rain over the box, last 7 days', 'mm'),
    'box_max3d': ('Wettest day over the box, last 3 days', 'mm'),
    'wet_1d': ('Rain in the wettest cell, that day', 'mm'),
    'wet_3d': ('Rain in the wettest cell, last 3 days', 'mm'),
    'wet_7d': ('Rain in the wettest cell, last 7 days', 'mm'),
    'wet_max3d': ('Wettest cell-day, last 3 days', 'mm'),
    'soil_moisture': ('Soil moisture of the latest pass (recommended values)', 'm³/m³'),
    'soil_coverage_pct': ('Share of the box that pass covered', '%'),
    'soil_uncertainty': ('Uncertainty of that pass', 'm³/m³'),
    'soil_pass_age_days': ('Age of that pass', 'days'),
}

CLASSES = [
    {'id': 'danger', 'label': 'Danger', 'rule': 'probability >= threshold',
     'description': "The model expects the event's flood on at least one of the next 3 days."},
    {'id': 'no_danger', 'label': 'No danger signal', 'rule': 'probability < threshold',
     'description': 'The model does not expect the flood in the next 3 days.'},
]

# What the notebook printed (cells 28, 34, 36), for the build's self-check.
# Values are as printed (rounded to 3 decimals).
NOTEBOOK_PRINTED = {
    'records': 221,
    'positive_rate': 0.837,
    'rows': 248,
    'events': {  # cell 34: days, flood_label_rate, soil_data_fraction
        '01_mozambique_limpopo': (69, 0.899, 0.913), '02_china_guangxi': (13, 0.462, 1.000),
        '03_pakistan_punjab': (17, 0.588, 1.000), '04_usa_indiana': (15, 0.533, 0.533),
        '06_india_bihar_patna': (55, 0.873, 1.000), '07_india_bihar_bhagalpur': (27, 0.741, 1.000),
        '08_usa_wabash': (17, 0.588, 1.000), '09_thailand_bangkok': (14, 0.500, 1.000),
        '10_bangladesh_chattogram': (21, 0.667, 0.429),
    },
    'models': {  # cell 36
        'rain': {'threshold': 0.550, 'oof_balanced_accuracy': 0.777,
                 'test': {'test_rows': 45, 'actual_positive_rate': 0.733, 'predicted_positive_rate': 0.978,
                          'accuracy': 0.756, 'balanced_accuracy': 0.542, 'precision': 0.750, 'recall': 1.0,
                          'f1': 0.857, 'roc_auc': 0.692, 'average_precision': 0.877}},
        'rain_soil': {'threshold': 0.750, 'oof_balanced_accuracy': 0.800,
                      'test': {'test_rows': 45, 'actual_positive_rate': 0.733, 'predicted_positive_rate': 0.956,
                               'accuracy': 0.778, 'balanced_accuracy': 0.583, 'precision': 0.767, 'recall': 1.0,
                               'f1': 0.868, 'roc_auc': 0.692, 'average_precision': 0.874}},
    },
}


# ---- data (cell 34) ----

def load_frames(base, manifest, events):
    """The notebook's `rain` and `soil` frames, from the normalized tables
    (renamed back to the source column names the notebook used)."""
    rain_frames = []
    for event in events:
        if event in EXCLUDED_EVENTS:
            continue
        g = read_table(base, manifest, 'daily', event)
        if g is None:
            continue
        g = g.rename(columns={'date': 'date_utc', 'rain_box_mm': 'box_mean_mm', 'rain_wettest_cell_mm': 'wettest_cell_mm'})
        g['event'] = event
        g['date_utc'] = pd.to_datetime(g['date_utc'], utc=True, errors='coerce').dt.floor('D')
        g['in_flood_period'] = (
            g['in_flood_period'].astype(str).str.lower()
            .map({'true': 1, 'false': 0, '1': 1, '0': 0, '1.0': 1, '0.0': 0})
        )
        g['box_mean_mm'] = pd.to_numeric(g['box_mean_mm'], errors='coerce')
        g['wettest_cell_mm'] = pd.to_numeric(g['wettest_cell_mm'], errors='coerce')
        g = g.dropna(subset=['date_utc', 'in_flood_period'])
        rain_frames.append(g)
    if not rain_frames:
        raise DatasetError('No daily rainfall for any event the flood model uses')
    rain = pd.concat(rain_frames, ignore_index=True)
    rain = rain.sort_values(['event', 'date_utc'])
    rain = rain.drop_duplicates(['event', 'date_utc'], keep='last')

    # Historical rainfall features only (no future rain enters the inputs).
    for source, prefix in [('box_mean_mm', 'box'), ('wettest_cell_mm', 'wet')]:
        for event, idx in rain.groupby('event').groups.items():
            v = rain.loc[idx].sort_values('date_utc')[source]
            for days in [1, 3, 7]:
                col = f'{prefix}_{days}d'
                if col not in rain:
                    rain[col] = np.nan
                rain.loc[v.index, col] = v if days == 1 else v.rolling(days, min_periods=1).sum()
            col = f'{prefix}_max3d'
            if col not in rain:
                rain[col] = np.nan
            rain.loc[v.index, col] = v.rolling(3, min_periods=1).max()

    soil_frames = []
    for event in events:
        s = read_table(base, manifest, 'soil_passes', event)
        if s is None or s.empty:
            continue
        s = s.rename(columns={'date': 'date_utc'})
        value_col = next((c for c in ['mean_sm_recommended_only', 'mean_sm'] if c in s.columns), None)
        if value_col is None:
            continue
        s['event'] = event
        s['date_utc'] = pd.to_datetime(s['date_utc'], utc=True, errors='coerce').dt.floor('D')
        s['soil_moisture'] = pd.to_numeric(s[value_col], errors='coerce')
        s['soil_coverage_pct'] = pd.to_numeric(s['coverage_pct'], errors='coerce') if 'coverage_pct' in s else np.nan
        s['soil_uncertainty'] = pd.to_numeric(s['mean_uncertainty'], errors='coerce') if 'mean_uncertainty' in s else np.nan
        soil_frames.append(s[['event', 'date_utc', 'soil_moisture', 'soil_coverage_pct', 'soil_uncertainty']])
    soil = pd.concat(soil_frames, ignore_index=True) if soil_frames else pd.DataFrame()
    return rain, soil


def merge_soil(rain, soil):
    """Backward-only join: the latest same-event pass on or before the day,
    at most 24 days old (cell 34)."""
    merged = []
    for event, g in rain.groupby('event'):
        g = g.sort_values('date_utc').copy()
        if not soil.empty and event in set(soil['event']):
            s = soil[soil['event'] == event].copy()
            s = s.sort_values('date_utc').drop_duplicates('date_utc', keep='last')
            s = s.drop(columns=['event'], errors='ignore').rename(columns={'date_utc': 'soil_date'})
            g = pd.merge_asof(g.sort_values('date_utc'), s.sort_values('soil_date'), left_on='date_utc',
                              right_on='soil_date', direction='backward', tolerance=pd.Timedelta(days=SOIL_MAX_AGE_DAYS))
            g['soil_pass_age_days'] = (g['date_utc'] - g['soil_date']).dt.total_seconds() / 86400
            g = g.drop(columns=['soil_date'], errors='ignore')
        else:
            for c in SOIL_COLS:
                g[c] = np.nan
        merged.append(g)
    return pd.concat(merged, ignore_index=True)


# ---- target (cell 28) ----

def add_target(data):
    """`data` with the target column; NaN where any of the next 3 days is unknown."""
    df = data.copy()
    df['date_utc'] = pd.to_datetime(df['date_utc'], utc=True).dt.normalize()
    df[LABEL] = pd.to_numeric(df[LABEL], errors='coerce')
    df[TARGET] = np.nan
    for event, g in df.groupby('event'):
        g = g.sort_values('date_utc')
        if g['date_utc'].duplicated().any():
            raise DatasetError(f'Duplicate dates in event {event}')
        labels = g.set_index('date_utc')[LABEL]
        for idx, row in g.iterrows():
            future = [row['date_utc'] + pd.Timedelta(days=d) for d in range(1, HORIZON_DAYS + 1)]
            if all(d in labels.index and pd.notna(labels.loc[d]) for d in future):
                df.loc[idx, TARGET] = int(any(labels.loc[d] == 1 for d in future))
    return df


# ---- models (cell 36) ----

def make_forecast_model():
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.pipeline import make_pipeline

    return make_pipeline(SimpleImputer(strategy='median'), RandomForestClassifier(**RF_PARAMS))


def fitted(model, X, y):
    """Fits as the notebook does (all cores: each tree has its own seed, so
    the trees are the same however many cores build them), then switches
    prediction to one core. With n_jobs=-1, predict_proba adds the trees'
    votes up in whatever order the threads finish, so the last bits of a
    probability change from call to call; one core adds them in tree order
    and the same data always gives the same numbers. The notebook's printed
    results do not depend on those last bits."""
    model.fit(X, y)
    model.set_params(randomforestclassifier__n_jobs=1)
    return model


def thresholds():
    return np.arange(*THRESHOLD_GRID)


def _f(x):
    """A float for JSON (None for NaN / missing)."""
    if x is None:
        return None
    x = float(x)
    return None if not np.isfinite(x) else x


def score_metrics(y, prob, threshold):
    """The notebook's metric row for labels `y` and probabilities `prob`."""
    from sklearn.metrics import (accuracy_score, average_precision_score, balanced_accuracy_score, f1_score,
                                 precision_score, recall_score, roc_auc_score)

    pred = (prob >= threshold).astype(int)
    two = len(np.unique(y)) == 2
    return {
        'rows': int(len(y)),
        'actualPositiveRate': _f(y.mean()),
        'predictedPositiveRate': _f(pred.mean()),
        'accuracy': _f(accuracy_score(y, pred)),
        'balancedAccuracy': _f(balanced_accuracy_score(y, pred)),
        'precision': _f(precision_score(y, pred, zero_division=0)),
        'recall': _f(recall_score(y, pred, zero_division=0)),
        'f1': _f(f1_score(y, pred, zero_division=0)),
        'rocAuc': _f(roc_auc_score(y, prob)) if two else None,
        'averagePrecision': _f(average_precision_score(y, prob)) if two else None,
    }


def fit_model(cols, train_df, test_df):
    """One FEATURE_SETS entry of cell 36: out-of-fold probabilities, threshold,
    final model and test probabilities. Also keeps the fold models, so every
    day of a training event can be scored by the model that did not see it."""
    from sklearn.metrics import balanced_accuracy_score, f1_score
    from sklearn.model_selection import GroupKFold

    # Drop rows with no rainfall data; median imputation handles the rest.
    tr = train_df.dropna(subset=RAIN_COLS + [TARGET]).copy()
    te = test_df.dropna(subset=RAIN_COLS + [TARGET]).copy()
    if tr[TARGET].nunique() < 2:
        raise DatasetError('The training events have only one class of the target; cannot train the flood model')

    Xtr = tr[cols].reset_index(drop=True)
    ytr = tr[TARGET].reset_index(drop=True)
    groups = tr['event'].reset_index(drop=True)
    oof = np.full(len(tr), np.nan)
    folds = []
    if groups.nunique() >= 2:
        cv = GroupKFold(n_splits=min(MAX_FOLDS, groups.nunique()))
        for fit_i, val_i in cv.split(Xtr, ytr, groups):
            held_out = sorted(groups.iloc[val_i].unique())
            if ytr.iloc[fit_i].nunique() < 2:
                folds.append({'events': held_out, 'model': None})
                continue
            fold_model = fitted(make_forecast_model(), Xtr.iloc[fit_i], ytr.iloc[fit_i])
            oof[val_i] = fold_model.predict_proba(Xtr.iloc[val_i])[:, 1]
            folds.append({'events': held_out, 'model': fold_model, 'rows': int(len(val_i))})

    valid = np.isfinite(oof)
    best_t, best_ba = DEFAULT_THRESHOLD, -1
    sweep = []
    if valid.sum() and len(np.unique(ytr.to_numpy()[valid])) == 2:
        for threshold in thresholds():
            pred = (oof[valid] >= threshold).astype(int)
            ba = balanced_accuracy_score(ytr.to_numpy()[valid], pred)
            sweep.append({'threshold': round(float(threshold), 3), 'balancedAccuracy': float(ba),
                          'f1': float(f1_score(ytr.to_numpy()[valid], pred, zero_division=0))})
            if ba > best_ba:
                best_t, best_ba = float(threshold), float(ba)

    model = fitted(make_forecast_model(), tr[cols], tr[TARGET].astype(int))
    prob = model.predict_proba(te[cols])[:, 1] if len(te) else np.array([])
    return {
        'train': tr, 'test': te, 'oof': oof, 'threshold': best_t, 'oofBalancedAccuracy': best_ba if best_ba >= 0 else None,
        'oofRows': int(valid.sum()), 'sweep': sweep, 'folds': folds, 'model': model, 'testProb': prob,
    }


# ---- the whole run ----

def _events_in(manifest, only=None):
    ids = [e['id'] for e in manifest['events']]
    return [e for e in ids if only is None or e in only]


def run(base=None, events=None):
    """Runs the pipeline on the dataset in `base` (default
    server/data/hazards/flood). `events` restricts it to those event ids (the
    acceptance test pins the notebook's 10). Returns the snapshot dict."""
    import sklearn

    base = Path(base) if base else hazard_dir(HAZARD)
    manifest = read_manifest(base)
    ids = _events_in(manifest, set(events) if events else None)

    rain, soil = load_frames(base, manifest, ids)
    data = merge_soil(rain, soil)
    df = add_target(data)
    forecast_data = df.dropna(subset=[TARGET]).copy()
    forecast_data[TARGET] = forecast_data[TARGET].astype(int)
    train_df = forecast_data[~forecast_data['event'].isin(TEST_EVENTS)].copy()
    test_df = forecast_data[forecast_data['event'].isin(TEST_EVENTS)].copy()
    if test_df.empty:
        raise DatasetError(f'None of the test events {list(TEST_EVENTS)} has rows with a target')

    fits = {m: fit_model(spec['features'], train_df, test_df) for m, spec in MODELS.items()}

    per_event_stats = (
        df.groupby('event').agg(days=('date_utc', 'size'), flood_label_rate=(LABEL, 'mean'),
                                soil_data_fraction=('soil_moisture', lambda x: x.notna().mean()))
    )
    snapshot = {
        'version': 1,
        'hazard': HAZARD,
        'modelVersion': MODEL_VERSION,
        'interval': 'daily',
        'horizonDays': HORIZON_DAYS,
        'target': {
            'key': 'flood_within_3_days', 'column': TARGET, 'labelParameter': LABEL,
            'label': 'Flood within the next 3 days',
            'definition': f'1 if the reported flood period ({LABEL}) covers at least one of the next {HORIZON_DAYS} '
                          'calendar days, else 0; unknown (null) when any of those days is outside the data.',
        },
        'classes': CLASSES,
        'defaultModel': 'rain_soil',
        'features': [{'key': k, 'label': FEATURE_INFO[k][0], 'unit': FEATURE_INFO[k][1]} for k in RAIN_COLS + SOIL_COLS],
        'data': {
            'rows': int(len(df)),
            'records': int(len(forecast_data)),
            'positiveRate': _f(forecast_data[TARGET].mean()),
            'trainRows': int(len(train_df)),
            'testRows': int(len(test_df)),
            'events': {e: {'days': int(r.days), 'floodLabelRate': _f(r.flood_label_rate),
                           'soilDataFraction': _f(r.soil_data_fraction)} for e, r in per_event_stats.iterrows()},
        },
        'split': {
            'testEvents': sorted(test_df['event'].unique()),
            'trainEvents': sorted(train_df['event'].unique()),
            'excludedEvents': [{'id': e, 'reason': EXCLUDED_EVENTS[e]} for e in ids if e in EXCLUDED_EVENTS],
        },
        'models': {},
        'events': {},
    }

    for m, spec in MODELS.items():
        f = fits[m]
        y = f['test'][TARGET].astype(int).to_numpy()
        test_metrics = {'threshold': round(f['threshold'], 3), **score_metrics(y, f['testProb'], f['threshold'])}
        rf = f['model'].named_steps['randomforestclassifier']
        importance = sorted(({'feature': c, 'label': FEATURE_INFO[c][0], 'value': float(v)}
                             for c, v in zip(spec['features'], rf.feature_importances_)), key=lambda r: -r['value'])
        snapshot['models'][m] = {
            'label': spec['label'],
            'features': spec['features'],
            # Rounded for display; `thresholdExact` is the float the notebook
            # compares with (np.arange gives 0.5499999999999999 for 0.55).
            'threshold': round(f['threshold'], 3),
            'thresholdExact': f['threshold'],
            'params': {k: v for k, v in RF_PARAMS.items() if k != 'n_jobs'} | {'imputer': 'median'},
            'oof': {
                'balancedAccuracy': f['oofBalancedAccuracy'],
                'rows': f['oofRows'],
                'folds': [{'events': fo['events'], 'rows': fo.get('rows', 0)} for fo in f['folds']],
                'sweep': f['sweep'],
            },
            'test': test_metrics,
            'importance': importance,
        }

    for event in ids:
        snapshot['events'][event] = event_result(event, df, fits)
    snapshot['provenance'] = provenance(sklearn.__version__)
    snapshot['provenance']['notebookCheck'] = notebook_check(snapshot, ids)
    return snapshot


def event_result(event, df, fits):
    """Every day of one event: dates, label, target, and per model the
    probability, danger class and (where there is a target) the event's scores."""
    if event in EXCLUDED_EVENTS:
        return {'role': 'excluded', 'reason': EXCLUDED_EVENTS[event]}
    g = df[df['event'] == event].sort_values('date_utc')
    if g.empty:
        return {'role': 'excluded', 'reason': 'No daily rainfall for this event.'}
    has_target = g[TARGET].notna().to_numpy()
    y = g[TARGET].to_numpy()
    out = {
        'dates': [d.strftime('%Y-%m-%d') for d in g['date_utc']],
        # The day's own label (the parameter named by target.labelParameter).
        'label': [None if pd.isna(v) else bool(v) for v in g[LABEL]],
        'target': [None if pd.isna(v) else int(v) for v in y],
        'inputs': {c: [_f(v) for v in g[c]] for c in RAIN_COLS + SOIL_COLS},
        'models': {},
    }
    role = None
    for m, spec in MODELS.items():
        f = fits[m]
        X = g[spec['features']]
        if event in TEST_EVENTS:
            role, scorer, fold = 'test', f['model'], None
        else:
            fold = next((i for i, fo in enumerate(f['folds']) if event in fo['events'] and fo['model'] is not None), None)
            trained_on = event in set(f['train']['event'])
            if fold is not None:
                role, scorer = 'out_of_fold', f['folds'][fold]['model']
            elif trained_on:
                # Its fold could not be fit (one class only), as in the
                # notebook (oof stays NaN). The final model saw it, so it
                # must not score it: no probabilities.
                n = len(g)
                out['models'][m] = {'probability': [None] * n, 'class': [None] * n, 'threshold': round(f['threshold'], 3)}
                role = 'not_scored'
                continue
            else:
                # Not in training (no target rows) and not a test event: the
                # final model has not seen it either.
                role, scorer = 'unseen', f['model']
        prob = scorer.predict_proba(X)[:, 1]
        danger = prob >= f['threshold']
        res = {
            'probability': [float(p) for p in prob],
            'class': ['danger' if d else 'no_danger' for d in danger],
            'threshold': round(f['threshold'], 3),
        }
        if role == 'out_of_fold':
            # Sanity check: the same probabilities the notebook's oof array holds.
            tr = f['train'].reset_index(drop=True)
            idx = np.flatnonzero((tr['event'] == event).to_numpy())
            if not np.array_equal(f['oof'][idx], prob[has_target]):
                raise AssertionError(f'out-of-fold probabilities of {event} do not match the fold model')
            res['fold'] = fold
            res['foldEvents'] = f['folds'][fold]['events']
        if has_target.any():
            yy = y[has_target].astype(int)
            res['metrics'] = score_metrics(yy, prob[has_target], f['threshold'])
            res['metrics'].pop('accuracy')
        out['models'][m] = res
    out['role'] = role
    return out


def provenance(sklearn_version):
    return {
        'notebook': NOTEBOOK,
        'cells': {'data': 34, 'target': 28, 'split': '"CELL 2" (deleted; reconstructed from cells 32 and 35)', 'models': 36},
        'datasets': ['GPM IMERG Late Run daily V07 (doi:10.5067/GPM/IMERGDL/DAY/07)',
                     'NISAR L3 SME2 soil moisture, provisional, V1 (doi:10.5067/NIL3SME2-P1)'],
        'scoring': 'Test events: the final model (trained on the training events). Training events: out-of-fold, '
                   'the GroupKFold model that held that event out, so no event is scored by a model that saw it.',
        'environment': {'python': platform.python_version(), 'scikitLearn': sklearn_version,
                        'numpy': np.__version__, 'pandas': pd.__version__, 'machine': platform.machine()},
        'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    }


def notebook_check(snapshot, ids):
    """Compares the run with what the notebook printed, to the printed 3
    decimals. Only meaningful on the notebook's events."""
    nb = NOTEBOOK_PRINTED
    if set(ids) != set(nb['events']) | set(EXCLUDED_EVENTS):
        return {'applicable': False, 'reason': 'The dataset has other events than the notebook had.'}
    got, want = {}, {}
    d = snapshot['data']
    got['records'], want['records'] = d['records'], nb['records']
    got['positive_rate'], want['positive_rate'] = d['positiveRate'], nb['positive_rate']
    got['rows'], want['rows'] = d['rows'], nb['rows']
    for e, (days, rate, soil) in nb['events'].items():
        s = d['events'].get(e, {})
        got[f'{e}.days'], want[f'{e}.days'] = s.get('days'), days
        got[f'{e}.flood_label_rate'], want[f'{e}.flood_label_rate'] = s.get('floodLabelRate'), rate
        got[f'{e}.soil_data_fraction'], want[f'{e}.soil_data_fraction'] = s.get('soilDataFraction'), soil
    keys = {'test_rows': 'rows', 'actual_positive_rate': 'actualPositiveRate', 'predicted_positive_rate': 'predictedPositiveRate',
            'accuracy': 'accuracy', 'balanced_accuracy': 'balancedAccuracy', 'precision': 'precision', 'recall': 'recall',
            'f1': 'f1', 'roc_auc': 'rocAuc', 'average_precision': 'averagePrecision'}
    for m, p in nb['models'].items():
        sm = snapshot['models'][m]
        got[f'{m}.threshold'], want[f'{m}.threshold'] = sm['thresholdExact'], p['threshold']
        got[f'{m}.oof_balanced_accuracy'], want[f'{m}.oof_balanced_accuracy'] = sm['oof']['balancedAccuracy'], p['oof_balanced_accuracy']
        for k, v in p['test'].items():
            got[f'{m}.test.{k}'], want[f'{m}.test.{k}'] = sm['test'][keys[k]], v
    mismatches = [{'value': k, 'notebook': want[k], 'here': got[k]} for k in want
                  if got[k] is None or round(float(got[k]), 3) != round(float(want[k]), 3)]
    return {'applicable': True, 'compared': len(want), 'matches': not mismatches, 'mismatches': mismatches}


def check_environment():
    """Refuses scikit-learn >= 1.9, whose forests give different numbers (see
    the module docstring). Returns a warning text for a non-x86-64 machine."""
    import sklearn

    major, minor = (int(x) for x in sklearn.__version__.split('.')[:2])
    if (major, minor) >= (1, 9):
        raise EnvironmentError(
            f'scikit-learn {sklearn.__version__} changed how random forests sample with class weights and does not '
            'reproduce the notebook. Use the hazards environment (scikit-learn 1.8.0, requirements-hazards.txt), '
            'or pass --any-sklearn to build anyway.')
    if platform.machine().lower() not in ('x86_64', 'amd64'):
        return (f'Running on {platform.machine()}: results can differ from the notebook (run on x86-64 Colab) in the '
                'last digits of some probabilities; provenance.notebookCheck says whether the printed numbers match.')
    return None


if __name__ == '__main__':  # pragma: no cover - `python -m forecaster.hazards.flood` = build flood
    from .__main__ import main

    sys.exit(main(['build', 'flood', *sys.argv[1:]]))
