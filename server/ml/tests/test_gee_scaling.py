"""The notebook's per-image band maths (forecaster.gee.scaling) on made-up
pixel values, run on a numeric fake image instead of Earth Engine."""

import unittest
from unittest import mock

import numpy as np

from forecaster.gee import scaling

from .fake_ee import FakeImage

T0 = {'system:time_start': 1262304000000}


def img(**bands):
    return FakeImage(bands, T0)


class ModisAndOthers(unittest.TestCase):
    def test_modis_lst_and_emissivity(self):
        out = scaling.scale_modis(img(LST_Day_1km=[14952.0], LST_Night_1km=[14157.0], Emis_31=[241.0],
                                      Emis_32=[243.0]))
        self.assertAlmostEqual(out.value('LST_Day_C')[0], 14952 * 0.02 - 273.15, places=9)   # 25.89 °C
        self.assertAlmostEqual(out.value('LST_Night_C')[0], 14157 * 0.02 - 273.15, places=9)
        # toFloat: single precision, as in the notebook
        self.assertAlmostEqual(out.value('Emissivity_31')[0], 0.972, places=6)
        self.assertAlmostEqual(out.value('Emissivity_32')[0], 0.976, places=6)
        self.assertEqual(out.props, T0)
        self.assertIn('LST_Day_1km', out.bands)  # original bands kept (addBands)

    def test_albedo_aerosol_pdsi_smap(self):
        self.assertAlmostEqual(scaling.scale_albedo(img(Albedo_WSA_shortwave=[227.0])).value('Albedo')[0], 0.227)
        self.assertEqual(scaling.scale_aerosol(img(absorbing_aerosol_index=[1.5])).value('UV_Aerosol_Index')[0], 1.5)
        self.assertAlmostEqual(scaling.scale_terraclimate(img(pdsi=[-195.0])).value('PDSI')[0], -1.95)
        smap = scaling.scale_smap(img(ssm=[7.5], susm=[60.0]))
        self.assertEqual(smap.value('Soil_Moisture_Surface_mm')[0], 7.5)
        self.assertEqual(smap.value('Soil_Moisture_Subsurface_mm')[0], 60.0)

    def test_era5(self):
        out = scaling.scale_era5(img(
            temperature_2m=[290.259337], total_precipitation_sum=[0.001334196], dewpoint_temperature_2m=[280.0],
            u_component_of_wind_10m=[3.0], v_component_of_wind_10m=[-4.0],
            surface_solar_radiation_downwards_sum=[5.01e8]))
        self.assertAlmostEqual(out.value('AirTemp_C')[0], 17.109337, places=6)
        self.assertAlmostEqual(out.value('Precip_mm')[0], 1.334196, places=6)
        self.assertAlmostEqual(out.value('Dewpoint_C')[0], 6.85, places=6)
        self.assertAlmostEqual(out.value('WindSpeed_ms')[0], 5.0)
        self.assertEqual(out.value('Rs_down_Jm2')[0], 5.01e8)   # converted later, in features.add_physics

    def test_dynamic_world(self):
        out = scaling.scale_dw(img(built=[0.1], trees=[0.05], crops=[0.2]))
        self.assertAlmostEqual(out.value('Urban_Fraction')[0], 0.1)
        self.assertAlmostEqual(out.value('Vegetation_Fraction')[0], 0.25)


class Landsat(unittest.TestCase):
    # Two pixels: clear (QA 0b1000000 = bit 6, clear flag) and cloudy (bit 3).
    QA = [64.0, 8.0]

    def sr(self, bands, values):
        return img(QA_PIXEL=self.QA, **{b: [v, v] for b, v in zip(bands, values)})

    def test_qa_mask_bits_1_to_5(self):
        qa = np.array([0, 1, 2, 4, 8, 16, 32, 64, 128], dtype='float64')
        out = scaling.mask_landsat(img(QA_PIXEL=qa, x=np.ones(9)))
        # no flag, bit 0 (fill), 6 (clear) and 7 (water) pass; bits 1-5 are masked.
        self.assertEqual(np.isnan(out.value('x')).tolist(), [False, False, True, True, True, True, True, False, False])

    def test_tm_etm_reflectance_and_indices(self):
        dn = [8000, 9000, 10000, 16000, 14000, 12000]   # SR_B1..B5, B7
        out = scaling.add_indices(scaling.prep_tm_etm(self.sr(scaling.TM_ETM_BANDS, dn)))
        red = 10000 * 0.0000275 - 0.2
        nir = 16000 * 0.0000275 - 0.2
        green = 9000 * 0.0000275 - 0.2
        self.assertAlmostEqual(out.value('red')[0], red)
        self.assertAlmostEqual(out.value('NDVI')[0], (nir - red) / (nir + red))
        self.assertAlmostEqual(out.value('NDWI')[0], (green - nir) / (green + nir))
        self.assertTrue(np.isnan(out.value('NDVI')[1]))   # cloudy pixel masked
        self.assertEqual(out.props, T0)

    def test_oli_is_harmonised_with_slope_and_intercept(self):
        dn = [8000, 9000, 10000, 16000, 14000, 12000]   # SR_B2..B7
        with mock.patch.object(scaling, '_constant', FakeImage.constant):
            out = scaling.add_indices(scaling.prep_oli(self.sr(scaling.OLI_BANDS, dn)))
        refl = [v * 0.0000275 - 0.2 for v in dn]
        harm = [r * s + i for r, s, i in zip(refl, scaling.OLI_SLOPE, scaling.OLI_INTER)]
        for name, want in zip(scaling.LANDSAT_NAMES, harm):
            self.assertAlmostEqual(out.value(name)[0], want)
        red, nir = harm[2], harm[3]
        self.assertAlmostEqual(out.value('NDVI')[0], (nir - red) / (nir + red))


if __name__ == '__main__':
    unittest.main()
