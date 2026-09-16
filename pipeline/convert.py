"""Convert renamed .docx/.doc filings into Markdown reading copies for the extraction agents.

PDFs are listed in the index but never opened (excluded by policy).

Usage:
    python pipeline/convert.py [FILING_ID ...]     # default: every folder in filings/
Outputs:
    text/{FILING_ID}/{stem}.md     one per Word document (tables kept as Markdown tables)
    text/{FILING_ID}/_toc.md       file list in reading priority + heading index with line numbers
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime

from common import FILINGS, ROOT, STEM_RE, TEXT, Docx, utf8_console

READING_ORDER = [
    "00-Cover", "P1-FactSheet", "P2-01-UseOfProceeds", "P3-Offering", "P2-03-NewAssets", "P2-03-Assets",
    "P2-03-ExistingAssets", "P2-03-Leasing", "P2-03-Encumbrances", "P2-13-MDA", "P2-12-Financials",
    "P2-05-Risks", "P2-02-Policy", "P2-08-Unitholders", "P2-09-Governance", "P2-11-RelatedParty",
    "P2-10-Fees", "P2-04-Industry", "P2-06-Litigation", "P2-07-Other", "00-Definitions", "00-TOC",
]
MAX_TOC_HEADINGS = 120


def convert_filing(filing_dir, force: bool = False) -> None:
    out_dir = TEXT / filing_dir.name
    out_dir.mkdir(parents=True, exist_ok=True)
    rows, pdfs, heading_index = [], [], []
    for src in sorted(filing_dir.iterdir()):
        m = STEM_RE.match(src.stem)
        if not src.is_file() or not m:
            continue
        if src.suffix.lower() == ".pdf":
            pdfs.append(src.name)
            continue
        md = out_dir / f"{src.stem}.md"
        doc = Docx(src)
        lines, headings = doc.to_markdown()
        header = [f"<!-- source: filings/{filing_dir.name}/{src.name} | doc_type: {m['doctype']} | uploaded: {m['date']} -->", ""]
        if force or not md.exists() or md.stat().st_mtime < src.stat().st_mtime:
            md.write_text("\n".join(header + lines) + "\n", encoding="utf-8")
        offset = len(header) + 1
        rows.append((m["doctype"], m["date"], md.name, len(header) + len(lines), sum(len(x) for x in lines)))
        if len(headings) > MAX_TOC_HEADINGS:
            headings = [h for h in headings if h[1] <= 2][:MAX_TOC_HEADINGS]
        heading_index.append((md.name, [(i + offset, lvl, text) for i, lvl, text in headings]))

    latest = defaultdict(str)
    for doctype, date, *_ in rows:
        latest[doctype] = max(latest[doctype], date)
    rank = {d: i for i, d in enumerate(READING_ORDER)}
    rows.sort(key=lambda r: (rank.get(r[0], 99), r[0], r[1]), reverse=False)

    toc = [
        f"# {filing_dir.name} — Markdown reading copies",
        f"Generated {datetime.now():%Y-%m-%d %H:%M} by pipeline/convert.py. Line numbers below match the .md files.",
        "",
        "## Files in reading priority",
        "| DocType | Uploaded | File | Lines | Chars | Version |",
        "|---|---|---|---|---|---|",
    ]
    for doctype, date, name, n_lines, n_chars in rows:
        version = "latest" if date == latest[doctype] else f"OLDER draft (latest {doctype} is {latest[doctype]})"
        toc.append(f"| {doctype} | {date} | {name} | {n_lines:,} | {n_chars:,} | {version} |")
    toc += ["", "## PDFs in this filing (not converted, not read)"] + [f"- {p}" for p in pdfs]
    toc += ["", "## Heading index (line: heading)"]
    order = {name: i for i, (_, _, name, _, _) in enumerate(rows)}
    for name, heads in sorted(heading_index, key=lambda h: order.get(h[0], 999)):
        toc.append(f"\n### {name}")
        toc += [f"- L{line}: {'  ' * (lvl - 1)}{text[:140]}" for line, lvl, text in heads] or ["- (no headings detected; use Grep)"]
    (out_dir / "_toc.md").write_text("\n".join(toc) + "\n", encoding="utf-8")
    print(f"  {filing_dir.name}: {len(rows)} documents converted, {len(pdfs)} PDFs skipped -> {out_dir.relative_to(ROOT)}")


def main() -> None:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("filings", nargs="*", help="Filing IDs, e.g. WHART_PO_767525 (default: all)")
    ap.add_argument("--force", action="store_true", help="rewrite .md files even if up to date")
    args = ap.parse_args()
    dirs = [FILINGS / f for f in args.filings] if args.filings else sorted(p for p in FILINGS.iterdir() if p.is_dir())
    for d in dirs:
        convert_filing(d, force=args.force)


if __name__ == "__main__":
    main()
