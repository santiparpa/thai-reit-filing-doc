/* Shared layer for the two navigation designs (design-a.html, design-b.html).

   These are PROTOTYPES of the navigation only. They read the same bundle the real dashboard reads
   (site/data/reits.js) and then pad it with copies of the real filings placed in other years, so you
   can judge how each layout behaves once the docket is no longer one year of nine deals.

   No figure is invented: a demo row carries the same numbers as the 2026 filing it was copied from,
   only its dates are shifted, and every demo row is badged. Delete this folder and the real
   dashboard is unchanged. */
(() => {
  'use strict';

  const D = window.REIT_DATA;
  const A = (D && D.analysis) || {};
  const SUM = A.filings || {};
  const ORDER = A.order || Object.keys(SUM);

  /* ---------------------------------------------------------------- formats (mirrors app.js) */
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const nfCache = {};
  const nf = (d) => (nfCache[d] ||= new Intl.NumberFormat('en-US', {minimumFractionDigits: d, maximumFractionDigits: d}));
  const num = (x, d = 0) => (isNum(x) ? nf(d).format(x) : '—');
  const mnShort = (x) => (!isNum(x) ? '—' : Math.abs(x) >= 1000 ? `${num(x / 1000, 2)}bn` : `${num(x, 0)}m`);
  const mn = (x) => (!isNum(x) ? '—' : `THB ${mnShort(x)}`);
  const pct = (x, d = 1) => (isNum(x) ? `${num(x, d)}%` : '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (iso || '—');
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  /* ---------------------------------------------------------------- DOM helpers (mirrors app.js) */
  function add(el, kids) {
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function setAttrs(el, attrs) {
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    return el;
  }
  const h = (tag, attrs, ...kids) => add(setAttrs(document.createElement(tag), attrs), kids);
  const s = (tag, attrs, ...kids) => add(setAttrs(document.createElementNS('http://www.w3.org/2000/svg', tag), attrs), kids);
  const frag = (...kids) => add(document.createDocumentFragment(), kids);

  /* ---------------------------------------------------------------- vocabulary (mirrors app.js) */
  const SECTORS = ['Industrial & Logistics', 'Retail', 'Office', 'Hospitality', 'Residential & Serviced Apartment', 'Data Center', 'Healthcare', 'Mixed-use', 'Infrastructure', 'Other'];
  const sectorColor = (sector) => {
    const i = SECTORS.indexOf(sector);
    return i >= 0 && i < 4 ? `var(--s${i + 1})` : 'var(--ink-3)';
  };
  const SECTOR_SHORT = {'Industrial & Logistics': 'Industrial', 'Residential & Serviced Apartment': 'Residential', 'Data Center': 'Data centre'};
  const shortSector = (x) => SECTOR_SHORT[x] || x || '—';
  const STAGE = {
    offering: {tone: 'good', label: 'Offering open'},
    effective: {tone: 'good', label: 'Filing effective'},
    amended: {tone: 'warning', label: 'Under SEC review · amended'},
    review: {tone: 'warning', label: 'Under SEC review'},
    closed: {tone: 'neutral', label: 'Offering closed'},
    withdrawn: {tone: 'critical', label: 'Withdrawn'},
    unlisted: {tone: 'neutral', label: 'Not on SEC list'},
  };
  const STAGE_SHORT = {offering: 'Offering', effective: 'Effective', amended: 'Amended', review: 'In review', closed: 'Closed', withdrawn: 'Withdrawn', unlisted: 'Unlisted'};
  const STAGE_ORDER = ['offering', 'effective', 'amended', 'review', 'closed', 'withdrawn', 'unlisted'];

  const stageTone = (stage) => (STAGE[stage] || STAGE.unlisted).tone;
  function stageDot(stage) {
    return s('svg', {class: `dot tone-${stageTone(stage)}`, viewBox: '0 0 10 10', 'aria-hidden': 'true'}, s('circle', {cx: 5, cy: 5, r: 4}));
  }
  const typeTag = (type) => h('span', {class: `type${type === 'IPO' ? ' type-ipo' : ''}`, text: type || '—'});

  /* ---------------------------------------------------------------- year key */
  /* The book a filing belongs to is its FILING year: when it was first submitted to the SEC.
     first_filed wins. ALPHART is not on the SEC list yet and has no first_filed, so the fallback is
     the earliest document the SEC published for it, then the newest document date. Where both exist
     on the real set the earliest document always lands in the same year as first_filed, so the
     fallback never moves a filing between books. */
  const earliestDoc = (id) => {
    const docs = (((D.filings || {})[id] || {}).filing || {}).documents_used || [];
    const days = docs.map((x) => x.uploaded).filter((x) => /^\d{8}$/.test(x || '')).sort();
    return days.length ? `${days[0].slice(0, 4)}-${days[0].slice(4, 6)}-${days[0].slice(6)}` : null;
  };
  const yearOf = (c) => {
    const pick = c.first_filed || c.earliest_doc || c.last_doc;
    return typeof pick === 'string' && /^\d{4}/.test(pick) ? +pick.slice(0, 4) : null;
  };
  const dateOf = (c) => c.first_filed || c.earliest_doc || c.last_doc;
  const quarterOf = (iso) => {
    const m = typeof iso === 'string' && iso.match(/^\d{4}-(\d{2})/);
    return m ? `Q${Math.floor((+m[1] - 1) / 3) + 1}` : 'Undated';
  };

  /* ---------------------------------------------------------------- cards */
  function cardFrom(id, r, offset) {
    const st = r.sec_status || {};
    const m = r.metrics || {};
    const shift = (iso) => (typeof iso === 'string' && /^\d{4}-/.test(iso) ? String(+iso.slice(0, 4) - offset) + iso.slice(4) : null);
    return {
      id: offset ? `${id}__d${offset}` : id,
      real: !offset,
      earliest_doc: shift(earliestDoc(id)),
      source_id: id,
      ticker: r.ticker,
      type: r.offering_type,
      name_en: r.name_en,
      sector: r.sector,
      sub_sectors: r.sub_sectors || [],
      sponsor: (r.sponsors || [])[0] || '',
      manager: (r.reit_manager || [])[0] || '',
      stage: offset > 0 ? 'closed' : offset < 0 ? 'review' : (st.stage || 'unlisted'),
      first_filed: shift(st.first_filed),
      effective: shift(st.effective),
      offer_start: shift(st.offer_start),
      offer_end: shift(st.offer_end),
      last_doc: shift(r.latest_document_date),
      size: m.total_investment_thb_mn,
      equity: m.offering_size_thb_mn,
      debt: m.new_debt_thb_mn,
      yield_pct: m.projected_yield_pct,
      ltv_after: m.ltv_after_pct,
      assets: (m.new_assets_count ?? null),
    };
  }

  const REAL = ORDER.filter((id) => SUM[id]).map((id) => cardFrom(id, SUM[id], 0)).map((c) => ({...c, year: yearOf(c)}));
  /* On filing year the real set is no longer one book: QHHRREIT and MII were first submitted in
     2025. The home year is whichever holds the most of them. */
  const REAL_YEAR = REAL.length
    ? +Object.entries(REAL.reduce((t, c) => ({...t, [c.year]: (t[c.year] || 0) + 1}), {})).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    : 2026;

  /* Which real filings reappear in which book, picked so the list has a believable shape: a lighter
     2023, a busier 2025, a thin 2027 pipeline. Each copy is shifted so its FILING year lands exactly
     on the target, whatever year its source was filed in. */
  const PAD = [
    {year: 2023, take: ['QHHRREIT', 'WHART', 'ALLY', 'PROSPECT', 'MII', 'DTPBB2']},
    {year: 2024, take: ['QHHRREIT', 'WHART', 'ALLY', 'PROSPECT', 'MII', 'WHAIR', 'LHHOTEL', 'DTPBB2']},
    {year: 2025, take: ['WHART', 'ALLY', 'PROSPECT', 'WHAIR', 'LHHOTEL', 'DTPBB2', 'ALPHART']},
    {year: 2027, take: ['ALPHART', 'WHART', 'MII']},
  ];
  const DEMO = PAD.flatMap(({year, take}) => take
    .map((tk) => {
      const src = REAL.find((c) => c.ticker === tk);
      if (!src || src.year === year) return null;
      return cardFrom(src.source_id, SUM[src.source_id], src.year - year);
    })
    .filter(Boolean));

  const ALL = [...REAL, ...DEMO].map((c) => ({...c, year: c.year ?? yearOf(c) ?? REAL_YEAR, quarter: quarterOf(dateOf(c))}));
  ALL.sort((a, b) => (b.year - a.year) || String(dateOf(a) || '').localeCompare(String(dateOf(b) || '')) || a.ticker.localeCompare(b.ticker));

  const BY_ID = Object.fromEntries(ALL.map((c) => [c.id, c]));
  const YEARS = [...new Set(ALL.map((c) => c.year))].sort((a, b) => b - a);

  const sum = (rows, key) => rows.reduce((t, c) => t + (isNum(c[key]) ? c[key] : 0), 0);
  const LIVE = new Set(['offering', 'effective', 'review', 'amended']);
  function yearStat(y) {
    const rows = ALL.filter((c) => c.year === y);
    return {
      year: y, rows, count: rows.length,
      ipo: rows.filter((c) => c.type === 'IPO').length,
      po: rows.filter((c) => c.type === 'PO').length,
      size: sum(rows, 'size'), equity: sum(rows, 'equity'), debt: sum(rows, 'debt'),
      live: rows.filter((c) => LIVE.has(c.stage)).length,
      real: rows.some((c) => c.real),
    };
  }
  const YEAR_STATS = Object.fromEntries(YEARS.map((y) => [y, yearStat(y)]));
  const MAX_YEAR_SIZE = Math.max(...YEARS.map((y) => YEAR_STATS[y].size), 1);

  /* ---------------------------------------------------------------- search */
  /* Ticker prefix first, then ticker, name and the rest of the row as plain substrings. The
     loose subsequence pass is deliberately limited to the ticker ("wht" -> WHART): run it over the
     whole row and a short query like "hosp" matches every filing, which is no filter at all. */
  function score(card, q) {
    const tk = card.ticker.toLowerCase();
    if (tk.startsWith(q)) return 900 + Math.max(0, 20 - tk.length);
    if (tk.includes(q)) return 800;
    const name = (card.name_en || '').toLowerCase();
    const at = name.indexOf(q);
    if (at >= 0) return 700 - Math.min(99, at);
    const rest = [card.sector, card.sponsor, card.manager, String(card.year), card.type].join(' ').toLowerCase();
    const at2 = rest.indexOf(q);
    if (at2 >= 0) return 600 - Math.min(99, at2);
    let i = 0;
    for (const ch of q) {
      i = tk.indexOf(ch, i) + 1;
      if (i === 0) return -1;
    }
    return 300;
  }
  /* Ties break towards the year the real data is in, then towards the newest year: on a docket
     where every ticker files most years, the copy you want is almost always the current one. */
  const search = (rows, raw) => {
    const q = (raw || '').trim().toLowerCase();
    if (!q) return rows;
    return rows
      .map((c) => [score(c, q), c])
      .filter(([n]) => n >= 0)
      .sort((a, b) => (b[0] - a[0])
        || (Math.abs(a[1].year - REAL_YEAR) - Math.abs(b[1].year - REAL_YEAR))
        || (b[1].year - a[1].year)
        || a[1].ticker.localeCompare(b[1].ticker))
      .map(([, c]) => c);
  };

  /* ---------------------------------------------------------------- prototype scaffolding */
  function demoBanner(note) {
    const realYears = [...new Set(REAL.map((c) => c.year))].sort((a, b) => a - b);
    const span = realYears.length > 1 ? `${realYears[0]}–${realYears[realYears.length - 1]}` : String(realYears[0]);
    return h('div', {class: 'demo-banner'},
      h('span', {class: 'demo-chip', text: 'prototype'}),
      h('p', null, `Books run on filing year — the date of first submission to the SEC. That puts the ${REAL.length} real filings in ${span}. `,
        `Added to them are ${DEMO.length} copies dated into other years, so you can see the layout at ${ALL.length} deals; copies keep the source figures and only shift dates. `,
        note || '', h('a', {href: '../index.html', text: 'Open the real dashboard →'})));
  }
  const demoChip = (card) => (card.real ? null : h('span', {class: 'demo-chip is-inline', text: 'copy', title: 'Copy of a real filing, re-dated into another year for this prototype'}));
  const openHref = (card) => (card.real ? `../index.html#/reit/${card.source_id}` : null);

  window.NAV = {
    D, A, SUM, ALL, BY_ID, REAL, DEMO, YEARS, YEAR_STATS, MAX_YEAR_SIZE, REAL_YEAR, LIVE,
    SECTORS, STAGE, STAGE_SHORT, STAGE_ORDER, shortSector,
    h, s, frag, add, setAttrs,
    isNum, num, mn, mnShort, pct, fmtDate, plural, dateOf, quarterOf, sum,
    sectorColor, stageDot, stageTone, typeTag, search, demoBanner, demoChip, openHref,
    generated: ((D && D.generated_at) || '').slice(0, 10),
  };
})();
