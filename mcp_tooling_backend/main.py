from __future__ import annotations

import argparse

from app.bootstrap import build_mcp_bundle
from app.config import get_settings


def main() -> None:
    parser = argparse.ArgumentParser(description="CO-OP Operations FastMCP server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http", "sse"],
        default="stdio",
        help="MCP transport mode (stdio recommended for local agent integrations)",
    )
    parser.add_argument("--host", default=None, help="Host for HTTP transports")
    parser.add_argument("--port", type=int, default=None, help="Port for HTTP transports")
    parser.add_argument("--path", default="/mcp", help="Path for streamable-http transport")
    args = parser.parse_args()

    settings = get_settings()
    bundle = build_mcp_bundle()

    if args.transport == "stdio":
        bundle.mcp.run(transport="stdio")
        return

    host = args.host or settings.host
    port = args.port or settings.port

    if args.transport == "streamable-http":
        bundle.mcp.run(transport="streamable-http", host=host, port=port, path=args.path)
    else:
        bundle.mcp.run(transport="sse", host=host, port=port)


if __name__ == "__main__":
    main()
