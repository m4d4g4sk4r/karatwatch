import os
import logging
import asyncio
import time
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException, Header, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings

from providers import ProviderManager, ProviderConfig
from providers.goodreturns import GoodreturnsProvider
from services.cache import CacheManager
from services.validator import DataValidator
from services.normalizer import DataNormalizer
from models.prices import MetalsResponse, ProviderResult, ProviderCapability

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 8765
    CACHE_TTL_SECONDS: int = 1800
    RETRY_COOLDOWN_SECONDS: int = 120
    CACHE_FILE: str = "/data/cache.json"
    REQUEST_TIMEOUT: float = 10.0
    RATE_LIMIT_PER_IP_PER_MINUTE: int = 30
    RATE_LIMIT_GLOBAL_PER_MINUTE: int = 120
    API_KEY: str = ""
    CF_ACCESS_CLIENT_ID: str = ""
    CF_ACCESS_CLIENT_SECRET: str = ""
    METALS_PROVIDERS: str = "goodreturns"
    METALS_PROVIDER_TIMEOUT: float = 10.0
    METALS_PROVIDER_RETRY_COOLDOWN: int = 120
    METALS_PROVIDER_MAX_FAILURES: int = 3
    GOODRETURNS_GOLD_URL: str = "https://www.goodreturns.in/gold-rates/ahmedabad.html"
    GOODRETURNS_SILVER_URL: str = "https://www.goodreturns.in/silver-rates/ahmedabad.html"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

app = FastAPI(
    title="Precious Metals API",
    description="Gold and Silver prices for Ahmedabad, India - Multi-provider architecture",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

provider_manager: Optional[ProviderManager] = None
cache_manager: Optional[CacheManager] = None
rate_limiter: Optional["RateLimiter"] = None


class RateLimiter:
    def __init__(self, per_ip_limit: int, global_limit: int, window_seconds: int = 60):
        self.per_ip_limit = per_ip_limit
        self.global_limit = global_limit
        self.window_seconds = window_seconds
        self.ip_requests: Dict[str, List[float]] = {}
        self.global_requests: List[float] = []
        self.lock = asyncio.Lock()

    def _clean_old_requests(self, requests: List[float], now: float) -> List[float]:
        cutoff = now - self.window_seconds
        return [t for t in requests if t > cutoff]

    async def check_limit(self, client_ip: str) -> tuple[bool, int]:
        async with self.lock:
            now = time.time()
            self.ip_requests[client_ip] = self._clean_old_requests(
                self.ip_requests.get(client_ip, []), now
            )
            self.global_requests = self._clean_old_requests(
                self.global_requests, now
            )

            ip_count = len(self.ip_requests[client_ip])
            global_count = len(self.global_requests)

            if ip_count >= self.per_ip_limit:
                retry_after = int(self.window_seconds - (now - self.ip_requests[client_ip][0])) + 1
                return False, retry_after

            if global_count >= self.global_limit:
                retry_after = int(self.window_seconds - (now - self.global_requests[0])) + 1
                return False, retry_after

            self.ip_requests[client_ip].append(now)
            self.global_requests.append(now)
            return True, 0


@asynccontextmanager
async def lifespan(app: FastAPI):
    global provider_manager, cache_manager, rate_limiter

    provider_configs = {
        "goodreturns": ProviderConfig(
            name="goodreturns",
            timeout=settings.METALS_PROVIDER_TIMEOUT,
            retry_cooldown=settings.METALS_PROVIDER_RETRY_COOLDOWN,
            max_failures=settings.METALS_PROVIDER_MAX_FAILURES,
            custom_config={
                "gold_url": settings.GOODRETURNS_GOLD_URL,
                "silver_url": settings.GOODRETURNS_SILVER_URL
            }
        )
    }

    provider_names = [name.strip() for name in settings.METALS_PROVIDERS.split(",") if name.strip()]

    provider_manager = ProviderManager(provider_names, provider_configs)
    cache_manager = CacheManager(
        settings.CACHE_FILE,
        settings.CACHE_TTL_SECONDS,
        settings.RETRY_COOLDOWN_SECONDS
    )
    rate_limiter = RateLimiter(
        settings.RATE_LIMIT_PER_IP_PER_MINUTE,
        settings.RATE_LIMIT_GLOBAL_PER_MINUTE
    )

    logger.info(f"Initialized providers: {provider_names}")
    logger.info(f"Cache TTL: {settings.CACHE_TTL_SECONDS}s, Retry cooldown: {settings.RETRY_COOLDOWN_SECONDS}s")

    yield

    if provider_manager:
        await provider_manager.close()


app.router.lifespan_context = lifespan


async def verify_auth(
    request: Request,
    x_metals_api_key: Optional[str] = Header(None),
    cf_access_client_id: Optional[str] = Header(None),
    cf_access_client_secret: Optional[str] = Header(None)
):
    # Check API key first (if provided in request)
    if x_metals_api_key and settings.API_KEY:
        if x_metals_api_key == settings.API_KEY:
            return True
        # If API key provided but wrong, still check Cloudflare Access as fallback
    
    # Check Cloudflare Access credentials
    if cf_access_client_id and cf_access_client_secret and settings.CF_ACCESS_CLIENT_ID and settings.CF_ACCESS_CLIENT_SECRET:
        if cf_access_client_id == settings.CF_ACCESS_CLIENT_ID and cf_access_client_secret == settings.CF_ACCESS_CLIENT_SECRET:
            return True
        raise HTTPException(status_code=401, detail="Invalid Cloudflare Access credentials")
    
    # Check if only API key is configured (no CF Access in request)
    if settings.API_KEY and not (cf_access_client_id or cf_access_client_secret):
        if x_metals_api_key != settings.API_KEY:
            raise HTTPException(status_code=401, detail="Invalid API key")
        return True
    
    raise HTTPException(status_code=401, detail="Authentication required")


def get_client_ip(request: Request) -> str:
    cf_ip = request.headers.get("CF-Connecting-IP")
    if cf_ip:
        return cf_ip
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.get("/api/metals")
async def get_metals(
    request: Request,
    auth: bool = Depends(verify_auth)
):
    client_ip = get_client_ip(request)
    allowed, retry_after = await rate_limiter.check_limit(client_ip)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(retry_after)}
        )

    cached = cache_manager.get()
    if cached and cache_manager.is_valid():
        logger.info("Serving fresh cached data")
        cached.stale = False
        return JSONResponse(content=cached.to_dict())

    if cached and not cache_manager.can_retry():
        logger.info("Serving stale cached data (retry cooldown active)")
        cached.stale = True
        return JSONResponse(content=cached.to_dict())

    logger.info("Fetching fresh data from providers")
    required_caps = [
        ProviderCapability.CURRENT_GOLD,
        ProviderCapability.CURRENT_SILVER,
        ProviderCapability.HISTORICAL_GOLD,
        ProviderCapability.HISTORICAL_SILVER
    ]

    provider_result = await provider_manager.fetch_with_failover(required_caps)

    fallback_used = False
    cached_response = cache_manager.get()

    if provider_result.success:
        errors = DataValidator.validate_provider_result(provider_result, required_caps)
        if errors:
            logger.warning(f"Provider {provider_result.provider} validation failed: {errors}")
            provider_result.success = False
            provider_result.error = "; ".join(errors)

    if not provider_result.success:
        for provider in provider_manager.providers:
            cache_manager.record_attempt(provider.name)

    if provider_result.success:
        response = DataNormalizer.build_response(provider_result, cached=False, fallback_used=fallback_used)
        cache_manager.set(response, success=True, provider=provider_result.provider)
        return JSONResponse(content=response.to_dict())
    elif cached_response:
        logger.warning("All providers failed, serving stale cached data")
        cached_response.stale = True
        cache_manager.set(cached_response, success=False)
        return JSONResponse(content=cached_response.to_dict())
    else:
        raise HTTPException(status_code=503, detail="Unable to fetch data and no cache available")


@app.get("/health")
async def health_check():
    provider_status = provider_manager.get_all_status() if provider_manager else []
    return {
        "status": "ok",
        "cache_valid": cache_manager.is_valid() if cache_manager else False,
        "providers": provider_status
    }


@app.get("/providers/status")
async def providers_status(auth: bool = Depends(verify_auth)):
    if not provider_manager:
        return {"providers": []}
    return {"providers": provider_manager.get_all_status()}


if __name__ == "__main__":
    import uvicorn
    import time
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)