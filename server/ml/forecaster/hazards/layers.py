"""Per-event map layers of a hazard dataset: a classified GeoTIFF (a "mask",
e.g. reference water labels) turned into a small web overlay PNG plus stats.

Generic over hazards and layer kinds: the importer of a hazard says which
files to read and what their classes mean (a spec, see `mask_layer`); this
module does the raster work and keeps the layer manifest. Output, next to the
hazard's events.json (layout in dataset.py):

    layers.json                              {hazard, version, generated, layers: {eventId: [record]}}
    events/<eventId>/layers/<layerId>.png    the overlay image of one layer

A record carries everything the API serves about the layer (label, kind,
bounds, legend, stats, source, description), so a new layer kind needs no
server change. The source GeoTIFFs are not copied (re-run the import to
rebuild the PNGs from them).

Only EPSG:4326 rasters are accepted: the web map (Leaflet imageOverlay) places
an image by its lat/lon corners, which is exact only for a lat/lon grid.
Reprojecting other CRSs is left for when such a layer arrives.
"""

import datetime as dt
import hashlib
import json
import math
import os
import struct
import zlib
from pathlib import Path

from .dataset import DatasetError, check_id, write_json

LAYERS_FILE = 'layers.json'
LAYERS_VERSION = 1
# Long side of the overlay PNG. ~2048 px keeps the files a few hundred KB at
# most while staying sharper than the screen at the zoom that shows a whole
# event box; the native-resolution numbers are in the stats.
MAX_IMAGE_SIZE = 2048
# Mean Earth radius (IUGG), km: pixel areas are computed on this sphere.
EARTH_RADIUS_KM = 6371.0088


# ---- reading ----

def read_mask(path):
    """(array, transform, bounds, nodata, band description) of band 1 of a
    classified GeoTIFF in EPSG:4326."""
    try:
        import rasterio
    except ImportError as exc:  # pragma: no cover - environment problem
        raise DatasetError('rasterio is needed to read layer GeoTIFFs: install requirements-hazards.txt') from exc
    with rasterio.open(path) as src:
        if src.crs is None or src.crs.to_epsg() != 4326:
            raise DatasetError(f'{path}: layers must be EPSG:4326 (lat/lon) for the web map, got {src.crs}')
        t = src.transform
        if t.b != 0 or t.d != 0 or t.e >= 0:
            raise DatasetError(f'{path}: expected a north-up grid without rotation')
        arr = src.read(1)
        return arr, t, src.bounds, src.nodata, (src.descriptions[0] if src.descriptions else None)


# ---- areas (native resolution) ----

def row_pixel_areas_km2(transform, height):
    """Area of one pixel in each row, km²: R² · Δφ · Δλ · cos(φ of the row's
    centre). Pixels shrink towards the poles, so a count of pixels alone is not
    an area; within a row they are all equal."""
    dlon = math.radians(abs(transform.a))
    dlat = math.radians(abs(transform.e))
    import numpy as np

    lat_centres = transform.f + transform.e * (np.arange(height) + 0.5)
    return (EARTH_RADIUS_KM ** 2) * dlat * dlon * np.cos(np.radians(lat_centres))


def class_stats(arr, transform, classes, nodata, window=None):
    """Pixels and km² of each class (and of nodata) in `arr`, or in the
    [row0, row1, col0, col1] `window` of it. Unclassified values count as
    unknown, like nodata."""
    import numpy as np

    areas = row_pixel_areas_km2(transform, arr.shape[0])
    if window is not None:
        r0, r1, c0, c1 = window
        arr, areas = arr[r0:r1, c0:c1], areas[r0:r1]
    out = {}
    known_pixels, known_area = 0, 0.0
    for c in classes:
        hit = arr == c['value']
        n_row = hit.sum(axis=1)
        pixels, area = int(n_row.sum()), float((n_row * areas).sum())
        out[c['key']] = {'value': c['value'], 'pixels': pixels, 'areaKm2': area}
        known_pixels += pixels
        known_area += area
    total_pixels = int(arr.size)
    total_area = float((areas * arr.shape[1]).sum())
    unknown = {'value': nodata, 'pixels': total_pixels - known_pixels, 'areaKm2': total_area - known_area}
    for v in out.values():
        # % of the pixels with a known class, so unknown edges do not dilute it.
        v['pctOfKnown'] = round(100 * v['pixels'] / known_pixels, 3) if known_pixels else None
        v['areaKm2'] = round(v['areaKm2'], 2)
    return {
        'pixels': total_pixels,
        'totalAreaKm2': round(total_area, 2),
        'knownAreaKm2': round(known_area, 2),
        'unknownPct': round(100 * unknown['pixels'] / total_pixels, 3) if total_pixels else None,
        'classes': {**out, 'unknown': {**unknown, 'areaKm2': round(unknown['areaKm2'], 2)}},
    }


def bbox_window(transform, shape, bbox):
    """[row0, row1, col0, col1] of the pixels whose centres fall inside
    bbox [west, south, east, north], or None if none do."""
    west, south, east, north = bbox
    h, w = shape
    c0 = max(0, math.ceil((west - transform.c) / transform.a - 0.5))
    c1 = min(w, math.floor((east - transform.c) / transform.a - 0.5) + 1)
    r0 = max(0, math.ceil((north - transform.f) / transform.e - 0.5))
    r1 = min(h, math.floor((south - transform.f) / transform.e - 0.5) + 1)
    return [r0, r1, c0, c1] if r0 < r1 and c0 < c1 else None


# ---- the overlay image ----

def downsample_priority(arr, factor, priority, fill):
    """Shrink `arr` by `factor` in both directions; each output pixel takes the
    first value of `priority` present in its factor x factor block (`fill` if
    none). With priority [water, not water] this is the "any water" rule: a
    narrow river a quarter of a block wide still shows, where averaging or a
    majority vote would erase it. Edges are padded with `fill`."""
    import numpy as np

    if factor == 1:
        out = np.full(arr.shape, fill, dtype=arr.dtype)
        for v in reversed(priority):
            out[arr == v] = v
        return out
    h, w = arr.shape
    H, W = -(-h // factor), -(-w // factor)
    padded = np.full((H * factor, W * factor), fill, dtype=arr.dtype)
    padded[:h, :w] = arr
    blocks = padded.reshape(H, factor, W, factor)
    out = np.full((H, W), fill, dtype=arr.dtype)
    # Lowest priority first, so higher ones overwrite it.
    for v in reversed(priority):
        out[(blocks == v).any(axis=(1, 3))] = v
    return out


def _png_chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)


def encode_png_palette(indices, palette):
    """An 8-bit palette PNG of `indices` (2-D uint8) with `palette` a list of
    (r, g, b, a). Written by hand (zlib is in the standard library) so the
    import needs no imaging package, and the bytes depend only on the pixels,
    so a re-import without changes leaves the file identical."""
    import numpy as np

    h, w = indices.shape
    rows = np.empty((h, w + 1), dtype=np.uint8)
    rows[:, 0] = 0  # filter type "None" per row; zlib does the rest on these mostly-flat masks
    rows[:, 1:] = indices
    header = struct.pack('>IIBBBBB', w, h, 8, 3, 0, 0, 0)
    plte = b''.join(struct.pack('BBB', *p[:3]) for p in palette)
    trns = bytes(p[3] for p in palette)
    return (b'\x89PNG\r\n\x1a\n' + _png_chunk(b'IHDR', header) + _png_chunk(b'PLTE', plte) +
            _png_chunk(b'tRNS', trns) + _png_chunk(b'IDAT', zlib.compress(rows.tobytes(), 9)) + _png_chunk(b'IEND', b''))


def _hex_rgba(color, opacity):
    c = color.lstrip('#')
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), round(255 * opacity)


def _write_bytes(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)
    return path


# ---- one layer ----

def mask_layer(tif, base, event_id, spec, event_bbox=None, max_size=MAX_IMAGE_SIZE):
    """Build one mask layer of an event from a classified GeoTIFF: writes
    <base>/events/<event>/layers/<id>.png and returns the layer record.

    spec: {id, label, description, legend: [{value, key, label, color|None,
    opacity}], priority: [values, most visible first] (downsampling rule),
    source: {...}, notes: [...]}. Legend entries with color None are drawn
    transparent; values not in the legend (and nodata) count as unknown.
    """
    check_id(event_id, 'event id')
    check_id(spec['id'], 'layer id')
    import numpy as np

    arr, t, b, nodata, band = read_mask(tif)
    classes = [c for c in spec['legend'] if c['value'] != nodata and c.get('key') != 'unknown']
    known = {c['value'] for c in classes}
    nodata_value = int(nodata) if nodata is not None else 255
    if not known.issuperset(int(v) for v in np.unique(arr) if v != nodata_value):
        found = sorted(int(v) for v in np.unique(arr))
        raise DatasetError(f'{tif}: values {found} are not all in the legend {sorted(known)} (nodata {nodata})')

    stats = class_stats(arr, t, classes, nodata_value)
    window = bbox_window(t, arr.shape, event_bbox) if event_bbox else None
    if window:
        box = class_stats(arr, t, classes, nodata_value, window)
        stats['eventBox'] = {'bbox': event_bbox, **box}

    factor = max(1, math.ceil(max(arr.shape) / max_size))
    small = downsample_priority(arr, factor, spec['priority'], nodata_value)
    # Palette index = legend order; anything else (nodata) -> a last, transparent entry.
    palette = [(0, 0, 0, 0) if not c.get('color') else _hex_rgba(c['color'], c.get('opacity', 1)) for c in spec['legend']]
    lut = np.full(256, len(palette), dtype=np.uint8)
    for i, c in enumerate(spec['legend']):
        lut[c['value']] = i
    palette.append((0, 0, 0, 0))
    png = encode_png_palette(lut[small], palette)
    rel = f'events/{event_id}/layers/{spec["id"]}.png'
    _write_bytes(Path(base) / rel, png)

    # The PNG may cover a few padded pixels past the raster's east/south edge
    # (when the size is not a multiple of the factor); its bounds include
    # them so the image lines up exactly on the map.
    h, w = small.shape
    west, north = t.c, t.f
    east, south = west + w * factor * t.a, north + h * factor * t.e
    res_deg = abs(t.a)
    mid_lat = (b.top + b.bottom) / 2
    stats.update({
        'width': int(arr.shape[1]),
        'height': int(arr.shape[0]),
        'pixelSizeDeg': [round(abs(t.a), 12), round(abs(t.e), 12)],
        # Metres at the raster's middle latitude (east-west shrinks with cos φ).
        'pixelSizeM': [round(math.radians(abs(t.a)) * EARTH_RADIUS_KM * 1000 * math.cos(math.radians(mid_lat)), 2),
                       round(math.radians(abs(t.e)) * EARTH_RADIUS_KM * 1000, 2)],
        'method': 'Counted at the native resolution; each pixel\'s area is R² · Δφ · Δλ · cos(φ) at its row centre, '
                  f'R = {EARTH_RADIUS_KM} km (mean Earth radius). Percentages of known pixels leave out the unknown ones.',
    })
    return {
        'id': spec['id'],
        'label': spec['label'],
        'kind': 'mask',
        'description': spec['description'],
        'time': spec.get('time'),
        'crs': 'EPSG:4326',
        # Leaflet's imageOverlay order: [[south, west], [north, east]].
        'bounds': [[_r(south), _r(west)], [_r(north), _r(east)]],
        'extent': [[_r(b.bottom), _r(b.left)], [_r(b.top), _r(b.right)]],
        'file': rel,
        'image': {
            'format': 'png',
            'width': int(w),
            'height': int(h),
            'bytes': len(png),
            'sha256': hashlib.sha256(png).hexdigest(),
            'downsample': factor,
            'resolutionDeg': round(res_deg * factor, 12),
            'rule': spec.get('rule') or f'each image pixel covers {factor} x {factor} source pixels and shows the first class present in this order: '
                                        + ', '.join(next(c['label'] for c in spec['legend'] if c['value'] == v) for v in spec['priority']),
        },
        'legend': [{k: c.get(k) for k in ('value', 'key', 'label', 'color', 'opacity')} for c in spec['legend']],
        'stats': stats,
        'source': {**spec.get('source', {}), 'file': Path(tif).name, 'band': band, 'nodata': nodata_value},
        'notes': spec.get('notes', []),
    }


def _r(x):
    return round(float(x), 7)


# ---- the manifest ----

def read_layers(base):
    path = Path(base) / LAYERS_FILE
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data.get('layers'), dict):
        raise DatasetError(f'{path}: needs "layers": {{eventId: [layer]}}')
    return data['layers']


def write_layers(base, hazard, records):
    """Merge `records` ({eventId: [layer]}) into <base>/layers.json: a layer
    replaces the one with the same id on the same event, every other layer
    (other events, other kinds written by other importers) is kept, so
    importing one kind of layer never drops another."""
    layers = read_layers(base)
    for event_id, recs in records.items():
        new_ids = {r['id'] for r in recs}
        kept = [r for r in layers.get(event_id, []) if r['id'] not in new_ids]
        layers[event_id] = sorted(kept + recs, key=lambda r: r['id'])
    manifest = {
        'hazard': hazard,
        'version': LAYERS_VERSION,
        'generated': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'description': 'Map layers per event: an overlay image (file, bounds in EPSG:4326 as [[south, west], [north, east]]) '
                       'with its legend, stats and source. Written by python -m forecaster.hazards import.',
        'layers': {k: layers[k] for k in sorted(layers)},
    }
    write_json(Path(base) / LAYERS_FILE, manifest)
    return manifest
