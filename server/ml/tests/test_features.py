"""Physics features (notebook cell 45) against values worked out by hand.

Inputs: T = 30 °C, Td = 20 °C, LST day 40 / night 22 °C, albedo 0.2,
wind 2 m/s, MODIS Emissivity_31 = 0.9712, ERA5 sunlight 6.0e8 J/m² per month.
By hand: es(30) = 4.243065 kPa, ea(20) = 2.338281 kPa, VPD = 1.904784 kPa.
"""

import unittest

import pandas as pd

from forecaster import features


def frame(dates=('2020-01-01', '2020-02-01', '2020-03-01'), rain=(10.0, 20.0, 30.0), **over):
    n = len(dates)
    cols = {
        'date': list(dates), 'AirTemp_C': [30.0] * n, 'Dewpoint_C': [20.0] * n, 'Precip_mm': list(rain),
        'WindSpeed_ms': [2.0] * n, 'Rs_down_Jm2': [6.0e8] * n, 'LST_Day_C': [40.0] * n,
        'LST_Night_C': [22.0] * n, 'Albedo': [0.2] * n, 'Emissivity_31': [0.9712] * n,
    }
    cols.update(over)
    return features.add_physics(pd.DataFrame(cols))


class PhysicsFeatures(unittest.TestCase):
    def test_sunlight_uses_the_real_month_length(self):
        df = frame(dates=('2020-01-01', '2020-02-01', '2021-02-01', '2020-04-01'), rain=(0, 0, 0, 0))
        # 6e8 J over 31, 29 (leap year), 28 and 30 days of 86 400 s
        expect = [224.0143369, 239.4636015, 6.0e8 / (28 * 86400), 231.4814815]
        for got, want in zip(df['Rs_down_Wm2'], expect):
            self.assertAlmostEqual(got, want, places=6)

    def test_vpd(self):
        self.assertAlmostEqual(frame()['VPD_kPa'].iloc[0], 1.9047838, places=6)

    def test_net_radiation_with_real_emissivity(self):
        df = frame()
        self.assertAlmostEqual(df['R_n'].iloc[0], 49.5840947, places=5)   # January, 31 days
        self.assertAlmostEqual(df['R_n'].iloc[1], 61.9435064, places=5)   # February 2020, 29 days
        # The emissivity column is used as is, not a constant.
        other = frame(Emissivity_31=[0.95] * 3)
        self.assertNotAlmostEqual(other['R_n'].iloc[0], df['R_n'].iloc[0], places=2)

    def test_simple_differences_and_products(self):
        row = frame().iloc[2]
        self.assertAlmostEqual(row['delta_T'], 10.0)
        self.assertAlmostEqual(row['LST_DTR'], 18.0)
        self.assertAlmostEqual(row['evopration_demand'], 1.9047838 * 2, places=6)
        self.assertAlmostEqual(row['Sensible_Heat_Proxy'], 20.0)
        self.assertAlmostEqual(row['Vapor_Slope_kPa_C'], 0.2433625, places=6)

    def test_rain_sums_skip_missing_months(self):
        df = frame()
        self.assertEqual(df['Precip_2mo_sum'].tolist(), [10.0, 30.0, 50.0])
        self.assertEqual(df['Precip_3mo_sum'].tolist(), [10.0, 30.0, 60.0])
        df = frame(rain=(10.0, float('nan'), 30.0))
        self.assertEqual(df['Precip_2mo_sum'].tolist(), [10.0, 10.0, 30.0])
        self.assertEqual(df['Precip_3mo_sum'].tolist(), [10.0, 10.0, 40.0])

    def test_physics_columns_in_notebook_order(self):
        df = frame()
        self.assertEqual(list(df.columns[-len(features.PHYSICS_COLUMNS):]), features.PHYSICS_COLUMNS)

    def test_season_encoding(self):
        df = features.add_season(pd.DataFrame({'date': pd.to_datetime(['2010-01-01', '2010-07-01'])}))
        self.assertAlmostEqual(df['sin_month'].iloc[0], 0.0)  # January
        self.assertAlmostEqual(df['cos_month'].iloc[0], 1.0)
        self.assertAlmostEqual(df['cos_month'].iloc[1], -1.0)  # July
        self.assertAlmostEqual(df['t_years'].iloc[1], 181 / 365.25)

    def test_final_columns_are_the_notebook_csv(self):
        # Cell 48's printout of the final CSV's columns.
        self.assertEqual(features.FINAL_COLUMNS, [
            'Emissivity_31', 'Emissivity_32', 'LST_Day_C', 'LST_Night_C', 'date', 'Albedo', 'NDVI', 'NDWI',
            'AirTemp_C', 'Dewpoint_C', 'Precip_mm', 'Rs_down_Jm2', 'WindSpeed_ms', 'UV_Aerosol_Index',
            'landcover_mode', 'soil_texture_mode', 'population_total', 'population_density_mean',
            'Soil_Moisture_Subsurface_mm', 'Soil_Moisture_Surface_mm', 'Urban_Fraction', 'Vegetation_Fraction',
            'PDSI', 'VPD_kPa', 'delta_T', 'Rs_down_Wm2', 'R_n', 'evopration_demand', 'LST_DTR',
            'Sensible_Heat_Proxy', 'Vapor_Slope_kPa_C', 'Precip_2mo_sum', 'Precip_3mo_sum'])

    def test_every_model_column_has_a_label(self):
        for item in features.describe(features.model_columns(3)):
            self.assertTrue(item['label'])
        self.assertEqual(features.feature_info('NDVI_lag1')[0], "Last month's NDVI")


if __name__ == '__main__':
    unittest.main()
