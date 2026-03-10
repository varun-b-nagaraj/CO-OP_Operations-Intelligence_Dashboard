from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re


CREATE_TABLE_PATTERN = re.compile(
    r"create\s+table\s+if\s+not\s+exists\s+public\.(?:\"(?P<quoted>[^\"]+)\"|(?P<bare>[a-zA-Z0-9_]+))\s*\(",
    flags=re.IGNORECASE,
)


@dataclass(frozen=True)
class TableDefinition:
    name: str
    columns: tuple[str, ...]
    source_file: str


@dataclass(frozen=True)
class SchemaRegistry:
    tables: tuple[TableDefinition, ...]

    @property
    def table_names(self) -> list[str]:
        return [table.name for table in self.tables]

    def to_dict(self) -> list[dict[str, object]]:
        return [
            {
                "name": table.name,
                "columns": list(table.columns),
                "source_file": table.source_file,
            }
            for table in self.tables
        ]


def _extract_block(sql_text: str, open_paren_index: int) -> str:
    depth = 0
    cursor = open_paren_index
    while cursor < len(sql_text):
        char = sql_text[cursor]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return sql_text[open_paren_index + 1 : cursor]
        cursor += 1
    return ""


def _extract_columns(block: str) -> tuple[str, ...]:
    columns: list[str] = []
    for raw_line in block.splitlines():
        line = raw_line.strip().rstrip(",")
        if not line:
            continue
        lowered = line.lower()
        if lowered.startswith("--"):
            continue
        if lowered.startswith(("constraint", "primary key", "foreign key", "unique", "check", "exclude")):
            continue

        if line.startswith('"') and '"' in line[1:]:
            column_name = line[1:].split('"', 1)[0]
        else:
            column_name = line.split()[0]

        normalized = column_name.strip()
        if normalized and normalized not in columns:
            columns.append(normalized)
    return tuple(columns)


def load_schema_registry(project_root: Path) -> SchemaRegistry:
    migrations_dir = project_root / "supabase" / "migrations"
    if not migrations_dir.exists():
        return SchemaRegistry(tables=tuple())

    table_map: dict[str, TableDefinition] = {}

    for migration_path in sorted(migrations_dir.glob("*.sql")):
        sql_text = migration_path.read_text(encoding="utf-8")
        for match in CREATE_TABLE_PATTERN.finditer(sql_text):
            table_name = match.group("quoted") or match.group("bare")
            if not table_name:
                continue

            open_paren_index = match.end() - 1
            block = _extract_block(sql_text, open_paren_index)
            columns = _extract_columns(block)

            existing = table_map.get(table_name)
            if existing is None or len(columns) > len(existing.columns):
                table_map[table_name] = TableDefinition(
                    name=table_name,
                    columns=columns,
                    source_file=str(migration_path.relative_to(project_root)),
                )

    tables = tuple(sorted(table_map.values(), key=lambda table: table.name.lower()))
    return SchemaRegistry(tables=tables)
