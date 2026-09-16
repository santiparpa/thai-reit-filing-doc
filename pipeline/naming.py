"""Apply the filing naming convention and move SEC download folders into filings/.

    filings/{TICKER}_{IPO|PO}_{SEC_NO}/{TICKER}_{IPO|PO}_{FilingDate}_{DocType}[-NN].{ext}

FilingDate = the SEC upload stamp (YYYYMMDD) of that document; DocType follows Form 69-REIT
section numbering for .docx/.doc and the SEC category for PDFs (PDFs are never opened).
-NN is added only when two documents would otherwise share a name.

Usage:
    python pipeline/naming.py --dry-run [SET_DIR ...]    # default SET_DIRs: inbox/ALL_*
    python pipeline/naming.py [SET_DIR ...]
"""
from __future__ import annotations

import argparse
import csv
import re
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from common import FILINGS, INBOX, MANIFEST, ROOT, Docx, load_overrides, sha1, utf8_console

SET_RE = re.compile(r"^ALL_(\d+)_V\d+$", re.I)
CATEGORIES = [
    "SECURITIES_OFFERING_INFORMATION", "REIT_EXECUTIVE_SUMMARY", "REIT_ESTABLISHED_CONTRACT",
    "PROFIT_AND_LOSS_STATEMENT", "CERTIFICATE_FROM_TRUSTEE", "SENSITIVITY_ANALYSIS",
    "APPRAISAL_REPORT", "OTHERS_IF_ANY", "REIT_COVER", "ISSUER",
]
FILE_RE = re.compile(
    r"^(?P<cat>" + "|".join(CATEGORIES) + r"|[A-Z_]+?)_(?P<round>[A-Z]+)_(?P<ts>\d{17})(?:\s*\(\d+\))?\.(?P<ext>docx|doc|pdf)$",
    re.I,
)
ATTACHMENT_TYPES = {
    "APPRAISAL_REPORT": "ATT-Appraisal",
    "CERTIFICATE_FROM_TRUSTEE": "ATT-TrusteeCert",
    "PROFIT_AND_LOSS_STATEMENT": "ATT-FinStmt",
    "REIT_ESTABLISHED_CONTRACT": "ATT-TrustDeed",
    "SENSITIVITY_ANALYSIS": "ATT-Sensitivity",
    "OTHERS_IF_ANY": "ATT-Other",
}

# Ordered (doc_type, pattern). Tested against the first 1, then 2, then 4 heading lines,
# so the top heading wins. "P2-03-Assets" is weak: later lines may refine it to New/Existing.
ISSUER_RULES = [
    ("P2-01-UseOfProceeds", r"วัตถุประสงค์การใช้เงิน"),
    ("P2-02-Policy", r"นโยบาย\s*และ\s*ภาพรวม"),
    ("P2-04-Industry", r"ภาวะอุตสาหกรรม"),
    ("P2-05-Risks", r"ปัจจัยความเสี่ยง"),
    ("P2-06-Litigation", r"(ข้อพิพาท|ข้อมูลพิพาท)\s*ทางกฎหมาย"),
    ("P2-07-Other", r"ข้อมูลสำคัญอื่น|ข้อมูลอื่นที่เกี่ยวข้อง"),
    ("P2-08-Unitholders", r"ข้อมูลหน่วยทรัสต์และผู้ถือหน่วยทรัสต์"),
    ("P2-09-Governance", r"โครงสร้างการจัดการ"),
    ("P2-11-RelatedParty", r"รายการระหว่างกัน"),
    ("P2-10-Fees", r"ค่าธรรมเนียม"),
    ("P2-13-MDA", r"Management Discussion|การวิเคราะห์และคำอธิบาย"),
    ("P2-12-Financials", r"ข้อมูลทางการเงินที่สำคัญ|ฐานะ(ทาง)?การเงินและผลการดำเนินงาน"),
    ("P2-03-NewAssets", r"จะ(เข้า)?ลงทุนเพิ่มเติม|ลงทุนครั้งแรก"),
    ("P2-03-ExistingAssets", r"ทรัพย์สิน\S*(ปัจจุบัน|อยู่เดิม)|ลงทุนในปัจจุบัน"),
    ("P2-03-Leasing", r"การจัดหา(ผล)?ประโยชน์"),
    ("P2-03-Encumbrances", r"ข้อพิพาท\s*หรือ\s*ข้อจำกัด"),
    ("P2-03-Assets", r"ทรัพย์สินหลัก"),
]
ASSET_FAMILY = {"P2-03-NewAssets", "P2-03-ExistingAssets", "P2-03-Assets"}


def classify(cat: str, ext: str, doc: Docx | None, offering_type: str) -> str:
    if ext == "pdf":
        return ATTACHMENT_TYPES.get(cat, "ATT-" + cat.title().replace("_", ""))
    head = doc.head_lines(4)
    if cat == "REIT_COVER":
        first = head[0] if head else ""
        return "00-TOC" if "สารบัญ" in first else "00-Definitions" if "คำจำกัดความ" in first else "00-Cover"
    if cat == "REIT_EXECUTIVE_SUMMARY":
        return "P1-FactSheet"
    if cat == "SECURITIES_OFFERING_INFORMATION":
        return "P3-Offering"
    # A section that opens with encumbrances and continues into leasing is the leasing section.
    if re.search(r"ข้อพิพาท\s*หรือ\s*ข้อจำกัด[\s\S]*การจัดหา(ผล)?ประโยชน์", "\n".join(head)):
        return "P2-03-Leasing"
    weak = None
    for n in (1, 2, 4):
        joined = "\n".join(head[:n])
        for doc_type, pattern in ISSUER_RULES:
            if weak and doc_type not in ASSET_FAMILY:
                continue
            if re.search(pattern, joined):
                if doc_type == "P2-03-Assets":
                    weak = doc_type
                    continue
                return _ipo_asset(doc_type, offering_type)
    return _ipo_asset(weak, offering_type) if weak else "P2-XX-Unclassified"


def _ipo_asset(doc_type: str, offering_type: str) -> str:
    return "P2-03-NewAssets" if offering_type == "IPO" and doc_type in ASSET_FAMILY else doc_type


def identify_set(set_dir: Path, files: list[dict], overrides: dict) -> tuple[str, str, str]:
    m = SET_RE.match(set_dir.name)
    if not m:
        raise SystemExit(f"{set_dir.name}: not an SEC download folder (expected ALL_<number>_V<nn>)")
    sec_no = m.group(1)
    ticker = offering_type = None
    covers = sorted((f for f in files if f["cat"] == "REIT_COVER" and f["doc"]), key=lambda f: f["ts"], reverse=True)
    for f in covers:
        lines = f["doc"].head_lines(15)
        # The cover page proper: not the TOC/definitions pages, and "เสนอขายหน่วยทรัสต์ของ" on its own line.
        if not lines or re.search(r"สารบัญ|คำจำกัดความ", lines[0]):
            continue
        if not any(line.strip().startswith("เสนอขายหน่วยทรัสต์ของ") for line in lines):
            continue
        for line in lines:
            t = re.search(r"(?:\(|:\s*)([A-Z][A-Z0-9]{1,11})\)?\s*$", line)
            if t and re.search(r"trust|reit", line, re.I):
                ticker = t.group(1)
                break
        if not ticker:
            continue
        offering_type = "PO" if re.search(r"ลงทุนเพิ่มเติม|เพิ่มทุน", "\n".join(lines)) else "IPO"
        break
    ov = overrides.get(sec_no, {})
    ticker = ov.get("ticker", ticker)
    offering_type = ov.get("offering_type", offering_type)
    if not ticker or not offering_type:
        raise SystemExit(
            f"{set_dir.name}: could not read ticker/IPO-PO from the cover page. "
            f'Add {{"{sec_no}": {{"ticker": "...", "offering_type": "IPO|PO"}}}} to pipeline/overrides.json'
        )
    return ticker, offering_type, sec_no


def load_manifest() -> list[dict]:
    if not MANIFEST.exists():
        return []
    with open(MANIFEST, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def plan_set(set_dir: Path, overrides: dict, manifest: list[dict]) -> dict:
    files = []
    for p in sorted(set_dir.iterdir()):
        if not p.is_file():
            continue
        m = FILE_RE.match(p.name)
        if not m:
            print(f"  ! skipped (unrecognised name): {p.name}")
            continue
        ext = m["ext"].lower()
        files.append({
            "path": p, "cat": m["cat"].upper(), "ts": m["ts"], "ext": ext,
            "doc": Docx(p) if ext in ("docx", "doc") else None,
        })
    ticker, offering_type, sec_no = identify_set(set_dir, files, overrides)
    file_overrides = overrides.get("files", {})
    for f in files:
        f["doc_type"] = file_overrides.get(f["path"].name) or classify(f["cat"], f["ext"], f["doc"], offering_type)

    # PO set whose single asset section covers both the existing portfolio and the new assets.
    if offering_type == "PO" and not any(f["doc_type"] == "P2-03-NewAssets" for f in files):
        for f in files:
            if f["doc_type"] == "P2-03-ExistingAssets" and "ลงทุนเพิ่มเติม" in f["doc"].full_text():
                f["doc_type"] = "P2-03-Assets"

    filing_id = f"{ticker}_{offering_type}_{sec_no}"
    target = FILINGS / filing_id
    taken = {p.stem for p in target.iterdir()} if target.exists() else set()
    known = {(r["filing_id"], r["sha1"]) for r in manifest}

    for f in files:
        f["sha1"] = sha1(f["path"])
        f["duplicate"] = (filing_id, f["sha1"]) in known
    groups = defaultdict(list)
    for f in files:
        if not f["duplicate"]:
            groups[f"{ticker}_{offering_type}_{f['ts'][:8]}_{f['doc_type']}"].append(f)
    for base, members in groups.items():
        members.sort(key=lambda f: (f["ts"], f["path"].name))
        if len(members) == 1 and base not in taken:
            members[0]["new_name"] = f"{base}.{members[0]['ext']}"
            taken.add(base)
            continue
        n = 1
        for f in members:
            while f"{base}-{n:02d}" in taken:
                n += 1
            f["new_name"] = f"{base}-{n:02d}.{f['ext']}"
            taken.add(f"{base}-{n:02d}")
    return {"set_dir": set_dir, "filing_id": filing_id, "target": target, "files": files}


def apply_plan(plan: dict) -> None:
    plan["target"].mkdir(parents=True, exist_ok=True)
    new_file = not MANIFEST.exists()
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    with open(MANIFEST, "a", encoding="utf-8-sig" if new_file else "utf-8", newline="") as fh:
        w = csv.writer(fh)
        if new_file:
            w.writerow(["filing_id", "original_set", "original_name", "new_path", "doc_type", "sec_category", "upload_ts", "sha1", "renamed_at"])
        for f in plan["files"]:
            if f["duplicate"]:
                continue
            dest = plan["target"] / f["new_name"]
            shutil.move(str(f["path"]), str(dest))
            w.writerow([
                plan["filing_id"], plan["set_dir"].name, f["path"].name, dest.relative_to(ROOT).as_posix(),
                f["doc_type"], f["cat"], f["ts"], f["sha1"], datetime.now().isoformat(timespec="seconds"),
            ])
    _remove_if_empty(plan["set_dir"])


def _remove_if_empty(folder: Path) -> None:
    if any(folder.iterdir()):
        return
    try:
        folder.rmdir()
    except PermissionError:  # OneDrive can hold a handle on a just-emptied folder
        print(f"  note: {folder.name} is empty but locked by OneDrive; delete it later")


def main() -> None:
    utf8_console()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sets", nargs="*", type=Path, help="SEC download folders (default: inbox/ALL_*)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    set_dirs = args.sets or sorted(p for p in INBOX.glob("ALL_*") if p.is_dir())
    if not set_dirs:
        print("No SEC folders to rename.")
        return
    overrides, manifest = load_overrides(), load_manifest()
    renamed = []
    for set_dir in set_dirs:
        if not any(p.is_file() for p in set_dir.iterdir()):
            if not args.dry_run:
                _remove_if_empty(set_dir)
            continue
        plan = plan_set(set_dir.resolve(), overrides, manifest)
        print(f"\n{set_dir.name}  ->  filings/{plan['filing_id']}/")
        for f in plan["files"]:
            arrow = "(duplicate of an already-filed document, skipped)" if f["duplicate"] else f["new_name"]
            print(f"  {f['path'].name:<70} {arrow}")
        if not args.dry_run:
            apply_plan(plan)
            renamed.append(plan["filing_id"])
    if renamed:
        print("\nRenamed:", ", ".join(renamed))


if __name__ == "__main__":
    main()
