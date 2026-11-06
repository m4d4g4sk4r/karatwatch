# Optional KaratWatch backend

A supporting FastAPI service for the [KaratWatch widget](../README.md).
The widget works without it. Deploy this for shared caching, configurable
providers, failover machinery, and application rate limits.

## Run the backend

Requires Docker Compose. From the repository root:

```bash
cp .env.example backend/.env
# Set API_KEY to a strong random value in backend/.env.
cd backend
docker compose up -d --build
curl http://127.0.0.1:8765/health
```

The process listens on all interfaces inside Docker, while the host publishes
only `127.0.0.1:8765`. Existing deployment resource names are retained for compatibility.
The bind-mounted `data/` directory must be writable by the container user
(`nobody`); provision its permissions before deployment if necessary.

For Python development, create a virtual environment, install
`backend/requirements.txt`, and run `python main.py` from `backend`.
Set `CACHE_FILE` to a writable local path when running outside Docker.

## Authentication and Cloudflare

Local requests use `X-Metals-Api-Key`. For the documented Cloudflare deployment,
clients send **all three** headers together:

```text
CF-Access-Client-Id: <your service token client ID>
CF-Access-Client-Secret: <your service token secret>
X-Metals-Api-Key: <your backend API key>
```

Create a dedicated tunnel pointing to `http://127.0.0.1:8765`, and an Access
application for your own hostname. Use a **Service Auth** policy restricted to
your token, with no public bypass override. Cloudflare rules and plan limits
must be checked for your account; this repository does not provision them.
Never alter unrelated tunnels or policies. Never expose the origin port publicly.

## Connect the widget

Set `SETTINGS.serverURL` in the widget to your HTTPS `/api/metals` endpoint,
then enter the three credentials using its in-app setup menu. Leave the URL
empty to use direct Goodreturns fetching instead. See the [widget guide](../README.md)
for installation and display parameters.

## API

`GET /api/metals?city=mumbai` selects a Goodreturns Indian city slug. Omit `city`
for Ahmedabad. Names are case-insensitive; `Bengaluru` maps to `bangalore` and
`Gurugram` to `gurgaon`. Invalid syntax returns 422. A valid slug without supported
upstream pages returns 503 if there is no cached data; it never falls back to
another city's prices. The widget sends this parameter automatically.

Each city has its own cache file, retry/circuit state, and fetch lock. The original
`CACHE_FILE` and configured Goodreturns URLs remain in use for Ahmedabad; other
cities use fixed Goodreturns URLs and sibling cache files. Keep default URL overrides
pointing to Ahmedabad. Rate limits remain shared across cities. Up to 128 additional
cities can be active per process; further new cities return 503 until restart.
`/health` and `/providers/status` continue to describe the default city's providers.

`GET /api/metals` returns the following shape (illustrative values):

```json
{
  "city": "Ahmedabad",
  "updatedAt": "2026-11-06T14:36:47+05:30",
  "stale": false,
  "gold": {
    "24k": 143510,
    "22k": 131550,
    "history": [
      {"date": "2026-11-06", "24k": 143510, "22k": 131550},
      {"date": "2026-11-05", "24k": 146070, "22k": 133900}
    ]
  },
  "silver": {
    "price": 205000,
    "history": [
      {"date": "2026-11-06", "price": 205000},
      {"date": "2026-11-05", "price": 210000}
    ]
  },
  "source": {
    "provider": "goodreturns",
    "fallbackUsed": false
  }
}
```


History dates are newest first; missing dates are not fabricated. `stale` indicates
server fallback data; `updatedAt` is the data timestamp. Clients should tolerate
unknown metadata fields. Authentication failures, rate limiting, and unavailable
upstream data can return 401/403, 429, and 503 respectively.

`GET /health` is an unauthenticated local health endpoint.
`GET /providers/status` requires authentication. Edge policies may restrict both.

## Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for tests and PR checks.
Keep `.env` and tunnel credentials out of Git. Previously exposed credentials were rotated and repository history cleaned.

## Upstream request policy

The Goodreturns provider identifies itself as KaratWatch and fetches each metal's
page once for both current prices and history. The default 30-minute response cache
reduces repeat requests. A 401/403 response pauses requests to that source host for
at least 24 hours; 429/503 pauses for at least 30 minutes. Longer Retry-After values,
including HTTP dates, are respected. These holds are shared across city providers
within a process and are reset by a process restart; do not restart to evade a block.

API source metadata includes attribution, source-page links, and an indicative-data
notice. Existing cached responses acquire this metadata on their next successful fetch.
Keep this service authenticated for your own use. Do not advertise access to a shared
pricing API without source permission. Setting `METALS_PROVIDERS` to an empty value
and restarting disables new provider fetches (previously cached responses may remain).
See the root README for the distinction between the software license and data rights.
