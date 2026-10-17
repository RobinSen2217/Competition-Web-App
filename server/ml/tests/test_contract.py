import unittest

from forecaster.contract import InvalidInput, parse_request

from .helpers import run_cli, synthetic_request


class ContractValidation(unittest.TestCase):
    def assertInvalid(self, req, fragment):
        with self.assertRaises(InvalidInput) as ctx:
            parse_request(req)
        self.assertIn(fragment, str(ctx.exception))

    def test_valid_request_gets_defaults(self):
        req = synthetic_request(n=48)
        del req['horizon']
        r = parse_request(req)
        self.assertEqual(r.options, {'testFraction': 0.2, 'seed': 42, 'lags': 2})
        self.assertEqual(r.horizon, 12)
        self.assertEqual(r.models, ['ridge', 'nn', 'gbm'])
        self.assertEqual(r.area['halfWidthKm'], 1)

    def test_not_an_object(self):
        self.assertInvalid([], 'JSON object')

    def test_wrong_version(self):
        self.assertInvalid(synthetic_request(n=36, version=1), '"version"')

    def test_unsupported_target(self):
        self.assertInvalid(synthetic_request(n=36, target='ndvi'), '"target"')
        self.assertInvalid(synthetic_request(n=36, target='LST_Day_C'), '"target"')

    def test_unsupported_interval(self):
        self.assertInvalid(synthetic_request(n=36, interval='daily'), '"interval"')

    def test_horizon_bounds_and_type(self):
        for bad in (0, 25, 1.5, True, '12', None):
            self.assertInvalid(synthetic_request(n=36, horizon=bad), '"horizon"')

    def test_unknown_duplicate_and_empty_models(self):
        self.assertInvalid(synthetic_request(n=36, models=['ridge', 'lstm']), 'lstm')
        self.assertInvalid(synthetic_request(n=36, models=[]), '"models"')
        self.assertInvalid(synthetic_request(n=36, models=['nn', 'nn']), 'more than once')

    def test_area(self):
        self.assertInvalid(synthetic_request(n=36, area={'name': 'X'}), '"area.id"')
        self.assertInvalid(synthetic_request(n=36, area={'id': 'x', 'center': {'lat': 99, 'lon': 0}}), 'center')
        self.assertInvalid(synthetic_request(n=36, area={'id': 'x', 'halfWidthKm': 0}), 'halfWidthKm')

    def test_columns(self):
        req = synthetic_request(n=36)
        i = req['columns'].index('R_n')
        req['columns'] = req['columns'][:i] + req['columns'][i + 1:]
        req['rows'] = [r[:i] + r[i + 1:] for r in req['rows']]
        self.assertInvalid(req, 'R_n')
        req = synthetic_request(n=36)
        req['columns'][0] = 'date'
        self.assertInvalid(req, 'more than once')

    def test_extra_columns_allowed(self):
        req = synthetic_request(n=36)
        req['columns'].append('my_extra')
        for r in req['rows']:
            r.append(1.0)
        parse_request(req)

    def test_row_length_and_values(self):
        req = synthetic_request(n=36)
        req['rows'][3] = req['rows'][3][:-1]
        self.assertInvalid(req, '"rows[3]"')
        req = synthetic_request(n=36)
        req['rows'][2][req['columns'].index('AirTemp_C')] = 'warm'
        self.assertInvalid(req, 'AirTemp_C')
        req = synthetic_request(n=36)
        req['rows'][2][req['columns'].index('AirTemp_C')] = None
        parse_request(req)

    def test_dates(self):
        d = synthetic_request(n=36)['columns'].index('date')
        req = synthetic_request(n=36)
        req['rows'][3][d] = '2010/04/01'
        self.assertInvalid(req, 'YYYY-MM-DD')
        req = synthetic_request(n=36)
        del req['rows'][5]
        self.assertInvalid(req, 'consecutive')
        req = synthetic_request(n=36)
        req['rows'][4], req['rows'][5] = req['rows'][5], req['rows'][4]
        self.assertInvalid(req, 'consecutive')

    def test_bad_options(self):
        for opts, frag in (({'testFraction': 0}, 'testFraction'), ({'testFraction': 0.6}, 'testFraction'),
                           ({'seed': -1}, 'seed'), ({'lags': 0}, 'lags'), ({'lags': 13}, 'lags'),
                           ({'foo': 1}, 'foo'), ('x', '"options"')):
            self.assertInvalid(synthetic_request(n=36, options=opts), frag)

    def test_too_little_data_is_invalid_not_failure(self):
        # Validation passes; the pipeline then finds too few complete months.
        code, body, _ = run_cli(synthetic_request(n=20))
        self.assertEqual(code, 2)
        self.assertEqual(body['error']['code'], 'invalid_input')

    def test_cli_rejects_non_json_with_exit_2(self):
        code, body, _ = run_cli('{not json')
        self.assertEqual(code, 2)
        self.assertEqual(body['error']['code'], 'invalid_input')

    def test_cli_reports_validation_error_with_exit_2(self):
        code, body, _ = run_cli(synthetic_request(n=36, models=['svm']))
        self.assertEqual(code, 2)
        self.assertIn('svm', body['error']['message'])


if __name__ == '__main__':
    unittest.main()
