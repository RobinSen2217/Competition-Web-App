"""CLI: `python -m forecaster.hazards <command> <hazard> [options]`.

  import flood --rainfall <dir> --soil <dir> [--layers <dir>] [--out <dir>]
        the team's extracted files -> server/data/hazards/flood/ (import_flood.py);
        --layers alone (re)builds only the per-event map layers (layers.py)
  build flood [--data <dir>] [--stdout] [--any-sklearn]
        runs the model on the dataset -> <data>/model/forecast.json (flood.py);
        --stdout prints the snapshot instead of writing it (the black box mode)

Like `python -m forecaster`: stdout carries one JSON object (the result, or
{"error": {...}}), progress and warnings go to stderr. Exit codes: 0 success,
2 invalid input (unknown hazard, missing dataset, wrong scikit-learn), 1 failure.

A new hazard registers its importer and model in HAZARDS below.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

from .dataset import DatasetError, hazard_dir, write_json

EXIT_OK, EXIT_FAILURE, EXIT_INVALID = 0, 1, 2
log = logging.getLogger('forecaster.hazards')


def _flood_import(args):
    from .import_flood import run_import

    return run_import(args.rainfall, args.soil, args.layers, args.out)


def _flood_model():
    from . import flood

    return flood


# hazard id -> how to import its sources and which module builds its model
# (a module with run(base) -> snapshot, check_environment() and MODEL_VERSION).
HAZARDS = {
    'flood': {'import': _flood_import, 'model': _flood_model, 'snapshot': 'model/forecast.json'},
}


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        _emit({'error': {'code': 'invalid_input', 'message': message}})
        self.exit(EXIT_INVALID, f'{self.prog}: error: {message}\n')


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def build(hazard, data=None, stdout=False, any_sklearn=False):
    spec = HAZARDS[hazard]
    model = spec['model']()
    try:
        warning = model.check_environment()
    except EnvironmentError as exc:
        if not any_sklearn:
            raise DatasetError(str(exc)) from None
        warning = f'{exc} (building anyway: --any-sklearn)'
    if warning:
        log.warning(warning)
    base = Path(data) if data else hazard_dir(hazard)
    snapshot = model.run(base)
    if stdout:
        return snapshot
    path = write_json(base / spec['snapshot'], snapshot)
    check = snapshot.get('provenance', {}).get('notebookCheck', {})
    return {
        'hazard': hazard, 'path': str(path), 'modelVersion': snapshot.get('modelVersion'),
        'models': {m: {'threshold': r['threshold'], 'oofBalancedAccuracy': r['oof']['balancedAccuracy'],
                       'test': r['test']} for m, r in snapshot.get('models', {}).items()},
        'notebookCheck': check,
    }


def main(argv=None):
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='forecaster.hazards %(levelname)s %(message)s')
    parser = _Parser(prog='python -m forecaster.hazards')
    sub = parser.add_subparsers(dest='command', required=True, parser_class=_Parser)
    imp = sub.add_parser('import', help="normalize a hazard's source files into server/data/hazards/<hazard>/")
    imp.add_argument('hazard', choices=sorted(HAZARDS))
    # Which sources a hazard needs is its importer's call (flood: --rainfall
    # with --soil, and/or --layers), so none is required here.
    imp.add_argument('--rainfall')
    imp.add_argument('--soil')
    imp.add_argument('--layers', help='folder of per-event layer GeoTIFFs')
    imp.add_argument('--out')
    bld = sub.add_parser('build', help="run a hazard's model and save its snapshot")
    bld.add_argument('hazard', choices=sorted(HAZARDS))
    bld.add_argument('--data', help='dataset folder (default server/data/hazards/<hazard>)')
    bld.add_argument('--stdout', action='store_true', help='print the snapshot instead of writing it')
    bld.add_argument('--any-sklearn', action='store_true', help='build even with a scikit-learn that does not reproduce the notebook')
    args = parser.parse_args(argv)
    try:
        if args.command == 'import':
            _emit(HAZARDS[args.hazard]['import'](args))
        else:
            _emit(build(args.hazard, args.data, args.stdout, args.any_sklearn))
        return EXIT_OK
    except DatasetError as exc:
        _emit({'error': {'code': 'invalid_input', 'message': str(exc)}})
        return EXIT_INVALID
    except Exception as exc:  # our fault, not the caller's
        log.exception('hazards command failed')
        _emit({'error': {'code': 'failure', 'message': f'{type(exc).__name__}: {exc}'}})
        return EXIT_FAILURE


if __name__ == '__main__':
    sys.exit(main())
