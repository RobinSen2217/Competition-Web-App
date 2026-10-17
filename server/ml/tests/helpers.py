"""Shared test helpers: a synthetic features table in the notebook's layout,
requests built from it, and a CLI runner."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from forecaster import features

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR / 'tools'))

from build_request import build_request  # noqa: E402  (path set just above)


def synthetic_table(n=120, start='2010-01-01', seed=0):
    """A features table with the notebook's 33 columns and a seasonal cycle.

    NDVI follows last month's rain and the season, plus a little noise, so the
    models have something real to learn. Like the real data, the aerosol index
    and Dynamic World are empty in the early years and SMAP is patchy.
    """
    rng = np.random.RandomState(seed)
    dates = pd.date_range(start, periods=n, freq='MS')
    s = np.sin(2 * np.pi * (dates.month - 1) / 12)
    c = np.cos(2 * np.pi * (dates.month - 1) / 12)
    rain = np.maximum(0.0, 60 * s + 20 + rng.normal(0, 8, n))
    prev_rain = np.concatenate([[rain[0]], rain[:-1]])
    df = pd.DataFrame({
        'Emissivity_31': 0.9712 + rng.normal(0, 2e-4, n),
        'Emissivity_32': 0.9759 + rng.normal(0, 2e-4, n),
        'LST_Day_C': 33 + 9 * s + rng.normal(0, 1, n),
        'LST_Night_C': 18 + 6 * s + rng.normal(0, 1, n),
        'date': dates.strftime('%Y-%m-%d'),
        'Albedo': 0.22 + 0.02 * c + rng.normal(0, 0.003, n),
        'NDVI': 0.15 + 0.0008 * prev_rain + 0.02 * c + rng.normal(0, 0.004, n),
        'NDWI': -0.25 + rng.normal(0, 0.01, n),
        'AirTemp_C': 25 + 8 * s + rng.normal(0, 0.5, n),
        'Dewpoint_C': 12 + 6 * s + rng.normal(0, 0.5, n),
        'Precip_mm': rain,
        'Rs_down_Jm2': 6.5e8 + 1.5e8 * s + rng.normal(0, 1e7, n),
        'WindSpeed_ms': 2.5 + 1.5 * s + rng.normal(0, 0.2, n),
        'UV_Aerosol_Index': np.where(np.arange(n) < 24, np.nan, 1 + 0.3 * s),
        'landcover_mode': 50.0,
        'soil_texture_mode': 6,
        'population_total': 2875.6,
        'population_density_mean': 6.37,
        'Soil_Moisture_Subsurface_mm': np.where(np.arange(n) % 7 == 0, np.nan, 40 + 10 * s),
        'Soil_Moisture_Surface_mm': np.where(np.arange(n) % 7 == 0, np.nan, 5 + 2 * s),
        'Urban_Fraction': np.where(np.arange(n) < 12, np.nan, 0.1),
        'Vegetation_Fraction': np.where(np.arange(n) < 12, np.nan, 0.2 + 0.05 * s),
        'PDSI': -1.5 + 0.5 * s,
    })
    features.add_physics(df)
    return df[features.FINAL_COLUMNS]


def table_rows(df):
    """DataFrame -> JSON-ready rows (NaN -> None, numpy -> Python)."""
    out = []
    for rec in df.itertuples(index=False):
        out.append([v if isinstance(v, str) else (None if pd.isna(v) else float(v)) for v in rec])
    return out


def synthetic_request(n=120, table=None, **overrides):
    df = synthetic_table(n) if table is None else table
    req = {
        'version': 2,
        'area': {'id': 'test', 'name': 'Test', 'center': {'lat': 26.911773, 'lon': 70.929989}, 'halfWidthKm': 1},
        'interval': 'monthly',
        'columns': list(df.columns),
        'rows': table_rows(df),
        'target': 'NDVI',
        'horizon': 12,
        'models': ['ridge', 'nn', 'gbm'],
    }
    req.update(overrides)
    return req


def run_cli(request, module='forecaster', args=(), env=None):
    """Run `python -m <module>` as the server will; returns (exit code, parsed stdout, stderr)."""
    payload = request if isinstance(request, str) or request is None else json.dumps(request)
    proc = subprocess.run([sys.executable, '-m', module, *args], input=payload or '', capture_output=True,
                          text=True, cwd=ML_DIR, timeout=300, env=env)
    return proc.returncode, json.loads(proc.stdout), proc.stderr


__all__ = ['build_request', 'synthetic_table', 'synthetic_request', 'table_rows', 'run_cli', 'ML_DIR']
