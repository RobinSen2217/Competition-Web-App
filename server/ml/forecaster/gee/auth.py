"""Earth Engine login: the one place credentials are read.

Three ways in, chosen by environment variables (first match wins):

  GEE_SERVICE_ACCOUNT_KEY  path to a service-account JSON key (server use).
                           Relative paths are tried against the current
                           directory, then against server/.
  GEE_CREDENTIALS          the CONTENTS of the file `earthengine authenticate`
                           writes (~/.config/earthengine/credentials): a personal
                           login passed as an environment variable, for a host
                           where you can't run the browser sign-in. It holds a
                           refresh token that acts as that Google account, so
                           treat it like a password.
  (neither set)            the credentials stored by `earthengine authenticate`
                           on this machine (a developer's own login, as in the
                           notebook's ee.Authenticate()).

  GEE_PROJECT              Google Cloud project billed for the requests,
                           default "miicproject2" (notebook cell 5). The
                           datasets themselves are public.
"""

import json
import os
from pathlib import Path


def use_certifi_bundle(env=None):
    """Point Python's HTTPS at certifi's CA list unless SSL_CERT_FILE is set.

    The python.org macOS installer ships without trusted root certificates
    (until its "Install Certificates" script is run), which makes Earth Engine
    sign-in and requests fail with CERTIFICATE_VERIFY_FAILED. certifi is
    installed with earthengine-api's dependencies, so this works everywhere.
    """
    env = os.environ if env is None else env
    if env.get('SSL_CERT_FILE'):
        return env['SSL_CERT_FILE']
    try:
        import certifi
    except ImportError:  # pragma: no cover - certifi comes with requests
        return None
    env['SSL_CERT_FILE'] = certifi.where()
    return env['SSL_CERT_FILE']

from .areas import SERVER_DIR

DEFAULT_PROJECT = 'miicproject2'

SETUP_HELP = (
    'Set up Earth Engine credentials in one of two ways (see server/ml/README.md, "Credentials"): '
    '(1) server: put a service-account JSON key for project miicproject2 in server/secrets/ and set '
    'GEE_SERVICE_ACCOUNT_KEY to its path; (2) your own machine: run '
    '`server/ml/.venv/bin/earthengine authenticate` once; or (3) set GEE_CREDENTIALS to the contents '
    'of the file that command writes (~/.config/earthengine/credentials). GEE_PROJECT overrides the project '
    f'(default "{DEFAULT_PROJECT}").'
)


class CredentialsError(RuntimeError):
    """No usable Earth Engine credentials; the message says how to fix it."""


def settings(env=None):
    """(project, key path or None) from the environment."""
    env = os.environ if env is None else env
    project = (env.get('GEE_PROJECT') or '').strip() or DEFAULT_PROJECT
    key = (env.get('GEE_SERVICE_ACCOUNT_KEY') or '').strip() or None
    return project, key


def user_credentials(raw, ee_module):
    """OAuth credentials from GEE_CREDENTIALS (the stored-login file's JSON).

    Uses the earthengine-api's own client id/secret and scopes unless the JSON
    carries its own (newer `earthengine authenticate` versions store them).
    """
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CredentialsError(f'GEE_CREDENTIALS is not valid JSON ({exc}). Paste the whole contents of '
                               '~/.config/earthengine/credentials. ' + SETUP_HELP) from exc
    token = info.get('refresh_token') if isinstance(info, dict) else None
    if not isinstance(token, str) or not token:
        raise CredentialsError('GEE_CREDENTIALS has no "refresh_token". Run `earthengine authenticate` and '
                               'paste the contents of ~/.config/earthengine/credentials. ' + SETUP_HELP)
    from google.oauth2.credentials import Credentials  # installed with earthengine-api
    oauth = ee_module.oauth
    return Credentials(
        None,
        refresh_token=token,
        token_uri=oauth.TOKEN_URI,
        client_id=info.get('client_id') or oauth.CLIENT_ID,
        client_secret=info.get('client_secret') or oauth.CLIENT_SECRET,
        scopes=info.get('scopes') or oauth.SCOPES,
    )


def resolve_key(key):
    p = Path(key).expanduser()
    for candidate in ([p] if p.is_absolute() else [Path.cwd() / p, SERVER_DIR / p]):
        if candidate.is_file():
            return candidate
    raise CredentialsError(f'GEE_SERVICE_ACCOUNT_KEY is {key!r}, but no such file exists. {SETUP_HELP}')


def key_email(path):
    try:
        info = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CredentialsError(f'Cannot read the service-account key {path}: {exc}. {SETUP_HELP}') from exc
    email = info.get('client_email') if isinstance(info, dict) else None
    if not isinstance(email, str) or not email:
        raise CredentialsError(
            f'{path} is not a service-account JSON key (it has no "client_email"). '
            'Download one under IAM & Admin > Service Accounts > Keys > Add key > JSON. ' + SETUP_HELP)
    return email


def initialize(env=None, ee_module=None):
    """ee.Initialize with the configured credentials; returns (project, how).

    `ee_module` is for tests; normally the real earthengine-api is used.
    """
    if ee_module is None:
        use_certifi_bundle()
        import ee as ee_module  # imported here so the rest of the package loads without it
    project, key = settings(env)
    if key:
        path = resolve_key(key)
        email = key_email(path)
        try:
            credentials = ee_module.ServiceAccountCredentials(email, str(path))
            ee_module.Initialize(credentials, project=project)
        except Exception as exc:
            raise CredentialsError(
                f'Earth Engine refused the service account {email} for project {project!r}: {exc}. '
                'Check that the account has the Earth Engine Resource Viewer role, that the Earth Engine '
                'API is enabled in the project, and that the project is registered for Earth Engine. '
                + SETUP_HELP) from exc
        return project, f'service account {email}'
    raw = ((env if env is not None else os.environ).get('GEE_CREDENTIALS') or '').strip()
    if raw:
        credentials = user_credentials(raw, ee_module)
        try:
            ee_module.Initialize(credentials, project=project)
        except Exception as exc:
            raise CredentialsError(
                f'Earth Engine refused the login in GEE_CREDENTIALS for project {project!r}: {exc}. The login may '
                'have been revoked or expired, or the account may not have access to the project; run '
                '`earthengine authenticate` again and update GEE_CREDENTIALS. ' + SETUP_HELP) from exc
        return project, 'GEE_CREDENTIALS (personal login)'
    try:
        ee_module.Initialize(project=project)
    except Exception as exc:
        raise CredentialsError(f'No Earth Engine credentials found ({exc}). {SETUP_HELP}') from exc
    return project, 'stored user credentials'
