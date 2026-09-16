"""Merge all extracted filings, cross-check each one, derive comparable metrics and cross-REIT insights.

Reads data/reits/*.json and data/filing_status.json (if present); writes data/analysis.json, which the
workbook and dashboard read next to the per-REIT files. Every insight is computed from the data, so the
text regenerates when filings are added.

Usage: python pipeline/consolidate.py
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime

from common import utf8_console
from dataset import ANALYSIS, STATUS, iter_statuses, load_filings, load_json, num, val

TODAY = date.today()
SIZE_TOLERANCE_PCT = 1.0
YIELD_TOLERANCE_PP = 0.15
APPRAISAL_SPREAD_WARN_PCT = 10.0


def _date(s) -> date | None:
    if not isinstance(s, str):
        return None
    parts = s.split("-")
    try:
        return date(int(parts[0]), int(parts[1]) if len(parts) > 1 else 12, int(parts[2]) if len(parts) > 2 else 28)
    except (ValueError, IndexError):
        return None


def _pct_vs(value, base):
    return None if value is None or not base else (value / base - 1) * 100


def _round(x, n=2):
    return None if x is None else round(x, n)


def fmt_mn(x) -> str:
    if x is None:
        return "n/a"
    return f"THB {x:,.0f}m" if abs(x) < 1000 else f"THB {x / 1000:,.2f}bn"


def fmt_date(iso) -> str:
    d = _date(iso)
    return f"{d.day} {d:%b %Y}" if d and isinstance(iso, str) and len(iso) == 10 else (iso or "n/a")


STAGE_PHRASES = {
    "review": "under SEC review", "amended": "under SEC review after amendment", "effective": "effective, offer not yet open",
    "offering": "in their offer period", "closed": "with the offer closed", "withdrawn": "withdrawn", "unlisted": "not on the SEC filing list",
}


def names(items) -> list[str]:
    if isinstance(items, dict):
        items = [items]
    return [p["name_en"] for p in items or [] if isinstance(p, dict) and p.get("name_en")]


def tenure_kind(investment_type) -> str:
    t = (investment_type or "").lower()
    if "lease" in t and "free" in t:
        return "mixed"
    if "lease" in t:
        return "leasehold"
    return "freehold" if "free" in t else "other"


def trailing_dpu(rows: list[dict]) -> tuple[str | None, float | None]:
    by_period = defaultdict(list)
    for r in rows:
        if isinstance(r.get("dpu_thb"), (int, float)) and re.fullmatch(r"FY\d{4}", r.get("period", "")):
            by_period[r["period"]].append(r)
    if not by_period:
        return None, None
    period = max(by_period)
    totals = [r["dpu_thb"] for r in by_period[period] if (r.get("component") or "").lower() == "total"]
    return period, totals[0] if totals else sum(r["dpu_thb"] for r in by_period[period])


def analyse(f: dict, sec: dict | None) -> dict:
    fil, off, cap, parties = f["filing"], f["offering"], f["capital_structure"], f["parties"]
    ep = f.get("existing_portfolio")
    price, proj = off["offering_price_per_unit"], off["projected_distribution"]

    funding = defaultdict(float)
    for fs in off["funding_sources"]:
        amount = num(fs["amount_thb_mn"])
        if amount is not None:
            funding[fs["type"]] += amount
    m = {
        "units_offered_max": num(off["units_offered_max"]),
        "price_min_thb": num(price["min_thb"]),
        "price_max_thb": num(price["max_thb"]),
        "price_final_thb": num(price["final_thb"]),
        "par_thb": num(off["par_value_per_unit_thb"]),
        "offering_size_thb_mn": num(off["offering_size_thb_mn"]),
        "total_investment_thb_mn": num(off["total_investment_value_thb_mn"]),
        "new_debt_thb_mn": num(cap["new_borrowings_thb_mn"]) if num(cap["new_borrowings_thb_mn"]) is not None else funding.get("debt"),
        "funding_thb_mn": dict(funding),
        "transaction_costs_thb_mn": num(off["estimated_transaction_costs_thb_mn"]),
        "projected_dpu_thb": num(proj["dpu_thb"]),
        "projected_yield_pct": num(proj["distribution_yield_pct"]),
        "yield_basis_price_thb": num(proj["basis_price_thb"]),
        "projection_period": val(proj["projection_period"]),
        "ltv_before_pct": num(cap["ltv_before_pct"]),
        "ltv_after_pct": num(cap["ltv_after_pct"]),
        "ltv_limit_pct": num(cap["ltv_limit_pct"]),
        "units_before": num(cap["units_outstanding_before"]),
        "units_after_max": num(cap["units_outstanding_after_max"]),
        "nav_per_unit_thb": num(cap["nav_per_unit_thb"]),
    }
    offer_price = m["price_final_thb"] or m["price_max_thb"]
    m["new_equity_thb_mn"] = funding.get("new_units", m["offering_size_thb_mn"])
    if m["new_equity_thb_mn"] and m["new_debt_thb_mn"]:
        m["equity_share_pct"] = _round(m["new_equity_thb_mn"] / (m["new_equity_thb_mn"] + m["new_debt_thb_mn"]) * 100, 1)
    if m["units_offered_max"] and m["units_before"]:
        m["new_units_vs_existing_pct"] = _round(m["units_offered_max"] / m["units_before"] * 100, 1)

    assets = []
    for a in f["new_assets"]:
        values = [ap["value_thb_mn"] for ap in a["appraisals"] if isinstance(ap.get("value_thb_mn"), (int, float))]
        low, high = (min(values), max(values)) if values else (None, None)
        asset_price = num(a["acquisition_price_thb_mn"])
        expiry = val(a["lease_expiry"])
        expiry_date = _date(expiry)
        occupancy = sorted((o for o in a["occupancy"] if isinstance(o.get("occupancy_pct"), (int, float))), key=lambda o: o["as_of"])
        assets.append({
            "asset_id": a["asset_id"],
            "name": a["name_en"],
            "asset_type": a["asset_type"],
            "province": a["location"].get("province"),
            "investment_type": val(a["investment_type"]),
            "tenure": tenure_kind(val(a["investment_type"])),
            "price_thb_mn": asset_price,
            "appraisal_low_thb_mn": low,
            "appraisal_high_thb_mn": high,
            "appraisers": [ap["appraiser"] for ap in a["appraisals"]],
            "price_vs_low_appraisal_pct": _round(_pct_vs(asset_price, low)),
            "appraisal_spread_pct": _round((high - low) / low * 100) if low else None,
            "lease_expiry": expiry,
            "remaining_tenure_years": _round((expiry_date - TODAY).days / 365.25, 1) if expiry_date else None,
            "occupancy_pct": occupancy[-1]["occupancy_pct"] if occupancy else None,
            "occupancy_as_of": occupancy[-1]["as_of"] if occupancy else None,
            "leasable_sqm": num(a["building_area"]["leasable_sqm"]),
            "rooms": num(a["building_area"]["rooms"]),
            "wale_years": num(a["wale_years"]),
        })
    m["new_assets"] = assets
    m["new_asset_count"] = len(assets)
    priced = [x for x in assets if x["price_thb_mn"] is not None]
    m["acquisition_total_thb_mn"] = _round(sum(x["price_thb_mn"] for x in priced), 1) if priced else None
    if priced and all(x["appraisal_low_thb_mn"] is not None for x in priced):
        m["appraisal_low_total_thb_mn"] = _round(sum(x["appraisal_low_thb_mn"] for x in priced), 1)
        m["appraisal_high_total_thb_mn"] = _round(sum(x["appraisal_high_thb_mn"] for x in priced), 1)
        m["price_vs_low_appraisal_pct"] = _round(_pct_vs(m["acquisition_total_thb_mn"], m["appraisal_low_total_thb_mn"]))
        m["price_vs_low_appraisal_basis"] = "sum of asset prices"
    elif not priced and assets and all(x["appraisal_low_thb_mn"] is not None for x in assets) and m["total_investment_thb_mn"]:
        # Some filings cap only the whole deal; compare that cap with the summed lower appraisals instead.
        m["appraisal_low_total_thb_mn"] = _round(sum(x["appraisal_low_thb_mn"] for x in assets), 1)
        m["appraisal_high_total_thb_mn"] = _round(sum(x["appraisal_high_thb_mn"] for x in assets), 1)
        m["price_vs_low_appraisal_pct"] = _round(_pct_vs(m["total_investment_thb_mn"], m["appraisal_low_total_thb_mn"]))
        m["price_vs_low_appraisal_basis"] = "total investment value (no per-asset prices disclosed)"
    m["leasable_sqm_total"] = sum(x["leasable_sqm"] for x in assets if x["leasable_sqm"]) or None
    m["tenure_mix"] = dict(Counter(x["tenure"] for x in assets))
    expiries = [x for x in assets if x["remaining_tenure_years"] is not None]
    m["shortest_tenure_asset"] = min(expiries, key=lambda x: x["remaining_tenure_years"])["asset_id"] if expiries else None

    if ep:
        market = num(ep["market_price_per_unit_thb"])
        nav_unit = num(ep["nav_per_unit_thb"]) or m["nav_per_unit_thb"]
        total_assets = num(ep["total_asset_value_thb_mn"])
        fy, dpu = trailing_dpu(ep["historical_dpu"])
        m["existing"] = {
            "as_of": val(ep["as_of"]),
            "asset_count": num(ep["number_of_assets"]) or len(ep["assets"]),
            "total_assets_thb_mn": total_assets,
            "investment_value_thb_mn": num(ep.get("investment_value_thb_mn")),
            "nav_thb_mn": num(ep.get("nav_thb_mn")),
            "nav_per_unit_thb": nav_unit,
            "market_price_thb": market,
            "market_price_as_of": ep["market_price_per_unit_thb"].get("as_of"),
            "price_to_nav": _round(market / nav_unit) if market and nav_unit else None,
            "latest_appraisal_total_thb_mn": num(ep["latest_appraisal_total_thb_mn"]),
            "trailing_dpu_period": fy,
            "trailing_dpu_thb": dpu,
            "trailing_yield_at_market_pct": _round(dpu / market * 100) if dpu and market else None,
            "max_offer_vs_market_pct": _round(_pct_vs(m["price_max_thb"], market), 1),
            "deal_vs_total_assets_pct": _round(m["total_investment_thb_mn"] / total_assets * 100, 1)
            if m["total_investment_thb_mn"] and total_assets else None,
        }

    checks: list[dict] = []

    def check(cid, label, result, detail):
        checks.append({"id": cid, "label": label, "result": result, "detail": detail})

    units, size = m["units_offered_max"], m["offering_size_thb_mn"]
    if units and offer_price and size:
        implied = units * offer_price / 1e6
        diff = _pct_vs(implied, size)
        check("offering_size", "Units × price = offering size", "pass" if abs(diff) <= SIZE_TOLERANCE_PCT else "warn",
              f"{units:,.0f} units × THB {offer_price:,.2f} = {fmt_mn(implied)} vs stated {fmt_mn(size)} ({diff:+.1f}%)")
    else:
        check("offering_size", "Units × price = offering size", "n/a", "units, price or offering size not disclosed")

    dpu, basis, yld = m["projected_dpu_thb"], m["yield_basis_price_thb"] or offer_price, m["projected_yield_pct"]
    if dpu and basis and yld:
        implied = dpu / basis * 100
        check("yield", "Yield = projected DPU ÷ offer price", "pass" if abs(implied - yld) <= YIELD_TOLERANCE_PP else "warn",
              f"THB {dpu:.4f} ÷ THB {basis:.2f} = {implied:.2f}% vs stated {yld:.2f}%")
    else:
        check("yield", "Yield = projected DPU ÷ offer price", "n/a", "projected DPU, yield or basis price not disclosed")

    tiv = m["total_investment_thb_mn"]
    undisclosed = [fs["type"] for fs in off["funding_sources"] if num(fs["amount_thb_mn"]) is None]
    if undisclosed:
        check("funding", "Funding sources cover the investment", "n/a",
              f"amount not disclosed for: {', '.join(undisclosed)} (blank or placeholder in the filing)")
    elif funding and tiv:
        total_funding = sum(funding.values())
        check("funding", "Funding sources cover the investment", "pass" if total_funding >= tiv * 0.99 else "warn",
              f"sources {fmt_mn(total_funding)} vs investment {fmt_mn(tiv)} (maximums; the difference funds costs or is unused capacity)")
    else:
        check("funding", "Funding sources cover the investment", "n/a", "funding amounts or investment value not disclosed")

    if m["acquisition_total_thb_mn"] and tiv:
        check("asset_prices", "Asset prices within total investment", "pass" if m["acquisition_total_thb_mn"] <= tiv * 1.01 else "warn",
              f"sum of asset prices {fmt_mn(m['acquisition_total_thb_mn'])} vs total {fmt_mn(tiv)}")
    else:
        check("asset_prices", "Asset prices within total investment", "n/a", "per-asset prices not disclosed")

    premia = [x for x in assets if x["price_vs_low_appraisal_pct"] is not None]
    if premia:
        above = [x for x in premia if x["price_vs_low_appraisal_pct"] > 0]
        check("appraisal", "Price at or below lower appraisal", "warn" if above else "pass",
              "; ".join(f"{x['name']}: {x['price_vs_low_appraisal_pct']:+.1f}% vs lower appraisal" for x in premia))
    elif m.get("price_vs_low_appraisal_pct") is not None:
        check("appraisal", "Price at or below lower appraisal", "warn" if m["price_vs_low_appraisal_pct"] > 0 else "pass",
              f"total investment {fmt_mn(m['total_investment_thb_mn'])} vs summed lower appraisals "
              f"{fmt_mn(m['appraisal_low_total_thb_mn'])} ({m['price_vs_low_appraisal_pct']:+.1f}%); per-asset prices not disclosed")
    else:
        check("appraisal", "Price at or below lower appraisal", "n/a", "asset price or appraisal values not disclosed")
    appraised = [x for x in assets if x["appraisal_spread_pct"] is not None]
    if appraised:
        spreads = [x for x in appraised if x["appraisal_spread_pct"] > APPRAISAL_SPREAD_WARN_PCT]
        check("appraisal_spread", f"Appraisers within {APPRAISAL_SPREAD_WARN_PCT:.0f}% of each other", "warn" if spreads else "pass",
              "; ".join(f"{x['name']}: {x['appraisal_spread_pct']:.1f}% apart" for x in spreads) or f"{len(appraised)} asset(s) within range")

    if m["ltv_after_pct"] is not None and m["ltv_limit_pct"] is not None:
        check("ltv", "Post-deal LTV within limit", "pass" if m["ltv_after_pct"] <= m["ltv_limit_pct"] else "fail",
              f"{m['ltv_after_pct']:.1f}% vs limit {m['ltv_limit_pct']:.0f}%")
    else:
        check("ltv", "Post-deal LTV within limit", "n/a", "post-deal LTV or limit not disclosed")

    tenure_issues, tenure_checked = [], 0
    for a in f["new_assets"]:
        for c in a["components"]:
            start, end, years = _date(c.get("start_date")), _date(c.get("expiry_date")), c.get("tenure_years")
            if start and end and isinstance(years, (int, float)):
                tenure_checked += 1
                gap = (end - start).days / 365.25 - years
                if abs(gap) > 1:
                    tenure_issues.append(f"{a['name_en']} {c['component']}: {years} yrs but {c['start_date']}→{c['expiry_date']}")
    check("tenure_dates", "Lease start + tenure = expiry", "warn" if tenure_issues else ("pass" if tenure_checked else "n/a"),
          "; ".join(tenure_issues) or (f"{tenure_checked} leasehold component(s) consistent" if tenure_checked else "no dated leasehold components"))

    structural_ok = (fil["offering_type"] == "IPO" and ep is None) or (fil["offering_type"] == "PO" and ep is not None and len(ep["assets"]) > 0)
    check("structure", "IPO has no existing portfolio / PO has one", "pass" if structural_ok else "fail",
          f"{fil['offering_type']} with {len(ep['assets']) if ep else 0} existing asset rows")

    failed_self = [c for c in f["extraction"]["self_checks"] if c["result"] == "fail"]
    check("agent_self_checks", "Extraction agent self-checks", "warn" if failed_self else "pass",
          "; ".join(f"{c['check']}: {c.get('detail', '')}" for c in failed_self) or f"{len(f['extraction']['self_checks'])} passed or n/a")

    if sec and sec.get("stage") != "unlisted":
        check("sec_type", "SEC lists the same offering type", "warn" if sec.get("type_mismatch") else "pass",
              sec.get("type_mismatch") or f"SEC: {sec.get('offering_type')}")

    statuses = Counter(iter_statuses(f))
    applicable = sum(statuses.values()) - statuses.get("not_applicable", 0)
    completeness = {
        "counts": dict(statuses),
        "found_pct": _round((statuses.get("found", 0) + statuses.get("derived", 0)) / applicable * 100, 1) if applicable else None,
        "not_found_fields": len(f["extraction"]["not_found"]),
    }
    if statuses.get("ambiguous"):
        check("draft_figures", "Figures still ambiguous / draft placeholders", "warn", f"{statuses['ambiguous']} value(s) marked ambiguous")

    return {
        "filing_id": fil["filing_id"],
        "ticker": fil["ticker"],
        "offering_type": fil["offering_type"],
        "name_en": val(fil["reit_name_en"]),
        "name_th": val(fil["reit_name_th"]),
        "sector": f["sector"]["primary"],
        "sub_sectors": f["sector"]["sub_sectors"],
        "sponsors": names(parties["sponsors"]),
        "reit_manager": names(parties["reit_manager"]),
        "trustee": names(parties["trustee"]),
        "property_managers": names(parties["property_managers"]),
        "financial_advisors": names(parties["financial_advisors"]),
        "underwriters": list(dict.fromkeys(names(parties["lead_underwriters"]) + names(parties["underwriters"]))),
        "appraisers": names(parties["appraisers"]),
        "sellers": names(parties["sellers_or_lessors"]),
        "seller_related_to_sponsor": any(p.get("related_to_sponsor") for p in parties["sellers_or_lessors"]) if parties["sellers_or_lessors"] else None,
        "investor_eligibility": val(fil["investor_eligibility"]),
        "data_as_of": val(fil["data_as_of"]),
        "latest_document_date": fil["latest_document_date"],
        "sec_status": sec,
        "metrics": m,
        "checks": checks,
        "completeness": completeness,
    }


def build_insights(rows: list[dict], status_as_of: str | None) -> list[dict]:
    out = []

    def add(kind, text, ids):
        out.append({"kind": kind, "text": text, "filings": ids})

    if not rows:
        return out
    M = lambda r: r["metrics"]  # noqa: E731
    sized = [r for r in rows if M(r)["total_investment_thb_mn"]]
    total = sum(M(r)["total_investment_thb_mn"] for r in sized)
    equity = sum(M(r)["new_equity_thb_mn"] or 0 for r in rows)
    debt = sum(M(r)["new_debt_thb_mn"] or 0 for r in rows)
    kinds = Counter(r["offering_type"] for r in rows)
    add("pipeline", f"{len(rows)} filings ({kinds.get('IPO', 0)} IPO, {kinds.get('PO', 0)} PO) would add up to {fmt_mn(total)} of property "
        f"to Thai REITs, funded by up to {fmt_mn(equity)} of new units and {fmt_mn(debt)} of new borrowings.", [r["filing_id"] for r in rows])

    if sized:
        by_sector = defaultdict(list)
        for r in sized:
            by_sector[r["sector"]].append(r)
        sector, members = max(by_sector.items(), key=lambda kv: sum(M(r)["total_investment_thb_mn"] for r in kv[1]))
        share = sum(M(r)["total_investment_thb_mn"] for r in members) / total * 100
        add("sector", f"{sector} accounts for {share:.0f}% of deal value across {len(members)} of {len(sized)} filings.", [r["filing_id"] for r in members])
        big = max(sized, key=lambda r: M(r)["total_investment_thb_mn"])
        small = min(sized, key=lambda r: M(r)["total_investment_thb_mn"])
        add("size", f"Largest deal: {big['ticker']} at up to {fmt_mn(M(big)['total_investment_thb_mn'])}; smallest: {small['ticker']} at up to "
            f"{fmt_mn(M(small)['total_investment_thb_mn'])}.", [big["filing_id"], small["filing_id"]])

    yields = [r for r in rows if M(r)["projected_yield_pct"]]
    if len(yields) >= 2:
        hi = max(yields, key=lambda r: M(r)["projected_yield_pct"])
        lo = min(yields, key=lambda r: M(r)["projected_yield_pct"])
        add("yield", f"Projected distribution yields run from {M(lo)['projected_yield_pct']:.2f}% ({lo['ticker']}) to "
            f"{M(hi)['projected_yield_pct']:.2f}% ({hi['ticker']}), each on its own filing's basis price.", [lo["filing_id"], hi["filing_id"]])

    valued = [r for r in rows if M(r).get("price_vs_low_appraisal_pct") is not None]
    if valued:
        above = [r for r in valued if M(r)["price_vs_low_appraisal_pct"] > 0]
        deepest = min(valued, key=lambda r: M(r)["price_vs_low_appraisal_pct"])
        text = (f"{len(valued) - len(above)} of {len(valued)} deals with appraisal values disclosed are priced at or below the lower independent appraisal; "
                f"the widest discount is {deepest['ticker']} at {M(deepest)['price_vs_low_appraisal_pct']:+.1f}%.")
        if above:
            text += " Above the lower appraisal: " + ", ".join(f"{r['ticker']} ({M(r)['price_vs_low_appraisal_pct']:+.1f}%)" for r in above) + "."
        add("valuation", text, [r["filing_id"] for r in valued])

    levered = [r for r in rows if M(r)["ltv_after_pct"] is not None]
    if levered:
        top = max(levered, key=lambda r: M(r)["ltv_after_pct"])
        limit = M(top)["ltv_limit_pct"]
        add("leverage", f"Highest post-deal LTV: {top['ticker']} at {M(top)['ltv_after_pct']:.1f}%" + (f" against a {limit:.0f}% limit." if limit else "."),
            [top["filing_id"]])

    all_assets = [(r, a) for r in rows for a in M(r)["new_assets"]]
    if all_assets:
        lease = [(r, a) for r, a in all_assets if a["tenure"] in ("leasehold", "mixed")]
        free = [(r, a) for r, a in all_assets if a["tenure"] == "freehold"]
        verb = lambda n: "is" if n == 1 else "are"  # noqa: E731
        add("tenure_mix", f"{len(lease)} of {len(all_assets)} new assets {verb(len(lease))} wholly or partly leasehold; "
            f"{len(free)} {verb(len(free))} freehold.", sorted({r["filing_id"] for r, _ in all_assets}))
        dated = [(r, a) for r, a in all_assets if a["remaining_tenure_years"] is not None]
        if dated:
            r, a = min(dated, key=lambda ra: ra[1]["remaining_tenure_years"])
            add("tenure", f"Shortest remaining leasehold among new assets: {a['name']} ({r['ticker']}), about "
                f"{a['remaining_tenure_years']:.0f} years to {fmt_date(a['lease_expiry'])}.", [r["filing_id"]])

    relative = [r for r in rows if (M(r).get("existing") or {}).get("deal_vs_total_assets_pct")]
    if relative:
        top = max(relative, key=lambda r: M(r)["existing"]["deal_vs_total_assets_pct"])
        add("scale", f"Relative to trust size, {top['ticker']} is the biggest step: the acquisition equals {M(top)['existing']['deal_vs_total_assets_pct']:.0f}% "
            f"of its current total assets.", [top["filing_id"]])

    priced = [r for r in rows if (M(r).get("existing") or {}).get("max_offer_vs_market_pct") is not None]
    if priced:
        vals = sorted(priced, key=lambda r: M(r)["existing"]["max_offer_vs_market_pct"])
        add("pricing", "Maximum PO offer prices versus the last market price quoted in each filing: "
            + ", ".join(f"{r['ticker']} {M(r)['existing']['max_offer_vs_market_pct']:+.1f}%" for r in vals) + ".", [r["filing_id"] for r in vals])

    staged = [r for r in rows if r.get("sec_status")]
    if staged:
        counts = Counter(r["sec_status"]["stage"] for r in staged)
        add("status", f"SEC filing stage on {fmt_date(status_as_of)}: "
            + ", ".join(f"{n} {STAGE_PHRASES.get(stage, stage)}" for stage, n in counts.most_common()) + ".",
            [r["filing_id"] for r in staged])

    graded = [r for r in rows if r["completeness"]["found_pct"] is not None]
    if graded:
        low = min(graded, key=lambda r: r["completeness"]["found_pct"])
        add("data", f"Least complete extraction: {low['ticker']} ({low['completeness']['found_pct']:.0f}% of applicable fields found in the text filings); "
            f"gaps are listed per REIT and on the Validation sheet.", [low["filing_id"]])

    warns = [(r, c) for r in rows for c in r["checks"] if c["result"] in ("warn", "fail")]
    if warns:
        add("checks", f"{len(warns)} consistency checks need a look across {len({r['filing_id'] for r, _ in warns})} filings.",
            sorted({r["filing_id"] for r, _ in warns}))
    return out


def main() -> None:
    utf8_console()
    status = load_json(STATUS, {"filings": {}})
    filings = load_filings()
    rows = [analyse(f, status["filings"].get(f["filing"]["filing_id"])) for f in filings]
    rows.sort(key=lambda r: ((r["sec_status"] or {}).get("first_filed") or r["latest_document_date"], r["ticker"]))
    sectors = defaultdict(lambda: {"filings": 0, "total_investment_thb_mn": 0.0})
    for r in rows:
        sectors[r["sector"]]["filings"] += 1
        sectors[r["sector"]]["total_investment_thb_mn"] += r["metrics"]["total_investment_thb_mn"] or 0
    analysis = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "as_of": TODAY.isoformat(),
        "status_fetched_at": status.get("fetched_at"),
        "order": [r["filing_id"] for r in rows],
        "filings": {r["filing_id"]: r for r in rows},
        "totals": {
            "filings": len(rows),
            "ipo": sum(r["offering_type"] == "IPO" for r in rows),
            "po": sum(r["offering_type"] == "PO" for r in rows),
            "total_investment_thb_mn": _round(sum(r["metrics"]["total_investment_thb_mn"] or 0 for r in rows), 1),
            "new_equity_thb_mn": _round(sum(r["metrics"]["new_equity_thb_mn"] or 0 for r in rows), 1),
            "new_debt_thb_mn": _round(sum(r["metrics"]["new_debt_thb_mn"] or 0 for r in rows), 1),
            "new_assets": sum(r["metrics"]["new_asset_count"] for r in rows),
            "by_sector": dict(sectors),
        },
        "insights": build_insights(rows, status.get("as_of")),
    }
    ANALYSIS.parent.mkdir(parents=True, exist_ok=True)
    ANALYSIS.write_text(json.dumps(analysis, ensure_ascii=False, indent=2), encoding="utf-8")
    flagged = sum(c["result"] in ("warn", "fail") for r in rows for c in r["checks"])
    print(f"{len(rows)} filings analysed, {flagged} checks flagged -> data/analysis.json")


if __name__ == "__main__":
    main()
