"""Helpers for the hazard tests: environment checks, a cached model run on the
committed flood dataset (several seconds each, so it runs once per test
process) and writers for small synthetic datasets and sources."""

import csv
import functools
import json
import platform
import shutil
from pathlib import Path

FLOOD_DIR = Path(__file__).resolve().parents[2] / 'data' / 'hazards' / 'flood'
NOTEBOOK_EVENTS = [
    '01_mozambique_limpopo', '02_china_guangxi', '03_pakistan_punjab', '04_usa_indiana', '05_nepal_trishuli',
    '06_india_bihar_patna', '07_india_bihar_bhagalpur', '08_usa_wabash', '09_thailand_bangkok', '10_bangladesh_chattogram',
]


def sklearn_version():
    try:
        import sklearn
    except ImportError:
        return None
    return tuple(int(x) for x in sklearn.__version__.split('.')[:2])


def notebook_sklearn():
    """scikit-learn <= 1.8: forests as in the notebook (1.9 changed bootstrap sampling with class weights)."""
    v = sklearn_version()
    return v is not None and v < (1, 9)


def x86_64():
    return platform.machine().lower() in ('x86_64', 'amd64')


def has_rasterio():
    try:
        import rasterio  # noqa: F401
    except ImportError:
        return False
    return True


@functools.lru_cache(maxsize=None)
def committed_run():
    """flood.run() on the committed dataset, restricted to the notebook's events."""
    from forecaster.hazards import flood

    return flood.run(FLOOD_DIR, events=NOTEBOOK_EVENTS)


def export_raw_layout(dataset_dir, out_dir):
    """The normalized dataset written back in the sources' layout and column
    names (<out>/rainfall/<event>/rainfall_daily.csv, <out>/soil_moisture/<event>/
    soil_moisture_passes.csv), for the notebook copy to read."""
    manifest = json.loads((Path(dataset_dir) / 'events.json').read_text())
    rain_names = {'date': 'date_utc', 'rain_box_mm': 'box_mean_mm', 'rain_wettest_cell_mm': 'wettest_cell_mm'}
    for e in manifest['events']:
        for key, sub, name, rename in (('daily', 'rainfall', 'rainfall_daily.csv', rain_names),
                                       ('soil_passes', 'soil_moisture', 'soil_moisture_passes.csv', {'date': 'date_utc'})):
            src = e['files'].get(key)
            if not src:
                continue
            with open(Path(dataset_dir) / src, newline='') as f:
                rows = list(csv.reader(f))
            rows[0] = [rename.get(c, c) for c in rows[0]]
            dest = Path(out_dir) / sub / e['id'] / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, 'w', newline='') as f:
                csv.writer(f, lineterminator='\n').writerows(rows)
    return Path(out_dir) / 'rainfall', Path(out_dir) / 'soil_moisture'


def write_dataset(base, events):
    """A minimal normalized flood dataset. `events` = {id: {'daily': [(date,
    box, wet, flag)], 'soil': [(date, value, coverage, uncertainty)]}}."""
    base = Path(base)
    if base.exists():
        shutil.rmtree(base)
    records = []
    for eid, spec in events.items():
        d = base / 'events' / eid
        d.mkdir(parents=True)
        with open(d / 'daily.csv', 'w', newline='') as f:
            w = csv.writer(f, lineterminator='\n')
            w.writerow(['date', 'rain_box_mm', 'rain_wettest_cell_mm', 'cells_with_data', 'in_flood_period'])
            for date, box, wet, flag in spec['daily']:
                w.writerow([date, box, wet, 25, 'true' if flag else 'false'])
        files = {'daily': f'events/{eid}/daily.csv'}
        if spec.get('soil'):
            with open(d / 'soil_passes.csv', 'w', newline='') as f:
                w = csv.writer(f, lineterminator='\n')
                w.writerow(['date', 'track', 'coverage_pct', 'mean_sm', 'mean_sm_recommended_only', 'mean_uncertainty'])
                for date, value, cov, unc in spec['soil']:
                    w.writerow([date, 1, cov, value, value, unc])
            files['soil_passes'] = f'events/{eid}/soil_passes.csv'
        records.append({'id': eid, 'files': files})
    manifest = {
        'hazard': 'flood', 'version': 1, 'interval': 'daily',
        'tables': {'daily': {'kind': 'series', 'file': 'events/{eventId}/daily.csv', 'timeColumn': 'date', 'columns': {}},
                   'soil_passes': {'kind': 'observations', 'file': 'events/{eventId}/soil_passes.csv', 'timeColumn': 'date', 'columns': {}}},
        'events': records,
    }
    (base / 'events.json').write_text(json.dumps(manifest))
    return base
