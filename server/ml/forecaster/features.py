"""The notebook's table layout, physics features and model inputs.

Source: GEE_Data_Pipeline_Lat_Long_08_10_26.ipynb. The Earth Engine extraction
(forecaster.gee) writes one features table per area with exactly the columns of
the notebook's final "v4_physics_big_Final" CSV (cell 46), and the black box
reads that table. Both sides import this module, so the column names, the
physics and the model inputs are defined once.

Physics features, per month, exactly as notebook cell 45:

  es  = 0.6108 * exp(17.27 T / (T + 237.3))        saturation vapour pressure at air temp, kPa
  ea  = 0.6108 * exp(17.27 Td / (Td + 237.3))      actual vapour pressure (at dewpoint), kPa
  VPD_kPa            = es - ea                                   kPa
  delta_T            = LST_Day_C - AirTemp_C                     °C
  Rs_down_Wm2        = Rs_down_Jm2 / (days_in_month * 86400)     W/m² (ERA5 monthly sum -> mean flux)
  eps_sky            = 1.24 * (ea_hPa / Ta_K) ** (1/7)           Brutsaert clear-sky emissivity
  T_sky_K            = eps_sky ** 0.25 * Ta_K
  R_n                = (1 - Albedo) Rs + eps sigma T_sky^4 - eps sigma T_surf^4   W/m²
                       (T_surf = LST_Day_C in K, eps = MODIS Emissivity_31)
  evopration_demand  = VPD * WindSpeed_ms                        kPa·m/s
  LST_DTR            = LST_Day_C - LST_Night_C                   °C
  Sensible_Heat_Proxy= delta_T * WindSpeed_ms                    °C·m/s
  Vapor_Slope_kPa_C  = 4098 es / (T + 237.3)^2                   kPa/°C
  Precip_2mo_sum     = rolling 2-row sum of Precip_mm            (min_periods=1)
  Precip_3mo_sum     = rolling 3-row sum of Precip_mm            (min_periods=1)
"""

import numpy as np
import pandas as pd

SIGMA = 5.670374e-8  # Stefan-Boltzmann constant, W/m^2/K^4

# Columns of the notebook's merged table before physics (cell 42 output, as
# listed by cell 48), in the notebook's order. The order is what pandas
# produced from the notebook's merges; it is fixed here so every area's file
# has the same layout even when a dataset has no data at all for an area.
V5_COLUMNS = [
    'Emissivity_31', 'Emissivity_32', 'LST_Day_C', 'LST_Night_C', 'date',
    'Albedo', 'NDVI', 'NDWI', 'AirTemp_C', 'Dewpoint_C', 'Precip_mm', 'Rs_down_Jm2', 'WindSpeed_ms',
    'UV_Aerosol_Index', 'landcover_mode', 'soil_texture_mode', 'population_total', 'population_density_mean',
    'Soil_Moisture_Subsurface_mm', 'Soil_Moisture_Surface_mm', 'Urban_Fraction', 'Vegetation_Fraction', 'PDSI',
]

# Columns cell 45 adds, in the order it adds them.
PHYSICS_COLUMNS = [
    'VPD_kPa', 'delta_T', 'Rs_down_Wm2', 'R_n', 'evopration_demand', 'LST_DTR',
    'Sensible_Heat_Proxy', 'Vapor_Slope_kPa_C', 'Precip_2mo_sum', 'Precip_3mo_sum',
]

# The final features CSV (cell 46): 33 columns including "date".
FINAL_COLUMNS = V5_COLUMNS + PHYSICS_COLUMNS

TARGET = 'NDVI'
DATE = 'date'

# Model drivers, notebook cell 54 FEATURES (same order).
DRIVERS = [
    'AirTemp_C', 'Dewpoint_C', 'Precip_mm', 'WindSpeed_ms', 'VPD_kPa', 'Rs_down_Wm2',
    'evopration_demand', 'Vapor_Slope_kPa_C', 'Precip_2mo_sum', 'Precip_3mo_sum',
    'R_n', 'delta_T', 'LST_DTR',
]
SEASON = ['sin_month', 'cos_month']

# key -> (label, unit). Labels are what a person reads on the site, so they say
# what the thing is rather than repeat the notebook's column name.
FEATURE_INFO = {
    'AirTemp_C': ('Air temperature', '°C'),
    'Dewpoint_C': ('Dewpoint temperature', '°C'),
    'Precip_mm': ('Rainfall this month', 'mm'),
    'WindSpeed_ms': ('Wind speed', 'm/s'),
    'VPD_kPa': ('Vapour pressure deficit', 'kPa'),
    'Rs_down_Wm2': ('Incoming sunlight', 'W/m²'),
    # Key keeps the notebook's spelling so results line up with the team's work.
    'evopration_demand': ('Evaporative demand', 'kPa·m/s'),
    'Vapor_Slope_kPa_C': ('Vapour-pressure curve slope', 'kPa/°C'),
    'Precip_2mo_sum': ('Rainfall, last 2 months', 'mm'),
    'Precip_3mo_sum': ('Rainfall, last 3 months', 'mm'),
    'R_n': ('Net radiation', 'W/m²'),
    'delta_T': ('Surface minus air temperature', '°C'),
    'LST_DTR': ('Day-night surface temperature range', '°C'),
    'sin_month': ('Season (sine of month)', ''),
    'cos_month': ('Season (cosine of month)', ''),
}


def lag_columns(lags):
    return [f'NDVI_lag{k}' for k in range(1, lags + 1)]


def model_columns(lags):
    """Model input columns in order (notebook COLS with USE_TREND = False)."""
    return DRIVERS + SEASON + lag_columns(lags)


def feature_info(key):
    if key.startswith('NDVI_lag'):
        k = int(key[len('NDVI_lag'):])
        label = "Last month's NDVI" if k == 1 else f'NDVI {k} months earlier'
        return label, ''
    return FEATURE_INFO[key]


def describe(columns):
    return [{'key': key, 'label': feature_info(key)[0], 'unit': feature_info(key)[1]} for key in columns]


def saturation_vp(temp_c):
    """Tetens saturation vapour pressure, kPa (temp in °C)."""
    return 0.6108 * np.exp((17.27 * temp_c) / (temp_c + 237.3))


def add_physics(df):
    """Add the physics columns of notebook cell 45 to `df` in place; returns df.

    `df` needs the v5 columns and must be sorted by date with one row per
    month (the rolling rain sums count rows, as in the notebook).
    """
    es = saturation_vp(df['AirTemp_C'])
    ea = saturation_vp(df['Dewpoint_C'])
    df['VPD_kPa'] = es - ea

    df['delta_T'] = df['LST_Day_C'] - df['AirTemp_C']

    # ERA5-Land's monthly aggregate is the month's accumulated J/m²; dividing by
    # that month's real length gives the mean flux.
    days_in_month = pd.to_datetime(df['date']).dt.days_in_month
    seconds_in_month = days_in_month * 86400
    df['Rs_down_Wm2'] = df['Rs_down_Jm2'] / seconds_in_month

    ta_k = df['AirTemp_C'] + 273.15
    ea_hpa = ea * 10.0  # kPa -> hPa, Brutsaert's formula expects hPa
    epsilon_sky = 1.24 * (ea_hpa / ta_k) ** (1.0 / 7.0)
    t_sky_k = (epsilon_sky ** 0.25) * ta_k
    t_surface_k = df['LST_Day_C'] + 273.15
    epsilon_surface = df['Emissivity_31']
    df['R_n'] = (
        (1 - df['Albedo']) * df['Rs_down_Wm2']
        + epsilon_surface * SIGMA * t_sky_k ** 4
        - epsilon_surface * SIGMA * t_surface_k ** 4
    )

    df['evopration_demand'] = df['VPD_kPa'] * df['WindSpeed_ms']
    df['LST_DTR'] = df['LST_Day_C'] - df['LST_Night_C']
    df['Sensible_Heat_Proxy'] = df['delta_T'] * df['WindSpeed_ms']
    df['Vapor_Slope_kPa_C'] = (4098 * es) / ((df['AirTemp_C'] + 237.3) ** 2)
    # min_periods=1: a missing month is skipped in the sum, as in the notebook.
    df['Precip_2mo_sum'] = df['Precip_mm'].rolling(window=2, min_periods=1).sum()
    df['Precip_3mo_sum'] = df['Precip_mm'].rolling(window=3, min_periods=1).sum()
    return df


def add_season(d):
    """Month-of-year as a point on a circle, so December sits next to January
    (notebook add_season, including the unused t_years trend column)."""
    m = d['date'].dt.month
    d['sin_month'], d['cos_month'] = np.sin(2 * np.pi * (m - 1) / 12), np.cos(2 * np.pi * (m - 1) / 12)
    d['t_years'] = (d['date'] - pd.Timestamp('2010-01-01')).dt.days / 365.25
    return d
