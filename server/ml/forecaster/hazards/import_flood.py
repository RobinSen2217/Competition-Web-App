"""Import the team's flood event files into the normalized hazard dataset.

    python -m forecaster.hazards import flood --rainfall <dir> --soil <dir> [--layers <dir>] [--out <dir>]
    python -m forecaster.hazards import flood --layers <dir>        (layers only, events.json kept)
    python -m forecaster.hazards.import_flood --rainfall <dir> --soil <dir>      (same)

Sources (the folders inside the team's rainfall.zip and soil_moisture.zip):

    <rainfall>/rainfall_summary.csv, README.md
    <rainfall>/<event>/rainfall_daily.csv, rainfall_daily_grid.tif, README.md
    <soil>/soil_moisture_summary.csv, README.md
    <soil>/<event>/soil_moisture_passes.csv, *_soil_moisture.tif, README.md
    <layers>/<event>_water_reference.tif   (optional) the notebook's reference
                                       water labels (Part A), one per event

Output (default server/data/hazards/flood/, layout in dataset.py):

    events.json                        events, tables, column docs, sources
    events/<event>/daily.csv           date, rain_box_mm, rain_wettest_cell_mm,
                                       cells_with_data, in_flood_period
    events/<event>/soil_passes.csv     the pass table (date_utc renamed to date)
    layers.json, events/<event>/layers/water-reference.png
                                       with --layers: the reference water as a
                                       map overlay + stats (layers.py)
    README.md                          what all of it means

Every event is imported, including ones a model later leaves out (Nepal: a
glacier collapse, not rain; flood.py excludes it as the notebook did). Values
are copied as written in the sources, so a model reading the normalized files
sees exactly the numbers the notebook read. The event's bbox is the extent of
its rainfall GeoTIFF (EPSG:4326), i.e. the 0.1-degree IMERG cells covering
the event box. Country, admin area and cause, which the files do not carry,
come from flood_events.json next to this file.
"""

import argparse
import csv
import datetime as dt
import json
import logging
import re
import sys
from pathlib import Path

from .dataset import DATASET_VERSION, DatasetError, check_id, hazard_dir, read_manifest, write_csv, write_json, write_text
from .layers import LAYERS_FILE, mask_layer, read_layers, write_layers

log = logging.getLogger('forecaster.hazards')

HAZARD = 'flood'
META_FILE = Path(__file__).with_name('flood_events.json')

RAIN_DAILY = 'rainfall_daily.csv'
RAIN_GRID = 'rainfall_daily_grid.tif'
SOIL_PASSES = 'soil_moisture_passes.csv'

# Output column <- source column of rainfall_daily.csv.
DAILY_COLUMNS = [
    ('date', 'date_utc'),
    ('rain_box_mm', 'box_mean_mm'),
    ('rain_wettest_cell_mm', 'wettest_cell_mm'),
    ('cells_with_data', 'cells_with_data'),
    ('in_flood_period', 'in_flood_period'),
]
DAILY_DOCS = {
    'date': 'UTC day (00:00-24:00 UTC), YYYY-MM-DD',
    'rain_box_mm': 'Rain averaged over the event box, mm/day (GPM IMERG Late Run V07; cells weighted by their area inside the box)',
    'rain_wettest_cell_mm': 'Rain in the wettest 0.1-degree (~10 km) IMERG cell of the box that day, mm/day',
    'cells_with_data': 'Number of IMERG cells in the box with a value that day',
    'in_flood_period': 'true on the days of the reported flood period (flood_start..flood_end), false on the 7 days of lead-up rain before it',
}
# Soil pass columns are kept as the source has them; only date_utc becomes date.
SOIL_RENAME = {'date_utc': 'date'}
SOIL_DOCS = {
    'file': 'Source GeoTIFF of the pass (not copied; 200 m EASE-Grid 2.0, 4 bands)',
    'date': 'UTC date of the pass, YYYY-MM-DD',
    'utc_time': 'UTC time of the pass, YYYY-MM-DD HH:MM',
    'local_time': 'Local time of the pass, YYYY-MM-DD HH:MM',
    'track': 'NISAR track number',
    'direction': 'ASCENDING or DESCENDING orbit',
    'frames': 'Frames merged for the pass',
    'phase': 'before / onset / during / receding / after / unclear, relative to the flood timeline',
    'in_reported_flood_period': 'true if the pass falls in the reported flood period',
    'cells_in_box': 'Number of 200 m cells in the event box',
    'cells_with_soil_moisture': 'Cells with a soil moisture value (open water, towns, snow and heavy rain are empty)',
    'coverage_pct': '% of the box with a value',
    'mean_sm': 'Box mean soil moisture, m3/m3 (all values)',
    'median_sm': 'Box median soil moisture, m3/m3',
    'p10_sm': '10th percentile of soil moisture in the box, m3/m3',
    'p90_sm': '90th percentile of soil moisture in the box, m3/m3',
    'mean_sm_recommended_only': 'Box mean of "recommended" retrievals only (dense vegetation left out), m3/m3; the value the flood model uses',
    'cells_recommended': 'Cells with a recommended retrieval',
    'mean_uncertainty': "NASA's mean uncertainty estimate, m3/m3",
    'phase_reason': 'Why the pass got its phase label',
}
BOOLEAN_COLUMNS = {'in_flood_period', 'in_reported_flood_period'}
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

# ---- map layers (--layers) ----

# The notebook's reference water labels: <event>_water_reference.tif, EPSG:4326,
# uint8 band "water_label", ~30 m, 0 = not water, 1 = water, 255 = unknown.
WATER_REFERENCE_GLOB = '*_water_reference.tif'
WATER_REFERENCE = {
    'id': 'water-reference',
    'label': 'Reference water extent',
    'description': 'Water in the reference labels that the team notebook (flood_disaster.ipynb, Part A) uses to train and '
                   'score its NISAR HH/HV water segmentation: 1 = water, 0 = not water, 255 = unknown. Shown here as the '
                   'observed water around the event; it is not an output of this app.',
    'legend': [
        # A saturated mid blue at 80%: reads on light (CARTO Positron, OSM) and
        # dark (CARTO Dark Matter) basemaps, and is clearly not OSM's pale water.
        {'value': 1, 'key': 'water', 'label': 'Water', 'color': '#1a5cff', 'opacity': 0.8},
        {'value': 0, 'key': 'not_water', 'label': 'Not water', 'color': None, 'opacity': 0},
        {'value': 255, 'key': 'unknown', 'label': 'Unknown (no label)', 'color': None, 'opacity': 0},
    ],
    # Downsampling keeps water if any source pixel of the block is water, so
    # narrow channels survive at map scale.
    'priority': [1, 0],
    'source': {
        'notebook': 'flood_disaster.ipynb',
        'role': 'Reference labels for Part A water segmentation (NISAR HH/HV); "Prepared binary references: '
                '0=non-water, 1=water, 255=unknown"',
        'cells': 'Part A: label inventory (cell 11), single-event check (12), EVENT_LABEL_FILES (14), '
                 'multi-event dataset (30)',
        'origin': None,
        'date': None,
        'provenanceNote': 'The notebook does not say where these labels come from or which day they show. It pairs each '
                          'with the event\'s NISAR flood-time ("during") scene, and one of its plots titles value 1 '
                          '"candidate new water", so they are meant as the water at flood time, possibly flood water only '
                          'rather than every river and lake.',
    },
    'notes': [
        'Covers a larger area than the event box; stats.eventBox gives the numbers inside the box.',
        'The image is downsampled with an "any water" rule, so thin water looks a little wider than it is; '
        'the stats are counted at the native ~30 m.',
        'Unknown pixels are transparent, like non-water ones; stats.unknownPct says how many there are.',
    ],
}


def layer_event_id(name, event_ids):
    """The event a layer file belongs to: the longest event id its name starts
    with, followed by "_" ('07_india_bihar_bhagalpur_water_reference.tif' ->
    '07_india_bihar_bhagalpur'), or None."""
    hits = [e for e in event_ids if name.startswith(e + '_')]
    return max(hits, key=len) if hits else None


def import_layers(layers, out_dir, events):
    """Every <event>_water_reference.tif in `layers` -> a layer of that event.
    Returns ({eventId: [record]}, warnings)."""
    layer_dir = Path(layers)
    if not layer_dir.is_dir():
        raise DatasetError(f'Layers folder not found: {layer_dir}')
    by_id = {e['id']: e for e in events}
    files = sorted(layer_dir.glob(WATER_REFERENCE_GLOB))
    if not files:
        raise DatasetError(f'No {WATER_REFERENCE_GLOB} in {layer_dir}')
    records, warnings = {}, []
    for tif in files:
        event_id = layer_event_id(tif.name, by_id)
        if event_id is None:
            warnings.append(f'{tif.name}: no event id matches the file name; skipped')
            continue
        log.info('layer %s <- %s', event_id, tif.name)
        records.setdefault(event_id, []).append(mask_layer(tif, out_dir, event_id, WATER_REFERENCE, by_id[event_id].get('bbox')))
    return records, warnings


# ---- small parsers ----

def _bool(value, where):
    v = str(value).strip().lower()
    if v in ('true', '1', '1.0'):
        return 'true'
    if v in ('false', '0', '0.0'):
        return 'false'
    if v == '':
        return ''
    raise DatasetError(f'{where}: not a boolean: {value!r}')


def _number_text(value, where):
    """The source's number text, unchanged (empty stays empty)."""
    v = str(value).strip()
    if v == '' or v.lower() == 'nan':
        return ''
    try:
        float(v)
    except ValueError:
        raise DatasetError(f'{where}: not a number: {value!r}') from None
    return v


def _num(text):
    return None if text in ('', None) else float(text)


def _date(value, where):
    v = str(value).strip()[:10]
    if not DATE_RE.match(v):
        raise DatasetError(f'{where}: not a YYYY-MM-DD date: {value!r}')
    dt.date.fromisoformat(v)
    return v


def _read_csv(path):
    with open(path, newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


def _summary(path):
    """{event: row} from a summary CSV, or {} when the file is missing."""
    return {r['event']: r for r in _read_csv(path)} if path.exists() else {}


def readme_title(path):
    """'# Rainfall: Bangkok floods' -> 'Bangkok floods'."""
    if not path.exists():
        return None
    first = path.read_text(encoding='utf-8').splitlines()[0].lstrip('#').strip()
    return first.split(':', 1)[1].strip() if ':' in first else first


def readme_section(text, heading):
    """The text under '## <heading>' up to the next '## '."""
    m = re.search(rf'^## {re.escape(heading)}\s*\n(.*?)(?=^## |\Z)', text, flags=re.S | re.M)
    return m.group(1).strip() if m else ''


def readme_bullets(path, heading='Things to know'):
    """Top-level '- **Label** text' bullets of a section as (label, text), with
    continuation lines joined and markdown emphasis removed."""
    if not path.exists():
        return []
    section = readme_section(path.read_text(encoding='utf-8'), heading)
    bullets = []
    for line in section.splitlines():
        if line.startswith('- '):
            bullets.append(line[2:].strip())
        elif line.startswith('  ') and bullets and not line.strip().startswith('- '):
            bullets[-1] += ' ' + line.strip()
        elif line.startswith('  - ') and bullets:
            bullets[-1] += ' ' + line.strip()[2:]
    out = []
    for b in bullets:
        m = re.match(r'\*\*(.+?)\*\*\s*(.*)', b)
        label, rest = (m.group(1), m.group(2)) if m else ('', b)
        clean = lambda s: re.sub(r'\*\*(.+?)\*\*', r'\1', s).replace('`', '').strip()  # noqa: E731
        out.append((clean(label).rstrip(':.'), clean(rest)))
    return out


def grid_bbox(path):
    """[west, south, east, north] of a GeoTIFF in EPSG:4326, and the dates in
    its band descriptions. The 0.1-degree grid is stored in float32, so edges
    such as 74.0999984741211 are rounded to 4 decimals (74.1)."""
    try:
        import rasterio
    except ImportError as exc:  # pragma: no cover - environment problem
        raise DatasetError('rasterio is needed to read the rainfall GeoTIFFs: install requirements-hazards.txt') from exc
    with rasterio.open(path) as src:
        if src.crs is None or src.crs.to_epsg() != 4326:
            raise DatasetError(f'{path}: expected EPSG:4326, got {src.crs}')
        b = src.bounds
        dates = [d[:10] for d in src.descriptions if d and DATE_RE.match(d[:10])]
    return [round(b.left, 4), round(b.bottom, 4), round(b.right, 4), round(b.top, 4)], dates


# ---- one event ----

def import_daily(path):
    rows = _read_csv(path)
    missing = [src for _, src in DAILY_COLUMNS if rows and src not in rows[0]]
    if missing:
        raise DatasetError(f'{path}: missing column(s) {missing}')
    out, seen = [], set()
    for i, r in enumerate(rows, start=2):
        where = f'{path}:{i}'
        date = _date(r['date_utc'], where)
        if date in seen:
            raise DatasetError(f'{where}: duplicate date {date}')
        seen.add(date)
        out.append([
            date,
            _number_text(r['box_mean_mm'], where),
            _number_text(r['wettest_cell_mm'], where),
            _number_text(r['cells_with_data'], where),
            _bool(r['in_flood_period'], where),
        ])
    out.sort(key=lambda row: row[0])
    return out


def import_soil(path):
    rows = _read_csv(path)
    if not rows:
        return [], []
    if 'date_utc' not in rows[0]:
        raise DatasetError(f'{path}: no date_utc column')
    src_cols = list(rows[0].keys())
    header = [SOIL_RENAME.get(c, c) for c in src_cols]
    out = []
    for i, r in enumerate(rows, start=2):
        where = f'{path}:{i}'
        row = []
        for c in src_cols:
            v = r[c]
            if c == 'date_utc':
                v = _date(v, where)
            elif SOIL_RENAME.get(c, c) in BOOLEAN_COLUMNS:
                v = _bool(v, where)
            row.append(v)
        out.append(row)
    # Kept in the source's row order, not re-sorted: the notebook sorts the
    # passes itself and keeps the last pass of a day (Bangkok has two passes
    # on 18 and 30 Sep), so the order it sees must be the source's.
    return header, out


def _days_between(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def _gaps(dates):
    return [(a, b) for a, b in zip(dates, dates[1:]) if _days_between(a, b) != 1]


def build_event(event_id, rain_dir, soil_dir, rain_summary, soil_summary, meta, general_notes, out_dir):
    check_id(event_id, 'event id')
    warnings = []
    rdir, sdir = rain_dir / event_id, soil_dir / event_id
    files = {}

    daily = import_daily(rdir / RAIN_DAILY) if (rdir / RAIN_DAILY).exists() else []
    if daily:
        write_csv(out_dir / 'events' / event_id / 'daily.csv', [c for c, _ in DAILY_COLUMNS], daily)
        files['daily'] = f'events/{event_id}/daily.csv'
        for a, b in _gaps([r[0] for r in daily]):
            warnings.append(f'daily rainfall has a gap between {a} and {b}')
    else:
        warnings.append('no rainfall_daily.csv')

    soil_header, soil_rows = import_soil(sdir / SOIL_PASSES) if (sdir / SOIL_PASSES).exists() else ([], [])
    if soil_rows:
        write_csv(out_dir / 'events' / event_id / 'soil_passes.csv', soil_header, soil_rows)
        files['soil_passes'] = f'events/{event_id}/soil_passes.csv'

    bbox, grid_dates = (None, [])
    if (rdir / RAIN_GRID).exists():
        bbox, grid_dates = grid_bbox(rdir / RAIN_GRID)
        if daily and grid_dates and grid_dates != [r[0] for r in daily]:
            warnings.append('the rainfall GeoTIFF band dates differ from rainfall_daily.csv')
    else:
        warnings.append('no rainfall_daily_grid.tif, so no bbox')

    rs, ss, m = rain_summary.get(event_id, {}), soil_summary.get(event_id, {}), meta.get(event_id, {})
    flood_days = sum(1 for r in daily if r[4] == 'true')
    if soil_rows:
        di, ci, ri = soil_header.index('date'), soil_header.index('coverage_pct'), soil_header.index('mean_sm_recommended_only')
        soil_dates = sorted(r[di] for r in soil_rows)
        recommended = sum(1 for r in soil_rows if _num(_number_text(r[ri], 'soil')) is not None)
    else:
        soil_dates, recommended = [], 0

    notes = [f'{label}: {text}' if label else text for label, text in readme_bullets(rdir / 'README.md')
             if (label, text) not in general_notes]
    sources = []
    if daily:
        sources.append({'dataset': 'gpm_imerg_late_v07', 'files': [f'rainfall/{event_id}/{RAIN_DAILY}'] +
                        ([f'rainfall/{event_id}/{RAIN_GRID}'] if bbox else [])})
    if soil_rows:
        fi = soil_header.index('file') if 'file' in soil_header else None
        sources.append({'dataset': 'nisar_l3_sme2_v1', 'files': [f'soil_moisture/{event_id}/{SOIL_PASSES}'] +
                        ([f'soil_moisture/{event_id}/{r[fi]}' for r in soil_rows] if fi is not None else [])})

    return {
        'id': event_id,
        'name': readme_title(rdir / 'README.md') or readme_title(sdir / 'README.md') or event_id,
        'country': m.get('country'),
        'admin': m.get('admin'),
        'place': m.get('place'),
        'period': {
            'reported': rs.get('reported_flood_period') or None,
            # The hazard's own period (here the reported flood period); generic
            # names so every hazard's events read the same.
            'start': rs.get('flood_start') or ss.get('flood_start') or None,
            'end': rs.get('flood_end') or ss.get('flood_end') or None,
            'windowStart': daily[0][0] if daily else (rs.get('window_start') or None),
            'windowEnd': daily[-1][0] if daily else None,
            'soilWindowStart': ss.get('window_start') or None,
        },
        'bbox': bbox,
        'bboxSource': 'extent of the rainfall GeoTIFF (0.1-degree IMERG cells covering the event box), EPSG:4326' if bbox else None,
        'center': {'lat': round((bbox[1] + bbox[3]) / 2, 4), 'lon': round((bbox[0] + bbox[2]) / 2, 4)} if bbox else None,
        'cause': m.get('cause'),
        'rainDriven': m.get('rainDriven'),
        'notes': notes,
        'summary': {
            'rain7DaysBeforeMm': _num(rs.get('rain_7_days_before_mm')),
            'rainDuringFloodMm': _num(rs.get('rain_during_flood_period_mm')),
            'wettestDay': rs.get('wettest_day_utc') or None,
            'wettestDayBoxMeanMm': _num(rs.get('wettest_day_box_mean_mm')),
            'wettestCellAnyDayMm': _num(rs.get('wettest_cell_any_day_mm')),
            'imergCells': int(rs['imerg_cells']) if rs.get('imerg_cells') else None,
            'soilPasses': len(soil_rows),
            'soilPassesBeforeFlood': int(ss['passes_before_flood_period']) if ss.get('passes_before_flood_period') else None,
            'soilPassesInFlood': int(ss['passes_in_flood_period']) if ss.get('passes_in_flood_period') else None,
            'meanSoilMoistureBeforeFlood': _num(ss.get('mean_sm_before_flood_period')),
            'meanSoilMoistureInFlood': _num(ss.get('mean_sm_in_flood_period')),
            'meanSoilCoveragePct': _num(ss.get('mean_coverage_pct')),
        },
        'coverage': {
            'days': len(daily),
            'from': daily[0][0] if daily else None,
            'to': daily[-1][0] if daily else None,
            'floodDays': flood_days,
            'soilPasses': len(soil_rows),
            'soilPassesRecommended': recommended,
            'soilFrom': soil_dates[0] if soil_dates else None,
            'soilTo': soil_dates[-1] if soil_dates else None,
        },
        'files': files,
        'sources': sources,
        'warnings': warnings,
    }


# ---- the whole dataset ----

def _dataset_source(readme, dataset_id, name, doi, url, resolution):
    text = readme.read_text(encoding='utf-8') if readme.exists() else ''
    citation = ' '.join(readme_section(text, 'Source').split('\n\n')[0].replace('*', '').split())
    return {'id': dataset_id, 'name': name, 'doi': doi, 'url': url, 'resolution': resolution, 'citation': citation or None}


def _event_ids(rain_dir, soil_dir):
    ids = {p.name for p in rain_dir.iterdir() if (p / RAIN_DAILY).exists()} if rain_dir.exists() else set()
    ids |= {p.name for p in soil_dir.iterdir() if (p / SOIL_PASSES).exists()} if soil_dir.exists() else set()
    return sorted(ids)


def import_flood(rainfall, soil, out=None, meta_file=META_FILE, layers=None):
    """The whole dataset from the rainfall and soil folders (and, with
    `layers`, the map layers too). Returns the events.json manifest."""
    rain_dir, soil_dir = Path(rainfall), Path(soil)
    if not rain_dir.is_dir():
        raise DatasetError(f'Rainfall folder not found: {rain_dir}')
    if not soil_dir.is_dir():
        raise DatasetError(f'Soil moisture folder not found: {soil_dir}')
    out_dir = Path(out) if out else hazard_dir(HAZARD)
    meta = json.loads(Path(meta_file).read_text(encoding='utf-8')).get('events', {}) if meta_file and Path(meta_file).exists() else {}

    ids = _event_ids(rain_dir, soil_dir)
    if not ids:
        raise DatasetError(f'No <event>/{RAIN_DAILY} or <event>/{SOIL_PASSES} under {rain_dir} / {soil_dir}')

    # A "Things to know" bullet every event README repeats is about the data,
    # not the event; it goes to the dataset's notes, the rest to the event's.
    # (Needs two READMEs to tell the two apart.)
    per_event = [set(readme_bullets(rain_dir / e / 'README.md')) for e in ids if (rain_dir / e / 'README.md').exists()]
    general = set.intersection(*per_event) if len(per_event) >= 2 else set()

    rain_summary = _summary(rain_dir / 'rainfall_summary.csv')
    soil_summary = _summary(soil_dir / 'soil_moisture_summary.csv')
    events = [build_event(e, rain_dir, soil_dir, rain_summary, soil_summary, meta, general, out_dir) for e in ids]

    manifest = {
        'hazard': HAZARD,
        'version': DATASET_VERSION,
        'interval': 'daily',
        'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'description': 'Flood events with daily satellite rainfall over each event box (GPM IMERG) and the NISAR soil '
                       'moisture passes over the same box, from 7 days (rain) / 12 days (soil) before the reported flood '
                       'period to its end.',
        'tables': {
            'daily': {'kind': 'series', 'interval': 'daily', 'file': 'events/{eventId}/daily.csv', 'timeColumn': 'date',
                      'columns': DAILY_DOCS},
            'soil_passes': {'kind': 'observations', 'file': 'events/{eventId}/soil_passes.csv', 'timeColumn': 'date',
                            'columns': SOIL_DOCS},
        },
        'datasets': [
            _dataset_source(rain_dir / 'README.md', 'gpm_imerg_late_v07', 'GPM IMERG Late Run, daily, V07 (GPM_3IMERGDL.07)',
                            '10.5067/GPM/IMERGDL/DAY/07', 'https://doi.org/10.5067/GPM/IMERGDL/DAY/07', '0.1 degree (~10 km), daily'),
            _dataset_source(soil_dir / 'README.md', 'nisar_l3_sme2_v1', 'NISAR L3 SME2 soil moisture, provisional, version 1',
                            '10.5067/NIL3SME2-P1', 'https://nisar-docs.asf.alaska.edu/sme2/', '200 m (EASE-Grid 2.0), per satellite pass'),
        ],
        'notes': [f'{label}: {text}' if label else text for label, text in readme_bullets(rain_dir / 'README.md')] +
                 [f'{label}: {text}' if label else text for label, text in readme_bullets(soil_dir / 'README.md')],
        'importedFrom': {'rainfall': rain_dir.name, 'soil': soil_dir.name,
                         'command': 'python -m forecaster.hazards import flood --rainfall <rainfall> --soil <soil_moisture>'},
        'events': events,
    }
    write_json(out_dir / 'events.json', manifest)
    if layers is not None:
        import_flood_layers(layers, out_dir)  # rewrites the README with the layers
    else:
        # Layers imported earlier stay valid (they hang off the event ids), so
        # the README keeps listing them.
        write_text(out_dir / 'README.md', render_readme(manifest, read_layers(out_dir)))
    return manifest


def import_flood_layers(layers, out=None):
    """Only the map layers, for the events already in <out>/events.json (which
    is left as it is). Returns {'layers': {eventId: [record]}, 'warnings': [...]}."""
    out_dir = Path(out) if out else hazard_dir(HAZARD)
    manifest = read_manifest(out_dir)
    records, warnings = import_layers(layers, out_dir, manifest['events'])
    written = write_layers(out_dir, HAZARD, records)
    write_text(out_dir / 'README.md', render_readme(manifest, written['layers']))
    return {'layers': records, 'warnings': warnings}


def render_readme(m, layers=None):
    """README.md for the dataset folder, generated so it never drifts from
    events.json (and layers.json, {eventId: [layer]})."""
    lines = [
        '# Flood events dataset',
        '',
        'Generated by `python -m forecaster.hazards import flood` (server/ml); do not edit by hand, re-run the import.',
        'Served by the API under `/api/v1/hazards/flood` (docs/API.md, "Hazards").',
        '',
        m['description'],
        '',
        '## Files',
        '',
        '| file | what it is |',
        '|---|---|',
        '| `events.json` | every event (id, name, country, period, bbox, cause, coverage, sources), the tables and their columns, the source datasets |',
        '| `events/<event>/daily.csv` | one row per UTC day: rain over the box and the flood-period flag |',
        '| `events/<event>/soil_passes.csv` | one row per NISAR satellite pass over the box |',
        '| `model/forecast.json` | the flood forecast model results (`python -m forecaster.hazards build flood`) |',
        f'| `{LAYERS_FILE}` | map layers per event (overlay image, bounds, legend, stats, source); `--layers` of the import |',
        '| `events/<event>/layers/<layer>.png` | the overlay image of a layer (EPSG:4326, bounds in layers.json) |',
        '',
    ]
    for name, t in m['tables'].items():
        lines += [f'## `{name}` ({t["kind"]})', '', '| column | meaning |', '|---|---|']
        lines += [f'| `{c}` | {doc} |' for c, doc in t['columns'].items()]
        lines.append('')
    lines += ['## Events', '', '| id | name | country | reported flood period | days | soil passes | bbox [W, S, E, N] |',
              '|---|---|---|---|---|---|---|']
    for e in m['events']:
        country = (e['country'] or {}).get('name') or ''
        lines.append(f'| `{e["id"]}` | {e["name"]} | {country} | {e["period"]["reported"] or ""} | '
                     f'{e["coverage"]["days"]} | {e["coverage"]["soilPasses"]} | {e["bbox"]} |')
    lines += ['', '## Things to know', '']
    lines += [f'- {n}' for n in m['notes']]
    for e in m['events']:
        for n in e['notes']:
            lines.append(f'- `{e["id"]}`: {n}')
    if layers:
        lines += ['', '## Layers', '',
                  'Rebuilt from the source GeoTIFFs (not kept here) with '
                  '`python -m forecaster.hazards import flood --layers <folder with <event>_water_reference.tif>`.', '',
                  '| event | layer | image | shown class: area (% of known) | unknown | source file |', '|---|---|---|---|---|---|']
        for event_id, recs in sorted(layers.items()):
            for r in recs:
                shown = [c for c in r['legend'] if c.get('color')]
                cls = r['stats']['classes']
                area = '; '.join(f'{c["label"]}: {cls[c["key"]]["areaKm2"]} km² ({cls[c["key"]]["pctOfKnown"]}%)'
                                 for c in shown if c['key'] in cls)
                img = r['image']
                lines.append(f'| `{event_id}` | `{r["id"]}` {r["label"]} | {img["width"]} x {img["height"]} px, '
                             f'{round(img["bytes"] / 1024)} KB | {area} | {r["stats"]["unknownPct"]}% | `{r["source"]["file"]}` |')
        notes = [n for recs in layers.values() for r in recs for n in [r['source'].get('provenanceNote')] + r['notes'] if n]
        lines += [''] + [f'- {n}' for n in dict.fromkeys(notes)]
    lines += ['', '## Sources', '']
    lines += [f'- **{d["name"]}**: {d["citation"] or ""} {d["url"]}' for d in m['datasets']]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(prog='python -m forecaster.hazards import flood', description=__doc__.split('\n\n')[0])
    parser.add_argument('--rainfall', help='folder with rainfall_summary.csv and <event>/rainfall_daily.csv')
    parser.add_argument('--soil', help='folder with soil_moisture_summary.csv and <event>/soil_moisture_passes.csv')
    parser.add_argument('--layers', help=f'folder with {WATER_REFERENCE_GLOB} (the notebook\'s reference water labels); '
                                         'alone, only the layers are (re)built')
    parser.add_argument('--out', help='output folder (default server/data/hazards/flood)')
    parser.add_argument('--meta', default=str(META_FILE), help='curated event facts (default forecaster/hazards/flood_events.json)')
    args = parser.parse_args(argv)
    return run_import(args.rainfall, args.soil, args.layers, args.out, args.meta)


def run_import(rainfall=None, soil=None, layers=None, out=None, meta=META_FILE):
    """The CLI's import: events (rainfall + soil), layers, or both. Returns the summary printed as JSON."""
    if (rainfall is None) != (soil is None):
        raise DatasetError('--rainfall and --soil go together')
    if rainfall is None and layers is None:
        raise DatasetError('Nothing to import: give --rainfall and --soil, --layers, or all three')
    out_dir = Path(out) if out else hazard_dir(HAZARD)
    result = {'hazard': HAZARD, 'out': str(out_dir)}
    if rainfall is not None:
        manifest = import_flood(rainfall, soil, out, meta)
        result['events'] = [{'id': e['id'], 'days': e['coverage']['days'], 'soilPasses': e['coverage']['soilPasses'],
                             'bbox': e['bbox'], 'warnings': e['warnings']} for e in manifest['events']]
    if layers is not None:
        done = import_flood_layers(layers, out)
        result['layers'] = [{'event': event_id, 'id': r['id'], 'image': f'{r["image"]["width"]}x{r["image"]["height"]}',
                             'bytes': r['image']['bytes'], 'unknownPct': r['stats']['unknownPct'],
                             'classes': {k: v['areaKm2'] for k, v in r['stats']['classes'].items()}}
                            for event_id, recs in done['layers'].items() for r in recs]
        result['layerWarnings'] = done['warnings']
    return result


if __name__ == '__main__':
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    try:
        print(json.dumps(main(), ensure_ascii=False))
    except DatasetError as exc:
        print(json.dumps({'error': {'code': 'invalid_input', 'message': str(exc)}}))
        sys.exit(2)
