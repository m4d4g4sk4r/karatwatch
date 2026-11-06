from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
from enum import Enum


class ProviderCapability(Enum):
    CURRENT_GOLD = "current_gold"
    CURRENT_SILVER = "current_silver"
    HISTORICAL_GOLD = "historical_gold"
    HISTORICAL_SILVER = "historical_silver"
    GOLD_24K = "gold_24k"
    GOLD_22K = "gold_22k"
    GOLD_18K = "gold_18k"


@dataclass
class GoldPrice:
    price_24k: int
    price_22k: int
    history: List[Dict[str, Any]]
    source: str
    timestamp: datetime
    stale: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "24k": self.price_24k,
            "22k": self.price_22k,
            "history": self.history,
            "source": self.source,
            "timestamp": self.timestamp.isoformat(),
            "stale": self.stale
        }


@dataclass
class SilverPrice:
    price: int
    history: List[Dict[str, Any]]
    source: str
    timestamp: datetime
    stale: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "price": self.price,
            "history": self.history,
            "source": self.source,
            "timestamp": self.timestamp.isoformat(),
            "stale": self.stale
        }


@dataclass
class ProviderResult:
    gold: Optional[GoldPrice] = None
    silver: Optional[SilverPrice] = None
    provider: str = ""
    success: bool = False
    error: Optional[str] = None


@dataclass
class MetalsResponse:
    city: str = "Ahmedabad"
    updatedAt: str = ""
    stale: bool = False
    gold: Optional[Dict[str, Any]] = None
    silver: Optional[Dict[str, Any]] = None
    source: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "city": self.city,
            "updatedAt": self.updatedAt,
            "stale": self.stale,
            "gold": self.gold,
            "silver": self.silver,
            "source": self.source
        }