# Precious Metals API

A production-quality REST API for gold and silver prices in Ahmedabad, India, designed for iOS Scriptable widgets with a modular, extensible provider architecture.

## Features

- **Multi-provider architecture**: Easy to add new price providers
- **Automatic failover**: Falls back to next provider on failure
- **Circuit breaker**: Prevents hammering failing providers
- **Caching**: 30-minute TTL with persistent disk cache
- **Rate limiting**: Per-IP and global limits at application and Cloudflare edge
- **Authentication**: Cloudflare Access service tokens + API key fallback
- **Security**: Cloudflare Tunnel, WAF, origin isolation
- **Compatible**: Works with Scriptable widget implementation

## Quick Start

```bash
cd backend

# 1. Configure environment
cp ../.env.example .env
# Edit .env with your settings

# 2. Start API
docker compose up -d

# 3. Verify
curl -H "X-Metals-Api-Key: your-key" http://127.0.0.1:8765/api/metals
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Edge                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    WAF      │  │ Rate Limit  │  │ Cloudflare Access   │  │
│  │ (block non- │  │ (20/10s/IP) │  │ (Service Token)     │  │
│  │  API paths) │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Tunnel (precious-metals-api)         │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Home Server                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Precious Metals API (Docker)            │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐  │    │
│  │  │ Provider │ │ Provider │ │ Cache  │ │ Rate     │  │    │
│  │  │ Manager  │ │ Registry │ │ Manager│ │ Limiter  │  │    │
│  │  └──────────┘ └──────────┘ └────────┘ └──────────┘  │    │
│  │         │           │                                │    │
│  │         ▼           ▼                                │    │
│  │  ┌────────────────────────────────────────────────┐  │    │
│  │  │           GoodreturnsProvider                  │  │    │
│  │  │  • fetch_current_gold()                        │  │    │
│  │  │  • fetch_current_silver()                      │  │    │
│  │  │  • fetch_historical_gold()                     │  │    │
│  │  │  • fetch_historical_silver()                   │  │    │
│  │  └────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Provider Architecture

The API uses an extensible provider system:

```python
# Adding a new provider only requires:
class NewProvider(BaseProvider):
    @property
    def name(self): return "newprovider"
    
    @property
    def capabilities(self): return {CURRENT_GOLD, CURRENT_SILVER, ...}
    
    async def fetch_current_gold(self): ...
    async def fetch_current_silver(self): ...
    async def fetch_historical_gold(self): ...
    async def fetch_historical_silver(self): ...

# Then register in config:
METALS_PROVIDERS=goodreturns,newprovider
```

Currently implemented:
- **GoodreturnsProvider**: Scrapes gold/silver rates from goodreturns.in

## API Endpoint

**GET** `/api/metals`

### Response Format
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

### Authentication
- **Cloudflare Access** (preferred): `CF-Access-Client-Id` + `CF-Access-Client-Secret`
- **API Key**: `X-Metals-Api-Key`

### Rate Limits
- Application: 30 req/min/IP, 120 req/min global
- Cloudflare Edge: 20 req/10s/IP/colo

## Scriptable Widget

The API is compatible with the Scriptable widget (see `frontend/` directory).

### Widget Parameters
- `today` - Current prices
- `gold` - 24K gold history
- `gold:22k` - 22K gold history
- `silver` - Silver history
- JSON: `{"mode":"gold","purity":"24k","days":4}`

## Cloudflare Resources

| Resource | Purpose |
|----------|---------|
| Tunnel | Secure origin connection |
| DNS | Public hostname |
| Access App | Authentication |
| Service Token | Non-interactive auth |
| Rate Limit | DDoS protection |

## Project Structure

```
metalrates/
├── backend/
│   ├── main.py                 # FastAPI app
│   ├── providers/              # Provider architecture
│   │   ├── base.py            # Abstract base class
│   │   ├── goodreturns.py     # Goodreturns implementation
│   │   ├── manager.py         # Failover manager
│   │   └── __init__.py
│   ├── services/               # Shared services
│   │   ├── cache.py           # File-based cache
│   │   ├── validator.py       # Data validation
│   │   ├── normalizer.py      # Unit normalization
│   │   └── __init__.py
│   ├── models/
│   │   └── prices.py          # Data models
│   ├── tests/
│   │   └── test_providers.py  # Unit tests
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   └── .dockerignore
├── frontend/
│   ├── Price history.js       # Scriptable widget (gitignored - contains personal domain)
│   └── scriptable-config.js   # Widget config template (gitignored)
├── docs/
│   ├── README.md
│   ├── INSTRUCTIONS.md
│   ├── CLOUDFLARE_SETUP_GUIDE.md
│   ├── CLOUDFLARE_DEBUG_GUIDE.md
│   └── DEPLOYMENT_SUMMARY.md
└── scripts/
    ├── cloudflared-config.yml
    └── tunnel-credentials.json (gitignored - contains secrets)
```

## Cloudflare Tunnel Connector Setup

Run on your home server:

```bash
# 1. Install cloudflared
# https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation

# 2. Configure
mkdir -p ~/.cloudflared
cp tunnel-credentials.json ~/.cloudflared/<your-tunnel-id>.json
cp cloudflared-config.yml ~/.cloudflared/config.yml

# 3. Run
cloudflared tunnel run <your-tunnel-name>

# 4. Or as service (systemd)
sudo cp cloudflared.service /etc/systemd/system/
sudo systemctl enable --now cloudflared
```

## Testing

```bash
# Unit tests
cd backend
python -m pytest tests/ -v

# Local API test
curl -H "X-Metals-Api-Key: test-key" http://127.0.0.1:8765/api/metals | python3 -m json.tool

# Health check
curl http://127.0.0.1:8765/health

# Provider status
curl -H "X-Metals-Api-Key: test-key" http://127.0.0.1:8765/providers/status
```

## Security

- Origin binds to `127.0.0.1:8765` only
- No direct public access to origin
- Cloudflare Access enforces service token auth
- Rate limiting at edge and application
- WAF blocks non-API paths
- No credentials in logs, code, or images
- Cache-Control: no-store on responses

## Important Security Notes

- **Never commit `.env`** - contains real credentials
- **Never commit `scripts/tunnel-credentials.json`** - Cloudflare tunnel credentials
- **Never commit `frontend/Price history.js`** - contains personal domain
- Use `.env.example` as template
- Rotate API keys if accidentally committed

## License

Personal use.