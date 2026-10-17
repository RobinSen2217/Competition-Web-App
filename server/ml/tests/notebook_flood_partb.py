"""Near-verbatim copy of the flood notebook's Part B (flood_disaster.ipynb
cells 34, 28 and 36, plus the deleted "CELL 2" split), used by
tests/test_hazards_flood.py to check forecaster/hazards/flood.py against the
notebook's own code on the same data.

Changes from the notebook, none of which touch the computation:
- the rainfall and soil CSVs are read from folders (`<dir>/<event>/...`)
  instead of from rainfall.zip / soil_moisture.zip;
- display(), prints, plots and file output are left out;
- "CELL 2" (train_df / test_df) was deleted from the notebook; it is
  reconstructed as forecast_data split by FORECAST_TEST_EVENTS (cell 32),
  which reproduces every printed number;
- the cell-36 loop returns oof, thresholds and test probabilities.
"""

from pathlib import Path

import numpy as np
import pandas as pd


def run_notebook(rain_root, soil_root):
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import balanced_accuracy_score, f1_score
    from sklearn.model_selection import GroupKFold
    from sklearn.pipeline import make_pipeline

    TEST_EVENTS = {
        "02_china_guangxi",
        "07_india_bihar_bhagalpur",
        "09_thailand_bangkok",
    }

    # ---- cell 34 ("CELL 1") ----
    rain_frames = []
    for f in sorted(Path(rain_root).glob('*/rainfall_daily.csv')):
        event = f.parent.name
        if event == "05_nepal_trishuli":
            continue

        g = pd.read_csv(f)
        required = {"date_utc", "in_flood_period", "box_mean_mm", "wettest_cell_mm"}
        if not required.issubset(g.columns):
            continue

        g["event"] = event
        g["date_utc"] = pd.to_datetime(g["date_utc"], utc=True, errors="coerce").dt.floor("D")
        g["in_flood_period"] = (
            g["in_flood_period"].astype(str).str.lower()
            .map({"true": 1, "false": 0, "1": 1, "0": 0, "1.0": 1, "0.0": 0})
        )
        g["box_mean_mm"] = pd.to_numeric(g["box_mean_mm"], errors="coerce")
        g["wettest_cell_mm"] = pd.to_numeric(g["wettest_cell_mm"], errors="coerce")
        g = g.dropna(subset=["date_utc", "in_flood_period"])
        rain_frames.append(g)

    rain = pd.concat(rain_frames, ignore_index=True)
    rain = rain.sort_values(["event", "date_utc"])
    rain = rain.drop_duplicates(["event", "date_utc"], keep="last")

    rain_cols = []
    for source, prefix in [("box_mean_mm", "box"), ("wettest_cell_mm", "wet")]:
        for event, idx in rain.groupby("event").groups.items():
            v = rain.loc[idx].sort_values("date_utc")[source]
            for days in [1, 3, 7]:
                col = f"{prefix}_{days}d"
                if col not in rain:
                    rain[col] = np.nan
                rain.loc[v.index, col] = (v if days == 1 else v.rolling(days, min_periods=1).sum())
            col = f"{prefix}_max3d"
            if col not in rain:
                rain[col] = np.nan
            rain.loc[v.index, col] = v.rolling(3, min_periods=1).max()

    rain_cols = ["box_1d", "box_3d", "box_7d", "box_max3d", "wet_1d", "wet_3d", "wet_7d", "wet_max3d"]

    soil_frames = []
    for f in sorted(Path(soil_root).glob('*/soil_moisture_passes.csv')):
        event = f.parent.name
        s = pd.read_csv(f)
        if "date_utc" not in s.columns:
            continue
        value_col = next((c for c in ["mean_sm_recommended_only", "mean_sm"] if c in s.columns), None)
        if value_col is None:
            continue
        s["event"] = event
        s["date_utc"] = pd.to_datetime(s["date_utc"], utc=True, errors="coerce").dt.floor("D")
        s["soil_moisture"] = pd.to_numeric(s[value_col], errors="coerce")
        s["soil_coverage_pct"] = pd.to_numeric(s["coverage_pct"], errors="coerce") if "coverage_pct" in s else np.nan
        s["soil_uncertainty"] = pd.to_numeric(s["mean_uncertainty"], errors="coerce") if "mean_uncertainty" in s else np.nan
        soil_frames.append(s[["event", "date_utc", "soil_moisture", "soil_coverage_pct", "soil_uncertainty"]])

    soil = pd.concat(soil_frames, ignore_index=True) if soil_frames else pd.DataFrame()

    merged = []
    for event, g in rain.groupby("event"):
        g = g.sort_values("date_utc").copy()
        if not soil.empty and event in set(soil["event"]):
            s = soil[soil["event"] == event].copy()
            s = s.sort_values("date_utc").drop_duplicates("date_utc", keep="last")
            s = s.drop(columns=["event"], errors="ignore")
            s = s.rename(columns={"date_utc": "soil_date"})
            g = pd.merge_asof(
                g.sort_values("date_utc"), s.sort_values("soil_date"),
                left_on="date_utc", right_on="soil_date",
                direction="backward", tolerance=pd.Timedelta(days=24),
            )
            g["soil_pass_age_days"] = (g["date_utc"] - g["soil_date"]).dt.total_seconds() / 86400
            g = g.drop(columns=["soil_date"], errors="ignore")
        else:
            for c in ["soil_moisture", "soil_coverage_pct", "soil_uncertainty", "soil_pass_age_days"]:
                g[c] = np.nan
        merged.append(g)

    data = pd.concat(merged, ignore_index=True)
    soil_cols = ["soil_moisture", "soil_coverage_pct", "soil_uncertainty", "soil_pass_age_days"]

    # ---- cell 28 ----
    TARGET = "actual_flood_within_next_3_days"
    LABEL = "in_flood_period"
    df = data.copy()
    df["date_utc"] = pd.to_datetime(df["date_utc"], utc=True).dt.normalize()
    df[LABEL] = pd.to_numeric(df[LABEL], errors="coerce")
    df[TARGET] = np.nan
    for event, g in df.groupby("event"):
        g = g.sort_values("date_utc")
        if g["date_utc"].duplicated().any():
            raise ValueError(f"Duplicate dates in event {event}")
        labels = g.set_index("date_utc")[LABEL]
        for idx, row in g.iterrows():
            future_dates = [row["date_utc"] + pd.Timedelta(days=d) for d in (1, 2, 3)]
            if all(d in labels.index and pd.notna(labels.loc[d]) for d in future_dates):
                df.loc[idx, TARGET] = int(any(labels.loc[d] == 1 for d in future_dates))
    forecast_data = df.dropna(subset=[TARGET]).copy()
    forecast_data[TARGET] = forecast_data[TARGET].astype(int)

    # ---- "CELL 2" (reconstructed) ----
    train_df = forecast_data[~forecast_data["event"].isin(TEST_EVENTS)].copy()
    test_df = forecast_data[forecast_data["event"].isin(TEST_EVENTS)].copy()

    # ---- cell 36 ("CELL 3") ----
    SEED = 42
    FEATURE_SETS = {
        "Rainfall only": rain_cols,
        "Rainfall + soil moisture": rain_cols + soil_cols,
    }

    def make_forecast_model():
        return make_pipeline(
            SimpleImputer(strategy="median"),
            RandomForestClassifier(
                n_estimators=300, max_depth=6, min_samples_leaf=3,
                class_weight="balanced_subsample", random_state=SEED, n_jobs=-1,
            ),
        )

    out = {'records': len(forecast_data), 'positive_rate': forecast_data[TARGET].mean(), 'models': {}}
    for name, cols in FEATURE_SETS.items():
        tr = train_df.dropna(subset=rain_cols + [TARGET]).copy()
        te = test_df.dropna(subset=rain_cols + [TARGET]).copy()
        Xtr = tr[cols].reset_index(drop=True)
        ytr = tr[TARGET].reset_index(drop=True)
        groups = tr["event"].reset_index(drop=True)
        oof = np.full(len(tr), np.nan)
        if groups.nunique() >= 2:
            cv = GroupKFold(n_splits=min(5, groups.nunique()))
            for fit_i, val_i in cv.split(Xtr, ytr, groups):
                if ytr.iloc[fit_i].nunique() < 2:
                    continue
                fold_model = make_forecast_model()
                fold_model.fit(Xtr.iloc[fit_i], ytr.iloc[fit_i])
                oof[val_i] = fold_model.predict_proba(Xtr.iloc[val_i])[:, 1]
        valid = np.isfinite(oof)
        best_t, best_ba = 0.5, -1
        if valid.sum() and len(np.unique(ytr.to_numpy()[valid])) == 2:
            for threshold in np.arange(0.1, 0.91, 0.025):
                pred = (oof[valid] >= threshold).astype(int)
                ba = balanced_accuracy_score(ytr.to_numpy()[valid], pred)
                f1_score(ytr.to_numpy()[valid], pred, zero_division=0)
                if ba > best_ba:
                    best_t, best_ba = float(threshold), float(ba)
        model = make_forecast_model()
        model.fit(tr[cols], tr[TARGET].astype(int))
        prob = model.predict_proba(te[cols])[:, 1]
        out['models'][name] = {
            'threshold': best_t, 'oof_balanced_accuracy': best_ba,
            'oof': pd.DataFrame({'event': tr['event'].to_numpy(), 'date': tr['date_utc'].dt.strftime('%Y-%m-%d').to_numpy(), 'p': oof}),
            'test': pd.DataFrame({'event': te['event'].to_numpy(), 'date': te['date_utc'].dt.strftime('%Y-%m-%d').to_numpy(), 'p': prob}),
        }
    return out
