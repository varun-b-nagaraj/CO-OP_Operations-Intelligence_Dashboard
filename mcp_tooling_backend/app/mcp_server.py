from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import inspect
import re
from typing import Any, Awaitable, Callable

from .config import Settings
from .insights import business_kpis, employee_behavior_snapshot, sales_finance_snapshot
from .schema_registry import SchemaRegistry
from .supabase_client import SupabaseProxyClient

try:
    from fastmcp import FastMCP
except Exception as exc:  # pragma: no cover - runtime import validation
    raise RuntimeError(
        "fastmcp is required. Install dependencies from mcp_tooling_backend/requirements.txt"
    ) from exc


ToolCallable = Callable[..., Any]


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
            for table in self.schema_registry.tables:
                if table.name == table_name:
                    return {
                        "name": table.name,
                        "columns": list(table.columns),
                        "source_file": table.source_file,
                    }
            raise ValueError(f"Unknown table: {table_name}")

        async def query_table(
            table_name: str,
            select: str = "*",
            limit: int = 100,
            offset: int = 0,
            order: str | None = None,
            filters: dict[str, Any] | None = None,
        ) -> dict[str, Any]:
            if table_name not in self.schema_registry.table_names:
                raise ValueError(f"Unknown table: {table_name}")

            rows = await self.client.query_table(
                table_name,
                select=select,
                limit=limit,
                offset=offset,
                order=order,
                filters=filters,
            )
            return {
                "table": table_name,
                "row_count": len(rows),
                "rows": rows,
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
            query_table,
            name="query_table",
            description="Query a table with select/filters/order/limit through the Supabase proxy.",
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

            async def table_tool(
                limit: int = 100,
                offset: int = 0,
                select: str = "*",
                order: str | None = None,
                filters: dict[str, Any] | None = None,
                _table_name: str = table_name,
            ) -> dict[str, Any]:
                rows = await self.client.query_table(
                    _table_name,
                    select=select,
                    limit=limit,
                    offset=offset,
                    order=order,
                    filters=filters,
                )
                return {
                    "table": _table_name,
                    "row_count": len(rows),
                    "rows": rows,
                }

            table_tool.__name__ = tool_name
            table_tool.__doc__ = f"Fetch rows directly from table '{table_name}'."
            self._register_tool(
                table_tool,
                name=tool_name,
                description=f"Direct table fetch tool for {table_name}.",
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
