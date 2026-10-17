"""CLI: `python -m forecaster.gee <command>`.

  extract --area <id> [--end YYYY-MM-DD]   one area -> server/data/gee/<id>.features.csv
  extract --all [--end YYYY-MM-DD]         every area in areas.json, one after another
  check                                    log in to Earth Engine and make one tiny request

Like `python -m forecaster`: stdout carries one JSON object (the result, or
{"error": {...}}), progress goes to stderr. Exit codes: 0 success, 2 invalid
input (bad arguments, unknown area), 1 failure (credentials, Earth Engine).
"""

import argparse
import datetime as dt
import json
import logging
import sys
import time

from . import START_DATE
from .areas import AREAS_FILE, DATA_DIR, AreaError, features_path, find_area, load_areas
from .auth import CredentialsError, initialize

EXIT_OK, EXIT_FAILURE, EXIT_INVALID = 0, 1, 2

log = logging.getLogger('forecaster.gee')


class _Parser(argparse.ArgumentParser):
    """argparse exits with 2 on bad arguments; also put the error on stdout as JSON."""

    def error(self, message):
        _emit(_error('invalid_input', message))
        self.exit(EXIT_INVALID, f'{self.prog}: error: {message}\n')


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def _error(code, message):
    return {'error': {'code': code, 'message': message}}


def _end_date(value):
    try:
        d = dt.date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f'--end must be a date as YYYY-MM-DD, got {value!r}') from None
    if d <= dt.date.fromisoformat(START_DATE):
        raise argparse.ArgumentTypeError(f'--end must be after the start date {START_DATE}')
    return d.isoformat()


def _parser():
    p = _Parser(prog='python -m forecaster.gee', description=__doc__.split('\n\n')[0])
    sub = p.add_subparsers(dest='command', required=True, parser_class=_Parser)
    ex = sub.add_parser('extract', help='run the notebook extraction and write <id>.features.csv')
    which = ex.add_mutually_exclusive_group(required=True)
    which.add_argument('--area', help='area id from areas.json')
    which.add_argument('--all', action='store_true', help='every area in areas.json')
    ex.add_argument('--end', type=_end_date, default=None,
                    help='END_DATE (exclusive), default: first day of the current month')
    ex.add_argument('--areas-file', default=str(AREAS_FILE), help=argparse.SUPPRESS)
    ex.add_argument('--out-dir', default=str(DATA_DIR), help='where to write the CSVs (default server/data/gee)')
    sub.add_parser('check', help='verify Earth Engine credentials')
    return p


def _check():
    project, how = initialize()
    import ee
    # The smallest request that proves both the login and dataset access.
    n = ee.ImageCollection('MODIS/061/MOD11A2').limit(1).size().getInfo()
    return {'ok': True, 'project': project, 'credentials': how, 'probe': n}


def _extract_one(area, end, out_dir):
    from .extract import default_end_date, extract_area, write_csv  # needs earthengine-api
    started = time.monotonic()
    result = extract_area(area, end_date=end or default_end_date())
    path = write_csv(result.final, features_path(area['id'], out_dir))
    df = result.final
    return {
        'area': area['id'],
        'path': str(path),
        'rows': len(df),
        'columns': len(df.columns),
        'from': df['date'].iloc[0] if len(df) else None,
        'to': df['date'].iloc[-1] if len(df) else None,
        'seconds': round(time.monotonic() - started, 1),
    }


def main(argv=None):
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='forecaster.gee %(levelname)s %(message)s')
    args = _parser().parse_args(argv)
    if args.command == 'check':
        try:
            _emit(_check())
            return EXIT_OK
        except CredentialsError as exc:
            _emit(_error('credentials', str(exc)))
            return EXIT_FAILURE
        except Exception as exc:
            log.exception('check failed')
            _emit(_error('earth_engine', f'{type(exc).__name__}: {exc}'))
            return EXIT_FAILURE

    # Arguments first, so a typo is reported before any login attempt.
    try:
        areas = load_areas(args.areas_file) if args.all else [find_area(args.area, args.areas_file)]
    except AreaError as exc:
        _emit(_error('invalid_input', str(exc)))
        return EXIT_INVALID

    try:
        project, how = initialize()
    except CredentialsError as exc:
        _emit(_error('credentials', str(exc)))
        return EXIT_FAILURE
    log.info('Earth Engine initialised: project %s, %s', project, how)

    results, failed = [], False
    for area in areas:
        try:
            results.append(_extract_one(area, args.end, args.out_dir))
        except Exception as exc:
            # With --all, one area's failure should not lose the others' work.
            log.exception('%s: extraction failed', area['id'])
            results.append({'area': area['id'], 'error': f'{type(exc).__name__}: {exc}'})
            failed = True
    if not args.all and failed:
        _emit(_error('earth_engine', results[0]['error']))
        return EXIT_FAILURE
    _emit(results[0] if not args.all else {'results': results})
    return EXIT_FAILURE if failed else EXIT_OK


if __name__ == '__main__':
    sys.exit(main())
