from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import json

import httpx

from .config import Settings


@dataclass
class ProxyResponse:
    status_code: int
    headers: dict[str, str]
    body: bytes


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
    def _normalize_filters(filters: dict[str, Any] | None) -> dict[str, str]:
        if not filters:
            return {}

        normalized: dict[str, str] = {}
        for column, filter_spec in filters.items():
            if isinstance(filter_spec, dict):
                op = str(filter_spec.get("op", "eq"))
                value = SupabaseProxyClient._encode_filter_value(filter_spec.get("value"))
            else:
                op = "eq"
                value = SupabaseProxyClient._encode_filter_value(filter_spec)
            normalized[column] = f"{op}.{value}"
        return normalized

    async def query_table(
        self,
        table: str,
        *,
        select: str = "*",
        limit: int = 100,
        offset: int = 0,
        order: str | None = None,
        filters: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        base_params: dict[str, str] = {
            "select": select,
            "limit": str(limit),
            "offset": str(offset),
        }
        base_params.update(self._normalize_filters(filters))

        params = dict(base_params)
        if order:
            params["order"] = order

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

    async def count_rows(self, table: str, *, filters: dict[str, Any] | None = None) -> int:
        params: dict[str, str] = {"select": "id", "limit": "1"}
        params.update(self._normalize_filters(filters))

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
