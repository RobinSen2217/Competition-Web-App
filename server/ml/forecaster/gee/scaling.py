"""Per-image band maths, verbatim from the notebook (cells 21-41).

Each function takes one Earth Engine image and returns it with the scaled
bands added, exactly as the notebook's scale_* / prep_* functions do. They only
call image methods (select, multiply, add, ...), so tests can run them on a
small fake image with numbers instead of an ee.Image; the one Earth Engine
constructor needed (ee.Image.constant) goes through `_constant`.
"""

# Landsat Collection 2 Level 2 surface reflectance: DN * 0.0000275 - 0.2.
SR_SCALE, SR_OFFSET = 0.0000275, -0.2
LANDSAT_NAMES = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2']
TM_ETM_BANDS = ['SR_B1', 'SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B7']   # Landsat 5 / 7
OLI_BANDS = ['SR_B2', 'SR_B3', 'SR_B4', 'SR_B5', 'SR_B6', 'SR_B7']      # Landsat 8 / 9
# Cell 26 SLOPE / INTER: maps OLI reflectance onto the TM/ETM+ scale so the
# four sensors form one consistent series.
OLI_SLOPE = [0.8474, 0.8483, 0.9047, 0.8462, 0.8937, 0.9071]
OLI_INTER = [0.0003, 0.0088, 0.0061, 0.0412, 0.0254, 0.0172]
# QA_PIXEL bits 1-5: dilated cloud, cirrus, cloud, cloud shadow, snow.
LANDSAT_QA_MASK = 0b111110

KEEP = ['system:time_start']


def _constant(values):
    import ee  # only needed when running against Earth Engine
    return ee.Image.constant(values)


def scale_modis(img):                                   # cell 21, MODIS/061/MOD11A2
    lst_day_c = img.select('LST_Day_1km').multiply(0.02).subtract(273.15).rename('LST_Day_C')
    lst_night_c = img.select('LST_Night_1km').multiply(0.02).subtract(273.15).rename('LST_Night_C')
    emis31 = img.select('Emis_31').multiply(0.002).add(0.49).rename('Emissivity_31').toFloat()
    emis32 = img.select('Emis_32').multiply(0.002).add(0.49).rename('Emissivity_32').toFloat()
    return img.addBands([lst_day_c, lst_night_c, emis31, emis32]).copyProperties(img, KEEP)


def scale_albedo(img):                                  # cell 23, MODIS/061/MCD43A3
    albedo_scaled = img.select('Albedo_WSA_shortwave').multiply(0.001).rename('Albedo')
    return img.addBands(albedo_scaled).copyProperties(img, KEEP)


def scale_aerosol(img):                                 # cell 24, Sentinel-5P aerosol index
    ai = img.select('absorbing_aerosol_index').rename('UV_Aerosol_Index')
    return img.addBands(ai).copyProperties(img, KEEP)


def mask_landsat(img):                                  # cell 26
    qa = img.select('QA_PIXEL')
    return img.updateMask(qa.bitwiseAnd(LANDSAT_QA_MASK).eq(0))


def prep_tm_etm(img):                                   # cell 26, Landsat 5 TM and 7 ETM+
    img = mask_landsat(img)
    sr = img.select(TM_ETM_BANDS, LANDSAT_NAMES).multiply(SR_SCALE).add(SR_OFFSET)
    return sr.copyProperties(img, KEEP)


def prep_oli(img):                                      # cell 26, Landsat 8 and 9
    img = mask_landsat(img)
    sr = img.select(OLI_BANDS, LANDSAT_NAMES).multiply(SR_SCALE).add(SR_OFFSET)
    sr = sr.multiply(_constant(OLI_SLOPE)).add(_constant(OLI_INTER)).rename(LANDSAT_NAMES)
    return sr.copyProperties(img, KEEP)


def add_indices(img):                                   # cell 26
    ndvi = img.normalizedDifference(['nir', 'red']).rename('NDVI')
    ndwi = img.normalizedDifference(['green', 'nir']).rename('NDWI')    # McFeeters
    return img.addBands([ndvi, ndwi]).copyProperties(img, KEEP)


def scale_era5(img):                                    # cell 28, ERA5-Land monthly
    temp_c = img.select('temperature_2m').subtract(273.15).rename('AirTemp_C')
    precip_mm = img.select('total_precipitation_sum').multiply(1000).rename('Precip_mm')
    dewpoint_c = img.select('dewpoint_temperature_2m').subtract(273.15).rename('Dewpoint_C')
    u_wind = img.select('u_component_of_wind_10m').rename('Wind_U')
    v_wind = img.select('v_component_of_wind_10m').rename('Wind_V')
    wind_speed = u_wind.pow(2).add(v_wind.pow(2)).sqrt().rename('WindSpeed_ms')
    # Accumulated J/m² over the month; features.add_physics turns it into W/m².
    rs_down = img.select('surface_solar_radiation_downwards_sum').rename('Rs_down_Jm2')
    return img.addBands([temp_c, precip_mm, dewpoint_c, wind_speed, rs_down]).copyProperties(img, KEEP)


def scale_smap(img):                                    # cell 37, SMAP 10 km
    ssm = img.select('ssm').rename('Soil_Moisture_Surface_mm')
    susm = img.select('susm').rename('Soil_Moisture_Subsurface_mm')
    return img.addBands([ssm, susm]).copyProperties(img, KEEP)


def scale_dw(img):                                      # cell 39, Dynamic World
    urban = img.select('built').rename('Urban_Fraction')
    veg = img.select('trees').add(img.select('crops')).rename('Vegetation_Fraction')
    return img.addBands([urban, veg]).copyProperties(img, KEEP)


def scale_terraclimate(img):                            # cell 41, TerraClimate
    pdsi = img.select('pdsi').multiply(0.01).rename('PDSI')
    return img.addBands([pdsi]).copyProperties(img, KEEP)
