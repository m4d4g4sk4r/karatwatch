import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from models.prices import GoldPrice, SilverPrice, ProviderResult, ProviderCapability
from providers.goodreturns import GoodreturnsProvider
from providers.base import ProviderConfig
from services.validator import DataValidator
from services.normalizer import DataNormalizer
from services.cache import CacheManager


class TestGoodreturnsProvider:
    @pytest.fixture
    def provider(self):
        config = ProviderConfig(
            name="goodreturns",
            timeout=10.0,
            custom_config={
                "gold_url": "https://example.com/gold",
                "silver_url": "https://example.com/silver"
            }
        )
        provider = GoodreturnsProvider(config)
        return provider

    @pytest.mark.asyncio
    async def test_parse_gold(self, provider):
        sample_html = """
        <table class="gr-table table-conatiner">
            <tbody class="tablebody">
                <tr>
                    <td>1</td>
                    <td>₹1,435.10</td>
                    <td>₹1,315.50</td>
                </tr>
            </tbody>
        </table>
        <table class="gr-table table-conatiner">
            <tbody class="tablebody">
                <tr>
                    <td>Nov 06, 2026</td>
                    <td>₹1,435.10</td>
                    <td>₹1,315.50</td>
                </tr>
                <tr>
                    <td>Nov 05, 2026</td>
                    <td>₹1,460.70</td>
                    <td>₹1,339.00</td>
                </tr>
            </tbody>
        </table>
        """
        result = provider._parse_gold(sample_html)
        assert result is not None
        assert result.price_24k == 14351
        assert result.price_22k == 13155
        assert len(result.history) == 2
        assert result.history[0]["date"] == "2026-11-06"

    @pytest.mark.asyncio
    async def test_parse_silver(self, provider):
        sample_html = """
        <table class="gr-table table-conatiner">
            <tbody class="tablebody">
                <tr>
                    <td>1</td>
                    <td>₹205</td>
                    <td>₹210</td>
                    <td>-&nbsp;₹5</td>
                </tr>
            </tbody>
        </table>
        <table class="gr-table table-conatiner">
            <tbody class="tablebody">
                <tr>
                    <td>Nov 06, 2026</td>
                    <td>₹2,050</td>
                    <td>₹20,500</td>
                    <td>₹2,05,000</td>
                </tr>
                <tr>
                    <td>Nov 05, 2026</td>
                    <td>₹2,100</td>
                    <td>₹21,000</td>
                    <td>₹2,10,000</td>
                </tr>
            </tbody>
        </table>
        """
        result = provider._parse_silver(sample_html)
        assert result is not None
        assert result.price == 205000
        assert len(result.history) == 2
        assert result.history[0]["date"] == "2026-11-06"


class TestDataValidator:
    def test_validate_gold_valid(self):
        gold = GoldPrice(
            price_24k=143510,
            price_22k=131550,
            history=[
                {"date": "2026-11-06", "24k": 143510, "22k": 131550},
                {"date": "2026-11-05", "24k": 146070, "22k": 133900}
            ],
            source="goodreturns",
            timestamp=datetime.now()
        )
        errors = DataValidator.validate_gold(gold)
        assert len(errors) == 0

    def test_validate_gold_22k_higher_than_24k(self):
        gold = GoldPrice(
            price_24k=131550,
            price_22k=143510,
            history=[],
            source="goodreturns",
            timestamp=datetime.now()
        )
        errors = DataValidator.validate_gold(gold)
        assert any("22K gold price should be less than 24K" in e for e in errors)

    def test_validate_gold_invalid_price(self):
        gold = GoldPrice(
            price_24k=-100,
            price_22k=131550,
            history=[],
            source="goodreturns",
            timestamp=datetime.now()
        )
        errors = DataValidator.validate_gold(gold)
        assert len(errors) > 0

    def test_validate_silver_valid(self):
        silver = SilverPrice(
            price=205000,
            history=[
                {"date": "2026-11-06", "price": 205000},
                {"date": "2026-11-05", "price": 210000}
            ],
            source="goodreturns",
            timestamp=datetime.now()
        )
        errors = DataValidator.validate_silver(silver)
        assert len(errors) == 0

    def test_check_price_anomaly(self):
        assert DataValidator.check_price_anomaly(200000, 100000, "gold") == True
        assert DataValidator.check_price_anomaly(151000, 100000, "gold") == True
        assert DataValidator.check_price_anomaly(110000, 100000, "gold") == False


class TestDataNormalizer:
    def test_normalize_gold(self):
        gold = GoldPrice(
            price_24k=1435,
            price_22k=1315,
            history=[
                {"date": "2026-11-06", "24k": 1435, "22k": 1315},
                {"date": "2026-11-05", "24k": 1460, "22k": 1339}
            ],
            source="goodreturns",
            timestamp=datetime.now()
        )
        normalized = DataNormalizer.normalize_gold(gold)
        assert normalized.price_24k == 14350
        assert normalized.price_22k == 13150

    def test_normalize_silver(self):
        silver = SilverPrice(
            price=205,
            history=[
                {"date": "2026-11-06", "price": 205},
                {"date": "2026-11-05", "price": 210}
            ],
            source="goodreturns",
            timestamp=datetime.now()
        )
        normalized = DataNormalizer.normalize_silver(silver)
        assert normalized.price == 205000

    def test_deduplicate_history(self):
        history = [
            {"date": "2026-11-06", "price": 205000},
            {"date": "2026-11-06", "price": 206000},
            {"date": "2026-11-05", "price": 210000}
        ]
        result = DataNormalizer._deduplicate_history(history, ["price"])
        assert len(result) == 2


class TestCacheManager:
    @pytest.fixture
    def cache_manager(self, tmp_path):
        cache_file = tmp_path / "cache.json"
        return CacheManager(str(cache_file), 1800, 120)

    def test_cache_is_valid_false_when_empty(self, cache_manager):
        assert cache_manager.is_valid() == False

    def test_cache_is_valid_true_when_fresh(self, cache_manager):
        from models.prices import MetalsResponse
        from datetime import datetime
        response = MetalsResponse(
            city="Ahmedabad",
            updatedAt=datetime.now().isoformat(),
            stale=False
        )
        cache_manager.set(response, success=True)
        assert cache_manager.is_valid() == True


class TestProviderFailover:
    @pytest.mark.asyncio
    async def test_provider_manager_failover(self):
        config1 = ProviderConfig(name="provider1", timeout=1.0)
        config2 = ProviderConfig(name="provider2", timeout=1.0)

        from providers.base import BaseProvider
        from models.prices import ProviderCapability, GoldPrice, SilverPrice

        class MockProvider1(BaseProvider):
            def __init__(self):
                super().__init__(config1)
                self._should_fail = True

            @property
            def name(self):
                return "provider1"

            @property
            def capabilities(self):
                return {ProviderCapability.CURRENT_GOLD, ProviderCapability.CURRENT_SILVER}

            async def fetch_current_gold(self):
                if self._should_fail:
                    raise Exception("Provider 1 failed")
                return GoldPrice(143510, 131550, [], "provider1", datetime.now())

            async def fetch_current_silver(self):
                if self._should_fail:
                    raise Exception("Provider 1 failed")
                return SilverPrice(205000, [], "provider1", datetime.now())

            async def fetch_historical_gold(self, days=10):
                return []

            async def fetch_historical_silver(self, days=10):
                return []

        class MockProvider2(BaseProvider):
            def __init__(self):
                super().__init__(config2)

            @property
            def name(self):
                return "provider2"

            @property
            def capabilities(self):
                return {ProviderCapability.CURRENT_GOLD, ProviderCapability.CURRENT_SILVER}

            async def fetch_current_gold(self):
                return GoldPrice(143510, 131550, [], "provider2", datetime.now())

            async def fetch_current_silver(self):
                return SilverPrice(205000, [], "provider2", datetime.now())

            async def fetch_historical_gold(self, days=10):
                return []

            async def fetch_historical_silver(self, days=10):
                return []

        provider1 = MockProvider1()
        provider2 = MockProvider2()

        from providers.manager import ProviderManager
        manager = ProviderManager.__new__(ProviderManager)
        manager.providers = [provider1, provider2]

        result = await manager.fetch_with_failover()
        assert result.success == True
        assert result.provider == "provider2"