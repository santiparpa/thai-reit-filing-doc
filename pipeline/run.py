"""One command: ingest new SEC filing sets from inbox/ and rebuild every output.

    python pipeline/run.py

Steps
  1. rename    inbox/ALL_*  ->  filings/{TICKER}_{IPO|PO}_{SEC_NO}/   (pipeline/naming.py)
  2. convert   Word documents -> text/{FILING_ID}/*.md                (pipeline/convert.py)
  3. extract   filings that are new, changed, or have no JSON yet    (pipeline/extract.py, claude -p)
  4. validate  every data/reits/*.json against the schema             (pipeline/validate.py)
  5. status    SEC filing stage for every REIT                        (pipeline/sec_status.py)
  6. analyse   cross-checks and comparisons -> data/analysis.json     (pipeline/consolidate.py)
  7. workbook  workbook/Thai REIT Transactions 2026.xlsx             (pipeline/build_workbook.py)
  8. site      site/data/reits.js (the dashboard reads only this)    (pipeline/build_site.py)

Options
  --skip-extract       rebuild outputs from existing JSON only
  --re-extract ID ...  force extraction of specific filings
  --skip-status        do not contact the SEC website
"""
from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from datetime import datetime

from common import FILING_ID_RE, FILINGS, INBOX, MANIFEST, REITS, ROOT, utf8_console


def step(title: str, args: list[str], fatal: bool = True) -> bool:
    print(f"\n=== {title}\n$ python {' '.join(args)}", flush=True)
    code = subprocess.run([sys.executable, *args], cwd=ROOT).returncode
    if code and fatal:
        raise SystemExit(f"Step '{title}' failed (exit {code}).")
    if code:
        print(f"(step '{title}' failed with exit {code}; continuing)")
    return code == 0


def filings_renamed_since(start: str) -> list[str]:
    if not MANIFEST.exists():
        return []
    with open(MANIFEST, encoding="utf-8-sig", newline="") as fh:
        return sorted({r["filing_id"] for r in csv.DictReader(fh) if r["renamed_at"] >= start})


def main() -> None:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-extract", action="store_true")
    ap.add_argument("--re-extract", nargs="*", default=[])
    ap.add_argument("--skip-status", action="store_true")
    ap.add_argument("--parallel", type=int, default=3)
    args = ap.parse_args()

    INBOX.mkdir(exist_ok=True)
    start = datetime.now().isoformat(timespec="seconds")

    step("1. rename inbox sets", ["pipeline/naming.py"])
    touched = filings_renamed_since(start)
    step("2. convert Word documents", ["pipeline/convert.py", *touched] if touched else ["pipeline/convert.py"])

    if not args.skip_extract:
        missing = [d.name for d in sorted(FILINGS.iterdir())
                   if d.is_dir() and FILING_ID_RE.match(d.name) and not (REITS / f"{d.name}.json").exists()]
        targets = list(dict.fromkeys([*touched, *missing, *args.re_extract]))
        if targets:
            step("3. extract", ["pipeline/extract.py", "--parallel", str(args.parallel), *targets], fatal=False)
        else:
            print("\n=== 3. extract\nNo new or changed filings.")

    step("4. validate", ["pipeline/validate.py"], fatal=False)
    if not args.skip_status:
        step("5. SEC filing status", ["pipeline/sec_status.py"], fatal=False)
    step("6. consolidate & analyse", ["pipeline/consolidate.py"])
    step("7. workbook", ["pipeline/build_workbook.py"])
    step("8. dashboard data", ["pipeline/build_site.py"])
    print("\nDone. Open site/index.html; workbook in workbook/.")


if __name__ == "__main__":
    main()
