import json
import time
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from pathlib import Path

from models.prices import MetalsResponse, GoldPrice, SilverPrice, ProviderResult


class CacheManager:
    def __init__(self, cache_file: str, ttl_seconds: int, retry_cooldown: int):
        self.cache_file = Path(cache_file)
        self.ttl_seconds = ttl_seconds
        self.retry_cooldown = retry_cooldown
        self.lock = asyncio.Lock()
        self._cached_response: Optional[MetalsResponse] = None
        self._last_fetch_time: float = 0
        self._last_failure_time: float = 0
        self._provider_last_attempt: Dict[str, float] = {}
        self._load_cache()

    def _load_cache(self):
        try:
            if self.cache_file.exists():
                with open(self.cache_file, "r") as f:
                    data = json.load(f)
                    self._cached_response = MetalsResponse(**data)
                    self._last_fetch_time = data.get("_last_fetch_time", 0)
                    self._last_failure_time = data.get("_last_failure_time", 0)
                    self._provider_last_attempt = data.get("_provider_last_attempt", {})
        except Exception:
            pass

    def _save_cache(self, response: MetalsResponse):
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            data = response.to_dict()
            data["_last_fetch_time"] = self._last_fetch_time
            data["_last_failure_time"] = self._last_failure_time
            data["_provider_last_attempt"] = self._provider_last_attempt
            with open(self.cache_file, "w") as f:
                json.dump(data, f)
        except Exception:
            pass

    def is_valid(self) -> bool:
        if self._cached_response is None:
            return False
        return (time.time() - self._last_fetch_time) < self.ttl_seconds

    def can_retry(self, provider: str = "default") -> bool:
        last_attempt = self._provider_last_attempt.get(provider, self._last_failure_time)
        return (time.time() - last_attempt) >= self.retry_cooldown

    def record_attempt(self, provider: str):
        self._provider_last_attempt[provider] = time.time()

    def get(self) -> Optional[MetalsResponse]:
        return self._cached_response

    def set(self, response: MetalsResponse, success: bool = True, provider: str = "default"):
        self._cached_response = response
        self._last_fetch_time = time.time()
        if not success:
            self._last_failure_time = time.time()
            self._provider_last_attempt[provider] = time.time()
        self._save_cache(response)

    def get_stale(self) -> Optional[MetalsResponse]:
        return self._cached_response