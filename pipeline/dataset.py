"""Shared readers for extraction files (used by consolidate, workbook and site builders)."""
from __future__ import annotations

import json
from pathlib import Path

from common import DATA, REITS

ANALYSIS = DATA / "analysis.json"
STATUS = DATA / "filing_status.json"


def load_filings() -> list[dict]:
    filings = []
    for path in sorted(REITS.glob("*.json")):
        try:
            filings.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError) as e:
            print(f"  ! skipped {path.name}: {e}")
    return filings


def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def is_sourced(x) -> bool:
    """A schema num/text/date/land_area object: carries a status and a value."""
    return isinstance(x, dict) and "status" in x and ("value" in x or "value_sqm" in x)


def val(x):
    return x.get("value", x.get("value_sqm")) if is_sourced(x) else x


def num(x):
    v = val(x)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def cite(src) -> str:
    if not isinstance(src, dict) or not src.get("file"):
        return ""
    return f"{src['file']}:L{src['line']}" if src.get("line") else src["file"]


def iter_statuses(node):
    if isinstance(node, dict):
        if is_sourced(node):
            yield node["status"]
            return
        for v in node.values():
            yield from iter_statuses(v)
    elif isinstance(node, list):
        for v in node:
            yield from iter_statuses(v)


def iter_citations(node, path: str = "$"):
    """Yield (path, value, unit, status, source, note) for every sourced value and every cited row."""
    if isinstance(node, dict):
        if is_sourced(node):
            yield path, val(node), node.get("unit", ""), node["status"], node.get("source"), node.get("note", "")
            return
        if isinstance(node.get("source"), dict):
            scalars = [f"{k}={v}" for k, v in node.items()
                       if k not in ("source", "extra_sources") and isinstance(v, (str, int, float, bool)) and v not in ("", None)]
            yield path, "; ".join(scalars)[:500], "", "found", node["source"], ""
        for key, v in node.items():
            if key == "source":
                continue
            if key == "extra_sources":
                for i, s in enumerate(v or []):
                    yield f"{path}.extra_sources[{i}]", "", "", "found", s, ""
                continue
            yield from iter_citations(v, f"{path}.{key}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from iter_citations(v, f"{path}[{i}]")
