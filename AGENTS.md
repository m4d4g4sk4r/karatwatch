# Precious Metals API - Agent Instructions

## Project Overview
A FastAPI-based backend service that fetches gold and silver prices for Ahmedabad, India from multiple providers, with caching, rate limiting, and failover. Includes a Scriptable iOS widget for displaying prices.

## Architecture
```
backend/          # FastAPI backend service
├── main.py       # Entry point, FastAPI app, endpoints
├── providers/    # Provider abstraction layer
│   ├── base.py   # Base provider class, ProviderManager
│   ├── goodreturns.py  # Goodreturns.in scraper
│   └── manager.py      # Provider failover logic
├── services/     # Business logic
│   ├── cache.py  # File-based caching with TTL
│   ├── normalizer.py   # Response normalization
│   └── validator.py    # Data validation
├── models/       # Pydantic models
│   └── prices.py # MetalsResponse, ProviderResult, etc.
├── tests/        # Unit tests
├── requirements.txt
├── Dockerfile
└── docker-compose.yml

frontend/         # Scriptable iOS widget
└── Price history.js    # Main widget script

docs/             # Documentation
├── README.md
├── INSTRUCTIONS.md
├── CLOUDFLARE_SETUP_GUIDE.md
├── CLOUDFLARE_DEBUG_GUIDE.md
└── DEPLOYMENT_SUMMARY.md

scripts/          # Deployment scripts
├── cloudflared-config.yml
└── tunnel-credentials.json  # GITIGNORED - contains secrets
```

## Key Features
- **Multi-provider architecture**: Easy to add new price sources
- **Failover**: Automatically tries next provider on failure
- **Caching**: File-based cache with TTL and retry cooldown
- **Rate limiting**: Per-IP and global limits
- **Authentication**: API key or Cloudflare Access service tokens
- **Data validation**: Validates all provider responses
- **Scriptable widget**: iOS home screen widget with history charts

## Development Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env  # Edit with your values
python main.py
```

## Testing
```bash
cd backend
pytest tests/ -v
```

## Docker
```bash
cd backend
docker-compose up -d --build
```

## Configuration (.env)
| Variable | Description |
|----------|-------------|
| API_KEY | Random string for API key auth |
| CF_ACCESS_CLIENT_ID | Cloudflare Access service token ID |
| CF_ACCESS_CLIENT_SECRET | Cloudflare Access service token secret |
| METALS_PROVIDERS | Comma-separated provider names |
| CACHE_TTL_SECONDS | Cache freshness (default 1800) |
| RETRY_COOLDOWN_SECONDS | Retry delay after failure (default 120) |
| RATE_LIMIT_PER_IP_PER_MINUTE | Per-IP rate limit |
| RATE_LIMIT_GLOBAL_PER_MINUTE | Global rate limit |

## API Endpoints
- `GET /api/metals` - Current gold/silver prices (requires auth)
- `GET /health` - Health check (no auth)
- `GET /providers/status` - Provider status (requires auth)

## Adding a New Provider
1. Create `backend/providers/newprovider.py` extending `BaseProvider`
2. Implement `fetch_gold()`, `fetch_silver()`, `fetch_gold_history()`, `fetch_silver_history()`
3. Add to `ProviderManager` in `backend/main.py`
4. Add config to `.env.example`

## Security Notes
- **Never commit `.env`** - contains real credentials
- **Never commit `scripts/tunnel-credentials.json`** - Cloudflare tunnel credentials
- **Never commit `frontend/Price history.js`** - contains personal domain
- Use `.env.example` as template
- Rotate API keys if accidentally committed

## Deployment
- Backend: Docker container behind Cloudflare Tunnel
- Frontend: Scriptable widget runs on iOS, fetches from tunnel URL
- Cloudflare Access protects the API endpoint

## Widget Configuration
The Scriptable widget requires these in Keychain:
- `metals.cf-id` - Cloudflare Access Client ID
- `metals.cf-secret` - Cloudflare Access Client Secret
- `metals.api-key` - Backend API key

Widget parameter examples:
- `today` - All three prices
- `gold` - Gold 24K + 22K history
- `gold:7` - Gold history, 7 rows
- `gold:24k` - Gold 24K only
- `silver` - Silver history

## Common Tasks
- **Update provider URLs**: Edit `.env` GOODRETURNS_GOLD_URL/SILVER_URL
- **Change cache TTL**: Edit CACHE_TTL_SECONDS
- **Adjust rate limits**: Edit RATE_LIMIT_* variables
- **Add provider**: See "Adding a New Provider" above
- **Debug provider**: Check `/providers/status` endpoint
- **Clear cache**: Delete `data/cache.json`

## File Permissions
- `data/` directory must be writable by container user
- `scripts/tunnel-credentials.json` - 600 (owner read/write only)

## Monitoring
- Health check: `GET /health`
- Logs: `docker-compose logs -f metals-api`
- Provider status: `GET /providers/status` (authenticated)