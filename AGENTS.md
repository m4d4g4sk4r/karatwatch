# KaratWatch — agent instructions

## Product and code

KaratWatch is a Scriptable iOS widget for Ahmedabad gold and silver prices.
Direct Goodreturns fetching is the default. The FastAPI backend is optional.

- `frontend/KaratWatch.js`: public standalone widget, no personal endpoint.
- `frontend/tests/`: Node behavior tests; no npm dependencies.
- `backend/main.py`: API entry point and authentication.
- `backend/providers/`: provider abstraction, Goodreturns scraper, and failover.
- `backend/services/`: cache, normalization, and validation.
- `backend/models/prices.py`: response dataclasses.
- `backend/tests/`: pytest suite.
- `assets/`: reviewed README images and provenance.

## Documentation

Root README covers the widget. `backend/README.md` covers optional hosting and
API format. `CONTRIBUTING.md` covers development and CI. Do not recreate
historical deployment diaries or duplicate these guides.

## Checks

```bash
node --test frontend/tests/*.test.cjs
node --input-type=module --check < frontend/KaratWatch.js
python -m compileall -q backend
cd backend
python -m pytest tests -v
```

Run `python3 scripts/check_publication.py` from root after staging changes.
Gitleaks scans fetched history in CI. CI never deploys or uses production secrets.
Node tests do not verify Scriptable rendering; disclose on-device testing limits.
Default branch is `main`; publish changes through PRs.

## Data and compatibility

Gold: INR per 10 grams. Silver: INR per kilogram. Never fabricate missing data.
Preserve local cache and Keychain names when changing display branding.
Keychain entries: `metals.cf-id`, `metals.cf-secret`, `metals.api-key`.
API mode sends all three configured headers; direct mode needs no credentials.
Parameters include `today`, `gold`, `gold:7`, `gold:24k`, `gold:22k:7`, `silver:7`.
New providers implement the interface in `backend/providers/base.py` and are
registered in the provider manager; update configuration and tests together.

## Private files and deployment

Never commit `.env`, `scripts/tunnel-credentials.json`, personal
`frontend/Price history.js`, or `frontend/scriptable-config.js`.
Use `.env.example`; rotate exposed secrets. Keep raw `pics/` ignored.
Tunnel credentials must have mode 600. Container cache storage must be writable
by its unprivileged user. Preserve existing deployment names and unrelated services.
See backend README for Compose startup. Local `/health` is unauthenticated;
`/api/metals` and `/providers/status` require authentication.
