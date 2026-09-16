"""Shared paths and document helpers for the Thai REIT filing pipeline."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "inbox"
FILINGS = ROOT / "filings"
TEXT = ROOT / "text"
DATA = ROOT / "data"
REITS = DATA / "reits"
SCHEMA = ROOT / "schema" / "reit_filing.schema.json"
PROMPTS = ROOT / "pipeline" / "prompts"
OVERRIDES = ROOT / "pipeline" / "overrides.json"
SITE = ROOT / "site"
WORKBOOK = ROOT / "workbook" / "Thai REIT Transactions 2026.xlsx"
SAMPLE_WORKBOOK = ROOT / "sample" / "251216_Thai REIT Transactions 2025.xlsx"
# Outside OneDrive: synced folders lock freshly written files.
CACHE = Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()) / "reit-pipeline" / "doc-cache"
MANIFEST = FILINGS / "_rename_manifest.csv"

FILING_ID_RE = re.compile(r"^(?P<ticker>[A-Z0-9]+)_(?P<type>IPO|PO)_(?P<sec_no>\d+)$")
STEM_RE = re.compile(r"^(?P<ticker>[A-Z0-9]+)_(?P<type>IPO|PO)_(?P<date>\d{8})_(?P<doctype>.+?)(?:-(?P<nn>\d{2}))?$")

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


def utf8_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_overrides() -> dict:
    return json.loads(OVERRIDES.read_text(encoding="utf-8")) if OVERRIDES.exists() else {}


# ---------------------------------------------------------------- legacy .doc

def ensure_docx(path: Path) -> Path:
    """Return a .docx for `path`; legacy .doc is converted once through MS Word (cached by content hash)."""
    if path.suffix.lower() == ".docx":
        return path
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{sha1(path)[:20]}.docx"
    if out.exists():
        return out
    # Plain byte copy on a local path: avoids OneDrive locks and the downloaded-file zone mark
    # that makes Word sandbox legacy .doc files under automation.
    src = CACHE / f"{out.stem}.src{path.suffix.lower()}"
    src.write_bytes(path.read_bytes())
    word = _word_app()
    doc = _com_retry(lambda: word.Documents.Open(str(src), False, True, False))  # ConfirmConversions, ReadOnly, AddToRecentFiles
    _com_retry(lambda: doc.SaveAs2(str(out), FileFormat=16))  # wdFormatDocumentDefault
    _com_retry(lambda: doc.Close(False))
    src.unlink(missing_ok=True)
    for _ in range(40):  # Word releases the file a moment after Close()
        try:
            with open(out, "rb"):
                return out
        except PermissionError:
            time.sleep(0.25)
    return out


_word = None
_COM_BUSY = (-2147418111, -2147417846)  # RPC_E_CALL_REJECTED, RPC_E_SERVERCALL_RETRYLATER


def _com_retry(fn, tries: int = 60):
    import pywintypes

    for attempt in range(tries):
        try:
            return fn()
        except pywintypes.com_error as e:
            if e.hresult not in _COM_BUSY or attempt == tries - 1:
                raise
            time.sleep(0.5)


def _word_app():
    """One hidden Word instance per process, reused for every .doc and closed at exit."""
    global _word
    if _word is None:
        import atexit

        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        _word = _com_retry(lambda: win32com.client.DispatchEx("Word.Application"))
        _com_retry(lambda: setattr(_word, "Visible", False))
        _com_retry(lambda: setattr(_word, "DisplayAlerts", 0))
        atexit.register(_quit_word)
    return _word


def _quit_word() -> None:
    global _word
    if _word is not None:
        try:
            _word.Quit()
        except Exception:
            pass
        _word = None


# ---------------------------------------------------------------- .docx parsing

def _local(el) -> str | None:
    return etree.QName(el).localname if isinstance(el.tag, str) else None


def _val(el, name: str = "val") -> str | None:
    return None if el is None else el.get(f"{{{W_NS}}}{name}")


_SKIP_HEAD = re.compile(r"^(ส่วนที่\s*[\d.]*\s*(หน้า[\s\d.\-–]*)?|หน้า[\s\d.\-–]+|page\s*\d+|[\d.\-–\s]+)$", re.I)


class Docx:
    """Walks document.xml in reading order: paragraphs (incl. text boxes), tables (incl. merged cells)."""

    def __init__(self, path: Path):
        self.path = path
        with zipfile.ZipFile(ensure_docx(path)) as z:
            self._root = etree.fromstring(z.read("word/document.xml"))
            names = z.namelist()
            self._levels = self._style_levels(z.read("word/styles.xml")) if "word/styles.xml" in names else {}
        self._blocks: list | None = None

    # -- styles
    @staticmethod
    def _style_levels(xml: bytes) -> dict:
        root = etree.fromstring(xml)
        raw = {}
        for st in root.findall("w:style", NS):
            raw[_val(st, "styleId")] = (
                _val(st.find("w:name", NS)) or "",
                _val(st.find("w:pPr/w:outlineLvl", NS)),
                _val(st.find("w:basedOn", NS)),
            )

        def resolve(sid, depth=0):
            if sid not in raw or depth > 10:
                return None
            name, lvl, based = raw[sid]
            m = re.match(r"heading\s*(\d)", name, re.I)
            if m:
                return int(m.group(1))
            if lvl and lvl.isdigit() and int(lvl) < 9:
                return int(lvl) + 1
            return resolve(based, depth + 1) if based else None

        return {sid: resolve(sid) for sid in raw}

    # -- walking
    def blocks(self) -> list:
        """[("p", text, heading_level|None) | ("tbl", rows, None)] in document order."""
        if self._blocks is None:
            self._blocks = list(self._walk(self._root.find("w:body", NS)))
        return self._blocks

    def _walk(self, container):
        for el in container:
            tag = _local(el)
            if tag == "p":
                parts, nested = [], []
                self._collect(el, parts, nested)
                text = re.sub(r"[ \u00a0]+", " ", "".join(parts)).strip()
                yield ("p", text, self._level(el))
                yield from nested
            elif tag == "tbl":
                yield ("tbl", self._table(el), None)
            elif tag in ("sdt", "customXml", "ins", "smartTag"):
                inner = el.find("w:sdtContent", NS) if tag == "sdt" else el
                if inner is not None:
                    yield from self._walk(inner)

    def _collect(self, node, parts, nested):
        for ch in node:
            tag = _local(ch)
            if tag is None or tag in ("pPr", "rPr", "del", "Fallback", "instrText", "delText", "footnoteReference"):
                continue
            if tag == "txbxContent":
                nested.extend(self._walk(ch))
            elif tag == "t":
                parts.append(ch.text or "")
            elif tag == "tab":
                parts.append("\t")
            elif tag in ("br", "cr"):
                parts.append("\n")
            elif tag == "noBreakHyphen":
                parts.append("-")
            else:
                self._collect(ch, parts, nested)

    def _level(self, p) -> int | None:
        ppr = p.find("w:pPr", NS)
        if ppr is None:
            return None
        lvl = _val(ppr.find("w:outlineLvl", NS))
        if lvl and lvl.isdigit() and int(lvl) < 9:
            return int(lvl) + 1
        return self._levels.get(_val(ppr.find("w:pStyle", NS)))

    def _children(self, el, want: str):
        for ch in el:
            tag = _local(ch)
            if tag == want:
                yield ch
            elif tag in ("sdt", "customXml"):
                inner = ch.find("w:sdtContent", NS) if tag == "sdt" else ch
                if inner is not None:
                    yield from self._children(inner, want)

    def _table(self, tbl) -> list[list[str]]:
        rows = []
        for tr in self._children(tbl, "tr"):
            cells = []
            for tc in self._children(tr, "tc"):
                tcpr = tc.find("w:tcPr", NS)
                span = _val(tcpr.find("w:gridSpan", NS)) if tcpr is not None else None
                vmerge = tcpr.find("w:vMerge", NS) if tcpr is not None else None
                if vmerge is not None and _val(vmerge) != "restart":
                    cells.append("^")  # continuation of the vertically merged cell above
                else:
                    cells.append(self._cell_text(tc))
                if span and span.isdigit():
                    cells.extend([""] * (int(span) - 1))
            rows.append(cells)
        return rows

    def _cell_text(self, tc) -> str:
        out = []
        for kind, payload, _ in self._walk(tc):
            if kind == "p":
                if payload:
                    out.append(payload)
            else:
                out.append(" ; ".join(" / ".join(c for c in r if c) for r in payload))
        return "\n".join(out)

    # -- views
    def head_lines(self, n: int = 4) -> list[str]:
        """First n meaningful lines (skipping bare 'ส่วนที่ x' / page-number lines)."""
        out = []
        for kind, payload, _ in self.blocks():
            texts = [payload] if kind == "p" else [c for r in payload for c in r]
            for t in texts:
                for line in t.split("\n"):
                    line = line.strip()
                    if line and line != "^" and not _SKIP_HEAD.match(line):
                        out.append(line[:200])
                        if len(out) >= n:
                            return out
        return out

    def full_text(self) -> str:
        chunks = []
        for kind, payload, _ in self.blocks():
            chunks.append(payload if kind == "p" else "\n".join(" ".join(r) for r in payload))
        return "\n".join(chunks)

    def to_markdown(self) -> tuple[list[str], list[tuple[int, int, str]]]:
        """Return (lines, headings) where headings are (line_index, level, text)."""
        lines: list[str] = []
        headings: list[tuple[int, int, str]] = []
        numbered = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s*[^\d\s.]")
        for kind, payload, level in self.blocks():
            if kind == "p":
                if not payload:
                    continue
                flat = payload.replace("\n", " ").replace("\t", " ")
                if level and len(flat) <= 200:
                    lines.append("")
                    lines.append("#" * min(level, 6) + " " + flat)
                    headings.append((len(lines) - 1, level, flat))
                else:
                    m = numbered.match(flat)
                    if m and len(flat) <= 120:
                        headings.append((len(lines), m.group(1).count(".") + 1, flat))
                    lines.extend(payload.split("\n"))
            else:
                lines.extend(_md_table(payload))
        return lines, headings


def _md_table(rows: list[list[str]]) -> list[str]:
    rows = [r for r in rows if any(c.strip() and c != "^" for c in r)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    if width == 1:  # layout box, not a data table
        return [line for r in rows for line in r[0].split("\n") if line.strip()]

    def esc(c: str) -> str:
        return c.replace("|", "\\|").replace("\t", " ").replace("\n", " <br> ")

    out = [""]
    for i, r in enumerate(rows):
        r = [esc(c) for c in r] + [""] * (width - len(r))
        out.append("| " + " | ".join(r) + " |")
        if i == 0:
            out.append("|" + "---|" * width)
    out.append("")
    return out
