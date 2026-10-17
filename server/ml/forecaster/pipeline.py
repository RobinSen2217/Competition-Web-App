"""Train, score and forecast: notebook cell 54 as a function of one request.

The steps and their order are the notebook's:
  1. NDVI_lag1..lags = NDVI shifted by 1..lags rows; season columns; drop
     every row missing a model input or NDVI ("complete rows", df below).
  2. Chronological split: the last int(len * testFraction) complete rows are
     the test set. Each model is fitted on the rest; R² / RMSE on both parts.
  3. Permutation importance on the test part (drop in R² when a column is
     shuffled; n_repeats=30, random_state=seed).
  4. Hindcast: recursive_forecast on df.iloc[:-12], compared with the last 12
     complete rows (df.iloc[-12:]).
  5. Forecast: recursive_forecast on all of df, `horizon` months (notebook 12).

recursive_forecast (notebook): refit on the history; future drivers are each
calendar month's mean over that history (climatology); the forecast starts the
month after the history's last row, i.e. after the last *complete* row, and
each predicted NDVI becomes the next month's NDVI_lag1 (and so on).
"""

import datetime as dt
import logging
import warnings

import numpy as np
import pandas as pd
from sklearn.exceptions import ConvergenceWarning
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_squared_error, r2_score

from . import features
from .contract import InvalidInput
from .gee import DATASETS, PIPELINE
from .models import MODELS

log = logging.getLogger('forecaster')

# Bumped whenever the output changes (method or text), see README.md.
MODEL_VERSION = 'gee-notebook-2026-10-08'
HINDCAST_MONTHS = 12   # notebook: hist = df.iloc[:-N_FORECAST] with N_FORECAST = 12
IMPORTANCE_REPEATS = 30
# Enough history that the hindcast still has a couple of years to learn from.
MIN_TRAIN_ROWS = 24
MIN_TEST_ROWS = 2

TARGET = features.TARGET


def _month(ts):
    return ts.strftime('%Y-%m')


def _r(x, digits=5):
    """Round for output. Fixed precision keeps responses small and stable."""
    return round(float(x), digits)


def _score(y_true, y_pred):
    return {
        'r2': _r(r2_score(y_true, y_pred), 4),
        'rmse': _r(np.sqrt(mean_squared_error(y_true, y_pred)), 5),
    }


def _fit(spec, seed, X, y):
    model = spec.factory(seed)
    with warnings.catch_warnings():
        # lbfgs on a small MLP often stops at max_iter; the notebook accepted
        # that, and the warning on stderr would only be noise for the caller.
        warnings.simplefilter('ignore', ConvergenceWarning)
        model.fit(X, y)
    return model


def _climatology(hist):
    """Per-calendar-month mean of each driver over `hist` (notebook drv_clim)."""
    clim = hist.groupby(hist['date'].dt.month)[features.DRIVERS].mean()
    missing = sorted(set(range(1, 13)) - set(clim.index))
    if missing:
        raise InvalidInput(
            f'The history has no complete month for calendar month(s) {missing}; '
            'cannot build the climatology for future weather.')
    return clim


def recursive_forecast(spec, seed, hist, n, lags):
    """Notebook recursive_forecast for one model: fit on `hist`, predict n months ahead."""
    cols = features.model_columns(lags)
    fd = pd.date_range(hist['date'].iloc[-1] + pd.DateOffset(months=1), periods=n, freq='MS')
    f = features.add_season(_climatology(hist).loc[fd.month].reset_index(drop=True).assign(date=fd))
    mdl = _fit(spec, seed, hist[cols].values, hist[TARGET].values)
    past = list(hist[TARGET].values[-max(lags, 1):])
    pred = []
    for i in range(n):
        row = f.loc[[i]].copy()
        for k in range(1, lags + 1):
            row[f'NDVI_lag{k}'] = past[-k]
        p = float(mdl.predict(row[cols].values)[0])
        pred.append(p)
        past.append(p)
    return fd, np.array(pred)


def table(req):
    """The request's rows as the notebook's DataFrame (read_csv + sort by date)."""
    df = pd.DataFrame(req.rows, columns=req.columns)
    for col in req.columns:
        df[col] = pd.to_datetime(df[col]) if col == features.DATE else pd.to_numeric(df[col]).astype('float64')
    return df.sort_values('date').reset_index(drop=True)


def complete_rows(full, lags):
    """Notebook: NDVI lags by shift, season, dropna(subset=COLS + ["NDVI"])."""
    df = full.copy()
    for k in range(1, lags + 1):
        df[f'NDVI_lag{k}'] = df[TARGET].shift(k)
    cols = features.model_columns(lags)
    return features.add_season(df).dropna(subset=cols + [TARGET]).reset_index(drop=True)


def run(req, now=None):
    """Run the whole pipeline for a validated contract.Request -> response dict."""
    lags = req.options['lags']
    seed = req.options['seed']
    cols = features.model_columns(lags)
    full = table(req)
    df = complete_rows(full, lags)

    n_te = int(len(df) * req.options['testFraction'])
    n_tr = len(df) - n_te
    if n_tr < MIN_TRAIN_ROWS or n_te < MIN_TEST_ROWS:
        raise InvalidInput(
            f'Only {len(df)} month(s) have every input; need at least '
            f'{MIN_TRAIN_ROWS} for training and {MIN_TEST_ROWS} for testing.')
    hist, held = df.iloc[:-HINDCAST_MONTHS], df.iloc[-HINDCAST_MONTHS:]
    if len(hist) < MIN_TRAIN_ROWS:
        raise InvalidInput(f'Only {len(hist)} complete month(s) before the last {HINDCAST_MONTHS}; '
                           f'the hindcast needs at least {MIN_TRAIN_ROWS}.')

    X, y, dates = df[cols].values, df[TARGET].values, df['date']
    Xtr, Xte, ytr, yte = X[:n_tr], X[n_tr:], y[:n_tr], y[n_tr:]
    ho = held[TARGET].values

    results = {}
    fd = hc_dates = None
    for name in req.models:
        spec = MODELS[name]
        log.info('area=%s model=%s: fitting', req.area['id'], name)

        mdl = _fit(spec, seed, Xtr, ytr)
        p_tr, p_te = mdl.predict(Xtr), mdl.predict(Xte)
        imp = permutation_importance(mdl, Xte, yte, n_repeats=IMPORTANCE_REPEATS,
                                     random_state=seed, scoring='r2')
        importance = sorted(
            ({'feature': c, 'label': features.feature_info(c)[0], 'value': _r(v, 4)}
             for c, v in zip(cols, imp.importances_mean)),
            key=lambda e: -e['value'])

        hc_dates, hind = recursive_forecast(spec, seed, hist, HINDCAST_MONTHS, lags)
        fd, fc = recursive_forecast(spec, seed, df, req.horizon, lags)

        if not (np.all(np.isfinite(fc)) and np.all(np.isfinite(hind))):
            raise RuntimeError(f'Model "{name}" produced non-finite predictions.')

        results[name] = {
            'label': spec.label,
            'forecast': [_r(v) for v in fc],
            'hindcast': {
                'times': [_month(t) for t in hc_dates],
                'observed': [_r(v) for v in ho],
                'predicted': [_r(v) for v in hind],
                **_score(ho, hind),
            },
            'metrics': {
                'train': {**_score(ytr, p_tr), 'from': _month(dates.iloc[0]), 'to': _month(dates.iloc[n_tr - 1]),
                          'n': n_tr},
                'test': {**_score(yte, p_te), 'from': _month(dates.iloc[n_tr]), 'to': _month(dates.iloc[-1]),
                         'n': n_te},
            },
            'importance': importance,
        }

    # The hindcast compares the last 12 complete rows with 12 consecutive
    # predicted months; they only line up when those rows have no gaps.
    hindcast_aligned = [_month(t) for t in held['date']] == [_month(t) for t in hc_dates]
    return {
        'version': 2,
        'area': req.area['id'],
        'target': req.target,
        'interval': req.interval,
        'issued': _month(dates.iloc[-1]),
        'forecastTimes': [_month(t) for t in fd],
        'models': results,
        'features': features.describe(cols),
        'assumptions': _assumptions(req, df, full, hindcast_aligned),
        'modelVersion': MODEL_VERSION,
        'dataUntil': _data_until(full),
        'history': {
            'times': [_month(t) for t in full['date']],
            'observed': [None if np.isnan(v) else _r(v) for v in full[TARGET]],
        },
        'provenance': {
            'pipeline': PIPELINE,
            'datasets': list(DATASETS),
            'areaKm': _area_km(req.area.get('halfWidthKm')),
            'generated': (now or dt.datetime.now(dt.timezone.utc)).isoformat(timespec='seconds').replace('+00:00', 'Z'),
        },
    }


def _area_km(half):
    if half is None:
        return None
    side = f'{2 * half:g}'
    return f'{side} × {side} km'


def _data_until(full):
    """Last month with a value, per model source column (target first)."""
    out = {}
    for col in [TARGET] + features.DRIVERS:
        present = full.index[full[col].notna()]
        out[col] = _month(full['date'].iloc[present[-1]]) if len(present) else None
    return out


def _assumptions(req, df, full, hindcast_aligned):
    box = _area_km(req.area.get('halfWidthKm'))
    box = f'the {box} box' if box else 'the area box'
    out = [
        f'NDVI (what is forecast) is the monthly mean of cloud-free Landsat 5/7/8/9 pixels (30 m) over {box}; '
        'months without a clear Landsat view have no NDVI.',
        'Weather (air temperature, dewpoint, rain, wind, sunlight) is ERA5-Land reanalysis on a ~9 km grid; '
        'surface temperature and emissivity are MODIS (1 km), albedo MODIS (500 m).',
        'Future weather is each calendar month\'s average over the history (climatology), as in the notebook; '
        'it is not a weather forecast.',
        'Each forecast month\'s NDVI is fed back as the next month\'s input, so errors can build up further ahead.',
        f'Models learn only from months where every input and the previous {req.options["lags"]} months\' NDVI are '
        f'present ({len(df)} of {len(full)} months); the forecast starts after the last such month '
        f'({_month(df["date"].iloc[-1])}).',
        f'Accuracy (R², RMSE) is measured on the last {int(req.options["testFraction"] * 100)}% of those months, '
        'which the model did not see while training. Test scores use the actual weather and last month\'s actual '
        'NDVI, so a real forecast will usually do worse.',
        f'The hindcast re-runs the forecast as if made {HINDCAST_MONTHS} months earlier, with typical '
        f'(climatology) weather, and compares it with the last {HINDCAST_MONTHS} complete months.',
    ]
    if not hindcast_aligned:
        out.append(f'Some of the last {HINDCAST_MONTHS} complete months are not consecutive (months with missing '
                   'data are skipped), so the hindcast compares them in order with consecutive predicted months, '
                   'as the notebook does.')
    return out
