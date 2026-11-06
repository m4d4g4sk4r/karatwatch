from datetime import datetime, timezone
from email.utils import format_datetime
from unittest.mock import Mock
import time
import httpx
import pytest
from providers.base import ProviderConfig
from providers.goodreturns import GoodreturnsProvider
from models.prices import GoldPrice, SilverPrice


@pytest.fixture(autouse=True)
def clear_source_holds():
    GoodreturnsProvider._blocked_until.clear()
    yield
    GoodreturnsProvider._blocked_until.clear()


@pytest.mark.asyncio
async def test_current_and_history_require_only_two_requests():
    provider = GoodreturnsProvider(ProviderConfig(name='goodreturns'))
    await provider.client.aclose()
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, text='fixture')
    provider.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    now = datetime.now(timezone.utc)
    provider._parse_gold = Mock(return_value=GoldPrice(140000, 130000, [{'date':'2026-11-06','24k':140000,'22k':130000}], 'fixture', now))
    provider._parse_silver = Mock(return_value=SilverPrice(200000, [{'date':'2026-11-06','price':200000}], 'fixture', now))
    try:
        result = await provider.fetch_all()
        assert result.success
        assert len(requests) == 2
        assert len(result.gold.history) == 1
        assert len(result.silver.history) == 1
    finally:
        await provider.close()


@pytest.mark.asyncio
@pytest.mark.parametrize('status,wait', [(403,86400), (429,172800), (503,1800)])
async def test_refusal_stops_other_city_requests(status, wait):
    first = GoodreturnsProvider(ProviderConfig(name='goodreturns'))
    second = GoodreturnsProvider(ProviderConfig(name='goodreturns'))
    assert first.client.headers['User-Agent'].startswith('KaratWatch/')
    await first.client.aclose()
    await second.client.aclose()
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(status, headers={'Retry-After': str(wait)})
    first.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    second.client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        assert await first._fetch_html('https://www.goodreturns.in/gold-rates/mumbai.html') is None
        assert await second._fetch_html('https://www.goodreturns.in/gold-rates/delhi.html') is None
        assert len(calls) == 1
        assert GoodreturnsProvider._blocked_until['www.goodreturns.in'] >= time.time() + wait - 2
    finally:
        await first.close()
        await second.close()


def test_retry_after_http_date_is_not_shortened():
    future = datetime.fromtimestamp(time.time() + 172800, timezone.utc)
    assert GoodreturnsProvider.retry_seconds(format_datetime(future),1800) > 172790
    assert GoodreturnsProvider.retry_seconds('invalid',1800) == 1800
