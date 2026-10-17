"""Notebook cell 54 as written, minus the plots, as a reference for the tests.

Kept as close to the notebook's text as possible (the CSV read becomes a
DataFrame argument, the module-level code becomes one function) so the tests
compare forecaster.pipeline with the notebook itself rather than with a second
reading of it.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = ["AirTemp_C", "Dewpoint_C", "Precip_mm", "WindSpeed_ms", "VPD_kPa", "Rs_down_Wm2",
            "evopration_demand", "Vapor_Slope_kPa_C", "Precip_2mo_sum", "Precip_3mo_sum",
            "R_n", "delta_T", "LST_DTR"]
TEST_FRAC, SEED = 0.2, 42
N_LAGS = 2
USE_TREND = False
N_FORECAST = 12


def add_season(d):
    m = d["date"].dt.month
    d["sin_month"], d["cos_month"] = np.sin(2*np.pi*(m-1)/12), np.cos(2*np.pi*(m-1)/12)
    d["t_years"] = (d["date"] - pd.Timestamp("2010-01-01")).dt.days / 365.25
    return d


COLS = (FEATURES + ["sin_month", "cos_month"] + [f"NDVI_lag{k}" for k in range(1, N_LAGS + 1)]
        + (["t_years"] if USE_TREND else []))


def make_models():
    return {
        "GBM":   make_pipeline(StandardScaler(), GradientBoostingRegressor(
                    n_estimators=200, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=SEED)),
        "NN":    make_pipeline(StandardScaler(), MLPRegressor(
                    hidden_layer_sizes=(8, 8), activation="tanh", alpha=1e-1,
                    solver="lbfgs", max_iter=2000, random_state=SEED)),
        "Ridge": make_pipeline(StandardScaler(), Ridge(alpha=10.0)),
    }


def run_cell54(table):
    """`table` is the features CSV as a DataFrame (date as YYYY-MM-DD strings)."""
    df = table.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date").reset_index(drop=True)
    for k in range(1, N_LAGS + 1):
        df[f"NDVI_lag{k}"] = df["NDVI"].shift(k)
    df = add_season(df).dropna(subset=COLS + ["NDVI"]).reset_index(drop=True)
    X, y, dates = df[COLS].values, df["NDVI"].values, df["date"]

    n_te = int(len(df) * TEST_FRAC); n_tr = len(df) - n_te
    Xtr, Xte, ytr, yte = X[:n_tr], X[n_tr:], y[:n_tr], y[n_tr:]

    models = make_models()
    rows = []
    for name, mdl in models.items():
        mdl.fit(Xtr, ytr)
        p_tr, p_te = mdl.predict(Xtr), mdl.predict(Xte)
        for split, yt, yp in [("Train", ytr, p_tr), ("Test", yte, p_te)]:
            rows.append([name, split, r2_score(yt, yp), np.sqrt(mean_squared_error(yt, yp))])
    metrics = pd.DataFrame(rows, columns=["Model", "Split", "R2", "RMSE"])

    imp_tbl = {}
    for name, mdl in models.items():
        r = permutation_importance(mdl, Xte, yte, n_repeats=30, random_state=SEED, scoring="r2")
        imp_tbl[name] = pd.Series(r.importances_mean, index=COLS)

    drv_clim = lambda d: d.groupby(d["date"].dt.month)[FEATURES].mean()  # noqa: E731

    def recursive_forecast(hist, n):
        fd = pd.date_range(hist["date"].iloc[-1] + pd.DateOffset(months=1), periods=n, freq="MS")
        f = add_season(drv_clim(hist).loc[fd.month].reset_index(drop=True).assign(date=fd))
        out = {}
        for name, mdl in make_models().items():
            mdl.fit(hist[COLS].values, hist["NDVI"].values)
            past = list(hist["NDVI"].values[-max(N_LAGS, 1):]); pred = []
            for i in range(n):
                row = f.loc[[i]].copy()
                for k in range(1, N_LAGS + 1):
                    row[f"NDVI_lag{k}"] = past[-k]
                p = float(mdl.predict(row[COLS].values)[0]); pred.append(p); past.append(p)
            out[name] = np.array(pred)
        return fd, out

    hist, held = df.iloc[:-N_FORECAST], df.iloc[-N_FORECAST:]
    hc_dates, hind = recursive_forecast(hist, N_FORECAST)
    fd, fc = recursive_forecast(df, N_FORECAST)
    return {
        'dates': dates, 'n_tr': n_tr, 'n_te': n_te, 'metrics': metrics, 'importance': imp_tbl,
        'held': held, 'hindcast_dates': hc_dates, 'hindcast': hind, 'forecast_dates': fd, 'forecast': fc,
    }
