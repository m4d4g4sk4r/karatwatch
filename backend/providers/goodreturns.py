import re
import httpx
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Set
from bs4 import BeautifulSoup

from providers.base import BaseProvider, ProviderConfig
from models.prices import ProviderCapability, GoldPrice, SilverPrice


class GoodreturnsProvider(BaseProvider):
    def __init__(self, config: ProviderConfig):
        super().__init__(config)
        self.gold_url = config.custom_config.get("gold_url", "https://www.goodreturns.in/gold-rates/ahmedabad.html")
        self.silver_url = config.custom_config.get("silver_url", "https://www.goodreturns.in/silver-rates/ahmedabad.html")
        self.client = httpx.AsyncClient(
            timeout=config.timeout,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )

    @property
    def name(self) -> str:
        return "goodreturns"

    @property
    def capabilities(self) -> Set[ProviderCapability]:
        return {
            ProviderCapability.CURRENT_GOLD,
            ProviderCapability.CURRENT_SILVER,
            ProviderCapability.HISTORICAL_GOLD,
            ProviderCapability.HISTORICAL_SILVER,
            ProviderCapability.GOLD_24K,
            ProviderCapability.GOLD_22K
        }

    async def fetch_current_gold(self) -> Optional[GoldPrice]:
        html = await self._fetch_html(self.gold_url)
        if not html:
            return None
        return self._parse_gold(html)

    async def fetch_current_silver(self) -> Optional[SilverPrice]:
        html = await self._fetch_html(self.silver_url)
        if not html:
            return None
        return self._parse_silver(html)

    async def fetch_historical_gold(self, days: int = 10) -> List[Dict[str, Any]]:
        html = await self._fetch_html(self.gold_url)
        if not html:
            return []
        gold = self._parse_gold(html)
        return gold.history[:days] if gold else []

    async def fetch_historical_silver(self, days: int = 10) -> List[Dict[str, Any]]:
        html = await self._fetch_html(self.silver_url)
        if not html:
            return []
        silver = self._parse_silver(html)
        return silver.history[:days] if silver else []

    async def _fetch_html(self, url: str) -> Optional[str]:
        try:
            response = await self.client.get(url)
            response.raise_for_status()
            return response.text
        except Exception as e:
            return None

    def _parse_gold(self, html: str) -> Optional[GoldPrice]:
        try:
            soup = BeautifulSoup(html, "html.parser")
            tables = soup.find_all("table", class_="gr-table table-conatiner")
            if len(tables) < 2:
                return None

            # Table 0: Current prices (per gram, 8g, 10g, 100g)
            current_table = tables[0]
            current_tbody = current_table.find("tbody", class_="tablebody")
            if not current_tbody:
                return None

            current_rows = current_tbody.find_all("tr")
            current_24k = None
            current_22k = None

            for row in current_rows:
                cols = row.find_all("td")
                if len(cols) < 3:
                    continue
                first_col = cols[0].get_text(strip=True)
                if first_col == "1":
                    price_24k_text = cols[1].get_text(strip=True)
                    price_22k_text = cols[2].get_text(strip=True)
                    current_24k = int(self._parse_price(price_24k_text) * 10)
                    current_22k = int(self._parse_price(price_22k_text) * 10)
                    break

            # Table 1: Historical prices by date
            history_table = tables[1]
            history_tbody = history_table.find("tbody", class_="tablebody")
            if not history_tbody:
                return None

            history_rows = history_tbody.find_all("tr")
            history = []

            for row in history_rows:
                cols = row.find_all("td")
                if len(cols) < 3:
                    continue

                date_str = cols[0].get_text(strip=True)
                try:
                    date_obj = datetime.strptime(date_str, "%b %d, %Y")
                    formatted_date = date_obj.strftime("%Y-%m-%d")
                except ValueError:
                    continue

                price_24k_text = cols[1].get_text(strip=True)
                price_22k_text = cols[2].get_text(strip=True)

                price_24k = int(self._parse_price(price_24k_text) * 10)
                price_22k = int(self._parse_price(price_22k_text) * 10)

                if price_24k is None or price_22k is None:
                    continue

                history.append({
                    "date": formatted_date,
                    "24k": price_24k,
                    "22k": price_22k
                })

            if current_24k is None or current_22k is None:
                return None

            return GoldPrice(
                price_24k=current_24k,
                price_22k=current_22k,
                history=history,
                source=self.name,
                timestamp=datetime.now()
            )
        except Exception:
            return None

    def _parse_silver(self, html: str) -> Optional[SilverPrice]:
        try:
            soup = BeautifulSoup(html, "html.parser")
            tables = soup.find_all("table", class_="gr-table table-conatiner")
            if len(tables) < 2:
                return None

            # Table 0: Current prices (per gram, 8g, 10g, 100g, 1000g/1kg)
            current_table = tables[0]
            current_tbody = current_table.find("tbody", class_="tablebody")
            if not current_tbody:
                return None

            current_rows = current_tbody.find_all("tr")
            current_price = None

            for row in current_rows:
                cols = row.find_all("td")
                if len(cols) < 4:
                    continue
                first_col = cols[0].get_text(strip=True)
                # First column is '1' for 1 gram price
                if first_col == "1":
                    # 1kg price = per gram price * 1000
                    price_10g_text = cols[1].get_text(strip=True)
                    price_per_gram = int(self._parse_price(price_10g_text))
                    current_price = price_per_gram * 1000
                    break

            # Table 1: Historical prices by date
            history_table = tables[1]
            history_tbody = history_table.find("tbody", class_="tablebody")
            if not history_tbody:
                return None

            history_rows = history_tbody.find_all("tr")
            history = []

            for row in history_rows:
                cols = row.find_all("td")
                if len(cols) < 4:
                    continue

                date_str = cols[0].get_text(strip=True)
                try:
                    date_obj = datetime.strptime(date_str, "%b %d, %Y")
                    formatted_date = date_obj.strftime("%Y-%m-%d")
                except ValueError:
                    continue

                # Column 3 is 1kg price
                price_1kg_text = cols[3].get_text(strip=True)
                price_1kg = int(self._parse_price(price_1kg_text))

                if price_1kg is None:
                    continue

                history.append({
                    "date": formatted_date,
                    "price": price_1kg
                })

            if current_price is None:
                return None

            return SilverPrice(
                price=current_price,
                history=history,
                source=self.name,
                timestamp=datetime.now()
            )
        except Exception:
            return None

    def _parse_price(self, text: str) -> Optional[float]:
        text = text.replace("₹", "").replace(",", "").replace("\u20b9", "").strip()
        match = re.search(r"(\d+(?:\.\d+)?)", text)
        if match:
            return float(match.group(1))
        return None

    async def close(self):
        await self.client.aclose()