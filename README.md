# Thai REIT filing tracker (2026)

Structured extraction of Thai SEC REIT offering filings (Form 69-REIT, IPO and PO) into one JSON schema, an
Excel workbook for rechecking, and a dashboard — rebuilt by one command whenever a new filing set arrives.

Live dashboard: https://santiparpa.github.io/thai-reit-filing-doc/

GitHub Pages publishes only the `site/` dashboard (HTML, CSS, JS, and the `data/reits.js` bundle).
Source PDFs and Word files in `filings/` stay on this PC. After `python pipeline/run.py`, commit and
push `site/data/reits.js` to update the live site.

## Add a new filing (the only routine task)

1. Download the filing set from the SEC website. It arrives as a folder named like `ALL_812345_V10`.
2. Drop that folder, unchanged, into `inbox/`.
3. From this folder run:

   ```
   python pipeline/run.py
   ```

4. Open `site/index.html` (double-click works — no server needed) and `workbook/Thai REIT Transactions 2026.xlsx`.

`run.py` renames the files, converts the Word documents, extracts the filing with Claude Code, validates the
result, refreshes SEC filing status, and rebuilds the analysis, workbook and dashboard. A new version of a filing
you already have (e.g. `ALL_767525_V40`) goes into `inbox/` the same way: duplicates are skipped, new documents
are added to the existing filing folder, and that filing is re-extracted.

Useful options: `--skip-extract` (rebuild outputs from existing JSON only), `--re-extract WHART_PO_767525`
(force one filing), `--skip-status` (no SEC website access), `--parallel 2` (fewer simultaneous extractions).

### Requirements (already on this PC)

| Need | Used for |
|---|---|
| Python 3.11+ with `openpyxl`, `python-docx`/`lxml`, `jsonschema`, `beautifulsoup4`, `requests`, `pywin32` | all pipeline steps |
| Microsoft Word | converting legacy `.doc` files only |
| Claude Code CLI (`claude`), signed in | extraction (`claude -p`, uses your Claude Code login — no API key) |
| Windows `curl` | SEC status page (the site resets Python's TLS client) |

Extraction takes roughly 15–30 minutes per filing and counts against your Claude usage limit. If a run stops
at the limit, rerun `python pipeline/run.py` later: any filing without a valid JSON is picked up again.

## Folder layout

```
inbox/                     drop SEC download folders here
filings/{FILING_ID}/       renamed source files (PDFs kept but never read)
filings/_rename_manifest.csv   original name -> new name, SHA-1, date (undo trail)
text/{FILING_ID}/*.md      Markdown reading copies of the Word files; _toc.md = reading order + heading index
schema/reit_filing.schema.json   the contract between extraction, workbook and dashboard
data/reits/{FILING_ID}.json      one extraction per filing (every figure cited)
data/filing_status.json    SEC filing stage per filing
data/analysis.json         cross-checks, comparable metrics, generated insights
workbook/Thai REIT Transactions 2026.xlsx
site/                      dashboard (index.html, app.js, styles.css) + data/reits.js bundle
pipeline/                  scripts and the extraction prompt
sample/                    the 2025 tracker the workbook's first sheet is modelled on (left untouched)
```

## Naming convention

Folder: `{TICKER}_{IPO|PO}_{SEC_NO}` — e.g. `WHART_PO_767525` (SEC_NO is the number in `ALL_767525_V30`
and the SEC's TransID, which links the filing to its status row).

File: `{TICKER}_{IPO|PO}_{FilingDate}_{DocType}[-NN].{ext}` — e.g. `WHART_PO_20260827_P2-03-NewAssets.docx`

- **FilingDate** is the SEC upload date of that document, so revised drafts sort by date and never overwrite.
- **DocType** follows the Form 69-REIT structure for Word files, read from each document's heading:
  `00-Cover`, `00-TOC`, `00-Definitions`, `P1-FactSheet`, `P2-01-UseOfProceeds`, `P2-02-Policy`,
  `P2-03-NewAssets`, `P2-03-ExistingAssets`, `P2-03-Assets` (one section covering both), `P2-03-Leasing`,
  `P2-03-Encumbrances`, `P2-04-Industry`, `P2-05-Risks`, `P2-06-Litigation`, `P2-07-Other`,
  `P2-08-Unitholders`, `P2-09-Governance`, `P2-10-Fees`, `P2-11-RelatedParty`, `P2-12-Financials`,
  `P2-13-MDA`, `P3-Offering`. PDFs take their SEC category: `ATT-Appraisal`, `ATT-FinStmt`,
  `ATT-Sensitivity`, `ATT-TrustDeed`, `ATT-TrusteeCert`, `ATT-Other`.
- **-NN** is added only when two documents would otherwise share a name.

IPO vs PO and the ticker are read from the cover page. If a cover is unusual, add an override in
`pipeline/overrides.json`:

```json
{ "812345": { "ticker": "NEWREIT", "offering_type": "IPO" },
  "files": { "ISSUER_FIRST_20261001123456789.docx": "P2-05-Risks" } }
```

A document the rules cannot place is named `P2-XX-Unclassified`; add it under `"files"` and rerun.

## How extraction works

- `pipeline/prompts/extract_filing.md` is the single extraction prompt — the same text the initial nine
  parallel agents used. Optional structure hints for one filing go in `pipeline/prompts/notes/{FILING_ID}.md`.
- Agents read only `text/{FILING_ID}/*.md`, never PDFs, the web or prior knowledge. A value that is not in the
  text filings is recorded as `not_found` with a reason; nothing is estimated.
- Every figure carries `source = {file, line, section, quote}`. `pipeline/validate.py` checks the schema **and**
  that each quote appears verbatim in the cited file, so a citation cannot be invented.
- The latest version of each document wins; material changes from older drafts are kept in `revision_notes`.
- Status per value: `found`, `derived` (computed, formula in the note), `ambiguous` (inconsistent or a bracketed
  draft figure), `not_found`, `not_applicable`.

Run a step on its own when needed:

```
python pipeline/naming.py --dry-run inbox/ALL_812345_V10   # preview renames
python pipeline/convert.py NEWREIT_IPO_812345
python pipeline/extract.py NEWREIT_IPO_812345              # or --missing
python pipeline/validate.py                                # all JSON files
python pipeline/sec_status.py
python pipeline/consolidate.py; python pipeline/build_workbook.py; python pipeline/build_site.py
```

## Rechecking a number

- **Workbook:** value cells are coloured by status (grey not found, yellow ambiguous/draft, blue derived) and
  carry a comment with `file:line` and the Thai quote. The *Citations* sheet lists every sourced value; the
  *Validation* sheet lists pipeline cross-checks, the extractor's self-checks, fields not found and draft revisions.
  `Check:` columns are live Excel formulas (units × price, DPU ÷ price, price ÷ appraisal, P/NAV …).
- **Dashboard:** every figure shows a section chip such as `P2-03 · 94`; open it to see the file, line, section and
  the verbatim Thai source text.
- **Source:** open `text/{FILING_ID}/{file}.md` at that line, or the original Word file of the same name in `filings/`.

## Conventions

THB mn = million baht; per-unit values in THB; percentages 0–100; areas in sqm (1 rai = 1,600 sqm,
1 ngan = 400 sqm, 1 sq.wa = 4 sqm; the as-filed rai-ngan-wa text is kept); Buddhist Era years converted to
Gregorian; periods FY2024 / 9M2025 / 1Q2026 / FY2027P (P = projection). "ไม่เกิน" figures are maximums.
The workbook's *Transaction Size* is total investment value, as in the 2025 tracker.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Close '...xlsx' in Excel and run again.` | The workbook is open; close it and rerun. |
| Emptied `ALL_*` folders remain | OneDrive briefly locks them; delete them by hand. |
| `could not read ticker/IPO-PO from the cover page` | Add the filing to `pipeline/overrides.json`. |
| `SEC status not updated` | Network or SEC site issue; the previous status file is kept. Rerun later. |
| Extraction `FAILED validation` | Read the listed errors; rerun `python pipeline/extract.py FILING_ID`. |
| Dashboard says "No data bundle yet" | Run `python pipeline/build_site.py`. |
