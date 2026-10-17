"""Merging the per-dataset monthly tables into the final features table:
notebook cells 33 (satellite merge + static columns), 42 (v5 merge) and
45-46 (physics, final CSV). Pure pandas, no Earth Engine."""

import pandas as pd

from .. import features


def merge_satellite(df_lst, df_albedo, df_spectral, df_era5, df_uv, statics):
    """Cell 33. `statics` holds the four constant columns of cells 30-31:
    landcover_mode, soil_texture_mode, population_total, population_density_mean."""
    df_satellite = (
        df_lst.merge(df_albedo, on='date', how='outer')
        .merge(df_spectral, on='date', how='outer')
        .merge(df_era5, on='date', how='outer')
        .merge(df_uv, on='date', how='outer')
    )
    df_satellite = df_satellite.sort_values('date').reset_index(drop=True)
    for key in ('landcover_mode', 'soil_texture_mode', 'population_total', 'population_density_mean'):
        df_satellite[key] = statics.get(key)
    return df_satellite


def _iso_dates(df):
    df = df.copy()
    df['date'] = pd.to_datetime(df['date']).dt.strftime('%Y-%m-%d')
    return df


def merge_v5(df_satellite, df_smap, df_dw, df_pdsi):
    """Cell 42: dates normalised to YYYY-MM-DD, outer merges, sorted."""
    df_v5 = (
        _iso_dates(df_satellite).merge(_iso_dates(df_smap), on='date', how='outer')
        .merge(_iso_dates(df_dw), on='date', how='outer')
        .merge(_iso_dates(df_pdsi), on='date', how='outer')
    )
    return df_v5.sort_values('date').reset_index(drop=True)


def final_table(df_v5):
    """Cells 45-46: physics columns added, columns in the notebook's CSV order.

    Earth Engine leaves a band out of a month's result when it has no pixels,
    so a dataset with no data at all for an area (e.g. no SMAP coverage) would
    lose its column; reindexing restores it as empty and keeps every area's
    file in the same 33-column layout.
    """
    df = df_v5.reindex(columns=features.V5_COLUMNS).copy()
    # The notebook re-read its CSVs before cells 42 and 45, which turns columns
    # of nulls into float NaN; do the same so the physics maths never meets None.
    for col in features.V5_COLUMNS:
        if col != 'date':
            df[col] = pd.to_numeric(df[col])
    features.add_physics(df)
    return df[features.FINAL_COLUMNS]


def missing_columns(df_v5):
    """V5 columns absent from a merged table (no data at all for the area)."""
    return [c for c in features.V5_COLUMNS if c not in df_v5.columns]
