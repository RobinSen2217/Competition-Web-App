"""The normalized hazard dataset layout, shared by every hazard's importer and
model (and read by the Node server's hazard provider, src/providers/hazards.js):

    server/data/hazards/<hazard>/
      events.json                    the manifest: hazard, interval, file layout,
                                     column documentation, source datasets and
                                     one record per event (see below)
      events/<eventId>/<table>.csv   one CSV per event and table, e.g. the flood's
                                     daily.csv (regular daily series) and
                                     soil_passes.csv (irregular satellite passes)
      model/<name>.json              model snapshots written by `build`
      layers.json                    optional map layers per event, and their images
      events/<eventId>/layers/*.png  (written by layers.py, e.g. `import flood --layers`)
      README.md                      human-readable description, generated

`events.json` names its tables in `tables`: {name: {kind, file, timeColumn,
columns}} where kind is "series" (one row per interval step) or
"observations" (irregular rows, e.g. one per satellite pass), and `file` is a
pattern with "{eventId}". Every CSV has a `date` column (YYYY-MM-DD, UTC).
Values are copied from the sources as written (no float round trip), empty =
no value, booleans as `true` / `false`.

Ids (hazard, event) must be URL- and file-safe; they become paths here and in
the server.
"""

import csv
import io
import json
import os
import re
from pathlib import Path

HAZARDS_DIR = Path(__file__).resolve().parents[3] / 'data' / 'hazards'
DATASET_VERSION = 1
SAFE_ID = re.compile(r'^[A-Za-z0-9_-]+$')


class DatasetError(ValueError):
    """The dataset (or a source) is missing something or is malformed."""


def check_id(value, what='id'):
    if not isinstance(value, str) or not SAFE_ID.match(value):
        raise DatasetError(f'Unsafe {what} {value!r}: use letters, digits, "_" and "-" only')
    return value


def hazard_dir(hazard, root=HAZARDS_DIR):
    return Path(root) / check_id(hazard, 'hazard id')


def table_path(base, pattern, event_id):
    """Path of an event's table from the manifest's file pattern."""
    return Path(base) / pattern.replace('{eventId}', check_id(event_id, 'event id'))


# ---- writing (atomic: a server reading meanwhile never sees half a file) ----

def _atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'{path.name}.{os.getpid()}.tmp')
    tmp.write_text(text, encoding='utf-8')
    os.replace(tmp, path)
    return path


def write_json(path, obj):
    # allow_nan=False: NaN is not JSON and would break JSON.parse in the server.
    return _atomic_write(path, json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False) + '\n')


def write_csv(path, header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(header)
    w.writerows(rows)
    return _atomic_write(path, buf.getvalue())


def write_text(path, text):
    return _atomic_write(path, text)


# ---- reading ----

def read_manifest(base):
    path = Path(base) / 'events.json'
    if not path.exists():
        raise DatasetError(f'No events.json in {base}. Run the import first (see server/ml/README.md, "Hazards").')
    manifest = json.loads(path.read_text(encoding='utf-8'))
    for key in ('hazard', 'tables', 'events'):
        if key not in manifest:
            raise DatasetError(f'{path}: missing "{key}"')
    return manifest


def read_table(base, manifest, table, event_id, **read_csv_kwargs):
    """An event's table as a pandas DataFrame (None if the event has no such
    file). Parsed by plain `pd.read_csv` unless told otherwise: the CSVs keep
    the sources' number text, so this gives bit-identical floats to the
    notebook's own `pd.read_csv` of the source files."""
    import pandas as pd

    spec = manifest['tables'].get(table)
    if spec is None:
        raise DatasetError(f'Unknown table "{table}" in {base}/events.json')
    path = table_path(base, spec['file'], event_id)
    if not path.exists():
        return None
    return pd.read_csv(path, **read_csv_kwargs)
