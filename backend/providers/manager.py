from typing import List, Dict, Any, Optional, Sequence
from datetime import datetime

from providers.base import BaseProvider, ProviderConfig
from providers.goodreturns import GoodreturnsProvider
from models.prices import ProviderResult, GoldPrice, SilverPrice, MetalsResponse, ProviderCapability


class ProviderManager:
    def __init__(self, provider_names: Sequence[str], provider_configs: Dict[str, ProviderConfig]):
        self.providers: List[BaseProvider] = []
        self.provider_configs = provider_configs
        self._initialize_providers(provider_names)

    def _initialize_providers(self, provider_names: Sequence[str]):
        for name in provider_names:
            config = self.provider_configs.get(name, ProviderConfig(name=name))
            provider = self._create_provider(name, config)
            if provider:
                self.providers.append(provider)

    def _create_provider(self, name: str, config: ProviderConfig) -> Optional[BaseProvider]:
        if name == "goodreturns":
            return GoodreturnsProvider(config)
        # Future providers can be added here
        return None

    async def fetch_with_failover(self, required_capabilities: Optional[List[ProviderCapability]] = None) -> ProviderResult:
        """Try providers in order until one succeeds with required capabilities"""
        last_error = None

        for provider in self.providers:
            if not provider.is_healthy():
                continue

            if required_capabilities:
                if not all(cap in provider.capabilities for cap in required_capabilities):
                    continue

            try:
                result = await provider.fetch_all()
                if result.success and self._validate_result(result, required_capabilities):
                    return result
                last_error = result.error or "Invalid response"
            except Exception as e:
                last_error = str(e)

        # All providers failed, return failed result
        return ProviderResult(
            provider="none",
            success=False,
            error=last_error or "All providers failed"
        )

    def _validate_result(self, result: ProviderResult, required_capabilities: Optional[List[ProviderCapability]]) -> bool:
        if not required_capabilities:
            return True

        if ProviderCapability.CURRENT_GOLD in required_capabilities and not result.gold:
            return False
        if ProviderCapability.CURRENT_SILVER in required_capabilities and not result.silver:
            return False
        if ProviderCapability.HISTORICAL_GOLD in required_capabilities and result.gold and not result.gold.history:
            return False
        if ProviderCapability.HISTORICAL_SILVER in required_capabilities and result.silver and not result.silver.history:
            return False

        return True

    def get_all_status(self) -> List[Dict[str, Any]]:
        return [p.get_status() for p in self.providers]

    async def close(self):
        for provider in self.providers:
            if hasattr(provider, 'close'):
                await provider.close()