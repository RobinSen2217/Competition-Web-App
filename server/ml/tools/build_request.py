"""Build a contract-v2 forecaster request from one area's features table
(server/data/gee/<id>.features.csv, written by `python -m forecaster.gee extract`).

    .venv/bin/python tools/build_request.py jaisalmer | .venv/bin/python -m forecaster

Usable as a module too (tests import build_request). Every column of the CSV
is passed on; the black box picks the ones its models need. Options are left
to the black box's defaults (the notebook's).
"""

import argparse
import csv
import json
import math
import sys
from pathlib import Path

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from forecaster.gee.areas import AREAS_FILE, DATA_DIR, features_path, find_area  # noqa: E402


def _value(column, text):
    if column == 'date':
        return text
    if text == '':
        return None  # pandas writes NaN as an empty field
    v = float(text)
    return v if math.isfinite(v) else None


def read_table(path):
    with open(path, newline='') as f:
        reader = csv.reader(f)
        columns = next(reader)
        rows = [[_value(c, t) for c, t in zip(columns, row)] for row in reader if row]
    return columns, rows


def build_request(area_id, horizon=12, models=('ridge', 'nn', 'gbm'), csv_path=None,
                  areas_file=AREAS_FILE, data_dir=DATA_DIR):
    area = find_area(area_id, areas_file)
    columns, rows = read_table(csv_path or features_path(area_id, data_dir))
    return {
        'version': 2,
        'area': {
            'id': area['id'], 'name': area['name'],
            'center': {'lat': area['lat'], 'lon': area['lon']},
            'halfWidthKm': area['halfWidthKm'],
        },
        'interval': 'monthly',
        'columns': columns,
        'rows': rows,
        'target': 'NDVI',
        'horizon': horizon,
        'models': list(models),
    }


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('area', help='area id from server/data/gee/areas.json')
    p.add_argument('--csv', help='features CSV (default server/data/gee/<area>.features.csv)')
    p.add_argument('--horizon', type=int, default=12)
    a = p.parse_args()
    json.dump(build_request(a.area, horizon=a.horizon, csv_path=a.csv), sys.stdout, allow_nan=False)
