from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional, List, Dict, Any, Set
from dataclasses import dataclass

from models.prices import ProviderCapability, GoldPrice, SilverPrice, ProviderResult


@dataclass
class ProviderConfig:
    name: str
    timeout: float = 10.0
    max_retries: int = 3
    retry_cooldown: int = 120
    max_failures: int = 3
    custom_config: Dict[str, Any] = None

    def __post_init__(self):
        if self.custom_config is None:
            self.custom_config = {}


class BaseProvider(ABC):
    def __init__(self, config: ProviderConfig):
        self.config = config
        self._failure_count = 0
        self._last_failure_time: Optional[float] = None
        self._circuit_open = False
        self._last_success_time: Optional[float] = None

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique provider identifier"""
        pass

    @property
    @abstractmethod
    def capabilities(self) -> Set[ProviderCapability]:
        """Return set of capabilities this provider supports"""
        pass

    @abstractmethod
    async def fetch_current_gold(self) -> Optional[GoldPrice]:
        """Fetch current gold prices (24K and 22K)"""
        pass

    @abstractmethod
    async def fetch_current_silver(self) -> Optional[SilverPrice]:
        """Fetch current silver prices"""
        pass

    @abstractmethod
    async def fetch_historical_gold(self, days: int = 10) -> List[Dict[str, Any]]:
        """Fetch historical gold prices"""
        pass

    @abstractmethod
    async def fetch_historical_silver(self, days: int = 10) -> List[Dict[str, Any]]:
        """Fetch historical silver prices"""
        pass

    async def fetch_all(self) -> ProviderResult:
        """Fetch all supported data from this provider"""
        result = ProviderResult(provider=self.name)

        try:
            gold_task = self.fetch_current_gold() if ProviderCapability.CURRENT_GOLD in self.capabilities else None
            silver_task = self.fetch_current_silver() if ProviderCapability.CURRENT_SILVER in self.capabilities else None
            hist_gold_task = self.fetch_historical_gold() if ProviderCapability.HISTORICAL_GOLD in self.capabilities else None
            hist_silver_task = self.fetch_historical_silver() if ProviderCapability.HISTORICAL_SILVER in self.capabilities else None

            gold_data = await gold_task if gold_task else None
            silver_data = await silver_task if silver_task else None
            hist_gold_data = await hist_gold_task if hist_gold_task else []
            hist_silver_data = await hist_silver_task if hist_silver_task else []

            if gold_data:
                gold_data.history = hist_gold_data[:10] if hist_gold_data else gold_data.history[:10]
                result.gold = gold_data

            if silver_data:
                silver_data.history = hist_silver_data[:10] if hist_silver_data else silver_data.history[:10]
                result.silver = silver_data

            result.success = result.gold is not None or result.silver is not None
            if result.success:
                self._record_success()
            else:
                self._record_failure("No data returned")

        except Exception as e:
            result.success = False
            result.error = str(e)
            self._record_failure(str(e))

        return result

    def _record_success(self):
        self._failure_count = 0
        self._circuit_open = False
        self._last_success_time = datetime.now().timestamp()

    def _record_failure(self, error: str):
        self._failure_count += 1
        self._last_failure_time = datetime.now().timestamp()
        if self._failure_count >= self.config.max_failures:
            self._circuit_open = True

    def is_healthy(self) -> bool:
        if not self._circuit_open:
            return True
        if self._last_failure_time and (datetime.now().timestamp() - self._last_failure_time) > self.config.retry_cooldown:
            self._circuit_open = False
            self._failure_count = 0
            return True
        return False

    def get_status(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "healthy": self.is_healthy(),
            "failure_count": self._failure_count,
            "circuit_open": self._circuit_open,
            "last_success": self._last_success_time,
            "last_failure": self._last_failure_time,
            "capabilities": [c.value for c in self.capabilities]
        }