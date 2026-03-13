from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal


FilterOperator = Literal[
    "eq",
    "neq",
    "in",
    "nin",
    "gt",
    "gte",
    "lt",
    "lte",
    "ilike",
    "contains",
    "is",
]

DateRangeMode = Literal["auto", "explicit"]


@dataclass(frozen=True)
class ToolQueryFilter:
    column: str
    op: FilterOperator
    value: Any


@dataclass(frozen=True)
class ToolDateRange:
    mode: DateRangeMode = "auto"
    from_value: str | None = None
    to_value: str | None = None
    column: str | None = None


@dataclass(frozen=True)
class ToolSort:
    column: str
    direction: Literal["asc", "desc"] = "desc"


@dataclass(frozen=True)
class ToolQueryRequest:
    table: str
    select: str = "*"
    filters: tuple[ToolQueryFilter, ...] = tuple()
    date_range: ToolDateRange | None = None
    sort: tuple[ToolSort, ...] = tuple()
    limit: int = 100
    cursor: str | None = None
    include_related: tuple[str, ...] = tuple()
    include_storage_metadata: bool = False


@dataclass(frozen=True)
class ToolWindowDefaults:
    baseline_days: int = 30
    hr_days: int = 90
    finance_days: int = 30
    calendar_days_forward: int = 30


WINDOW_DEFAULTS = ToolWindowDefaults()


def now_utc() -> datetime:
    return datetime.now(UTC)


def iso_utc(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def infer_window_from_domain(*, department: str | None, table_name: str) -> tuple[str, str]:
    now = now_utc()
    table_lower = table_name.lower()
    department_lower = (department or "").lower()
    is_hr = department_lower == "hr" or table_lower.startswith("hr_") or any(
        token in table_lower for token in ("attendance", "shift", "strike", "meeting")
    )
    is_finance = department_lower == "finance" or table_lower.startswith("finance_")
    is_calendar = table_lower == "general_department_calendar_events"

    if is_calendar:
        return iso_utc(now), iso_utc(now + timedelta(days=WINDOW_DEFAULTS.calendar_days_forward))
    if is_hr:
        return iso_utc(now - timedelta(days=WINDOW_DEFAULTS.hr_days)), iso_utc(now)
    if is_finance:
        return iso_utc(now - timedelta(days=WINDOW_DEFAULTS.finance_days)), iso_utc(now)
    return iso_utc(now - timedelta(days=WINDOW_DEFAULTS.baseline_days)), iso_utc(now)

