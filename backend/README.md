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
