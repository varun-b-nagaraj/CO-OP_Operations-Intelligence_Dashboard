# CO-OP MCP Tooling Backend

FastMCP server for your CO-OP Operations dashboard that exposes:
- Multiple prompts for executive, employee-behavior, and sales/finance analysis
- Resources for schema catalog and KPI snapshots
- Tools for generic querying plus **individual tool calls for every table** discovered from `supabase/migrations`

This server talks to Supabase from backend-only code with your service role key, so the agent does not need direct Supabase network access.

## 1) Install

```bash
cd mcp_tooling_backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2) Configure

Copy `.env.example` values into your project `.env` (or export them in shell):
- `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE_KEY`

## 3) Run as MCP Server

Recommended local agent mode:

```bash
cd mcp_tooling_backend
source .venv/bin/activate
python main.py --transport stdio
```

Optional HTTP MCP transport:

```bash
python main.py --transport streamable-http --host 0.0.0.0 --port 8081 --path /mcp
```

## 4) What gets exposed

Core tools:
- `list_tables`
- `describe_table`
- `query_table`
- `query_department`
- `query_related`
- `schema_map`
- `storage_metadata`
- `business_overview`
- `employee_behavior_overview`
- `sales_finance_overview`

Dynamic per-table tools:
- `table_<table_name_slug>` for every table in your migrations
- Example: `table_students`, `table_hr_shift_attendance`, `table_finance_report_rows`

Canonical query shape (read-only):
- `table`, `select`, `filters[]`, `date_range`, `sort[]`, `limit`, `cursor`, `include_related[]`, `include_storage_metadata`
- Cursor responses include: `next_cursor`, `has_more`, `applied_sort`, `effective_window`

Prompts:
- `executive_briefing_prompt`
- `employee_behavior_prompt`
- `sales_and_growth_prompt`

Resources:
- `schema_catalog_resource`
- `business_kpi_resource`
