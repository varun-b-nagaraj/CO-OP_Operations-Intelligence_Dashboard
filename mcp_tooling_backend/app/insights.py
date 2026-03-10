from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .supabase_client import SupabaseProxyClient

async def business_kpis(client: SupabaseProxyClient, tables: list[str]) -> dict[str, Any]:
    key_table_candidates = [
        "students",
        "attendance",
        "strikes",
        "points_ledger",
        "marketing_reports",
        "finance_report_headers",
        "finance_report_rows",
        "inventory_session_final",
        "product_purchase_orders",
    ]

    available = [table for table in key_table_candidates if table in tables]
    counts: dict[str, int] = {}
    for table in available:
        counts[table] = await client.count_rows(table)

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "kpi_row_counts": counts,
        "notes": "Counts are direct table row totals from Supabase via this MCP backend proxy.",
    }


async def employee_behavior_snapshot(client: SupabaseProxyClient, tables: list[str], limit: int = 25) -> dict[str, Any]:
    result: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "tables_used": [],
        "records": {},
    }

    sources = [
        "hr_strikes",
        "strikes",
        "hr_points_ledger",
        "points_ledger",
        "hr_shift_attendance",
        "shift_attendance",
        "hr_meeting_attendance_records",
        "meeting_attendance_records",
    ]

    for table in sources:
        if table not in tables:
            continue
        rows = await client.query_table(table, limit=limit, order="created_at.desc", select="*")
        result["tables_used"].append(table)
        result["records"][table] = rows

    return result


async def sales_finance_snapshot(client: SupabaseProxyClient, tables: list[str], limit: int = 50) -> dict[str, Any]:
    result: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "tables_used": [],
        "records": {},
    }

    sources = [
        "finance_report_headers",
        "finance_report_rows",
        "finance_report_issues",
        "marketing_reports",
        "product_purchase_orders",
        "product_receipts",
    ]

    for table in sources:
        if table not in tables:
            continue
        rows = await client.query_table(table, limit=limit, order="created_at.desc", select="*")
        result["tables_used"].append(table)
        result["records"][table] = rows

    return result
