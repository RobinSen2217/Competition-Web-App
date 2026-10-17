"""The areas the extraction runs for (server/data/gee/areas.json) and the
notebook's area-of-interest box (cell 9). Pure Python, no Earth Engine."""

import json
import math
import re
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[3]
DATA_DIR = SERVER_DIR / 'data' / 'gee'
AREAS_FILE = DATA_DIR / 'areas.json'

# Ids become file names, so keep them to safe characters.
_ID = re.compile(r'^[a-z0-9][a-z0-9_-]*$')


class AreaError(ValueError):
    """areas.json is malformed or an area id is unknown."""


def half_extent_deg(center_lat, half_width_km):
    """(dlat, dlon) in degrees for a box `half_width_km` from the centre.

    Same flat-earth factors as cell 9: 110.574 km per degree of latitude and
    111.320 * cos(lat) km per degree of longitude.
    """
    lat_deg_per_km = 1 / 110.574
    lon_deg_per_km = 1 / (111.320 * math.cos(math.radians(center_lat)))
    return half_width_km * lat_deg_per_km, half_width_km * lon_deg_per_km


def aoi_bounds(center_lat, center_lon, half_width_km):
    """[west, south, east, north], the list cell 9 hands ee.Geometry.Rectangle."""
    dlat, dlon = half_extent_deg(center_lat, half_width_km)
    return [center_lon - dlon, center_lat - dlat, center_lon + dlon, center_lat + dlat]


def district_name(center_lat, center_lon):
    """Cell 9's file-name stem, e.g. aoi_26p9118_70p9300 (kept for reference in logs)."""
    return f'aoi_{center_lat:.4f}_{center_lon:.4f}'.replace('.', 'p').replace('-', 'm')


def _check(area, i):
    where = f'areas.json[{i}]'
    if not isinstance(area, dict):
        raise AreaError(f'{where} must be an object.')
    if not isinstance(area.get('id'), str) or not _ID.match(area['id']):
        raise AreaError(f'{where}.id must be lower-case letters, digits, "-" or "_".')
    # halfWidthKm is capped so a typo cannot start a continent-sized extraction.
    for key, lo, hi in (('lat', -90, 90), ('lon', -180, 180), ('halfWidthKm', 0.01, 50)):
        v = area.get(key)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise AreaError(f'{where}.{key} must be a number from {lo} to {hi}.')
    return {**area, 'name': area.get('name') or area['id']}


def load_areas(path=AREAS_FILE):
    try:
        raw = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise AreaError(f'Cannot read {path}: {exc}') from exc
    if not isinstance(raw, list):
        raise AreaError(f'{path} must hold an array of areas.')
    areas = [_check(a, i) for i, a in enumerate(raw)]
    ids = [a['id'] for a in areas]
    if len(set(ids)) != len(ids):
        raise AreaError(f'{path} lists an area id more than once.')
    return areas


def find_area(area_id, path=AREAS_FILE):
    areas = load_areas(path)
    for a in areas:
        if a['id'] == area_id:
            return a
    raise AreaError(f'Unknown area {area_id!r}; known: {", ".join(a["id"] for a in areas)}.')


def features_path(area_id, data_dir=DATA_DIR):
    return Path(data_dir) / f'{area_id}.features.csv'
