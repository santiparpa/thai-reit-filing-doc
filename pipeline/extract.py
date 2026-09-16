"""Extract filings into data/reits/{FILING_ID}.json by running the shared prompt through Claude Code headless.

Uses the same prompt template (pipeline/prompts/extract_filing.md) as the initial build. Optional
per-filing structure notes can be added in pipeline/prompts/notes/{FILING_ID}.md.

Usage:
    python pipeline/extract.py WHART_PO_767525 [...]      # one or more filings
    python pipeline/extract.py --missing                   # every filing without a JSON yet
Options:
    --parallel N    filings extracted at once (default 3)
    --model NAME    Claude model alias (default: your Claude Code default)
    --print-prompt  show the rendered prompt and exit
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from common import FILING_ID_RE, FILINGS, PROMPTS, REITS, ROOT, utf8_console

ALLOWED_TOOLS = [
    "Read", "Grep", "Glob", "Write", "Edit",
    "Bash(python pipeline/validate.py:*)",
    "PowerShell(python pipeline\\validate.py:*)",
    "PowerShell(python pipeline/validate.py:*)",
]
TIMEOUT_S = 3 * 60 * 60


def render_prompt(filing_id: str, extracted_by: str) -> str:
    m = FILING_ID_RE.match(filing_id)
    if not m:
        raise SystemExit(f"Not a filing ID: {filing_id}")
    text = (PROMPTS / "extract_filing.md").read_text(encoding="utf-8")
    values = {
        "FILING_ID": filing_id,
        "TICKER": m["ticker"],
        "OFFERING_TYPE": m["type"],
        "TEXT_DIR": f"text/{filing_id}",
        "SCHEMA": "schema/reit_filing.schema.json",
        "OUTPUT": f"data/reits/{filing_id}.json",
        "EXTRACTED_BY": extracted_by,
    }
    for key, val in values.items():
        text = text.replace("{{" + key + "}}", val)
    preamble = (
        f"Project root (your working directory): `{ROOT}`. Relative paths below are relative to it; "
        "the Read tool needs absolute paths (prefix them with the root). Run the validator from the root. "
        "Do not spawn sub-agents.\n\n"
    )
    notes = PROMPTS / "notes" / f"{filing_id}.md"
    if notes.exists():
        text += "\n\n## Orchestrator notes for this set (structure only)\n" + notes.read_text(encoding="utf-8")
    return preamble + text


def _claude(args: list[str], stdin: str) -> dict:
    exe = shutil.which("claude")
    if not exe:
        raise SystemExit("The 'claude' CLI is not on PATH. Install Claude Code or run extraction manually.")
    proc = subprocess.run(
        [exe, *args], input=stdin, text=True, encoding="utf-8", cwd=ROOT,
        capture_output=True, timeout=TIMEOUT_S,
    )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"is_error": True, "result": (proc.stdout or proc.stderr)[-2000:]}


def _validate(filing_id: str) -> tuple[bool, str]:
    proc = subprocess.run(
        [sys.executable, "pipeline/validate.py", f"data/reits/{filing_id}.json", "--max-errors", "60"],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    return proc.returncode == 0, proc.stdout[-6000:]


def extract(filing_id: str, model: str | None) -> tuple[str, bool, str]:
    base = ["-p", "--output-format", "json", "--permission-mode", "acceptEdits",
            "--permission-prompts", "none", "--allowedTools", *ALLOWED_TOOLS]
    if model:
        base += ["--model", model]
    print(f"[extract] {filing_id}: started")
    result = _claude(base, render_prompt(filing_id, f"claude -p pipeline ({date.today().isoformat()})"))
    ok, report = _validate(filing_id)
    if not ok and result.get("session_id"):  # one repair round in the same session
        print(f"[extract] {filing_id}: validator errors, asking for a fix")
        fix = "The validator still reports these errors. Fix them in the output file, re-run the validator until OK:\n\n" + report
        result = _claude([*base, "--resume", result["session_id"]], fix)
        ok, report = _validate(filing_id)
    print(f"[extract] {filing_id}: {'OK' if ok else 'FAILED validation'}")
    return filing_id, ok, (result.get("result") or "")[-1500:] if ok else report


def main() -> None:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("filings", nargs="*")
    ap.add_argument("--missing", action="store_true")
    ap.add_argument("--parallel", type=int, default=3)
    ap.add_argument("--model")
    ap.add_argument("--print-prompt", action="store_true")
    args = ap.parse_args()

    targets = list(args.filings)
    if args.missing:
        targets += [d.name for d in sorted(FILINGS.iterdir())
                    if d.is_dir() and FILING_ID_RE.match(d.name) and not (REITS / f"{d.name}.json").exists()]
    targets = list(dict.fromkeys(targets))
    if not targets:
        print("[extract] nothing to extract")
        return
    if args.print_prompt:
        print(render_prompt(targets[0], "preview"))
        return
    REITS.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        results = list(pool.map(lambda f: extract(f, args.model), targets))
    failed = [f for f, ok, _ in results if not ok]
    for f, ok, summary in results:
        print(f"\n=== {f}: {'OK' if ok else 'FAILED'}\n{summary}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
