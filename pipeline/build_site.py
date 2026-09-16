"""Bundle the structured data for the dashboard: site/data/reits.js.

The site code (site/index.html, site/app.js, site/styles.css) never changes when filings are added;
it renders whatever this bundle contains. A .js bundle (not .json) lets index.html open straight from
the file system without a web server.

Usage: python pipeline/build_site.py
"""
from __future__ import annotations

import json
from datetime import datetime

from common import SITE, utf8_console
from dataset import ANALYSIS, STATUS, load_filings, load_json


def main() -> None:
    utf8_console()
    analysis = load_json(ANALYSIS, None)
    if analysis is None:
        raise SystemExit("data/analysis.json missing: run pipeline/consolidate.py first")
    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "analysis": analysis,
        "status": load_json(STATUS, None),
        "filings": {f["filing"]["filing_id"]: f for f in load_filings()},
    }
    out = SITE / "data" / "reits.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("window.REIT_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"{len(payload['filings'])} filings -> site/data/reits.js ({out.stat().st_size / 1024:,.0f} KB)")


if __name__ == "__main__":
    main()
