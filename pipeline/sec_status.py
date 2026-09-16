"""Record each filing's current SEC filing stage.

Source: the SEC's public list of REIT (trust unit) filings
    https://market.sec.or.th/public/idisc/th/ViewMore/filing-equity?SecuTypeCode=RT&FilingData=0
Rows are matched by the SEC transaction number: the TransID in each row's link equals the SEC number in
our FILING_ID (the ALL_<number>_Vxx download folder). Fetched with the system curl, because the site
resets Python's TLS client.

Usage:  python pipeline/sec_status.py
Output: data/filing_status.json  (kept unchanged if the site cannot be reached)
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import date, datetime

from bs4 import BeautifulSoup

from common import DATA, FILING_ID_RE, FILINGS, utf8_console

LIST_URL = "https://market.sec.or.th/public/idisc/th/ViewMore/filing-equity?SecuTypeCode=RT&FilingData=0"
DETAIL_URL = "https://market.sec.or.th/public/ipos/IPOSEQ01.aspx?TransID={}&lang=th"
OUT = DATA / "filing_status.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
COLUMNS = ["issuer", "security_type", "offering_type", "first_filed", "last_amended", "effective", "offer_start", "offer_end", "remark"]
DATE_COLUMNS = {"first_filed", "last_amended", "effective", "offer_start", "offer_end"}
STAGES = {
    "review": "Under SEC review",
    "amended": "Under SEC review (amended)",
    "effective": "Filing effective",
    "offering": "Offering in progress",
    "closed": "Offering closed",
    "withdrawn": "Withdrawn / cancelled",
    "unlisted": "Not on SEC filing list",
}


def fetch(url: str) -> str:
    curl = shutil.which("curl") or shutil.which("curl.exe")
    if curl:
        proc = subprocess.run(
            [curl, "-s", "-L", "--max-time", "90", "-A", UA, "-H", "Accept-Language: th,en;q=0.8", url],
            capture_output=True,
        )
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout.decode("utf-8", errors="replace")
    import requests

    return requests.get(url, timeout=90, headers={"User-Agent": UA}).text


def be_to_iso(text: str) -> str | None:
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", text.strip())
    if not m:
        return None
    d, mo, y = map(int, m.groups())
    return f"{y - 543 if y > 2400 else y:04d}-{mo:02d}-{d:02d}"


def parse_list(html: str) -> dict[str, dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", id="gPP02T01") or soup.find("table")
    if table is None:
        raise ValueError("filing table not found on the SEC page")
    rows = {}
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        link = tr.find("a", href=re.compile(r"TransID=\d+"))
        if len(tds) < len(COLUMNS) or link is None:
            continue
        rec = {"trans_id": re.search(r"TransID=(\d+)", link["href"]).group(1), "detail_url": link["href"]}
        for key, td in zip(COLUMNS, tds):
            text = td.get_text(" ", strip=True)
            if key in DATE_COLUMNS:
                rec[key] = be_to_iso(text)
                rec[f"{key}_th"] = text
            else:
                rec[key] = text
        rows[rec["trans_id"]] = rec
    return rows


def stage_of(rec: dict, today: str) -> str:
    if re.search(r"ยกเลิก|ถอน|withdraw|cancel", rec.get("remark", ""), re.I):
        return "withdrawn"
    if rec.get("offer_end") and rec["offer_end"] < today:
        return "closed"
    if rec.get("offer_start") and rec["offer_start"] <= today:
        return "offering"
    if rec.get("effective"):
        return "effective"
    return "amended" if rec.get("last_amended") else "review"


def main() -> None:
    utf8_console()
    today = date.today().isoformat()
    try:
        rows = parse_list(fetch(LIST_URL))
    except Exception as e:  # network or layout change: keep the previous snapshot
        print(f"SEC status not updated ({e}); previous data/filing_status.json kept.")
        sys.exit(1)

    result = {"fetched_at": datetime.now().isoformat(timespec="seconds"), "as_of": today, "source_url": LIST_URL,
              "stage_labels": STAGES, "filings": {}}
    for d in sorted(FILINGS.iterdir()):
        m = FILING_ID_RE.match(d.name)
        if not d.is_dir() or not m:
            continue
        rec = rows.get(m["sec_no"])
        if rec is None:
            rec = {"trans_id": m["sec_no"], "detail_url": DETAIL_URL.format(m["sec_no"]), "stage": "unlisted"}
        else:
            rec["stage"] = stage_of(rec, today)
            if rec.get("offering_type") and rec["offering_type"] != m["type"]:
                rec["type_mismatch"] = f"SEC lists {rec['offering_type']}, filing folder says {m['type']}"
        rec["stage_label"] = STAGES[rec["stage"]]
        result["filings"][d.name] = rec
        print(f"  {d.name:<22} {rec['stage_label']}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"-> {OUT.relative_to(DATA.parent)}")


if __name__ == "__main__":
    main()
