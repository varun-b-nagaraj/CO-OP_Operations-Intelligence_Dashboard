from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_role_key: str
    mcp_server_name: str
    host: str
    port: int
    default_limit: int


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url:
        raise RuntimeError("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL")
    if not supabase_service_role_key:
        raise RuntimeError("Missing SUPABASE_SERVICE_ROLE_KEY")

    return Settings(
        supabase_url=supabase_url.rstrip("/"),
        supabase_service_role_key=supabase_service_role_key,
        mcp_server_name=os.getenv("MCP_SERVER_NAME", "coop-ops-intelligence"),
        host=os.getenv("MCP_HOST", "0.0.0.0"),
        port=int(os.getenv("MCP_PORT", "8081")),
        default_limit=int(os.getenv("MCP_DEFAULT_LIMIT", "100")),
    )
