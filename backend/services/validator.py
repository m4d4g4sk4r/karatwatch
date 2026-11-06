from datetime import datetime
from typing import Optional, List, Dict, Any
from models.prices import GoldPrice, SilverPrice, ProviderResult, ProviderCapability


class DataValidator:
    MIN_GOLD_PRICE = 10000
    MAX_GOLD_PRICE = 500000
    MIN_SILVER_PRICE = 10000
    MAX_SILVER_PRICE = 500000
    MAX_PRICE_CHANGE_PCT = 0.50

    @staticmethod
    def validate_gold(gold: GoldPrice) -> List[str]:
        errors = []

        if gold.price_24k <= 0 or gold.price_22k <= 0:
            errors.append("Gold prices must be positive")

        if not (DataValidator.MIN_GOLD_PRICE <= gold.price_24k <= DataValidator.MAX_GOLD_PRICE):
            errors.append(f"24K gold price {gold.price_24k} outside reasonable range")

        if not (DataValidator.MIN_GOLD_PRICE <= gold.price_22k <= DataValidator.MAX_GOLD_PRICE):
            errors.append(f"22K gold price {gold.price_22k} outside reasonable range")

        if gold.price_22k >= gold.price_24k:
            errors.append("22K gold price should be less than 24K")

        if gold.history:
            errors.extend(DataValidator.validate_history(gold.history, ["24k", "22k"], "gold"))

        return errors

    @staticmethod
    def validate_silver(silver: SilverPrice) -> List[str]:
        errors = []

        if silver.price <= 0:
            errors.append("Silver price must be positive")

        if not (DataValidator.MIN_SILVER_PRICE <= silver.price <= DataValidator.MAX_SILVER_PRICE):
            errors.append(f"Silver price {silver.price} outside reasonable range")

        if silver.history:
            errors.extend(DataValidator.validate_history(silver.history, ["price"], "silver"))

        return errors

    @staticmethod
    def validate_history(history: List[Dict[str, Any]], required_fields: List[str], metal_type: str) -> List[str]:
        errors = []

        if len(history) < 2:
            errors.append(f"Insufficient historical data for {metal_type}")

        seen_dates = set()
        prev_date = None

        for i, record in enumerate(history):
            if not isinstance(record, dict):
                errors.append(f"Record {i} is not a dict")
                continue

            date_str = record.get("date")
            if not date_str:
                errors.append(f"Record {i} missing date")
                continue

            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                errors.append(f"Record {i} has invalid date format: {date_str}")
                continue

            if date_str in seen_dates:
                errors.append(f"Duplicate date in history: {date_str}")
            seen_dates.add(date_str)

            if prev_date and date_obj > prev_date:
                errors.append(f"History not sorted newest first: {date_str} after {prev_date.strftime('%Y-%m-%d')}")
            prev_date = date_obj

            for field in required_fields:
                value = record.get(field)
                if value is None:
                    errors.append(f"Record {i} missing {field}")
                elif not isinstance(value, (int, float)) or value <= 0:
                    errors.append(f"Record {i} has invalid {field}: {value}")

        return errors

    @staticmethod
    def check_price_anomaly(current: int, previous: int, metal: str) -> bool:
        if previous <= 0:
            return False
        change_pct = abs(current - previous) / previous
        return change_pct > DataValidator.MAX_PRICE_CHANGE_PCT

    @staticmethod
    def validate_provider_result(result: ProviderResult, required_capabilities: Optional[List[ProviderCapability]] = None) -> List[str]:
        errors = []

        if required_capabilities:
            if ProviderCapability.CURRENT_GOLD in required_capabilities and not result.gold:
                errors.append("Missing current gold data")
            if ProviderCapability.CURRENT_SILVER in required_capabilities and not result.silver:
                errors.append("Missing current silver data")

        if result.gold:
            errors.extend(DataValidator.validate_gold(result.gold))
        if result.silver:
            errors.extend(DataValidator.validate_silver(result.silver))

        return errors