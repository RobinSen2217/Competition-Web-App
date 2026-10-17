"""Notebook cells 9-46 for one area: build the area box, pull every dataset
month by month, merge, add physics, write <id>.features.csv.

Collections, filters, band selections, reducers and scales are the
notebook's, cell by cell. Not part of the server pipeline (they draw pictures
and need Google Drive or geemap, and add nothing to the table): the map widget
(cell 13), the Sentinel-2 RGB thumbnail and index GeoTIFF heatmaps (cells
15-17), the intermediate Drive CSVs (cell 35) and the plots (cells 47-52).
"""

import datetime as dt
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import ee

from . import START_DATE, scaling, tables
from .aggregate import aggregate_monthly, aggregate_monthly_chunked
from .areas import aoi_bounds, district_name

log = logging.getLogger('forecaster.gee')


def default_end_date(today=None):
    """First day of the current month: the last whole month is the one before,
    and a half-finished month would mix part-month means into the table."""
    today = today or dt.date.today()
    return today.replace(day=1).isoformat()


@dataclass
class Extraction:
    tables: dict      # dataset name -> monthly DataFrame as the notebook prints it
    statics: dict     # landcover_mode, soil_texture_mode, population_total, population_density_mean
    v5: object        # merged table (cell 42)
    final: object     # final features table (cells 45-46)


def aoi_rectangle(area):
    """Cell 9: the box as an Earth Engine rectangle (planar, in degrees)."""
    return ee.Geometry.Rectangle(aoi_bounds(area['lat'], area['lon'], area['halfWidthKm']))


def _filtered(collection_id, start_date, end_date, geometry):
    return ee.ImageCollection(collection_id).filterDate(start_date, end_date).filterBounds(geometry)


def extract_area(area, start_date=START_DATE, end_date=None, sleep=time.sleep):
    """Run the notebook's extraction for one area (needs ee.Initialize first)."""
    end_date = end_date or default_end_date()
    g = aoi_rectangle(area)
    log.info('%s (%s): %s to %s, box %s', area['id'], district_name(area['lat'], area['lon']),
             start_date, end_date, aoi_bounds(area['lat'], area['lon'], area['halfWidthKm']))
    t = {}

    # Cell 21: MODIS land surface temperature + emissivity.
    modis = _filtered('MODIS/061/MOD11A2', start_date, end_date, g).select(
        ['LST_Day_1km', 'LST_Night_1km', 'Emis_31', 'Emis_32'])
    log.info('Number of MODIS images matching our filters: %s', modis.size().getInfo())
    t['lst'] = aggregate_monthly(
        modis.map(scaling.scale_modis), g, start_date, end_date,
        bands=['LST_Day_C', 'LST_Night_C', 'Emissivity_31', 'Emissivity_32'],
        reducer=ee.Reducer.mean(), scale=1000)

    # Cell 23: MODIS albedo.
    log.info('MODIS albedo ...')
    albedo_ic = (_filtered('MODIS/061/MCD43A3', start_date, end_date, g)
                 .select(['Albedo_WSA_shortwave']).map(scaling.scale_albedo))
    t['albedo'] = aggregate_monthly(albedo_ic, g, start_date, end_date,
                                    bands=['Albedo'], reducer=ee.Reducer.mean(), scale=500)

    # Cell 24: Sentinel-5P UV aerosol index.
    log.info('Sentinel-5P aerosol index ...')
    aerosol_ic = (_filtered('COPERNICUS/S5P/OFFL/L3_AER_AI', start_date, end_date, g)
                  .select(['absorbing_aerosol_index']).map(scaling.scale_aerosol))
    t['uv'] = aggregate_monthly(aerosol_ic, g, start_date, end_date,
                                bands=['UV_Aerosol_Index'], reducer=ee.Reducer.mean(), scale=1000)

    # Cell 26: Landsat 5/7/8/9 NDVI and NDWI.
    log.info('Landsat NDVI / NDWI ...')

    def col(cid, prep):
        return _filtered(cid, start_date, end_date, g).map(prep)

    landsat = (col('LANDSAT/LT05/C02/T1_L2', scaling.prep_tm_etm)
               .merge(col('LANDSAT/LE07/C02/T1_L2', scaling.prep_tm_etm))
               .merge(col('LANDSAT/LC08/C02/T1_L2', scaling.prep_oli))
               .merge(col('LANDSAT/LC09/C02/T1_L2', scaling.prep_oli))
               .map(scaling.add_indices))
    t['spectral'] = aggregate_monthly(landsat, g, start_date, end_date,
                                      bands=['NDVI', 'NDWI'], reducer=ee.Reducer.mean(), scale=30)

    # Cell 28: ERA5-Land weather.
    log.info('ERA5-Land ...')
    era5 = (_filtered('ECMWF/ERA5_LAND/MONTHLY_AGGR', start_date, end_date, g)
            .select(['temperature_2m', 'total_precipitation_sum', 'dewpoint_temperature_2m',
                     'u_component_of_wind_10m', 'v_component_of_wind_10m',
                     'surface_solar_radiation_downwards_sum'])
            .map(scaling.scale_era5))
    t['era5'] = aggregate_monthly(
        era5, g, start_date, end_date,
        bands=['AirTemp_C', 'Precip_mm', 'Dewpoint_C', 'WindSpeed_ms', 'Rs_down_Jm2'],
        reducer=ee.Reducer.mean(), scale=9000)

    # Cells 30-31: land cover, soil texture, population (one value per area).
    log.info('Land cover, soil, population ...')
    landcover = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map')
    lc_mode = landcover.reduceRegion(
        reducer=ee.Reducer.mode(), geometry=g, scale=10, maxPixels=1e9, bestEffort=True).getInfo()
    soil = ee.Image('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02').select('b0')
    soil_mode = soil.reduceRegion(
        reducer=ee.Reducer.mode(), geometry=g, scale=250, maxPixels=1e9, bestEffort=True).getInfo()
    worldpop = _filtered('WorldPop/GP/100m/pop', start_date, end_date, g).select('population').mean()
    pop_stats = worldpop.reduceRegion(
        reducer=ee.Reducer.sum(), geometry=g, scale=100, maxPixels=1e9, bestEffort=True).getInfo()
    pop_density_mean = worldpop.reduceRegion(
        reducer=ee.Reducer.mean(), geometry=g, scale=100, maxPixels=1e9, bestEffort=True).getInfo()
    statics = {
        'landcover_mode': lc_mode.get('Map'),
        'soil_texture_mode': soil_mode.get('b0'),
        'population_total': pop_stats.get('population'),
        'population_density_mean': pop_density_mean.get('population'),
    }
    log.info('Static values: %s', statics)

    # Cell 33: satellite merge.
    df_satellite = tables.merge_satellite(t['lst'], t['albedo'], t['spectral'], t['era5'], t['uv'], statics)

    # Cell 37: SMAP soil moisture.
    log.info('Extracting SMAP Soil Moisture...')
    smap_ic = (_filtered('NASA_USDA/HSL/SMAP10KM_soil_moisture', start_date, end_date, g)
               .select(['ssm', 'susm']).map(scaling.scale_smap))
    t['smap'] = aggregate_monthly(
        smap_ic, g, start_date, end_date,
        bands=['Soil_Moisture_Surface_mm', 'Soil_Moisture_Subsurface_mm'],
        reducer=ee.Reducer.mean(), scale=10000)

    # Cell 39: Dynamic World, chunked (too heavy for one request).
    log.info('Dynamic World (chunked) ...')
    dw_ic = _filtered('GOOGLE/DYNAMICWORLD/V1', start_date, end_date, g).map(scaling.scale_dw)
    t['dw'] = aggregate_monthly_chunked(
        dw_ic, g, start_date, end_date,
        bands=['Urban_Fraction', 'Vegetation_Fraction'],
        reducer=ee.Reducer.mean(), scale=100, chunk_months=6, sleep=sleep)

    # Cell 41: TerraClimate drought index.
    log.info('Extracting TerraClimate PDSI...')
    tc_ic = (_filtered('IDAHO_EPSCOR/TERRACLIMATE', start_date, end_date, g)
             .select(['pdsi']).map(scaling.scale_terraclimate))
    t['pdsi'] = aggregate_monthly(tc_ic, g, start_date, end_date,
                                  bands=['PDSI'], reducer=ee.Reducer.mean(), scale=4000)

    # Cells 42, 45-46.
    v5 = tables.merge_v5(df_satellite, t['smap'], t['dw'], t['pdsi'])
    missing = tables.missing_columns(v5)
    if missing:
        log.warning('%s: no data at all for %s; those columns stay empty.', area['id'], ', '.join(missing))
    final = tables.final_table(v5)
    log.info('%s: final table %s', area['id'], final.shape)
    return Extraction(tables=t, statics=statics, v5=v5, final=final)


def write_csv(df, path):
    """Write atomically, so a reader never sees a half-written table."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', newline='') as f:
            df.to_csv(f, index=False)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path
