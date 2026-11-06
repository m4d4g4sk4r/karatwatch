from datetime import datetime
from typing import List, Dict, Any, Optional
from zoneinfo import ZoneInfo

from models.prices import GoldPrice, SilverPrice, MetalsResponse, ProviderResult


IST = ZoneInfo("Asia/Kolkata")


class DataNormalizer:
    @staticmethod
    def normalize_gold(gold: GoldPrice) -> GoldPrice:
        if gold.price_24k < 10000:
            gold.price_24k *= 10
        if gold.price_22k < 10000:
            gold.price_22k *= 10

        for record in gold.history:
            if record.get("24k", 0) < 10000:
                record["24k"] *= 10
            if record.get("22k", 0) < 10000:
                record["22k"] *= 10

        gold.history = DataNormalizer._deduplicate_history(gold.history, ["24k", "22k"])
        gold.history = DataNormalizer._sort_history(gold.history)

        return gold

    @staticmethod
    def normalize_silver(silver: SilverPrice) -> SilverPrice:
        if silver.price < 10000:
            silver.price *= 1000

        for record in silver.history:
            if record.get("price", 0) < 10000:
                record["price"] *= 1000

        silver.history = DataNormalizer._deduplicate_history(silver.history, ["price"])
        silver.history = DataNormalizer._sort_history(silver.history)

        return silver

    @staticmethod
    def _deduplicate_history(history: List[Dict[str, Any]], fields: List[str]) -> List[Dict[str, Any]]:
        seen = set()
        result = []
        for record in history:
            date = record.get("date")
            if date and date not in seen:
                seen.add(date)
                result.append(record)
        return result

    @staticmethod
    def _sort_history(history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return sorted(history, key=lambda x: x.get("date", ""), reverse=True)[:10]

    @staticmethod
    def build_response(provider_result: ProviderResult, cached: bool = False, fallback_used: bool = False, city: str = "Ahmedabad") -> MetalsResponse:
        now = datetime.now(IST)
        updated_at = now.isoformat()

        if provider_result.gold:
            updated_at = provider_result.gold.timestamp.astimezone(IST).isoformat()
        elif provider_result.silver:
            updated_at = provider_result.silver.timestamp.astimezone(IST).isoformat()

        response = MetalsResponse(
            city=city,
            updatedAt=updated_at,
            stale=cached,
            source={
                "provider": provider_result.provider,
                "fallbackUsed": fallback_used
            }
        )

        if provider_result.provider == "goodreturns":
            slug = city.lower().replace(" ", "-")
            response.source.update({
                "name": "Goodreturns",
                "goldUrl": f"https://www.goodreturns.in/gold-rates/{slug}.html",
                "silverUrl": f"https://www.goodreturns.in/silver-rates/{slug}.html",
                "notice": "Indicative third-party prices; verify before use. Not financial advice. No affiliation or endorsement."
            })

        if provider_result.gold:
            gold = provider_result.gold
            if not cached:
                gold = DataNormalizer.normalize_gold(gold)
            response.gold = {
                "24k": gold.price_24k,
                "22k": gold.price_22k,
                "history": gold.history
            }

        if provider_result.silver:
            silver = provider_result.silver
            if not cached:
                silver = DataNormalizer.normalize_silver(silver)
            response.silver = {
                "price": silver.price,
                "history": silver.history
            }

        return response