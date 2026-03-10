from __future__ import annotations

from .config import get_settings
from .mcp_server import MCPBundle, MCPServerBuilder, project_root_from_file
from .schema_registry import load_schema_registry


def build_mcp_bundle() -> MCPBundle:
    settings = get_settings()
    schema_registry = load_schema_registry(project_root_from_file())
    builder = MCPServerBuilder(settings=settings, schema_registry=schema_registry)
    return builder.build()
