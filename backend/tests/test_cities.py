from datetime import datetime, timezone
from collections import Counter
import pytest
from fastapi.testclient import TestClient
import main
from models.prices import ProviderResult, GoldPrice, SilverPrice
from services.cache import CacheManager


@pytest.fixture
def api(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, 'CACHE_FILE', str(tmp_path / 'cache.json'))
    monkeypatch.setattr(main.settings, 'API_KEY', 'fixture-only-key')
    monkeypatch.setattr(main.settings, 'RATE_LIMIT_PER_IP_PER_MINUTE', 100)
    calls = Counter()
    failures = set()

    async def fetch(manager, caps):
        url = manager.providers[0].gold_url
        slug = url.rsplit('/', 1)[-1].removesuffix('.html')
        calls[slug] += 1
        assert manager.providers[0].silver_url.endswith(f'/{slug}.html')
        if slug in failures:
            return ProviderResult(success=False, provider='goodreturns')
        amount = 140000 if slug == 'ahmedabad' else 150000
        dates = ['2026-11-06', '2026-11-05']
        now = datetime.now(timezone.utc)
        return ProviderResult(success=True, provider='goodreturns',
            gold=GoldPrice(amount, amount-10000,
                [{'date': d, '24k': amount, '22k': amount-10000} for d in dates], 'fixture', now),
            silver=SilverPrice(200000, [{'date': d, 'price': 200000} for d in dates], 'fixture', now))
    monkeypatch.setattr(main.ProviderManager, 'fetch_with_failover', fetch)
    with TestClient(main.app) as client:
        client.headers['X-Metals-Api-Key'] = 'fixture-only-key'
        yield client, calls, failures


def test_default_city_aliases_and_isolated_caches(api):
    client, calls, _ = api
    default = client.get('/api/metals')
    assert default.status_code == 200
    assert default.json()['city'] == 'Ahmedabad'
    mumbai = client.get('/api/metals', params={'city': ' Mumbai '})
    assert mumbai.status_code == 200
    assert mumbai.json()['city'] == 'Mumbai'
    assert mumbai.json()['gold']['24k'] != default.json()['gold']['24k']
    assert client.get('/api/metals?city=MUMBAI').json() == mumbai.json()
    assert calls == {'ahmedabad': 1, 'mumbai': 1}
    assert client.get('/api/metals?city=Bengaluru').json()['city'] == 'Bangalore'
    assert calls['bangalore'] == 1
    cache = main.city_contexts['mumbai'][1]
    restored = CacheManager(str(cache.cache_file), 1800, 120)
    assert restored.get().city == 'Mumbai'
    assert restored.is_valid()


def test_upstream_failure_never_uses_another_city(api):
    client, calls, failures = api
    client.get('/api/metals')
    failures.add('mumbai')
    assert client.get('/api/metals?city=mumbai').status_code == 503
    failures.clear()
    assert client.get('/api/metals?city=mumbai').status_code == 200
    cache = main.city_contexts['mumbai'][1]
    cache._last_fetch_time = 1
    failures.add('mumbai')
    response = client.get('/api/metals?city=mumbai')
    assert response.json()['city'] == 'Mumbai'
    assert response.json()['stale'] is True
    assert not cache.is_valid()
    count = calls['mumbai']
    assert client.get('/api/metals?city=mumbai').json()['stale'] is True
    assert calls['mumbai'] == count
    assert client.get('/api/metals').json()['stale'] is False


@pytest.mark.parametrize('city', ['', '../mumbai', 'https://example.com', 'mumbai?x=1', 'a'*61])
def test_invalid_city_rejected_without_provider_request(api, city):
    client, calls, _ = api
    assert client.get('/api/metals', params={'city': city}).status_code == 422
    assert not calls


def test_city_requires_auth_and_shares_rate_limit(api, monkeypatch):
    client, calls, _ = api
    assert client.get('/api/metals?city=mumbai', headers={'X-Metals-Api-Key':'wrong'}).status_code == 401
    monkeypatch.setattr(main.rate_limiter, 'per_ip_limit', 1)
    assert client.get('/api/metals').status_code == 200
    assert client.get('/api/metals?city=mumbai').status_code == 429
    assert 'mumbai' not in calls
