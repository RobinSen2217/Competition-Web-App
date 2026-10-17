"""Earth Engine extraction: notebook cells 9-46 for one area, written to
server/data/gee/<id>.features.csv. Run with `python -m forecaster.gee`.

This file must stay free of Earth Engine imports: the forecasting black box
imports the constants below for its response, and it has to run where the
earthengine-api is not set up.
"""

PIPELINE = 'GEE notebook GEE_Data_Pipeline_Lat_Long_08_10_26'

START_DATE = '2010-01-01'  # notebook cell 11

# Every Earth Engine dataset the extraction reads, in notebook order.
DATASETS = [
    'MODIS/061/MOD11A2',                                  # cell 21: LST + emissivity
    'MODIS/061/MCD43A3',                                  # cell 23: albedo
    'COPERNICUS/S5P/OFFL/L3_AER_AI',                      # cell 24: UV aerosol index
    'LANDSAT/LT05/C02/T1_L2',                             # cell 26: NDVI / NDWI
    'LANDSAT/LE07/C02/T1_L2',
    'LANDSAT/LC08/C02/T1_L2',
    'LANDSAT/LC09/C02/T1_L2',
    'ECMWF/ERA5_LAND/MONTHLY_AGGR',                       # cell 28: weather
    'ESA/WorldCover/v200',                                # cell 30: land cover
    'OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02',    # cell 30: soil texture
    'WorldPop/GP/100m/pop',                               # cell 31: population
    'NASA_USDA/HSL/SMAP10KM_soil_moisture',               # cell 37: soil moisture
    'GOOGLE/DYNAMICWORLD/V1',                             # cell 39: urban / vegetation fractions
    'IDAHO_EPSCOR/TERRACLIMATE',                          # cell 41: drought index
]
