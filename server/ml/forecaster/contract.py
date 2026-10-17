"""Request validation: turn a raw JSON object into a checked Request or raise
InvalidInput with a message that names the offending field.

Contract version 2: the request carries one area's features table (the
columns and rows of server/data/gee/<id>.features.csv) as produced by the
Earth Engine extraction, i.e. the notebook's final CSV.

Validation lives here, not in the Node server, so the black box is safe to call
from anywhere (CLI, tests, another service) and the rules sit next to the code
that depends on them.
"""

import math
import re
from dataclasses import dataclass, field

from . import features
from .models import MODELS

VERSION = 2
INTERVALS = ('monthly',)         # the only cadence the models are built for
TARGETS = (features.TARGET,)     # the notebook models Landsat NDVI only
DEFAULT_HORIZON = 12             # notebook N_FORECAST
MAX_HORIZON = 24
DEFAULT_OPTIONS = {'testFraction': 0.2, 'seed': 42, 'lags': 2}
MAX_LAGS = 12
MAX_ROWS = 1200                  # 100 years of months; anything larger is a mistake
# Columns the models read; any other notebook column may come along and is ignored.
REQUIRED_COLUMNS = [features.DATE, features.TARGET] + features.DRIVERS

_DATE = re.compile(r'^(\d{4})-(\d{2})-(\d{2})$')


class InvalidInput(ValueError):
    """The request is malformed or the data cannot support a forecast."""


@dataclass
class Request:
    area: dict
    interval: str
    columns: list
    rows: list
    target: str
    horizon: int
    models: list
    options: dict = field(default_factory=lambda: dict(DEFAULT_OPTIONS))


def _is_int(v):
    # bool is a subclass of int in Python; true/false must not pass as 1/0.
    return isinstance(v, int) and not isinstance(v, bool)


def _is_number(v):
    return (isinstance(v, (int, float)) and not isinstance(v, bool)) and math.isfinite(v)


def _month_index(s, where):
    m = _DATE.match(s) if isinstance(s, str) else None
    if not m or not 1 <= int(m.group(2)) <= 12 or not 1 <= int(m.group(3)) <= 31:
        raise InvalidInput(f'{where} must be a date as "YYYY-MM-DD", got {s!r}.')
    return int(m.group(1)) * 12 + int(m.group(2)) - 1


def _area(raw):
    if not isinstance(raw, dict):
        raise InvalidInput('"area" must be an object with an "id".')
    area_id = raw.get('id')
    if not isinstance(area_id, str) or not area_id.strip():
        raise InvalidInput('"area.id" must be a non-empty string.')
    name = raw.get('name', area_id)
    if not isinstance(name, str):
        raise InvalidInput('"area.name" must be a string.')
    center = raw.get('center')
    if center is not None:
        if not isinstance(center, dict) or not _is_number(center.get('lat')) or not _is_number(center.get('lon')):
            raise InvalidInput('"area.center" must be {"lat": number, "lon": number}.')
        if not (-90 <= center['lat'] <= 90 and -180 <= center['lon'] <= 180):
            raise InvalidInput('"area.center" is outside valid latitude/longitude ranges.')
    half = raw.get('halfWidthKm')
    if half is not None and (not _is_number(half) or half <= 0):
        raise InvalidInput('"area.halfWidthKm" must be a positive number.')
    return {'id': area_id, 'name': name, 'center': center, 'halfWidthKm': half}


def _columns(raw):
    if not isinstance(raw, list) or not raw or not all(isinstance(c, str) and c for c in raw):
        raise InvalidInput('"columns" must be a non-empty array of column names.')
    if len(set(raw)) != len(raw):
        raise InvalidInput('"columns" lists a column more than once.')
    missing = [c for c in REQUIRED_COLUMNS if c not in raw]
    if missing:
        raise InvalidInput(f'"columns" is missing: {", ".join(missing)} (required: {", ".join(REQUIRED_COLUMNS)}).')
    return list(raw)


def _rows(raw, columns):
    if not isinstance(raw, list) or not raw:
        raise InvalidInput('"rows" must be a non-empty array of rows.')
    if len(raw) > MAX_ROWS:
        raise InvalidInput(f'"rows" has {len(raw)} rows; at most {MAX_ROWS} are accepted.')
    date_at = columns.index(features.DATE)
    months = []
    for i, row in enumerate(raw):
        if not isinstance(row, list) or len(row) != len(columns):
            raise InvalidInput(f'"rows[{i}]" must be an array with one value per column ({len(columns)}).')
        for j, v in enumerate(row):
            if j == date_at:
                months.append(_month_index(v, f'"rows[{i}]" date'))
            elif v is not None and not _is_number(v):
                raise InvalidInput(f'"rows[{i}]" {columns[j]} must be a finite number or null, got {v!r}.')
    for i in range(1, len(months)):
        # NDVI lags and rolling rain sums count rows as months, so a gap or a
        # reordering would silently misalign them; demand an unbroken run.
        if months[i] != months[i - 1] + 1:
            raise InvalidInput(
                f'"rows" must be consecutive months in date order; {raw[i - 1][date_at]} is followed by '
                f'{raw[i][date_at]}.')
    return raw


def _models(raw):
    if not isinstance(raw, list) or not raw:
        raise InvalidInput(f'"models" must be a non-empty array; available: {", ".join(MODELS)}.')
    unknown = [m for m in raw if not isinstance(m, str) or m not in MODELS]
    if unknown:
        raise InvalidInput(f'Unknown model(s): {", ".join(map(str, unknown))}; available: {", ".join(MODELS)}.')
    if len(set(raw)) != len(raw):
        raise InvalidInput('"models" lists a model more than once.')
    return list(raw)


def _options(raw):
    if raw is None:
        return dict(DEFAULT_OPTIONS)
    if not isinstance(raw, dict):
        raise InvalidInput('"options" must be an object.')
    unknown = [k for k in raw if k not in DEFAULT_OPTIONS]
    if unknown:
        raise InvalidInput(f'Unknown option(s): {", ".join(unknown)}; allowed: {", ".join(DEFAULT_OPTIONS)}.')
    opts = {**DEFAULT_OPTIONS, **raw}
    tf = opts['testFraction']
    if not _is_number(tf) or not 0 < tf < 0.5:
        raise InvalidInput('"options.testFraction" must be a number between 0 and 0.5 (exclusive).')
    if not _is_int(opts['seed']) or not 0 <= opts['seed'] < 2 ** 32:
        raise InvalidInput('"options.seed" must be an integer from 0 to 2^32 - 1.')
    if not _is_int(opts['lags']) or not 1 <= opts['lags'] <= MAX_LAGS:
        raise InvalidInput(f'"options.lags" must be an integer from 1 to {MAX_LAGS}.')
    return opts


def parse_request(raw):
    """Validate a decoded JSON request. Returns Request or raises InvalidInput."""
    if not isinstance(raw, dict):
        raise InvalidInput('The request must be a JSON object.')
    if raw.get('version') != VERSION:
        raise InvalidInput(f'"version" must be {VERSION}.')
    interval = raw.get('interval')
    if interval not in INTERVALS:
        raise InvalidInput(f'"interval" must be one of: {", ".join(INTERVALS)}.')
    target = raw.get('target')
    if target not in TARGETS:
        raise InvalidInput(f'"target" must be one of: {", ".join(TARGETS)} (got {target!r}).')
    horizon = raw.get('horizon', DEFAULT_HORIZON)
    if not _is_int(horizon) or not 1 <= horizon <= MAX_HORIZON:
        raise InvalidInput(f'"horizon" must be an integer from 1 to {MAX_HORIZON}.')
    columns = _columns(raw.get('columns'))
    return Request(
        area=_area(raw.get('area')),
        interval=interval,
        columns=columns,
        rows=_rows(raw.get('rows'), columns),
        target=target,
        horizon=horizon,
        models=_models(raw.get('models')),
        options=_options(raw.get('options')),
    )
