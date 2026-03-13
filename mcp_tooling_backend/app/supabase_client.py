from __future__ import annotations

from dataclasses import asdict
from dataclasses import dataclass
from typing import Any
import base64
import json

import httpx

from .config import Settings
from .tooling_schema import ToolDateRange
from .tooling_schema import ToolQueryFilter
from .tooling_schema import ToolQueryRequest
from .tooling_schema import ToolSort
from .tooling_schema import infer_window_from_domain


@dataclass
class ProxyResponse:
    status_code: int
    headers: dict[str, str]
    body: bytes


@dataclass
class ToolQueryResponse:
    table: str
    row_count: int
    rows: list[dict[str, Any]]
    next_cursor: str | None
    has_more: bool
    applied_sort: list[dict[str, str]]
    effective_window: dict[str, str] | None
    offset: int
    limit: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class SupabaseProxyClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._base_url = settings.supabase_url
        self._auth_headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        }

    @staticmethod
    def _encode_filter_value(value: Any) -> str:
        if value is None:
            return "null"
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (dict, list)):
            return json.dumps(value, separators=(",", ":"))
        return str(value)

    @staticmethod
    def _normalize_filter_op(op: str) -> str:
        normalized = op.strip().lower()
        allowed = {"eq", "neq", "in", "nin", "gt", "gte", "lt", "lte", "ilike", "contains", "is"}
        if normalized not in allowed:
            return "eq"
        return normalized

    @staticmethod
    def _normalize_filters(
        filters: dict[str, Any] | list[dict[str, Any]] | None,
    ) -> list[tuple[str, str]]:
        if filters is None:
            return []

        normalized: list[tuple[str, str]] = []
        items: list[tuple[str, Any]]
        if isinstance(filters, list):
            items = []
            for row in filters:
                column = str(row.get("column", "")).strip()
                if not column:
                    continue
                items.append((column, {"op": row.get("op"), "value": row.get("value")}))
        else:
            items = list(filters.items())

        for column, filter_spec in items:
            if isinstance(filter_spec, dict):
                op = SupabaseProxyClient._normalize_filter_op(str(filter_spec.get("op", "eq")))
                value = SupabaseProxyClient._encode_filter_value(filter_spec.get("value"))
            else:
                op = "eq"
                value = SupabaseProxyClient._encode_filter_value(filter_spec)
            normalized.append((column, f"{op}.{value}"))
        return normalized

    @staticmethod
    def _decode_cursor(cursor: str | None) -> int:
        if not cursor:
            return 0
        try:
            decoded = base64.b64decode(cursor).decode("utf-8")
            payload = json.loads(decoded)
            offset = int(payload.get("offset", 0))
            return max(offset, 0)
        except Exception:
            return 0

    @staticmethod
    def _encode_cursor(offset: int) -> str:
        payload = json.dumps({"offset": max(offset, 0)}, separators=(",", ":"))
        return base64.b64encode(payload.encode("utf-8")).decode("utf-8")

    @staticmethod
    def _normalize_sort(sort: list[dict[str, str]] | tuple[ToolSort, ...] | None) -> list[dict[str, str]]:
        if not sort:
            return [{"column": "id", "direction": "asc"}]

        normalized: list[dict[str, str]] = []
        for item in sort:
            if isinstance(item, ToolSort):
                column = item.column.strip()
                direction = item.direction
            else:
                column = str(item.get("column", "")).strip()
                direction = str(item.get("direction", "asc")).lower()
            if not column:
                continue
            normalized.append({"column": column, "direction": "desc" if direction == "desc" else "asc"})

        if not normalized:
            normalized.append({"column": "id", "direction": "asc"})
        if not any(entry["column"] == "id" for entry in normalized):
            normalized.append({"column": "id", "direction": "asc"})
        return normalized

    @staticmethod
    def _normalize_filter_list(
        filters: list[dict[str, Any]] | tuple[ToolQueryFilter, ...] | None,
    ) -> list[dict[str, Any]]:
        if not filters:
            return []
        normalized: list[dict[str, Any]] = []
        for entry in filters:
            if isinstance(entry, ToolQueryFilter):
                normalized.append({"column": entry.column, "op": entry.op, "value": entry.value})
                continue
            column = str(entry.get("column", "")).strip()
            if not column:
                continue
            normalized.append(
                {
                    "column": column,
                    "op": SupabaseProxyClient._normalize_filter_op(str(entry.get("op", "eq"))),
                    "value": entry.get("value"),
                }
            )
        return normalized

    @staticmethod
    def _resolve_date_column(*, table: str, date_columns: list[str] | tuple[str, ...], requested: str | None) -> str | None:
        if requested and requested.strip():
            return requested.strip()
        if date_columns:
            preferred = [
                "checkin_date",
                "shift_date",
                "starts_at",
                "ends_at",
                "log_date",
                "report_date",
                "business_sales_date",
                "payout_date",
                "ach_bank_date",
                "date_placed",
                "requested_pickup_date",
                "created_at",
                "updated_at",
                "uploaded_at",
                "requested_at",
                "issued_at",
            ]
            date_set = {column.lower(): column for column in date_columns}
            for key in preferred:
                if key in date_set:
                    return date_set[key]
            return date_columns[0]
        fallback_candidates = [
            "created_at",
            "updated_at",
            "uploaded_at",
            "requested_at",
            "issued_at",
            "date",
        ]
        if table.lower().startswith("finance_"):
            fallback_candidates.insert(0, "uploaded_at")
        if table.lower().startswith("hr_") or "attendance" in table.lower():
            fallback_candidates.insert(0, "shift_date")
        return fallback_candidates[0]

    def _resolve_date_window(
        self,
        *,
        table: str,
        department: str | None,
        date_columns: list[str] | tuple[str, ...],
        date_range: ToolDateRange | dict[str, Any] | None,
    ) -> tuple[str | None, str | None, str | None]:
        if not date_range:
            return (None, None, None)

        if isinstance(date_range, ToolDateRange):
            mode = date_range.mode
            from_value = date_range.from_value
            to_value = date_range.to_value
            requested_column = date_range.column
        else:
            mode = str(date_range.get("mode", "auto")).lower()
            from_value = date_range.get("from")
            to_value = date_range.get("to")
            requested_column = date_range.get("column")

        date_column = self._resolve_date_column(
            table=table, date_columns=date_columns, requested=str(requested_column) if requested_column else None
        )
        if not date_column:
            return (None, None, None)

        if mode == "explicit":
            if from_value is None and to_value is None:
                return (None, None, None)
            return (
                date_column,
                str(from_value) if from_value is not None else None,
                str(to_value) if to_value is not None else None,
            )

        auto_from, auto_to = infer_window_from_domain(department=department, table_name=table)
        return (date_column, auto_from, auto_to)

    async def query_table(
        self,
        table: str,
        *,
        select: str = "*",
        limit: int = 100,
        offset: int = 0,
        order: str | None = None,
        filters: dict[str, Any] | list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        base_params: list[tuple[str, str]] = [("select", select), ("limit", str(limit)), ("offset", str(offset))]
        base_params.extend(self._normalize_filters(filters))

        params = list(base_params)
        if order:
            params.append(("order", order))

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.get(
                    f"{self._base_url}/rest/v1/{table}",
                    params=params,
                    headers={**self._auth_headers, "Accept": "application/json"},
                )
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                # Common LLM failure mode: invalid order column (e.g. timestamp desc).
                # Retry once without ordering to keep tool calls resilient.
                if exc.response.status_code == 400 and order:
                    fallback_response = await client.get(
                        f"{self._base_url}/rest/v1/{table}",
                        params=base_params,
                        headers={**self._auth_headers, "Accept": "application/json"},
                    )
                    fallback_response.raise_for_status()
                    payload = fallback_response.json()
                    if isinstance(payload, list):
                        return payload
                    raise RuntimeError(
                        f"Unexpected Supabase payload type for table {table}: {type(payload)}"
                    )
                raise

            payload = response.json()
            if isinstance(payload, list):
                return payload
            raise RuntimeError(f"Unexpected Supabase payload type for table {table}: {type(payload)}")

    async def query_tool(
        self,
        request: ToolQueryRequest,
        *,
        date_columns: list[str] | tuple[str, ...] = tuple(),
        department: str | None = None,
    ) -> ToolQueryResponse:
        limit = max(1, min(int(request.limit), 500))
        offset = self._decode_cursor(request.cursor)
        sort = self._normalize_sort(request.sort)
        filters = self._normalize_filter_list(request.filters)

        date_column, date_from, date_to = self._resolve_date_window(
            table=request.table,
            department=department,
            date_columns=date_columns,
            date_range=request.date_range,
        )
        if date_column and date_from:
            filters.append({"column": date_column, "op": "gte", "value": date_from})
        if date_column and date_to:
            filters.append({"column": date_column, "op": "lte", "value": date_to})

        order = ",".join(f"{entry['column']}.{entry['direction']}" for entry in sort)
        rows = await self.query_table(
            request.table,
            select=request.select,
            limit=limit + 1,
            offset=offset,
            order=order,
            filters=filters,
        )

        has_more = len(rows) > limit
        sliced_rows = rows[:limit]
        next_cursor = self._encode_cursor(offset + limit) if has_more else None
        effective_window = (
            {"column": date_column, "from": date_from, "to": date_to}
            if date_column and (date_from or date_to)
            else None
        )
        return ToolQueryResponse(
            table=request.table,
            row_count=len(sliced_rows),
            rows=sliced_rows,
            next_cursor=next_cursor,
            has_more=has_more,
            applied_sort=sort,
            effective_window=effective_window,
            offset=offset,
            limit=limit,
        )

    async def count_rows(
        self,
        table: str,
        *,
        filters: dict[str, Any] | list[dict[str, Any]] | None = None,
    ) -> int:
        params: list[tuple[str, str]] = [("select", "id"), ("limit", "1")]
        params.extend(self._normalize_filters(filters))

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{self._base_url}/rest/v1/{table}",
                params=params,
                headers={
                    **self._auth_headers,
                    "Accept": "application/json",
                    "Prefer": "count=exact",
                },
            )
            response.raise_for_status()
            content_range = response.headers.get("content-range", "")

        # content-range format: "0-0/123"
        if "/" in content_range:
            maybe_count = content_range.rsplit("/", 1)[-1]
            if maybe_count.isdigit():
                return int(maybe_count)
        return 0

    async def proxy_request(
        self,
        *,
        method: str,
        supabase_path: str,
        query_string: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> ProxyResponse:
        path = supabase_path.lstrip("/")
        target_url = f"{self._base_url}/{path}"
        if query_string:
            target_url = f"{target_url}?{query_string}"

        upstream_headers = {**headers, **self._auth_headers}
        upstream_headers.pop("host", None)
        upstream_headers.pop("content-length", None)

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.request(
                method=method.upper(),
                url=target_url,
                headers=upstream_headers,
                content=body,
            )

        filtered_headers: dict[str, str] = {}
        for key, value in response.headers.items():
            lower_key = key.lower()
            if lower_key in {"content-encoding", "content-length", "transfer-encoding", "connection"}:
                continue
            filtered_headers[key] = value

        filtered_headers["x-coop-mcp-proxy"] = "supabase"
        return ProxyResponse(
            status_code=response.status_code,
            headers=filtered_headers,
            body=response.content,
        )
