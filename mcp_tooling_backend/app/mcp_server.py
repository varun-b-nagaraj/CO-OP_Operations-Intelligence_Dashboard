from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import inspect
import re
from typing import Any, Callable

from .config import Settings
from .insights import business_kpis, employee_behavior_snapshot, sales_finance_snapshot
from .schema_registry import SchemaRegistry
from .supabase_client import SupabaseProxyClient
from .tooling_schema import ToolDateRange
from .tooling_schema import ToolQueryFilter
from .tooling_schema import ToolQueryRequest
from .tooling_schema import ToolSort

try:
    from fastmcp import FastMCP
except Exception as exc:  # pragma: no cover - runtime import validation
    raise RuntimeError(
        "fastmcp is required. Install dependencies from mcp_tooling_backend/requirements.txt"
    ) from exc


ToolCallable = Callable[..., Any]


DEPARTMENT_HINTS: dict[str, tuple[str, ...]] = {
    "hr": (
        "students",
        "attendance",
        "meeting_attendance_records",
        "morning_shift_attendance",
        "off_period_shift_attendance",
        "shift_attendance",
        "shift_change_requests",
        "strikes",
        "strike_appeals",
        "points_ledger",
        "employee_settings",
        "employee_login_credentials",
        "hr_",
    ),
    "finance": (
        "finance_",
    ),
    "marketing": (
        "marketing_",
        "event_",
        "external_contacts",
        "internal_coordinators",
        "coordination_logs",
    ),
    "product": (
        "product_",
    ),
    "inventory": (
        "inventory_",
        "Inventory",
        "cfa_",
    ),
    "calendar": (
        "general_department_calendar_events",
    ),
    "access": (
        "access_",
        "auth_sessions",
        "employee_role_assignments",
        "employee_permission_overrides",
    ),
    "executive": (
        "executive_agent_",
    ),
}


EXPLICIT_RELATIONS: dict[str, list[dict[str, str]]] = {
    "product_purchase_orders": [
        {"child_table": "product_purchase_order_lines", "child_column": "purchase_order_id", "parent_column": "id"},
        {
            "child_table": "product_purchase_order_attachments",
            "child_column": "purchase_order_id",
            "parent_column": "id",
        },
    ],
    "product_purchase_order_lines": [
        {
            "child_table": "product_purchase_order_line_attachments",
            "child_column": "purchase_order_line_id",
            "parent_column": "id",
        }
    ],
    "marketing_events": [
        {"child_table": "event_contacts", "child_column": "event_id", "parent_column": "id"},
        {"child_table": "event_assets", "child_column": "event_id", "parent_column": "id"},
        {"child_table": "event_notes", "child_column": "event_id", "parent_column": "id"},
        {"child_table": "coordination_logs", "child_column": "event_id", "parent_column": "id"},
        {"child_table": "marketing_reports", "child_column": "linked_event_id", "parent_column": "id"},
    ],
    "finance_report_headers": [
        {"child_table": "finance_report_rows", "child_column": "report_header_id", "parent_column": "id"},
        {"child_table": "finance_report_issues", "child_column": "report_header_id", "parent_column": "id"},
        {
            "child_table": "finance_report_activity_log",
            "child_column": "report_header_id",
            "parent_column": "id",
        },
    ],
}


@dataclass
class MCPBundle:
    mcp: Any
    tools: dict[str, ToolCallable]
    prompts: dict[str, ToolCallable]
    resources: dict[str, ToolCallable]
    table_names: list[str]


class MCPServerBuilder:
    def __init__(self, *, settings: Settings, schema_registry: SchemaRegistry) -> None:
        self.settings = settings
        self.schema_registry = schema_registry
        self.client = SupabaseProxyClient(settings)
        self.mcp = FastMCP(settings.mcp_server_name)

        self.tool_registry: dict[str, ToolCallable] = {}
        self.prompt_registry: dict[str, ToolCallable] = {}
        self.resource_registry: dict[str, ToolCallable] = {}

    @staticmethod
    def _slugify(name: str) -> str:
        return re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()

    def _register_tool(self, fn: ToolCallable, *, name: str, description: str) -> None:
        tool_decorator = getattr(self.mcp, "tool")
        tool_decorator(name=name, description=description)(fn)
        self.tool_registry[name] = fn

    def _register_prompt(self, fn: ToolCallable, *, name: str, description: str) -> None:
        prompt_decorator = getattr(self.mcp, "prompt")
        prompt_decorator(name=name, description=description)(fn)
        self.prompt_registry[name] = fn

    def _register_resource(self, fn: ToolCallable, *, uri: str, name: str, description: str) -> None:
        resource_decorator = getattr(self.mcp, "resource")
        resource_decorator(uri, name=name, description=description)(fn)
        self.resource_registry[name] = fn

    def _table_department(self, table_name: str) -> str:
        for department, hints in DEPARTMENT_HINTS.items():
            for hint in hints:
                if hint.endswith("_"):
                    if table_name.startswith(hint):
                        return department
                elif table_name == hint:
                    return department
        return "shared"

    def _tables_for_department(self, department: str) -> list[str]:
        normalized = department.strip().lower()
        if normalized in {"all", "*"}:
            return self.schema_registry.table_names
        return [table for table in self.schema_registry.table_names if self._table_department(table) == normalized]

    def _default_date_range(self, mode: str, from_value: str | None, to_value: str | None, column: str | None) -> ToolDateRange:
        if mode == "explicit":
            return ToolDateRange(mode="explicit", from_value=from_value, to_value=to_value, column=column)
        return ToolDateRange(mode="auto", from_value=None, to_value=None, column=column)

    @staticmethod
    def _normalize_filter_models(filters: list[dict[str, Any]] | None) -> tuple[ToolQueryFilter, ...]:
        if not filters:
            return tuple()
        normalized: list[ToolQueryFilter] = []
        for row in filters:
            column = str(row.get("column", "")).strip()
            if not column:
                continue
            op = str(row.get("op", "eq")).strip().lower() or "eq"
            normalized.append(ToolQueryFilter(column=column, op=op, value=row.get("value")))
        return tuple(normalized)

    def _register_core_prompts(self) -> None:
        async def executive_briefing_prompt(question: str) -> str:
            return (
                "You are the executive insights assistant for CO-OP operations. Use MCP tools to gather hard evidence "
                "before making claims. Focus on trends, outliers, and concrete recommendations. "
                "Respond in English only. "
                f"Business question: {question}"
            )

        async def employee_behavior_prompt(question: str) -> str:
            return (
                "You are analyzing employee behavior and performance signals. Prioritize strikes, points ledger, "
                "attendance, meeting attendance, and schedule compliance, then summarize with specific names and counts. "
                "Respond in English only. "
                f"Requested analysis: {question}"
            )

        async def sales_and_growth_prompt(question: str) -> str:
            return (
                "You are analyzing sales and business growth. Pull finance, marketing, product purchasing, and "
                "inventory signals. Compare current vs historical periods and highlight opportunities/risks. "
                "Respond in English only. "
                f"Requested analysis: {question}"
            )

        self._register_prompt(
            executive_briefing_prompt,
            name="executive_briefing_prompt",
            description="Prompt scaffold for leadership-level business insight conversations.",
        )
        self._register_prompt(
            employee_behavior_prompt,
            name="employee_behavior_prompt",
            description="Prompt scaffold for staff behavior, attendance, and policy trend analysis.",
        )
        self._register_prompt(
            sales_and_growth_prompt,
            name="sales_and_growth_prompt",
            description="Prompt scaffold for sales, finance, and growth diagnostics.",
        )

    def _register_core_resources(self) -> None:
        async def schema_catalog_resource() -> dict[str, Any]:
            return {
                "table_count": len(self.schema_registry.tables),
                "tables": self.schema_registry.to_dict(),
                "relationships": self.schema_registry.infer_relationships(),
            }

        async def business_kpi_resource() -> dict[str, Any]:
            return await business_kpis(self.client, self.schema_registry.table_names)

        self._register_resource(
            schema_catalog_resource,
            uri="resource://schema/catalog",
            name="schema_catalog_resource",
            description="All migration-defined public tables and discovered columns.",
        )
        self._register_resource(
            business_kpi_resource,
            uri="resource://insights/business-kpis",
            name="business_kpi_resource",
            description="Top-level KPI row counts for key operations tables.",
        )

    def _register_core_tools(self) -> None:
        async def list_tables() -> dict[str, Any]:
            return {
                "table_count": len(self.schema_registry.tables),
                "tables": self.schema_registry.to_dict(),
            }

        async def describe_table(table_name: str) -> dict[str, Any]:
            table = self.schema_registry.table_map.get(table_name)
            if table is None:
                raise ValueError(f"Unknown table: {table_name}")
            return {
                "name": table.name,
                "department": self._table_department(table.name),
                "columns": list(table.columns),
                "date_columns": list(table.date_columns),
                "source_file": table.source_file,
            }

        async def schema_map() -> dict[str, Any]:
            relationships = self.schema_registry.infer_relationships()
            merged_relationships = list(relationships)
            for parent, child_rows in EXPLICIT_RELATIONS.items():
                for child in child_rows:
                    merged_relationships.append(
                        {
                            "from_table": child["child_table"],
                            "from_column": child["child_column"],
                            "to_table": parent,
                            "to_column": child["parent_column"],
                        }
                    )
            return {
                "table_count": len(self.schema_registry.tables),
                "tables": [
                    {
                        "name": table.name,
                        "department": self._table_department(table.name),
                        "columns": list(table.columns),
                        "date_columns": list(table.date_columns),
                        "source_file": table.source_file,
                    }
                    for table in self.schema_registry.tables
                ],
                "relationships": merged_relationships,
                "departments": {
                    department: self._tables_for_department(department)
                    for department in ["hr", "product", "marketing", "finance", "inventory", "calendar", "access", "executive", "shared"]
                },
            }

        async def query_table(
            table: str,
            select: str = "*",
            filters: list[dict[str, Any]] | None = None,
            date_range: dict[str, Any] | None = None,
            sort: list[dict[str, str]] | None = None,
            limit: int = 100,
            cursor: str | None = None,
            include_related: list[str] | None = None,
            include_storage_metadata: bool = False,
        ) -> dict[str, Any]:
            table_def = self.schema_registry.table_map.get(table)
            if table_def is None:
                raise ValueError(f"Unknown table: {table}")

            date_spec = date_range or {"mode": "auto"}
            request = ToolQueryRequest(
                table=table,
                select=select,
                filters=self._normalize_filter_models(filters),
                date_range=self._default_date_range(
                    str(date_spec.get("mode", "auto")),
                    str(date_spec.get("from")) if date_spec.get("from") else None,
                    str(date_spec.get("to")) if date_spec.get("to") else None,
                    str(date_spec.get("column")) if date_spec.get("column") else None,
                ),
                sort=tuple(ToolSort(column=row.get("column", "id"), direction=row.get("direction", "desc")) for row in (sort or [])),
                limit=limit,
                cursor=cursor,
                include_related=tuple(include_related or []),
                include_storage_metadata=include_storage_metadata,
            )

            result = await self.client.query_tool(
                request,
                date_columns=table_def.date_columns,
                department=self._table_department(table),
            )
            payload = result.to_dict()
            payload["department"] = self._table_department(table)
            payload["include_related"] = include_related or []
            payload["include_storage_metadata"] = include_storage_metadata
            if filters:
                payload["applied_filters"] = filters
            return payload

        async def query_department(
            department: str,
            select: str = "*",
            filters: list[dict[str, Any]] | None = None,
            date_range: dict[str, Any] | None = None,
            sort: list[dict[str, str]] | None = None,
            limit_per_table: int = 50,
            cursor: str | None = None,
            table_whitelist: list[str] | None = None,
        ) -> dict[str, Any]:
            tables = self._tables_for_department(department)
            if table_whitelist:
                allowed = set(table_whitelist)
                tables = [table for table in tables if table in allowed]

            scoped_rows: dict[str, Any] = {}
            for table_name in tables:
                table_def = self.schema_registry.table_map[table_name]
                date_spec = date_range or {"mode": "auto"}
                request = ToolQueryRequest(
                    table=table_name,
                    select=select,
                    filters=self._normalize_filter_models(filters),
                    date_range=self._default_date_range(
                        str(date_spec.get("mode", "auto")),
                        str(date_spec.get("from")) if date_spec.get("from") else None,
                        str(date_spec.get("to")) if date_spec.get("to") else None,
                        str(date_spec.get("column")) if date_spec.get("column") else None,
                    ),
                    sort=tuple(ToolSort(column=row.get("column", "id"), direction=row.get("direction", "desc")) for row in (sort or [])),
                    limit=limit_per_table,
                    cursor=cursor,
                )
                result = await self.client.query_tool(
                    request,
                    date_columns=table_def.date_columns,
                    department=self._table_department(table_name),
                )
                scoped_rows[table_name] = result.to_dict()

            return {
                "department": department,
                "table_count": len(tables),
                "tables": tables,
                "results": scoped_rows,
                "filters": filters or [],
                "date_range": date_range or {"mode": "auto"},
            }

        async def query_related(
            table: str,
            parent_ids: list[str],
            include_children: bool = True,
            limit_per_relation: int = 100,
        ) -> dict[str, Any]:
            if table not in EXPLICIT_RELATIONS:
                return {
                    "table": table,
                    "parent_ids": parent_ids,
                    "relations": [],
                    "results": {},
                    "note": "No explicit relation map configured for this table.",
                }

            relation_rows = EXPLICIT_RELATIONS[table]
            results: dict[str, Any] = {}

            if include_children:
                for relation in relation_rows:
                    child_table = relation["child_table"]
                    if child_table not in self.schema_registry.table_map:
                        continue
                    child_def = self.schema_registry.table_map[child_table]
                    request = ToolQueryRequest(
                        table=child_table,
                        select="*",
                        filters=tuple(),
                        date_range=ToolDateRange(mode="auto"),
                        sort=(ToolSort(column="id", direction="asc"),),
                        limit=limit_per_relation,
                    )
                    typed_filters = [{"column": relation["child_column"], "op": "in", "value": parent_ids}]
                    rows = await self.client.query_table(
                        child_table,
                        select=request.select,
                        limit=request.limit,
                        offset=0,
                        order="id.asc",
                        filters=typed_filters,
                    )
                    results[child_table] = {
                        "relation": relation,
                        "row_count": len(rows),
                        "rows": rows,
                        "department": self._table_department(child_table),
                        "date_columns": list(child_def.date_columns),
                    }

            return {
                "table": table,
                "parent_ids": parent_ids,
                "relations": relation_rows,
                "results": results,
            }

        async def storage_metadata(
            bucket: str,
            limit: int = 100,
            cursor: str | None = None,
            prefix: str | None = None,
        ) -> dict[str, Any]:
            allowed_buckets = {"product-files", "marketing-files", "finance-files"}
            if bucket not in allowed_buckets:
                raise ValueError(f"Bucket {bucket} is not in allowed read-only metadata buckets.")

            filters: list[dict[str, Any]] = [{"column": "bucket_id", "op": "eq", "value": bucket}]
            if prefix:
                filters.append({"column": "name", "op": "ilike", "value": f"{prefix}%"})

            request = ToolQueryRequest(
                table="objects",
                select="id,bucket_id,name,owner,created_at,updated_at,last_accessed_at,metadata",
                filters=self._normalize_filter_models(filters),
                date_range=ToolDateRange(mode="auto", column="created_at"),
                sort=(ToolSort(column="created_at", direction="desc"),),
                limit=limit,
                cursor=cursor,
            )
            result = await self.client.query_tool(
                request,
                date_columns=("created_at", "updated_at", "last_accessed_at"),
                department="shared",
            )
            filtered_rows = [row for row in result.rows if row.get("bucket_id") == bucket]
            response_rows = []
            for row in filtered_rows:
                object_name = str(row.get("name", ""))
                if prefix and not object_name.startswith(prefix):
                    continue
                response_rows.append(
                    {
                        **row,
                        "public_url": f"{self.settings.supabase_url}/storage/v1/object/public/{bucket}/{object_name}",
                    }
                )

            return {
                "bucket": bucket,
                "row_count": len(response_rows),
                "rows": response_rows,
                "next_cursor": result.next_cursor,
                "has_more": result.has_more,
            }

        async def business_overview() -> dict[str, Any]:
            return await business_kpis(self.client, self.schema_registry.table_names)

        async def employee_behavior_overview(limit: int = 25) -> dict[str, Any]:
            return await employee_behavior_snapshot(self.client, self.schema_registry.table_names, limit=limit)

        async def sales_finance_overview(limit: int = 50) -> dict[str, Any]:
            return await sales_finance_snapshot(self.client, self.schema_registry.table_names, limit=limit)

        self._register_tool(list_tables, name="list_tables", description="List all known public tables and columns.")
        self._register_tool(describe_table, name="describe_table", description="Describe a single table schema.")
        self._register_tool(
            schema_map,
            name="schema_map",
            description="Return schema metadata, inferred date columns, relationship map, and department table groups.",
        )
        self._register_tool(
            query_table,
            name="query_table",
            description="Canonical read-only table query with filters, date windows, cursor pagination, and sort metadata.",
        )
        self._register_tool(
            query_department,
            name="query_department",
            description="Run canonical read-only queries across all tables in a department with shared date/filter settings.",
        )
        self._register_tool(
            query_related,
            name="query_related",
            description="Fetch related child records from explicit relation packs (Product, Marketing, Finance).",
        )
        self._register_tool(
            storage_metadata,
            name="storage_metadata",
            description="Read-only metadata listing for product-files, marketing-files, and finance-files buckets.",
        )
        self._register_tool(
            business_overview,
            name="business_overview",
            description="High-level KPI overview across HR, finance, inventory, marketing, and product tables.",
        )
        self._register_tool(
            employee_behavior_overview,
            name="employee_behavior_overview",
            description="Recent employee behavior signals from strikes, points, attendance, and meetings.",
        )
        self._register_tool(
            sales_finance_overview,
            name="sales_finance_overview",
            description="Recent sales/finance trend inputs from finance, marketing, and product tables.",
        )

    def _register_per_table_tools(self) -> None:
        used_names: set[str] = set(self.tool_registry)

        for table in self.schema_registry.tables:
            slug = self._slugify(table.name)
            tool_name = f"table_{slug}"
            index = 2
            while tool_name in used_names:
                tool_name = f"table_{slug}_{index}"
                index += 1
            used_names.add(tool_name)

            table_name = table.name
            table_date_columns = table.date_columns

            async def table_tool(
                select: str = "*",
                filters: list[dict[str, Any]] | None = None,
                date_range: dict[str, Any] | None = None,
                sort: list[dict[str, str]] | None = None,
                limit: int = 100,
                cursor: str | None = None,
                include_related: list[str] | None = None,
                include_storage_metadata: bool = False,
                _table_name: str = table_name,
                _date_columns: tuple[str, ...] = table_date_columns,
            ) -> dict[str, Any]:
                date_spec = date_range or {"mode": "auto"}
                request = ToolQueryRequest(
                    table=_table_name,
                    select=select,
                    filters=self._normalize_filter_models(filters),
                    date_range=self._default_date_range(
                        str(date_spec.get("mode", "auto")),
                        str(date_spec.get("from")) if date_spec.get("from") else None,
                        str(date_spec.get("to")) if date_spec.get("to") else None,
                        str(date_spec.get("column")) if date_spec.get("column") else None,
                    ),
                    sort=tuple(ToolSort(column=row.get("column", "id"), direction=row.get("direction", "desc")) for row in (sort or [])),
                    limit=limit,
                    cursor=cursor,
                    include_related=tuple(include_related or []),
                    include_storage_metadata=include_storage_metadata,
                )
                result = await self.client.query_tool(
                    request,
                    date_columns=_date_columns,
                    department=self._table_department(_table_name),
                )
                payload = result.to_dict()
                payload["department"] = self._table_department(_table_name)
                payload["include_related"] = include_related or []
                payload["include_storage_metadata"] = include_storage_metadata
                if filters:
                    payload["applied_filters"] = filters
                return payload

            table_tool.__name__ = tool_name
            table_tool.__doc__ = f"Canonical read-only table query tool for '{table_name}'."
            self._register_tool(
                table_tool,
                name=tool_name,
                description=f"Canonical table query tool for {table_name} with date ranges and cursor pagination.",
            )

    def build(self) -> MCPBundle:
        self._register_core_prompts()
        self._register_core_resources()
        self._register_core_tools()
        self._register_per_table_tools()

        return MCPBundle(
            mcp=self.mcp,
            tools=self.tool_registry,
            prompts=self.prompt_registry,
            resources=self.resource_registry,
            table_names=self.schema_registry.table_names,
        )


async def invoke_callable(fn: ToolCallable, arguments: dict[str, Any] | None = None) -> Any:
    arguments = arguments or {}
    result = fn(**arguments)
    if inspect.isawaitable(result):
        return await result
    return result


def project_root_from_file() -> Path:
    return Path(__file__).resolve().parents[2]
