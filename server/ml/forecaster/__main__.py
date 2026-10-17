"""CLI entry: `python -m forecaster` reads one JSON request on stdin and writes
one JSON response on stdout.

stdout carries only the response (the caller parses it), so all logging goes to
stderr. Exit codes: 0 success, 2 invalid input, 1 internal failure; on failure
stdout still holds a JSON {"error": {...}} body the caller can pass on.
"""

import json
import logging
import sys

from .contract import InvalidInput, parse_request
from .pipeline import run

EXIT_OK, EXIT_FAILURE, EXIT_INVALID = 0, 1, 2


def _emit(obj):
    # allow_nan=False: NaN/Infinity are not JSON and would break JSON.parse.
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(',', ':')))
    sys.stdout.write('\n')
    sys.stdout.flush()


def _error(code, message):
    return {'error': {'code': code, 'message': message}}


def main():
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format='forecaster %(levelname)s %(message)s')
    try:
        raw = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        _emit(_error('invalid_input', f'Request is not valid JSON: {exc}'))
        return EXIT_INVALID
    try:
        response = run(parse_request(raw))
        _emit(response)
        return EXIT_OK
    except InvalidInput as exc:
        _emit(_error('invalid_input', str(exc)))
        return EXIT_INVALID
    except Exception as exc:  # anything else is our fault, not the caller's
        logging.getLogger('forecaster').exception('model failure')
        _emit(_error('model_failure', f'{type(exc).__name__}: {exc}'))
        return EXIT_FAILURE


if __name__ == '__main__':
    sys.exit(main())
