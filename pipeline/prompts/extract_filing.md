# Task: extract one Thai REIT filing into the shared JSON schema

You are an equity research analyst extracting facts from ONE Thai REIT offering filing (SEC Form 69-REIT, written in Thai).

- Filing ID: **{{FILING_ID}}** (ticker {{TICKER}}, detected as **{{OFFERING_TYPE}}** from the cover page — confirm or flag)
- Working directory: the project root (all paths below are relative to it)

## Inputs — read nothing else
- Markdown reading copies of the Word documents: `{{TEXT_DIR}}/*.md`. Start with `{{TEXT_DIR}}/_toc.md`: it lists the files in reading priority, marks OLDER drafts, and indexes headings with line numbers.
- The schema (the contract with the workbook and dashboard): `{{SCHEMA}}`. Read it fully before writing; field descriptions define units and meaning.
- Do NOT open PDFs, other filings' folders, the web, or use prior knowledge about this REIT. If a figure is not in these .md files it is `not_found`. Never estimate, never fill from memory.

## Output
Write exactly one file, `{{OUTPUT}}` (UTF-8 JSON, `"schema_version": "1.0.0"`, `extraction.extracted_by` = "{{EXTRACTED_BY}}"). Then run

    python pipeline/validate.py {{OUTPUT}}

and fix every error until it prints `OK`. The validator also checks that each `source.quote` appears verbatim in the cited file, so quote exactly (contiguous text, no ellipses, no paraphrase; whitespace and table pipes are ignored).

Modify nothing except `{{OUTPUT}}`.

## Reading plan (files are long — Grep with Thai keywords, then Read with offset/limit around hits)
1. `00-Cover` (latest): REIT names, IPO/PO evidence, max units, max new equity, max debt, total investment value, capital-increase and additional-investment numbers.
2. `P1-FactSheet` (latest): data as-of date, sponsor, manager, trustee, property manager, advisers, underwriters, appraisers, auditor, units, NAV, market price, DPU history, LTV, projected yield.
3. `P2-01-UseOfProceeds` and `P3-Offering` (offering details, allocation, price range, timetable, underwriters, projected return, sponsor take-up). Skip subscription mechanics and legal boilerplate.
4. `P2-03-NewAssets` (or `P2-03-Assets`) and `P2-03-Leasing`: everything under `new_assets` — tenure, areas, price, both appraisals and method, occupancy, 2–3 years of revenue/NOI, location, tenants, lease expiry profile, lease structure, guarantees, encumbrances.
5. PO only: `P2-03-ExistingAssets` (or the existing part of `P2-03-Assets`), `P2-12-Financials`, `P2-13-MDA`, `P2-08-Unitholders`: `existing_portfolio` and `capital_structure` "before" figures.
6. `P2-05-Risks`: the asset-specific risks in full, generic risks by heading only.
7. Low priority (`P2-09-Governance`, `P2-11-RelatedParty`, `P2-10-Fees`): only Grep for the named parties and the sponsor relationship. Do not read trust-deed provisions.
8. Skip `P2-04-Industry`, `P2-06-Litigation`, `P2-07-Other`, `00-TOC` unless needed; use `00-Definitions` only to resolve an abbreviation.

Useful Grep keywords: ราคาเสนอขาย, มูลค่าที่ตราไว้, จำนวนหน่วยทรัสต์, ไม่เกิน, อัตราผลตอบแทน, ประโยชน์ตอบแทน, ประมาณการ, ลดทุน, ราคาประเมิน, มูลค่ายุติธรรม, วิธีรายได้, วิธีต้นทุน, อัตราคิดลด, ผู้ประเมินค่า, อัตราการเช่า, อัตราการเข้าพัก, ราคาห้องพักเฉลี่ย, ผู้เช่ารายใหญ่, สัญญาเช่า, ครบกำหนด, ระยะเวลาการเช่า, สิทธิการเช่าช่วง, สิทธิการเช่า, กรรมสิทธิ์, เงินกู้ยืม, อัตราส่วนเงินกู้ยืม, มูลค่าทรัพย์สินสุทธิ, ราคาปิด, รายได้ค่าเช่า, รายได้จากการลงทุนสุทธิ, ผู้สนับสนุน, ผู้จัดการกองทรัสต์, ทรัสตี, ผู้บริหารอสังหาริมทรัพย์, ที่ปรึกษาทางการเงิน, ผู้จัดการการจัดจำหน่าย, ผู้รับประกันการจำหน่าย, ผู้สอบบัญชี, ที่ปรึกษากฎหมาย, ผู้ให้กู้.

## Rules
1. **Latest version wins.** When `_toc.md` marks a document as an OLDER draft, take figures from the latest one, and record material differences (units, price, size, debt, asset list, appraisal values) in `filing.revision_notes`.
2. **Cite every figure.** `source` = `{file, line, section, quote}`: file is the .md name, line is the line number in that .md, section is the nearest heading, quote is a short verbatim excerpt containing the figure.
3. **Status discipline.** `found` (stated, source required) · `derived` (you computed it: explain the formula in `note` and cite an input) · `ambiguous` (filing unclear or inconsistent: source + note) · `not_found` (value null) · `not_applicable` (value null).
4. **Units.** 1,233,500,000 บาท → 1233.5 in `_thb_mn` fields; per-unit amounts in THB; percentages 0–100; areas in sqm (1 ไร่ = 1,600 sqm, 1 งาน = 400 sqm, 1 ตารางวา = 4 sqm; keep the as-filed text in `as_filed`); Buddhist Era − 543 = Gregorian; Thai month names → ISO dates. Periods: FY2024, 9M2025, 1Q2026, FY2027P.
5. **Draft placeholders.** Bracketed numbers such as "[2,200]" → record the number with status `ambiguous` and note "draft placeholder in brackets". Empty placeholders ("[•]", "[ ]") → `not_found` with that note.
6. **"ไม่เกิน" (not exceeding)** values are maxima: use the max fields and say so in `note`.
7. **Language.** English for all text; use the filing's official English names; Thai originals in `name_th` / `value_th`.
8. **IPO vs PO.** IPO: `existing_portfolio` = null; `capital_increase_no`, `additional_investment_no`, `units_outstanding_before` = `not_applicable`. PO: `existing_portfolio` covers ONLY assets already owned (never the new assets).
9. **new_assets.** One entry per project as the filing groups them (a multi-building project is one entry with building counts). Normally two independent appraisers, so two `appraisals` entries. If appraisals or prices are given only in aggregate, put them on the asset they cover and explain in `notes`.
10. **Existing assets.** One row per project; plain values with a row `source` (add `extra_sources` for figures from elsewhere).
11. **risks.** 6–15 items, asset-specific first, summarised in your own English words.
12. **analyst_notes.** 3–10 factual observations an equity analyst would flag (e.g. price vs. lower appraisal, rental guarantee, leasehold expiry, tenant concentration, related-party seller, dilution, placeholders still in brackets), each with a source. No recommendations.
13. **extraction.not_found.** List every schema field you searched for but could not find, with a reason (e.g. "appraisal assumptions appear only in the PDF appraisal report, which is excluded").
14. **extraction.self_checks.** At least: max units × max price ≈ offering size (±1%); DPU ÷ basis price ≈ yield; funding sources ≈ total investment value (+ costs); sum of asset prices ≤ total investment value; lease start + tenure ≈ expiry. Report pass / fail / n/a with the numbers. Never change a filing number to make a check pass.

## Finish
Reply with at most 15 lines: headline deal figures, number of new and existing assets captured, number of `not_found` fields, failed self-checks, and anything in the filing that looked wrong or inconsistent.
