"""Validate extraction files against the schema and check that every citation points at real text.

Usage:
    python pipeline/validate.py data/reits/WHART_PO_767525.json [...]
    python pipeline/validate.py                  # every file in data/reits/
Exit code 1 if any file has errors (warnings do not fail).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

from common import REITS, SCHEMA, TEXT, utf8_console

_NOISE = re.compile(r"<br>|[\s|*#`>\"“”'‘’]+")


def _norm(s: str) -> str:
    return _NOISE.sub("", s)


def iter_sources(node, path: str = "$"):
    if isinstance(node, dict):
        for key, val in node.items():
            here = f"{path}.{key}"
            if key == "source" and isinstance(val, dict):
                yield here, val
            elif key == "extra_sources" and isinstance(val, list):
                for i, s in enumerate(val):
                    if isinstance(s, dict):
                        yield f"{here}[{i}]", s
            else:
                yield from iter_sources(val, here)
    elif isinstance(node, list):
        for i, val in enumerate(node):
            yield from iter_sources(val, f"{path}[{i}]")


def check_citations(data: dict, filing_id: str) -> tuple[list[str], list[str]]:
    errors, warnings, cache = [], [], {}
    text_dir = TEXT / filing_id
    for path, src in iter_sources(data):
        name = src.get("file")
        if not isinstance(name, str):
            continue
        md = text_dir / name
        if not md.exists():
            errors.append(f"{path}: cited file {name} does not exist in text/{filing_id}/")
            continue
        if name not in cache:
            lines = md.read_text(encoding="utf-8").split("\n")
            cache[name] = (lines, _norm("".join(lines)))
        lines, whole = cache[name]
        line = src.get("line")
        if isinstance(line, int) and not 1 <= line <= len(lines):
            errors.append(f"{path}: line {line} is beyond the end of {name} ({len(lines)} lines)")
            line = None
        quote = src.get("quote")
        if quote:
            q = _norm(quote)
            if q and q not in whole:
                errors.append(f"{path}: quote not found verbatim in {name}: {quote[:90]!r}")
            elif q and isinstance(line, int) and q not in _norm("".join(lines[max(0, line - 40): line + 40])):
                warnings.append(f"{path}: quote exists in {name} but not within 40 lines of line {line}")
    return errors, warnings


def validate_file(path: Path, validator: Draft202012Validator) -> tuple[list[str], list[str]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return [f"cannot read JSON: {e}"], []
    errors = []
    for err in sorted(validator.iter_errors(data), key=lambda e: [str(p) for p in e.absolute_path]):
        loc = "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in err.absolute_path)
        msg = err.message
        if err.context:
            sub = best_match(err.context)
            sub_loc = "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in sub.absolute_path)
            msg = f"{sub.message} (at {loc}{sub_loc})"
        errors.append(f"{loc}: {msg[:400]}")
    warnings = []
    filing_id = data.get("filing", {}).get("filing_id") if isinstance(data, dict) else None
    if filing_id != path.stem:
        errors.append(f"$.filing.filing_id {filing_id!r} must equal the file name {path.stem!r}")
    elif (TEXT / filing_id).exists():
        cite_errors, warnings = check_citations(data, filing_id)
        errors += cite_errors
    return errors, warnings


def main() -> None:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--max-errors", type=int, default=80)
    args = ap.parse_args()
    validator = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))
    files = args.files or sorted(REITS.glob("*.json"))
    failed = False
    for f in files:
        errors, warnings = validate_file(f, validator)
        for w in warnings[:20]:
            print(f"  warning: {w}")
        if errors:
            failed = True
            print(f"{f.name}: {len(errors)} error(s)")
            for e in errors[: args.max_errors]:
                print(f"  - {e}")
            if len(errors) > args.max_errors:
                print(f"  ... {len(errors) - args.max_errors} more")
        else:
            print(f"{f.name}: OK" + (f" ({len(warnings)} warning(s))" if warnings else ""))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
