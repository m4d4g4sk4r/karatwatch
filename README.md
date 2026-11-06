# KaratWatch

**Gold and silver, at a glance.**

A self-hosted FastAPI service and Scriptable iOS widget for Ahmedabad precious-metal prices.
Track 24K and 22K gold, silver, recent history, and price changes from your Home Screen.

- Goodreturns provider with an extensible provider interface and failover machinery.
- Persistent cache, retry cooldown, and application rate limits.
- Current prices plus up to ten available historical records.
- Scriptable widget with Keychain credentials, local caching, history views, and alerts.
- Docker deployment with optional Cloudflare Tunnel and Access protection.

Gold values are INR per **10 grams**; silver values are INR per **kilogram**.
These are indicative source prices, not guaranteed transaction quotes.

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
The bind-mounted `backend/data/` directory must be writable by the container user
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

## Install the widget

Copy [frontend/KaratWatch.js](frontend/KaratWatch.js) into a new Scriptable script.
Set `SETTINGS.serverURL` to your own endpoint. Run it in Scriptable and configure
the three credentials in its setup menu. Credentials use Keychain entries
`metals.cf-id`, `metals.cf-secret`, and `metals.api-key`.
Add a Scriptable Home Screen widget and select the script.

Parameters: `today`, `gold`, `gold:7`, `gold:24k`, `gold:22k:7`, `silver`, `silver:7`.
The public script has a placeholder hostname. Personal copies remain ignored.
Refresh is scheduled around 05:00 phone-local time by default; iOS controls actual
execution. Manual refresh is available. Syntax checks do not verify iPhone rendering.

## API

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

## Development and pull requests

See [CONTRIBUTING.md](CONTRIBUTING.md). GitHub Actions compile Python, run tests
on Python 3.11/3.12, check widget JavaScript syntax, scan tracked publication files,
validate Compose, and build/start the Docker image on every PR. CI does not deploy.

## Repository layout

- `backend/`: API, providers, services, and tests.
- `frontend/KaratWatch.js`: publishable widget with placeholder URL.
- `scripts/check_publication.py`: tracked-file publication guard.
- `docs/`: sanitized historical deployment notes; this README is the setup reference.

## Publication status

Historical commits contained deployment credentials. Removing them from current
files does not revoke them or erase history. Rotate exposed credentials before
reusing the deployment; coordinate widget Keychain updates. Do not publish private
configuration. No open-source license has been selected yet; public visibility
alone does not grant a redistribution license.
