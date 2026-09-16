/* Thai REIT Deal Docket
   Renders window.REIT_DATA, which pipeline/build_site.py writes to site/data/reits.js.
   No filing data lives in this file: add filings, rerun the pipeline, reload. */
(() => {
  'use strict';

  const DATA = window.REIT_DATA;
  const main = document.getElementById('main');
  const rail = document.getElementById('rail');
  const tip = document.getElementById('tip');
  const pop = document.getElementById('popover');
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------------------------------------------ DOM helpers */
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
  const s = (tag, attrs, ...kids) => add(setAttrs(document.createElementNS(SVGNS, tag), attrs), kids);
  const frag = (...kids) => add(document.createDocumentFragment(), kids);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scrollToId = (id) => document.getElementById(id)?.scrollIntoView({behavior: reduced() ? 'auto' : 'smooth', block: 'start'});

  if (!DATA || !DATA.analysis) {
    main.replaceChildren(h('section', {class: 'empty'},
      h('p', {class: 'eyebrow', text: 'Thai REIT Deal Docket'}),
      h('h1', {class: 'display', text: 'No data bundle yet'}),
      h('p', {class: 'lede', text: 'Build it with  python pipeline/run.py  (or python pipeline/build_site.py once data/analysis.json exists), then reload this page.'})));
    return;
  }

  const A = DATA.analysis;
  const FIL = DATA.filings || {};
  const SUM = A.filings || {};
  const ORDER = [...(A.order || []), ...Object.keys(FIL).filter((id) => !(A.order || []).includes(id))].filter((id) => FIL[id]);
  const TODAY = A.as_of || new Date().toISOString().slice(0, 10);

  /* ------------------------------------------------------------------ values & formats */
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const isSV = (x) => !!x && typeof x === 'object' && 'status' in x && ('value' in x || 'value_sqm' in x);
  const val = (x) => (isSV(x) ? ('value' in x ? x.value : x.value_sqm) : x);
  const nfCache = {};
  const nf = (d) => (nfCache[d] ||= new Intl.NumberFormat('en-US', {minimumFractionDigits: d, maximumFractionDigits: d}));
  const num = (x, d = 0) => (isNum(x) ? nf(d).format(x) : '—');
  const mn = (x) => (!isNum(x) ? '—' : Math.abs(x) >= 1000 ? `THB ${num(x / 1000, 2)}bn` : `THB ${num(x, Number.isInteger(x) ? 0 : 1)}m`);
  const mnShort = (x) => (!isNum(x) ? '—' : Math.abs(x) >= 1000 ? `${num(x / 1000, 2)}bn` : `${num(x, 0)}m`);
  const pct = (x, d = 2) => (isNum(x) ? `${num(x, d)}%` : '—');
  const signed = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : x < 0 ? '−' : '±'}${num(Math.abs(x), d)}%` : '—');
  const thb = (x, d = 2) => (isNum(x) ? `THB ${num(x, d)}` : '—');
  const unitsFmt = (x) => (!isNum(x) ? '—' : x >= 1e6 ? `${num(x / 1e6, x % 1e5 ? 2 : 1)}m units` : `${num(x)} units`);
  const sqm = (x) => (isNum(x) ? `${num(x)} sqm` : '—');
  const years = (x) => (isNum(x) ? `${num(x, Number.isInteger(x) ? 0 : 1)} years` : '—');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    const m = typeof iso === 'string' && iso.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
    if (!m) return iso || '—';
    if (m[3]) return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
    return m[2] ? `${MONTHS[+m[2] - 1]} ${m[1]}` : m[1];
  }
  const beYear = (iso) => (typeof iso === 'string' && /^\d{4}/.test(iso) ? +iso.slice(0, 4) + 543 : null);
  const toTime = (iso) => {
    const m = typeof iso === 'string' && iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };
  const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const countWord = (n) => (n < WORDS.length ? WORDS[n] : String(n));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ------------------------------------------------------------------ vocabulary */
  const SECTORS = ['Industrial & Logistics', 'Retail', 'Office', 'Hospitality', 'Residential & Serviced Apartment', 'Data Center', 'Healthcare', 'Mixed-use', 'Infrastructure', 'Other'];
  const sectorColor = (sector) => {
    const i = SECTORS.indexOf(sector);
    return i >= 0 && i < 4 ? `var(--s${i + 1})` : 'var(--ink-3)';
  };
  const STAGE = {
    offering: {tone: 'good', label: 'Offering open'},
    effective: {tone: 'good', label: 'Filing effective'},
    amended: {tone: 'warning', label: 'Under SEC review · amended'},
    review: {tone: 'warning', label: 'Under SEC review'},
    closed: {tone: 'neutral', label: 'Offering closed'},
    withdrawn: {tone: 'critical', label: 'Withdrawn'},
    unlisted: {tone: 'neutral', label: 'Not on SEC list'},
  };
  const RESULT = {pass: ['good', 'Pass'], warn: ['warning', 'Check'], fail: ['critical', 'Fail'], 'n/a': ['neutral', 'n/a']};
  const DOC_NAMES = {
    '00-Cover': 'Cover page', '00-TOC': 'Contents', '00-Definitions': 'Definitions', 'P1-FactSheet': 'Fact sheet',
    'P2-01-UseOfProceeds': 'Use of proceeds', 'P2-02-Policy': 'Policy and business overview', 'P2-03-NewAssets': 'Assets to be acquired',
    'P2-03-Assets': 'Assets (existing and new)', 'P2-03-ExistingAssets': 'Existing assets', 'P2-03-Leasing': 'Leasing and benefits',
    'P2-03-Encumbrances': 'Disputes and encumbrances', 'P2-04-Industry': 'Industry overview', 'P2-05-Risks': 'Risk factors',
    'P2-06-Litigation': 'Litigation', 'P2-07-Other': 'Other information', 'P2-08-Unitholders': 'Units and unitholders',
    'P2-09-Governance': 'Management and governance', 'P2-10-Fees': 'Fees and expenses', 'P2-11-RelatedParty': 'Related-party transactions',
    'P2-12-Financials': 'Financial information', 'P2-13-MDA': 'Management discussion and analysis', 'P3-Offering': 'Offering details',
  };
  const STATUS_TEXT = {
    derived: 'Derived by the extractor from stated figures.',
    ambiguous: 'Ambiguous in the filing, or still a bracketed draft figure.',
    not_found: 'Not found in the text filings.',
    not_applicable: 'Not applicable to this filing.',
  };
  const KIND = {
    pipeline: 'Pipeline', sector: 'Sector', size: 'Deal size', yield: 'Yield', valuation: 'Valuation', leverage: 'Leverage',
    tenure_mix: 'Tenure', tenure: 'Tenure', scale: 'Scale', pricing: 'Pricing', status: 'SEC stage', data: 'Data gaps', checks: 'Checks',
  };
  const ROLES = [
    ['sponsors', 'Sponsor'], ['reit_manager', 'REIT manager'], ['trustee', 'Trustee'], ['property_managers', 'Property manager'],
    ['financial_advisors', 'Financial advisor'], ['lead_underwriters', 'Lead underwriter'], ['underwriters', 'Underwriter'],
    ['appraisers', 'Appraiser'], ['auditor', 'Auditor'], ['legal_advisors', 'Legal advisor'], ['lenders', 'Lender'],
    ['sellers_or_lessors', 'Seller / lessor'], ['operators_or_master_lessees', 'Operator / master lessee'],
  ];

  /* ------------------------------------------------------------------ small components */
  function docInfo(file) {
    const m = /^([A-Z0-9]+)_(IPO|PO)_(\d{8})_(.+?)(?:-(\d{2}))?\.md$/.exec(file || '');
    if (!m) return {code: 'src', name: file || 'Source', date: null};
    const type = m[4];
    const code = type.startsWith('00-') ? type.slice(3) : type.replace(/-[A-Za-z].*$/, '');
    return {code, type, name: DOC_NAMES[type] || type, date: `${m[3].slice(0, 4)}-${m[3].slice(4, 6)}-${m[3].slice(6)}`, filing: `${m[1]}_${m[2]}`};
  }

  function cite(src, holder) {
    if (!src || !src.file) return null;
    const d = docInfo(src.file);
    return h('button', {
      class: 'cite', type: 'button',
      'aria-label': `Source: ${d.name}${src.line ? `, line ${src.line}` : ''}`,
      onclick: (e) => { e.stopPropagation(); openCite(e.currentTarget, src, holder); },
    }, d.code, src.line ? h('span', {class: 'cite-line', text: String(src.line)}) : null);
  }

  let popAnchor = null;
  let currentFiling = null;
  function openCite(btn, src, holder) {
    if (popAnchor === btn && !pop.hidden) { closePop(true); return; }
    const d = docInfo(src.file);
    const status = holder && holder.status;
    pop.replaceChildren(
      h('div', {class: 'pop-head'},
        h('span', {class: 'pop-code', text: d.code}),
        h('span', {class: 'pop-name', text: d.name}),
        h('button', {class: 'pop-close', type: 'button', 'aria-label': 'Close source', text: '×', onclick: () => closePop(true)})),
      h('p', {class: 'pop-file', text: `text/${currentFiling || '…'}/${src.file}${src.line ? ` · line ${src.line}` : ''}`}),
      d.date ? h('p', {class: 'pop-meta', text: `Uploaded to the SEC ${fmtDate(d.date)} · พ.ศ. ${beYear(d.date)}`}) : null,
      src.section ? h('p', {class: 'pop-section', lang: 'th', text: src.section}) : null,
      src.quote ? h('blockquote', {class: 'pop-quote', lang: 'th', text: src.quote}) : h('p', {class: 'pop-meta', text: 'No quote recorded for this figure.'}),
      status && status !== 'found' && STATUS_TEXT[status] ? h('p', {class: 'pop-status', text: STATUS_TEXT[status]}) : null,
      holder && holder.note ? h('p', {class: 'pop-note', text: holder.note}) : null,
    );
    pop.hidden = false;
    popAnchor = btn;
    const r = btn.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    const below = r.bottom + 6 + ph <= window.innerHeight - 8;
    const top = below ? r.bottom + 6 : Math.max(8, r.top - ph - 6);
    pop.style.left = `${left + window.scrollX}px`;
    pop.style.top = `${top + window.scrollY}px`;
    pop.querySelector('.pop-close').focus({preventScroll: true});
  }
  function closePop(returnFocus) {
    if (pop.hidden) return;
    pop.hidden = true;
    if (returnFocus && popAnchor && document.contains(popAnchor)) popAnchor.focus({preventScroll: true});
    popAnchor = null;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePop(true); hideTip(); } });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.cite')) closePop(false); });

  /** A sourced value: formatted value + status flag + source chip. */
  function V(obj, fmt = (x) => x) {
    const status = isSV(obj) ? obj.status : null;
    const raw = val(obj);
    const out = h('span', {class: 'v'});
    if (status === 'not_found') out.append(h('span', {class: 'nf', title: obj.note || STATUS_TEXT.not_found, text: 'not found'}));
    else if (status === 'not_applicable') out.append(h('span', {class: 'na', text: 'n/a'}));
    else if (raw === null || raw === undefined || raw === '') out.append(h('span', {class: 'nf', text: '—'}));
    else {
      out.append(fmt(raw));
      if (status === 'ambiguous') out.append(h('span', {class: 'flag', title: obj.note || STATUS_TEXT.ambiguous, text: 'draft'}));
      if (status === 'derived') out.append(h('span', {class: 'flag is-derived', title: obj.note || STATUS_TEXT.derived, text: 'calc'}));
    }
    if (isSV(obj) && obj.source) out.append(cite(obj.source, obj));
    return out;
  }
  const pair = (a, b, fmt) => h('span', {class: 'pair'}, V(a, fmt), h('span', {class: 'arrow', 'aria-label': 'to', text: '→'}), V(b, fmt));

  function toneIcon(tone) {
    const svg = s('svg', {class: 'tone-icon', viewBox: '0 0 10 10', 'aria-hidden': 'true'});
    if (tone === 'good') svg.append(s('circle', {cx: 5, cy: 5, r: 4.2}));
    else if (tone === 'warning') svg.append(s('path', {d: 'M5 0.8 L9.4 9 H0.6 Z'}));
    else if (tone === 'critical') svg.append(s('rect', {x: 1, y: 1, width: 8, height: 8}));
    else svg.append(s('circle', {cx: 5, cy: 5, r: 3.4}));
    return svg;
  }
  function stagePill(sec, bare) {
    const st = (sec && STAGE[sec.stage]) || {tone: 'neutral', label: 'Status not checked'};
    return h('span', {class: `pill tone-${st.tone}${bare ? ' is-bare' : ''}`, title: (sec && sec.stage_label) || st.label}, toneIcon(st.tone), bare ? h('span', {class: 'sr-only', text: st.label}) : st.label);
  }
  const resultPill = (r) => { const [tone, label] = RESULT[r] || ['neutral', r]; return h('span', {class: `pill tone-${tone}`}, toneIcon(tone), label); };
  const typeTag = (t) => h('span', {class: `type type-${String(t).toLowerCase()}`, title: t === 'IPO' ? 'Initial public offering of a new trust' : 'Capital increase by a listed trust', text: t});
  const sectorTag = (sector) => h('span', {class: 'tag'}, h('span', {class: 'swatch', style: `background:${sectorColor(sector)}`}), sector);

  function section(id, title, sub, ...kids) {
    return h('section', {class: 'block', id, 'aria-labelledby': `${id}-h`},
      h('div', {class: 'block-head'}, h('h2', {class: 'section-title', id: `${id}-h`, text: title}), sub ? h('p', {class: 'section-sub', text: sub}) : null),
      kids);
  }
  function card(title, sub, body, opts = {}) {
    return h('figure', {class: `card${opts.wide ? ' is-wide' : ''}${opts.plain ? ' is-plain' : ''}`},
      h('figcaption', {class: 'card-head'}, h('h3', {class: 'card-title', text: title}), sub ? h('p', {class: 'sub', text: sub}) : null),
      body, opts.extra || []);
  }

  function legend(items) {
    return h('ul', {class: 'legend'}, items.map((it) => h('li', null, keyGlyph(it), it.label)));
  }
  function keyGlyph({color, shape = 'bar'}) {
    const svg = s('svg', {class: 'key', width: 14, height: 10, viewBox: '0 0 14 10', 'aria-hidden': 'true'});
    if (shape === 'line') svg.append(s('line', {x1: 0, x2: 14, y1: 5, y2: 5, style: `stroke:${color};stroke-width:2`}));
    else if (shape === 'dot') svg.append(s('circle', {cx: 7, cy: 5, r: 4, style: `fill:${color}`}));
    else if (shape === 'ring') svg.append(s('circle', {cx: 7, cy: 5, r: 3.3, style: `fill:var(--surface);stroke:${color};stroke-width:2`}));
    else if (shape === 'tick') svg.append(s('line', {x1: 7, x2: 7, y1: 0, y2: 10, style: `stroke:${color};stroke-width:2`}));
    else svg.append(s('rect', {x: 0, y: 1, width: 14, height: 8, rx: 2, style: `fill:${color}`}));
    return svg;
  }

  function cmp(a, b) {
    const na = a === null || a === undefined || a === '' || (typeof a === 'number' && !Number.isFinite(a));
    const nb = b === null || b === undefined || b === '' || (typeof b === 'number' && !Number.isFinite(b));
    if (na || nb) return na && nb ? 0 : na ? 1 : -1;
    return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
  }
  /** columns: {key, label, num?, get?(row) for sorting, render(row)} */
  function dataTable({columns, rows, sort, onRow, scroll, caption}) {
    let state = sort ? {...sort} : null;
    const wrap = h('div', {class: `table-wrap${scroll ? ' is-scroll' : ''}`});
    const draw = () => {
      const data = rows.slice();
      const col = state && columns.find((c) => c.key === state.key);
      if (col && col.get) {
        data.sort((a, b) => {
          const va = col.get(a); const vb = col.get(b);
          const empty = (x) => x === null || x === undefined || x === '';
          if (empty(va) || empty(vb)) return cmp(va, vb);
          return cmp(va, vb) * state.dir;
        });
      }
      const head = h('tr', null, columns.map((c) => {
        const active = state && state.key === c.key;
        const th = h('th', {scope: 'col', class: c.num ? 'num' : null, 'aria-sort': sort && c.get ? (active ? (state.dir > 0 ? 'ascending' : 'descending') : 'none') : null});
        if (sort && c.get) {
          th.append(h('button', {type: 'button', class: 'sort', onclick: () => { state = {key: c.key, dir: active ? -state.dir : c.num ? -1 : 1}; draw(); }},
            c.label, h('span', {class: 'sort-mark', 'aria-hidden': 'true', text: active ? (state.dir > 0 ? '▲' : '▼') : ''})));
        } else th.textContent = c.label;
        return th;
      }));
      const body = data.map((r) => {
        const tr = h('tr', {class: onRow ? 'is-link' : null}, columns.map((c) => h('td', {class: [c.num ? 'num' : '', c.cls || ''].join(' ').trim() || null}, c.render ? c.render(r) : r[c.key])));
        if (onRow) tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, summary')) onRow(r); });
        return tr;
      });
      wrap.replaceChildren(h('table', {class: 'data'}, caption ? h('caption', {class: 'sr-only', text: caption}) : null, h('thead', null, head), h('tbody', null, body)));
    };
    draw();
    return wrap;
  }
  const twin = (columns, rows) => h('details', {class: 'twin'}, h('summary', {text: 'Data table'}), dataTable({columns, rows}));

  /* ------------------------------------------------------------------ chart plumbing */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const err = raw / mag;
    return (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  }
  function niceTicks(max, count) {
    const step = niceStep(max / count);
    const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
    const out = [];
    for (let t = 0; t <= top + step / 2; t += step) out.push(+t.toFixed(10));
    return out;
  }
  function ticksBetween(lo, hi, count) {
    const step = niceStep((hi - lo) / count);
    const out = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(+t.toFixed(10));
    return out;
  }
  const roundRight = (x, y, w, hh, r) => { r = Math.min(r, w, hh / 2); return `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}z`; };
  const roundLeft = (x, y, w, hh, r) => { r = Math.min(r, w, hh / 2); return `M${x + w} ${y}h${-(w - r)}a${r} ${r} 0 0 0 ${-r} ${r}v${hh - 2 * r}a${r} ${r} 0 0 0 ${r} ${r}h${w - r}z`; };
  const roundTop = (x, y, w, hh, r) => { r = Math.min(r, w / 2, hh); return `M${x} ${y + hh}v${-(hh - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${hh - r}z`; };

  const observers = new Set();
  function chart(build) {
    const box = h('div', {class: 'chart-box'});
    let lastWidth = 0;
    const draw = () => {
      const w = Math.floor(box.clientWidth);
      if (w < 60 || w === lastWidth) return;
      lastWidth = w;
      box.replaceChildren(build(w));
    };
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    observers.add(ro);
    return box;
  }
  function teardown() { observers.forEach((o) => o.disconnect()); observers.clear(); hideTip(); closePop(false); }

  function bindTip(el, get) {
    el.setAttribute('tabindex', '0');
    const show = (x, y) => {
      const c = get();
      if (!c) return;
      tip.replaceChildren(h('p', {class: 'tip-title', text: c.title}),
        (c.rows || []).map((r) => h('p', {class: 'tip-row'}, r.color ? h('span', {class: 'tip-key', style: `background:${r.color}`}) : null, h('b', {text: r.value}), h('span', {text: r.label}))));
      tip.hidden = false;
      const tw = tip.offsetWidth; const th = tip.offsetHeight;
      let left = x + 14; let top = y - th - 12;
      if (left + tw > window.innerWidth - 8) left = x - tw - 14;
      if (top < 8) top = y + 16;
      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${top}px`;
    };
    el.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
    el.addEventListener('pointerleave', hideTip);
    el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(r.left + Math.min(r.width, 180) / 2, r.top); });
    el.addEventListener('blur', hideTip);
  }
  function hideTip() { tip.hidden = true; }
  window.addEventListener('scroll', hideTip, {passive: true});

  function linkable(g, href) {
    if (!href) return;
    g.classList.add('is-link');
    g.setAttribute('role', 'link');
    g.addEventListener('click', () => { location.hash = href; });
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = href; });
  }

  /* ------------------------------------------------------------------ chart forms */
  /** Horizontal bars, stacked when a row has several parts. keys: {key: {label, color}} */
  function hbar({rows, keys, tick = (t) => num(t), label = 88, rowH = 30, barH = 14, endPad = 76}) {
    return (width) => {
      const top = 4; const axisH = 22;
      const plotW = Math.max(60, width - label - endPad);
      const totals = rows.map((r) => r.parts.reduce((a, p) => a + (p.value > 0 ? p.value : 0), 0));
      const ticks = niceTicks(Math.max(1e-9, ...totals, ...rows.map((r) => (isNum(r.marker) ? r.marker : 0))), width < 520 ? 3 : 4);
      const xmax = ticks[ticks.length - 1];
      const X = (v) => label + (v / xmax) * plotW;
      const H = top + rows.length * rowH + axisH;
      const svg = s('svg', {class: 'viz', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': rows.map((r) => `${r.label} ${r.end || ''}`).join('; ')});
      for (const t of ticks) {
        svg.append(s('line', {class: t === 0 ? 'axis' : 'grid', x1: X(t), x2: X(t), y1: top, y2: top + rows.length * rowH}));
        svg.append(s('text', {class: 'tick', x: X(t), y: H - 6, 'text-anchor': 'middle'}, tick(t)));
      }
      rows.forEach((r, i) => {
        const y = top + i * rowH + (rowH - barH) / 2;
        const g = s('g', {class: 'mark', 'aria-label': `${r.label}: ${r.end || 'not disclosed'}`});
        g.append(s('rect', {class: 'hit', x: 0, y: top + i * rowH, width, height: rowH}));
        g.append(s('text', {class: 'row-label', x: label - 10, y: y + barH / 2, 'text-anchor': 'end', 'dominant-baseline': 'central'}, r.label));
        const parts = r.parts.filter((p) => p.value > 0);
        let acc = 0;
        parts.forEach((p, j) => {
          const last = j === parts.length - 1;
          const x0 = X(acc) + (j ? 1 : 0);
          acc += p.value;
          const w = Math.max(0.75, X(acc) - (last ? 0 : 1) - x0);
          g.append(s('path', {d: last ? roundRight(x0, y, w, barH, 4) : `M${x0} ${y}h${w}v${barH}h${-w}z`, style: `fill:${keys[p.key].color}`}));
        });
        if (isNum(r.marker)) g.append(s('line', {class: 'marker', x1: X(r.marker), x2: X(r.marker), y1: y - 4, y2: y + barH + 4}));
        if (!parts.length) g.append(s('text', {class: 'muted', x: label + 4, y: y + barH / 2, 'dominant-baseline': 'central'}, 'not disclosed'));
        else if (r.end) g.append(s('text', {class: 'end-label', x: Math.max(X(acc), isNum(r.marker) ? X(r.marker) : 0) + 7, y: y + barH / 2, 'dominant-baseline': 'central'}, r.end));
        if (r.tip) bindTip(g, () => r.tip);
        linkable(g, r.href);
        svg.append(g);
      });
      return svg;
    };
  }

  /** Bars left (negative) or right (positive) of zero. */
  function diverging({rows, label = 88, rowH = 30, barH = 14}) {
    return (width) => {
      const top = 4; const axisH = 22; const pad = 10;
      const extent = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
      const m = niceTicks(extent * 1.4, 2).slice(-1)[0];
      const plotW = Math.max(80, width - label - pad);
      const X = (v) => label + ((v + m) / (2 * m)) * plotW;
      const H = top + rows.length * rowH + axisH;
      const svg = s('svg', {class: 'viz', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': rows.map((r) => `${r.label} ${signed(r.value)}`).join('; ')});
      for (const t of [-m, -m / 2, 0, m / 2, m]) {
        svg.append(s('line', {class: t === 0 ? 'axis' : 'grid', x1: X(t), x2: X(t), y1: top, y2: top + rows.length * rowH}));
        svg.append(s('text', {class: 'tick', x: X(t), y: H - 6, 'text-anchor': 'middle'}, t === 0 ? '0' : signed(t, 0)));
      }
      rows.forEach((r, i) => {
        const y = top + i * rowH + (rowH - barH) / 2;
        const g = s('g', {class: 'mark', 'aria-label': `${r.label}: ${signed(r.value)}`});
        g.append(s('rect', {class: 'hit', x: 0, y: top + i * rowH, width, height: rowH}));
        g.append(s('text', {class: 'row-label', x: label - 10, y: y + barH / 2, 'text-anchor': 'end', 'dominant-baseline': 'central'}, r.label));
        const x0 = X(0); const x1 = X(r.value);
        if (r.value < 0) g.append(s('path', {d: roundLeft(x1, y, x0 - x1, barH, 4), style: 'fill:var(--div-neg)'}));
        else if (r.value > 0) g.append(s('path', {d: roundRight(x0, y, x1 - x0, barH, 4), style: 'fill:var(--div-pos)'}));
        g.append(s('text', {class: 'end-label', x: r.value < 0 ? x1 - 6 : x1 + 6, y: y + barH / 2, 'text-anchor': r.value < 0 ? 'end' : 'start', 'dominant-baseline': 'central'}, signed(r.value)));
        if (r.tip) bindTip(g, () => r.tip);
        linkable(g, r.href);
        svg.append(g);
      });
      return svg;
    };
  }

  /** Before → after dots against a limit tick. */
  function dumbbell({rows, label = 88, rowH = 30}) {
    return (width) => {
      const top = 4; const axisH = 22; const endPad = 58;
      const ticks = niceTicks(Math.max(1, ...rows.flatMap((r) => [r.before, r.after, r.limit].filter(isNum))) * 1.05, width < 520 ? 3 : 5);
      const xmax = ticks[ticks.length - 1];
      const plotW = Math.max(60, width - label - endPad);
      const X = (v) => label + (v / xmax) * plotW;
      const H = top + rows.length * rowH + axisH;
      const svg = s('svg', {class: 'viz', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': 'Loan-to-value before and after each deal'});
      for (const t of ticks) {
        svg.append(s('line', {class: t === 0 ? 'axis' : 'grid', x1: X(t), x2: X(t), y1: top, y2: top + rows.length * rowH}));
        svg.append(s('text', {class: 'tick', x: X(t), y: H - 6, 'text-anchor': 'middle'}, `${num(t)}%`));
      }
      rows.forEach((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        const g = s('g', {class: 'mark', 'aria-label': `${r.label}: ${pct(r.before, 1)} to ${pct(r.after, 1)}`});
        g.append(s('rect', {class: 'hit', x: 0, y: top + i * rowH, width, height: rowH}));
        g.append(s('text', {class: 'row-label', x: label - 10, y: cy, 'text-anchor': 'end', 'dominant-baseline': 'central'}, r.label));
        if (isNum(r.limit)) g.append(s('line', {class: 'limit', x1: X(r.limit), x2: X(r.limit), y1: cy - 9, y2: cy + 9}));
        if (isNum(r.before) && isNum(r.after)) g.append(s('line', {x1: X(r.before), x2: X(r.after), y1: cy, y2: cy, style: 'stroke:var(--seq-light);stroke-width:2'}));
        if (isNum(r.before)) g.append(s('circle', {cx: X(r.before), cy, r: 5, style: 'fill:var(--seq-light);stroke:var(--surface);stroke-width:2'}));
        if (isNum(r.after)) g.append(s('circle', {cx: X(r.after), cy, r: 5.5, style: 'fill:var(--s1);stroke:var(--surface);stroke-width:2'}));
        const endX = Math.max(isNum(r.after) ? X(r.after) : 0, isNum(r.limit) ? X(r.limit) : 0) + 10;
        g.append(s('text', {class: 'end-label', x: endX, y: cy, 'dominant-baseline': 'central'}, pct(r.after, 1)));
        if (r.tip) bindTip(g, () => r.tip);
        linkable(g, r.href);
        svg.append(g);
      });
      return svg;
    };
  }

  /** SEC lifecycle per filing on a shared date axis. */
  function timeline({rows, label = 88, rowH = 30}) {
    return (width) => {
      const top = 22; const axisH = 22; const endPad = 18;
      const DAY = 864e5;
      const now = toTime(TODAY);
      const times = rows.flatMap((r) => [r.filed, r.amended, r.effective, r.start, r.end].map(toTime).filter(isNum)).concat(isNum(now) ? [now] : []);
      const t0 = Math.min(...times) - 20 * DAY; const t1 = Math.max(...times) + 20 * DAY;
      const plotW = Math.max(80, width - label - endPad);
      const X = (t) => label + ((t - t0) / (t1 - t0)) * plotW;
      const H = top + rows.length * rowH + axisH;
      const svg = s('svg', {class: 'viz', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': 'SEC filing timeline'});
      const months = [];
      const d0 = new Date(t0);
      for (let m = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); m <= t1;) {
        months.push(m);
        const dd = new Date(m);
        m = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1);
      }
      const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(plotW / 58))));
      months.forEach((m, i) => {
        const dd = new Date(m);
        svg.append(s('line', {class: 'grid', x1: X(m), x2: X(m), y1: top, y2: top + rows.length * rowH}));
        if (i % every === 0) {
          const showYear = i === 0 || dd.getUTCMonth() < every;
          svg.append(s('text', {class: 'tick', x: X(m), y: H - 6, 'text-anchor': 'middle'}, `${MONTHS[dd.getUTCMonth()]}${showYear ? ` ’${String(dd.getUTCFullYear()).slice(2)}` : ''}`));
        }
      });
      if (isNum(now)) {
        svg.append(s('line', {class: 'today', x1: X(now), x2: X(now), y1: top - 6, y2: top + rows.length * rowH}));
        svg.append(s('text', {class: 'today-label', x: X(now), y: 11, 'text-anchor': 'middle'}, `Today · ${fmtDate(TODAY)}`));
      }
      rows.forEach((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        const g = s('g', {class: 'mark', 'aria-label': `${r.label}: ${r.stageLabel || ''}`});
        g.append(s('rect', {class: 'hit', x: 0, y: top + i * rowH, width, height: rowH}));
        g.append(s('text', {class: 'row-label', x: label - 10, y: cy, 'text-anchor': 'end', 'dominant-baseline': 'central'}, r.label));
        const pts = [r.filed, r.amended, r.effective, r.start, r.end].map(toTime).filter(isNum);
        if (!pts.length) {
          g.append(s('text', {class: 'muted', x: label + 4, y: cy, 'dominant-baseline': 'central'}, r.stageLabel || 'no SEC dates'));
        } else {
          g.append(s('line', {class: 'track', x1: X(Math.min(...pts)), x2: X(Math.max(...pts)), y1: cy, y2: cy}));
          const ts = toTime(r.start); const te = toTime(r.end);
          if (isNum(ts)) g.append(s('rect', {x: X(ts), y: cy - 5, width: Math.max(4, X(isNum(te) ? te : ts) - X(ts)), height: 10, rx: 3, style: 'fill:var(--s3)'}));
          if (toTime(r.filed)) g.append(s('circle', {cx: X(toTime(r.filed)), cy, r: 4, style: 'fill:var(--surface);stroke:var(--ink-3);stroke-width:2'}));
          if (toTime(r.amended)) g.append(s('circle', {cx: X(toTime(r.amended)), cy, r: 3.5, style: 'fill:var(--ink-3);stroke:var(--surface);stroke-width:1.5'}));
          if (toTime(r.effective)) g.append(s('circle', {cx: X(toTime(r.effective)), cy, r: 5, style: 'fill:var(--s1);stroke:var(--surface);stroke-width:2'}));
        }
        bindTip(g, () => ({title: `${r.label} · ${r.stageLabel || ''}`, rows: [
          ['First filed', r.filed], ['Last amended', r.amended], ['Effective', r.effective], ['Offer opens', r.start], ['Offer closes', r.end],
        ].filter(([, d]) => d).map(([k, d]) => ({label: k, value: fmtDate(d)}))}));
        linkable(g, r.href);
        svg.append(g);
      });
      return svg;
    };
  }

  /** Grouped columns per period. series: [{key, label, color}] */
  function columnsChart({groups, series, height = 210, tick = (t) => num(t)}) {
    return (width) => {
      const left = 50; const right = 8; const top = 12; const bottom = 28;
      const values = groups.flatMap((g) => series.map((sr) => g.values[sr.key])).filter(isNum);
      const vmax = Math.max(0, ...values); const vmin = Math.min(0, ...values);
      const step = niceStep(Math.max(vmax - vmin, 1e-9) / 4);
      const hi = Math.max(step, Math.ceil(vmax / step - 1e-9) * step); const lo = Math.floor(vmin / step + 1e-9) * step;
      const plotW = Math.max(60, width - left - right); const plotH = height - top - bottom;
      const Y = (v) => top + (1 - (v - lo) / (hi - lo)) * plotH;
      const svg = s('svg', {class: 'viz', width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': series.map((sr) => sr.label).join(' and ') + ' by period'});
      for (let t = lo; t <= hi + step / 2; t += step) {
        const tt = +t.toFixed(10);
        svg.append(s('line', {class: tt === 0 ? 'axis' : 'grid', x1: left, x2: width - right, y1: Y(tt), y2: Y(tt)}));
        svg.append(s('text', {class: 'tick', x: left - 8, y: Y(tt), 'text-anchor': 'end', 'dominant-baseline': 'central'}, tick(tt)));
      }
      const band = plotW / Math.max(1, groups.length);
      const colW = Math.max(3, Math.min(24, (band * 0.7 - 2 * (series.length - 1)) / series.length));
      const labelEvery = Math.max(1, Math.ceil(56 / band));
      groups.forEach((g, i) => {
        const gx = left + band * i;
        const total = series.length * colW + 2 * (series.length - 1);
        let x = gx + (band - total) / 2;
        const gg = s('g', {class: 'mark', 'aria-label': g.label});
        gg.append(s('rect', {class: 'hit', x: gx, y: top, width: band, height: plotH}));
        for (const sr of series) {
          const v = g.values[sr.key];
          if (isNum(v) && v !== 0) {
            const y0 = Y(0); const y1 = Y(v);
            gg.append(s('path', {d: v > 0 ? roundTop(x, y1, colW, y0 - y1, 4) : `M${x} ${y0}h${colW}v${y1 - y0}h${-colW}z`, style: `fill:${sr.color}${g.projection ? ';fill-opacity:0.45' : ''}`}));
          }
          x += colW + 2;
        }
        if (i % labelEvery === 0) gg.append(s('text', {class: 'tick', x: gx + band / 2, y: height - 8, 'text-anchor': 'middle'}, g.label));
        if (g.tip) bindTip(gg, () => g.tip);
        svg.append(gg);
      });
      return svg;
    };
  }

  /** Acquisition price against each appraisal on one value axis. */
  function valuationStrip(asset) {
    const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
    return (width) => {
      const aps = asset.appraisals.filter((ap) => isNum(ap.value_thb_mn));
      const price = val(asset.acquisition_price_thb_mn);
      const values = aps.map((ap) => ap.value_thb_mn).concat(isNum(price) ? [price] : []);
      const H = 96; const axisY = 52; const pad = 18;
      const svg = s('svg', {class: 'viz', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': 'Acquisition price and appraisal values, THB million'});
      if (!values.length) { svg.append(s('text', {class: 'muted', x: 0, y: 20}, 'No values disclosed')); return svg; }
      let lo = Math.min(...values); let hi = Math.max(...values);
      const spread = Math.max(hi - lo, hi * 0.05);
      lo -= spread * 0.6; hi += spread * 0.6;
      const X = (v) => pad + ((v - lo) / (hi - lo)) * (width - 2 * pad);
      svg.append(s('line', {class: 'axis', x1: pad, x2: width - pad, y1: axisY, y2: axisY}));
      for (const t of ticksBetween(lo, hi, width < 420 ? 3 : 5)) {
        svg.append(s('line', {class: 'axis', x1: X(t), x2: X(t), y1: axisY, y2: axisY + 4}));
        svg.append(s('text', {class: 'tick', x: X(t), y: H - 4, 'text-anchor': 'middle'}, num(t)));
      }
      aps.forEach((ap, i) => {
        const cx = X(ap.value_thb_mn);
        const g = s('g', {class: 'mark', 'aria-label': `${ap.appraiser}: ${mn(ap.value_thb_mn)}`});
        g.append(s('rect', {class: 'hit', x: cx - 14, y: axisY - 40, width: 28, height: 52}));
        g.append(s('circle', {cx, cy: axisY, r: 6, style: `fill:${COLORS[i % 4]};stroke:var(--surface);stroke-width:2`}));
        g.append(s('text', {class: 'end-label', x: cx, y: axisY - 14 - (i % 2) * 14, 'text-anchor': 'middle'}, num(ap.value_thb_mn)));
        bindTip(g, () => ({title: ap.appraiser, rows: [{label: ap.method || 'appraised value', value: mn(ap.value_thb_mn), color: COLORS[i % 4]}]
          .concat(ap.valuation_date ? [{label: 'valuation date', value: fmtDate(ap.valuation_date)}] : [])}));
        svg.append(g);
      });
      if (isNum(price)) {
        const px = X(price);
        const g = s('g', {class: 'mark', 'aria-label': `Acquisition price: ${mn(price)}`});
        g.append(s('rect', {class: 'hit', x: px - 14, y: axisY - 14, width: 28, height: 42}));
        g.append(s('line', {class: 'marker', x1: px, x2: px, y1: axisY - 11, y2: axisY + 11}));
        g.append(s('text', {class: 'end-label', x: px, y: axisY + 25, 'text-anchor': 'middle'}, `price ${num(price)}`));
        bindTip(g, () => ({title: 'Acquisition price (max)', rows: [{label: 'THB million', value: num(price, 1)}]}));
        svg.append(g);
      }
      return svg;
    };
  }

  /** Leasehold components on a year axis, with today. */
  function tenureChart(components) {
    return (width) => {
      const dated = components.filter((c) => toTime(c.expiry_date) || toTime(c.start_date));
      const label = Math.round(Math.min(130, Math.max(84, width * 0.24)));
      const rowH = 26; const top = 22; const axisH = 20; const endPad = 14;
      const now = toTime(TODAY);
      const ts = dated.flatMap((c) => [toTime(c.start_date), toTime(c.expiry_date)]).filter(isNum).concat(isNum(now) ? [now] : []);
      const y0 = new Date(Math.min(...ts)).getUTCFullYear();
      const y1 = new Date(Math.max(...ts)).getUTCFullYear() + 1;
      const t0 = Date.UTC(y0, 0, 1); const t1 = Date.UTC(y1, 0, 1);
      const plotW = Math.max(60, width - label - endPad);
      const X = (t) => label + ((t - t0) / (t1 - t0)) * plotW;
      const H = top + dated.length * rowH + axisH;
      const svg = s('svg', {class: 'viz', width, height: H, viewBox: `0 0 ${width} ${H}`, role: 'group', 'aria-label': 'Tenure of each component'});
      const span = y1 - y0;
      const step = [1, 2, 5, 10, 20, 25].find((st) => span / st <= Math.max(2, Math.floor(plotW / 56))) || 50;
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const x = X(Date.UTC(y, 0, 1));
        svg.append(s('line', {class: 'grid', x1: x, x2: x, y1: top, y2: top + dated.length * rowH}));
        svg.append(s('text', {class: 'tick', x, y: H - 5, 'text-anchor': 'middle'}, String(y)));
      }
      if (isNum(now)) {
        svg.append(s('line', {class: 'today', x1: X(now), x2: X(now), y1: top - 6, y2: top + dated.length * rowH}));
        svg.append(s('text', {class: 'today-label', x: X(now), y: 11, 'text-anchor': 'middle'}, 'Today'));
      }
      dated.forEach((c, i) => {
        const cy = top + i * rowH + rowH / 2;
        const a = toTime(c.start_date); const b = toTime(c.expiry_date);
        const g = s('g', {class: 'mark', 'aria-label': `${c.component}: ${fmtDate(c.start_date)} to ${fmtDate(c.expiry_date)}`});
        g.append(s('rect', {class: 'hit', x: 0, y: top + i * rowH, width, height: rowH}));
        g.append(s('text', {class: 'row-label', x: label - 10, y: cy, 'text-anchor': 'end', 'dominant-baseline': 'central'}, c.component.length > 18 ? `${c.component.slice(0, 17)}…` : c.component));
        const xa = X(isNum(a) ? a : t0); const xb = X(isNum(b) ? b : t1);
        g.append(s('rect', {x: xa, y: cy - 5, width: Math.max(3, xb - xa), height: 10, rx: 3, style: `fill:var(--s1)${isNum(a) && isNum(b) ? '' : ';fill-opacity:0.45'}`}));
        const left = isNum(b) && isNum(now) ? (b - now) / (365.25 * 864e5) : null;
        bindTip(g, () => ({title: `${c.component} · ${c.right}`, rows: [
          {label: 'start', value: fmtDate(c.start_date)}, {label: 'expiry', value: fmtDate(c.expiry_date)},
          ...(isNum(c.tenure_years) ? [{label: 'tenure', value: years(c.tenure_years)}] : []),
          ...(isNum(left) ? [{label: 'remaining', value: years(Math.round(left * 10) / 10)}] : []),
        ]}));
        svg.append(g);
      });
      return svg;
    };
  }

  /* ------------------------------------------------------------------ rail */
  function renderRail(activeId) {
    rail.replaceChildren(
      h('a', {class: 'brand', href: '#/', 'aria-label': 'Thai REIT Deal Docket, overview'},
        h('span', {class: 'brand-mark', 'aria-hidden': 'true', text: '69'}),
        h('span', {class: 'brand-text'}, h('b', {text: 'REIT Deal Docket'}), h('small', {text: 'Thai SEC Form 69-REIT filings'}))),
      h('a', {class: `rail-link${activeId ? '' : ' is-active'}`, href: '#/', 'aria-current': activeId ? null : 'page'}, 'Overview', h('span', {class: 'rail-count', text: String(ORDER.length)})),
      h('div', {class: 'rail-head', text: 'Filings'}),
      h('ul', {class: 'rail-list'}, ORDER.map((id) => {
        const f = FIL[id]; const sm = SUM[id] || {};
        return h('li', null, h('a', {class: `rail-item${id === activeId ? ' is-active' : ''}`, href: `#/reit/${id}`, 'aria-current': id === activeId ? 'page' : null},
          h('span', {class: 'rail-ticker', text: f.filing.ticker}),
          typeTag(f.filing.offering_type),
          h('span', {class: 'rail-meta'}, h('span', null, stagePill(sm.sec_status, true), ' ', ((sm.sec_status && STAGE[sm.sec_status.stage]) || {label: 'not checked'}).label),
            h('span', {class: 'rail-size', text: mnShort(sm.metrics && sm.metrics.total_investment_thb_mn)}))));
      })),
      h('p', {class: 'rail-foot'}, `Data built ${fmtDate((DATA.generated_at || '').slice(0, 10))}`, h('br'), `SEC status ${A.status_fetched_at ? fmtDate(A.status_fetched_at.slice(0, 10)) : 'not checked'}`),
    );
  }

  /* ------------------------------------------------------------------ overview */
  const view = {type: 'all', sector: 'all'};

  function kpi(label, value, sub, hero) {
    return h('div', {class: `kpi${hero ? ' is-hero' : ''}`}, h('p', {class: 'kpi-label', text: label}), h('p', {class: 'kpi-value', text: value}), sub ? h('p', {class: 'kpi-sub', text: sub}) : null);
  }
  function linkTickers(text, ids) {
    const map = new Map((ids || []).filter((id) => FIL[id]).map((id) => [FIL[id].filing.ticker, id]));
    if (!map.size) return text;
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(${[...map.keys()].sort((a, b) => b.length - a.length).map(esc).join('|')})\\b`, 'g');
    const out = [];
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      out.push(text.slice(last, m.index), h('a', {class: 'tick-link', href: `#/reit/${map.get(m[1])}`, text: m[1]}));
      last = m.index + m[1].length;
    }
    out.push(text.slice(last));
    return out;
  }
  function segmented(name, options, current, onChange) {
    return h('div', {class: 'seg', role: 'radiogroup', 'aria-label': name},
      options.map(([value, label]) => frag(
        h('input', {type: 'radio', name, id: `${name}-${value}`, value, checked: current === value, onchange: () => onChange(value)}),
        h('label', {for: `${name}-${value}`, text: label}))));
  }

  function renderOverview() {
    const all = ORDER.map((id) => SUM[id]).filter(Boolean);
    const T = A.totals || {};
    const M = (r) => r.metrics || {};
    const rows = all.filter((r) => (view.type === 'all' || r.offering_type === view.type) && (view.sector === 'all' || r.sector === view.sector));
    const open = all.filter((r) => r.sec_status && r.sec_status.stage === 'offering').length;
    const sectors = [...new Set(all.map((r) => r.sector))].sort((a, b) => SECTORS.indexOf(a) - SECTORS.indexOf(b));
    const href = (r) => `#/reit/${r.filing_id}`;

    const head = h('header', {class: 'page-head'},
      h('p', {class: 'eyebrow', text: 'Thai SEC · Form 69-REIT offering filings'}),
      h('h1', {class: 'display', text: `${countWord(T.filings ?? all.length)} filings, ${mn(T.total_investment_thb_mn)} of property`}),
      h('p', {class: 'lede'},
        `${plural(T.ipo ?? 0, 'IPO')} and ${plural(T.po ?? 0, 'PO')} with the SEC. Figures come only from the Word filings, and each one carries its prospectus section, like `,
        h('span', {class: 'cite cite-demo', 'aria-hidden': 'true'}, 'P1', h('span', {class: 'cite-line', text: '13'})),
        ' — open a chip to read the Thai source line.'),
      h('p', {class: 'stamp', text: `SEC status ${A.status_fetched_at ? `checked ${fmtDate(A.status_fetched_at.slice(0, 10))}` : 'not checked'} · data built ${fmtDate((DATA.generated_at || '').slice(0, 10))}`}),
    );

    const kpis = h('section', {class: 'kpis', 'aria-label': 'Pipeline totals'},
      kpi('Property to be acquired, at most', mn(T.total_investment_thb_mn), `${plural(T.new_assets ?? 0, 'asset')} across ${plural(T.filings ?? 0, 'filing')}`, true),
      kpi('New units, at most', mn(T.new_equity_thb_mn), 'sum of maximum offering sizes'),
      kpi('New borrowings, at most', mn(T.new_debt_thb_mn), 'debt raised for the acquisitions'),
      kpi('Offers open', String(open), `subscription running on ${fmtDate(TODAY)}`),
    );

    const insights = section('insights', 'What stands out', 'Generated from the extracted data across all filings; rebuilt on every pipeline run.',
      (A.insights || []).length
        ? h('ul', {class: 'insight-list'}, A.insights.map((ins) => h('li', {class: 'insight'}, h('span', {class: 'insight-kind', text: KIND[ins.kind] || ins.kind}), h('p', null, linkTickers(ins.text, ins.filings)))))
        : h('p', {class: 'nf', text: 'No insights yet.'}));

    const filters = h('div', {class: 'filters', role: 'group', 'aria-label': 'Filter the charts and table'},
      h('span', null, h('span', {class: 'filter-label', text: 'Offering'}), segmented('f-type', [['all', 'All'], ['IPO', 'IPO'], ['PO', 'PO']], view.type, (v) => { view.type = v; rerender('f-type-' + v); })),
      h('label', {class: 'select', for: 'f-sector'}, 'Sector',
        h('select', {id: 'f-sector', onchange: (e) => { view.sector = e.target.value; rerender('f-sector'); }},
          h('option', {value: 'all', text: 'All sectors', selected: view.sector === 'all'}),
          sectors.map((sc) => h('option', {value: sc, text: sc, selected: view.sector === sc})))),
      h('p', {class: 'filter-note', text: `${rows.length} of ${plural(all.length, 'filing')} shown below`}),
    );

    const none = (what) => h('p', {class: 'nf', text: `No filing in this selection discloses ${what}.`});

    // Deal size & funding
    const FUND = {new_units: {label: 'New units', color: 'var(--s1)'}, debt: {label: 'Borrowings', color: 'var(--s2)'}, other: {label: 'Cash, deposits, other', color: 'var(--s3)'}};
    const bySize = [...rows].sort((a, b) => (M(b).total_investment_thb_mn || 0) - (M(a).total_investment_thb_mn || 0));
    const fundRows = bySize.map((r) => {
      const fm = M(r).funding_thb_mn || {};
      const other = ['internal_cash', 'security_deposits', 'other'].reduce((a, k) => a + (fm[k] || 0), 0);
      const parts = [
        {key: 'new_units', value: fm.new_units ?? M(r).offering_size_thb_mn ?? 0},
        {key: 'debt', value: fm.debt ?? M(r).new_debt_thb_mn ?? 0},
        {key: 'other', value: other},
      ];
      return {
        label: r.ticker, href: href(r), parts, marker: M(r).total_investment_thb_mn, end: mnShort(M(r).total_investment_thb_mn),
        tip: {title: `${r.ticker} · ${r.offering_type}`, rows: parts.filter((p) => p.value > 0).map((p) => ({label: FUND[p.key].label, value: mn(p.value), color: FUND[p.key].color}))
          .concat([{label: 'total investment', value: mn(M(r).total_investment_thb_mn)}])},
      };
    });
    const dealCard = card('Deal size and funding', 'THB million, maximums on each cover page. The tick marks total investment value.',
      fundRows.length ? chart(hbar({rows: fundRows, keys: FUND})) : none('deal size'),
      {extra: [legend([...Object.values(FUND), {label: 'Total investment', color: 'var(--ink)', shape: 'tick'}]),
        twin([{key: 'r', label: 'REIT', render: (x) => x.label}, {key: 'u', label: 'New units', num: true, render: (x) => num(x.parts[0].value)},
          {key: 'd', label: 'Borrowings', num: true, render: (x) => num(x.parts[1].value)}, {key: 'o', label: 'Cash & other', num: true, render: (x) => num(x.parts[2].value)},
          {key: 't', label: 'Total investment', num: true, render: (x) => num(x.marker)}], fundRows)]});

    // Price vs lower appraisal
    const apprRows = rows.filter((r) => isNum(M(r).price_vs_low_appraisal_pct)).sort((a, b) => M(a).price_vs_low_appraisal_pct - M(b).price_vs_low_appraisal_pct)
      .map((r) => ({label: r.ticker, href: href(r), value: M(r).price_vs_low_appraisal_pct, tip: {title: r.ticker, rows: [
        {label: 'vs lower appraisal', value: signed(M(r).price_vs_low_appraisal_pct)},
        {label: 'price compared', value: mn(M(r).acquisition_total_thb_mn ?? M(r).total_investment_thb_mn)},
        {label: 'lower appraisals, summed', value: mn(M(r).appraisal_low_total_thb_mn)},
      ].concat(M(r).price_vs_low_appraisal_basis ? [{label: '', value: `basis: ${M(r).price_vs_low_appraisal_basis}`}] : [])}}));
    const apprCard = card('Price against the lower appraisal', 'Maximum asset prices (or the deal cap, where only that is given) vs the lower independent appraisal of each asset, summed.',
      apprRows.length ? chart(diverging({rows: apprRows})) : none('per-asset appraisals'),
      {extra: [legend([{label: 'Below lower appraisal', color: 'var(--div-neg)'}, {label: 'Above lower appraisal', color: 'var(--div-pos)'}]),
        twin([{key: 'r', label: 'REIT', render: (x) => x.label}, {key: 'v', label: 'vs lower appraisal', num: true, render: (x) => signed(x.value)}], apprRows)]});

    // Timeline
    const tlRows = rows.filter((r) => r.sec_status).map((r) => {
      const st = r.sec_status;
      return {label: r.ticker, href: href(r), filed: st.first_filed, amended: st.last_amended, effective: st.effective, start: st.offer_start, end: st.offer_end, stageLabel: (STAGE[st.stage] || {}).label};
    });
    const tlCard = card('SEC filing timeline', 'From first filing to the end of the offer period, as listed on the SEC filing page.',
      tlRows.length ? chart(timeline({rows: tlRows})) : none('SEC dates'),
      {wide: true, extra: [legend([{label: 'First filed', color: 'var(--ink-3)', shape: 'ring'}, {label: 'Last amended', color: 'var(--ink-3)', shape: 'dot'},
        {label: 'Effective', color: 'var(--s1)', shape: 'dot'}, {label: 'Offer period', color: 'var(--s3)'}, {label: 'Today', color: 'var(--accent)', shape: 'tick'}]),
      twin([{key: 'r', label: 'REIT', render: (x) => x.label}, {key: 's', label: 'Stage', render: (x) => x.stageLabel || '—'}, {key: 'f', label: 'Filed', render: (x) => fmtDate(x.filed)},
        {key: 'a', label: 'Amended', render: (x) => fmtDate(x.amended)}, {key: 'e', label: 'Effective', render: (x) => fmtDate(x.effective)},
        {key: 'o', label: 'Offer', render: (x) => (x.start ? `${fmtDate(x.start)} – ${fmtDate(x.end)}` : '—')}], tlRows)]});

    // Leverage
    const ltvRows = rows.filter((r) => isNum(M(r).ltv_after_pct)).sort((a, b) => M(b).ltv_after_pct - M(a).ltv_after_pct)
      .map((r) => ({label: r.ticker, href: href(r), before: M(r).ltv_before_pct, after: M(r).ltv_after_pct, limit: M(r).ltv_limit_pct,
        tip: {title: r.ticker, rows: [{label: 'before', value: pct(M(r).ltv_before_pct, 1)}, {label: 'after', value: pct(M(r).ltv_after_pct, 1)}, {label: 'limit', value: pct(M(r).ltv_limit_pct, 0)}]}}));
    const ltvCard = card('Leverage before and after', 'Borrowings as a share of total assets, against each trust’s stated limit.',
      ltvRows.length ? chart(dumbbell({rows: ltvRows})) : none('post-deal LTV'),
      {extra: [legend([{label: 'Before', color: 'var(--seq-light)', shape: 'dot'}, {label: 'After', color: 'var(--s1)', shape: 'dot'}, {label: 'Limit', color: 'var(--ink-2)', shape: 'tick'}]),
        twin([{key: 'r', label: 'REIT', render: (x) => x.label}, {key: 'b', label: 'Before', num: true, render: (x) => pct(x.before, 1)}, {key: 'a', label: 'After', num: true, render: (x) => pct(x.after, 1)}, {key: 'l', label: 'Limit', num: true, render: (x) => pct(x.limit, 0)}], ltvRows)]});

    // Yield
    const yRows = rows.filter((r) => isNum(M(r).projected_yield_pct)).sort((a, b) => M(b).projected_yield_pct - M(a).projected_yield_pct)
      .map((r) => ({label: r.ticker, href: href(r), parts: [{key: 'y', value: M(r).projected_yield_pct}], end: pct(M(r).projected_yield_pct),
        tip: {title: r.ticker, rows: [{label: 'projected yield', value: pct(M(r).projected_yield_pct)}, {label: 'projected DPU', value: thb(M(r).projected_dpu_thb, 4)},
          {label: 'basis price', value: thb(M(r).yield_basis_price_thb)}].concat(M(r).projection_period ? [{label: '', value: M(r).projection_period}] : [])}}));
    const yieldCard = card('Projected distribution yield', 'First projection period, each on its own filing’s basis price.',
      yRows.length ? chart(hbar({rows: yRows, keys: {y: {label: 'Yield', color: 'var(--s1)'}}, tick: (t) => `${num(t)}%`, endPad: 56})) : none('a projected yield'),
      {extra: [twin([{key: 'r', label: 'REIT', render: (x) => x.label}, {key: 'y', label: 'Projected yield', num: true, render: (x) => x.end}], yRows)]});

    // Sector
    const sectorTotals = sectors.map((sc) => ({sector: sc, value: rows.filter((r) => r.sector === sc).reduce((a, r) => a + (M(r).total_investment_thb_mn || 0), 0), count: rows.filter((r) => r.sector === sc).length})).filter((x) => x.count);
    const sectorSum = sectorTotals.reduce((a, x) => a + x.value, 0);
    const sectorKeys = Object.fromEntries(sectorTotals.map((x) => [x.sector, {label: x.sector, color: sectorColor(x.sector)}]));
    const sectorCard = card('Deal value by sector', 'Total investment value, THB million.',
      sectorSum > 0 ? chart(hbar({rows: [{label: 'All deals', parts: sectorTotals.map((x) => ({key: x.sector, value: x.value})), end: mnShort(sectorSum),
        tip: {title: 'Deal value by sector', rows: sectorTotals.map((x) => ({label: `${x.sector} · ${plural(x.count, 'filing')}`, value: `${mn(x.value)} (${pct((x.value / sectorSum) * 100, 0)})`, color: sectorColor(x.sector)}))}}],
      keys: sectorKeys, label: 72, rowH: 40, barH: 20})) : none('deal values'),
      {extra: [legend(sectorTotals.map((x) => ({label: `${x.sector} · ${pct((x.value / (sectorSum || 1)) * 100, 0)}`, color: sectorColor(x.sector)}))),
        twin([{key: 's', label: 'Sector', render: (x) => x.sector}, {key: 'n', label: 'Filings', num: true, render: (x) => num(x.count)}, {key: 'v', label: 'THB m', num: true, render: (x) => num(x.value)}], sectorTotals)]});

    // Comparison table
    const table = dataTable({
      caption: 'Comparison of all filings',
      sort: {key: 'tiv', dir: -1},
      onRow: (r) => { location.hash = href(r); },
      rows,
      columns: [
        {key: 'reit', label: 'REIT', cls: 'ticker-cell', get: (r) => r.ticker, render: (r) => frag(h('a', {href: href(r), text: r.ticker}), h('span', {class: 'detail', text: r.name_en || ''}))},
        {key: 'type', label: 'Type', get: (r) => r.offering_type, render: (r) => typeTag(r.offering_type)},
        {key: 'sector', label: 'Sector', get: (r) => r.sector, render: (r) => sectorTag(r.sector)},
        {key: 'stage', label: 'SEC stage', get: (r) => (r.sec_status ? r.sec_status.stage : null), render: (r) => stagePill(r.sec_status)},
        {key: 'tiv', label: 'Investment THB m', num: true, get: (r) => M(r).total_investment_thb_mn, render: (r) => num(M(r).total_investment_thb_mn)},
        {key: 'eq', label: 'New units THB m', num: true, get: (r) => M(r).new_equity_thb_mn, render: (r) => num(M(r).new_equity_thb_mn)},
        {key: 'debt', label: 'New debt THB m', num: true, get: (r) => M(r).new_debt_thb_mn, render: (r) => num(M(r).new_debt_thb_mn)},
        {key: 'price', label: 'Max price THB', num: true, get: (r) => M(r).price_max_thb, render: (r) => num(M(r).price_max_thb, 2)},
        {key: 'yield', label: 'Proj. yield', num: true, get: (r) => M(r).projected_yield_pct, render: (r) => pct(M(r).projected_yield_pct)},
        {key: 'ltv', label: 'LTV after', num: true, get: (r) => M(r).ltv_after_pct, render: (r) => pct(M(r).ltv_after_pct, 1)},
        {key: 'appr', label: 'vs lower appraisal', num: true, get: (r) => M(r).price_vs_low_appraisal_pct, render: (r) => signed(M(r).price_vs_low_appraisal_pct)},
        {key: 'assets', label: 'New assets', num: true, get: (r) => M(r).new_asset_count, render: (r) => num(M(r).new_asset_count)},
        {key: 'pnav', label: 'P/NAV', num: true, get: (r) => (M(r).existing || {}).price_to_nav, render: (r) => (isNum((M(r).existing || {}).price_to_nav) ? `${num(M(r).existing.price_to_nav, 2)}×` : '—')},
        {key: 'found', label: 'Fields found', num: true, get: (r) => (r.completeness || {}).found_pct, render: (r) => pct((r.completeness || {}).found_pct, 0)},
      ],
    });

    main.replaceChildren(head, kpis, insights, filters,
      h('div', {class: 'chart-grid'}, dealCard, apprCard, tlCard, ltvCard, yieldCard, sectorCard),
      section('compare', 'Side by side', 'Click a column to sort; click a row to open the deal file. Maximums unless a final price is announced.', h('div', {class: 'card'}, table)));
  }

  function rerender(focusId) {
    teardown();
    renderOverview();
    const el = focusId && document.getElementById(focusId);
    if (el) el.focus({preventScroll: true});
  }

  /* ------------------------------------------------------------------ deal file */
  function renderReit(id) {
    const f = FIL[id];
    const sm = SUM[id] || {metrics: {}, checks: [], completeness: {}};
    currentFiling = id;
    main.replaceChildren(...[
      dealHead(f, sm), jumpNav(f), termSheet(f, sm), partiesBlock(f), proceedsBlock(f), assetsBlock(f, sm),
      f.existing_portfolio ? portfolioBlock(f, sm) : null, risksBlock(f), notesBlock(f), qualityBlock(f, sm),
    ].filter(Boolean));
    document.title = `${f.filing.ticker} · Thai REIT Deal Docket`;
  }

  function lifecycle(sec) {
    if (!sec) return h('p', {class: 'meta', text: 'SEC filing status has not been checked yet.'});
    if (sec.stage === 'unlisted') return h('p', {class: 'meta', text: 'Not found on the SEC filing list when status was checked.'});
    const steps = [['Filed', sec.first_filed], ['Amended', sec.last_amended], ['Effective', sec.effective], ['Offer opens', sec.offer_start], ['Offer closes', sec.offer_end]];
    return h('ol', {class: 'lifecycle', 'aria-label': 'SEC filing lifecycle'}, steps.map(([label, d]) => {
      const state = d ? (d <= TODAY ? 'done' : 'next') : 'pending';
      return h('li', {class: `step is-${state}`}, h('span', {class: 'step-dot', 'aria-hidden': 'true'}), h('span', {class: 'step-label', text: label}), h('span', {class: 'step-date', text: d ? fmtDate(d) : '—'}));
    }));
  }

  function dealHead(f, sm) {
    const fil = f.filing;
    const sec = sm.sec_status;
    const asOf = val(fil.data_as_of);
    return h('header', {class: 'deal-head'},
      h('a', {class: 'back', href: '#/'}, '← All filings'),
      h('div', {class: 'deal-id'},
        h('h1', {class: 'ticker', text: fil.ticker}),
        h('div', {class: 'deal-names'},
          h('p', {class: 'name-en'}, V(fil.reit_name_en)),
          val(fil.reit_name_th) ? h('p', {class: 'name-th', lang: 'th', text: val(fil.reit_name_th)}) : null)),
      h('div', {class: 'tags'},
        typeTag(fil.offering_type), sectorTag(f.sector.primary), stagePill(sec),
        isNum(val(fil.additional_investment_no)) ? h('span', {class: 'tag', text: `Additional investment no. ${val(fil.additional_investment_no)}`}) : null,
        isNum(val(fil.capital_increase_no)) ? h('span', {class: 'tag', text: `Capital increase no. ${val(fil.capital_increase_no)}`}) : null),
      val(f.sector.description) ? h('p', {class: 'lede'}, V(f.sector.description)) : null,
      lifecycle(sec),
      h('p', {class: 'meta'},
        h('span', {class: 'mono', text: fil.filing_id}),
        asOf ? ` · data as of ${fmtDate(asOf)}${beYear(asOf) ? ` (พ.ศ. ${beYear(asOf)})` : ''}` : '',
        ` · latest document ${fmtDate(fil.latest_document_date)}`,
        sec && sec.detail_url ? frag(' · ', h('a', {href: sec.detail_url, target: '_blank', rel: 'noopener noreferrer', text: 'SEC filing page ↗'})) : null),
    );
  }

  function jumpNav(f) {
    const items = [
      ['terms', 'Deal terms'], ['parties', 'Parties'], ['assets', `New assets · ${f.new_assets.length}`],
      f.existing_portfolio ? ['portfolio', `Existing portfolio · ${f.existing_portfolio.assets.length}`] : null,
      ['risks', `Risks · ${f.risks.length}`], ['notes', 'Analyst notes'], ['quality', 'Data quality'],
    ].filter(Boolean);
    return h('nav', {class: 'jump', 'aria-label': 'Sections of this deal file'}, items.map(([target, label]) => h('button', {type: 'button', onclick: () => scrollToId(target), text: label})));
  }

  function priceRange(p) {
    const lo = val(p.min_thb); const hi = val(p.max_thb); const fin = val(p.final_thb);
    if (isNum(fin)) return frag(V(p.final_thb, thb), h('span', {class: 'hint', text: ' final'}));
    if (isNum(lo) && isNum(hi) && lo !== hi) return h('span', {class: 'pair'}, V(p.min_thb, thb), '–', V(p.max_thb, thb));
    if (isNum(hi)) return frag(h('span', {class: 'hint', text: 'up to '}), V(p.max_thb, thb));
    return V(p.max_thb, thb);
  }

  function termSheet(f, sm) {
    const off = f.offering; const cap = f.capital_structure; const pd = off.projected_distribution; const m = sm.metrics || {};
    const facts = [
      ['Units offered, max', V(off.units_offered_max, unitsFmt)],
      ['Offer price', priceRange(off.offering_price_per_unit)],
      ['Offering size, max', V(off.offering_size_thb_mn, mn)],
      ['Total investment, max', V(off.total_investment_value_thb_mn, mn)],
      ['New borrowings, max', V(cap.new_borrowings_thb_mn, mn)],
      ['Transaction costs, est.', V(off.estimated_transaction_costs_thb_mn, mn)],
      ['Projected DPU', V(pd.dpu_thb, (x) => thb(x, 4))],
      ['Projected yield', V(pd.distribution_yield_pct, pct)],
      ['Yield basis price', V(pd.basis_price_thb, thb)],
      ['LTV before → after', pair(cap.ltv_before_pct, cap.ltv_after_pct, (x) => pct(x, 1))],
      ['LTV limit', V(cap.ltv_limit_pct, (x) => pct(x, 0))],
      ['Units before → after', pair(cap.units_outstanding_before, cap.units_outstanding_after_max, unitsFmt)],
      ['NAV per unit', V(cap.nav_per_unit_thb, (x) => thb(x, 4))],
      ['Par value', V(off.par_value_per_unit_thb, (x) => thb(x, 4))],
    ];
    const prose = [
      ['Projection period', pd.projection_period], ['Investors', f.filing.investor_eligibility], ['Subscription ratio', off.subscription_ratio],
      ['Sponsor commitment', off.sponsor_commitment], ['Trust structure', f.filing.reit_structure], ['Listing', f.filing.listing],
      ['Unitholder approval', f.filing.unitholder_approval_date, fmtDate], ['Loan terms', cap.loan_terms], ['Effect on the enlarged trust', pd.pro_forma_note],
    ].filter(([, o]) => isSV(o) && o.status !== 'not_applicable');

    const FK = {new_units: {label: 'New units', color: 'var(--s1)'}, debt: {label: 'Borrowings', color: 'var(--s2)'}, internal_cash: {label: 'Internal cash', color: 'var(--s3)'},
      security_deposits: {label: 'Security deposits', color: 'var(--s4)'}, other: {label: 'Other', color: 'var(--ink-3)'}};
    const fund = m.funding_thb_mn || {};
    const parts = Object.keys(FK).filter((k) => isNum(fund[k]) && fund[k] > 0).map((k) => ({key: k, value: fund[k]}));
    const fundTotal = parts.reduce((a, p) => a + p.value, 0);
    const fundingCard = parts.length ? card('Funding sources', 'Maximum amounts on the cover page; the tick marks total investment value.',
      chart(hbar({rows: [{label: 'Sources', parts, marker: m.total_investment_thb_mn, end: mnShort(fundTotal),
        tip: {title: 'Funding sources, max', rows: parts.map((p) => ({label: FK[p.key].label, value: mn(p.value), color: FK[p.key].color})).concat(isNum(m.total_investment_thb_mn) ? [{label: 'total investment', value: mn(m.total_investment_thb_mn)}] : [])}}],
      keys: FK, label: 64, rowH: 40, barH: 18})),
      {extra: [legend(parts.map((p) => FK[p.key]).concat(isNum(m.total_investment_thb_mn) ? [{label: 'Total investment', color: 'var(--ink)', shape: 'tick'}] : [])),
        h('ul', {class: 'comp-list'}, off.funding_sources.map((fs) => h('li', null, h('b', {text: (FK[fs.type] || {label: fs.type}).label}), ' ', V(fs.amount_thb_mn, mn), fs.note ? h('span', {class: 'detail', text: fs.note}) : null)))]}) : null;

    const checks = (sm.checks || []).length ? frag(h('h3', {class: 'mini-title', text: 'Consistency checks'}),
      h('ul', {class: 'check-list'}, sm.checks.map((c) => h('li', {class: 'check'}, resultPill(c.result), h('div', null, h('p', {class: 'check-label', text: c.label}), h('p', {class: 'check-detail', text: c.detail})))))) : null;

    return section('terms', 'Deal terms', 'Maximums unless a final figure is announced. “draft” marks a bracketed figure; “calc” a figure derived from stated ones.',
      h('dl', {class: 'facts'}, facts.map(([k, v]) => h('div', {class: 'fact'}, h('dt', {text: k}), h('dd', null, v)))),
      prose.length ? h('dl', {class: 'prose'}, prose.map(([k, o, fmt]) => h('div', null, h('dt', {text: k}), h('dd', null, V(o, fmt))))) : null,
      fundingCard ? h('div', {style: 'margin-top:20px'}, fundingCard) : null,
      checks);
  }

  function partiesBlock(f) {
    const p = f.parties;
    const groups = ROLES.map(([key, label]) => {
      const list = Array.isArray(p[key]) ? p[key] : p[key] ? [p[key]] : [];
      if (!list.length) return null;
      return h('div', {class: 'role'}, h('dt', {text: label}), list.map((x) => h('dd', null,
        h('span', {class: 'party', text: x.name_en}),
        x.related_to_sponsor ? h('span', {class: 'badge', title: 'Related to the sponsor', text: 'sponsor group'}) : null,
        cite(x.source, x),
        x.name_th ? h('span', {class: 'th', lang: 'th', text: x.name_th}) : null,
        x.role_detail ? h('span', {class: 'detail', text: x.role_detail}) : null)));
    }).filter(Boolean);
    return section('parties', 'Parties', null,
      groups.length ? h('dl', {class: 'roles'}, groups) : h('p', {class: 'nf', text: 'No parties named in the text filings.'}),
      (p.not_found_roles || []).length ? h('p', {class: 'foot', text: `Not named in the text filings: ${p.not_found_roles.join(', ')}.`}) : null);
  }

  function proceedsBlock(f) {
    const o = f.offering;
    const parts = [];
    if (o.use_of_proceeds.length) {
      parts.push(h('div', null, h('h3', {class: 'mini-title', text: 'Use of proceeds'}), dataTable({rows: o.use_of_proceeds, columns: [
        {key: 'i', label: 'Item', render: (r) => frag(r.item, r.note ? h('span', {class: 'detail', text: r.note}) : null)},
        {key: 'a', label: 'THB m', num: true, render: (r) => frag(num(r.amount_thb_mn, 1), cite(r.source, r))},
      ]})));
    }
    if (o.allocation.length) {
      parts.push(h('div', null, h('h3', {class: 'mini-title', text: 'Allocation'}), dataTable({rows: o.allocation, columns: [
        {key: 't', label: 'Tranche', render: (r) => frag(r.tranche, r.note ? h('span', {class: 'detail', text: r.note}) : null)},
        {key: 'u', label: 'Units', num: true, render: (r) => num(r.units)},
        {key: 'p', label: '% of offer', num: true, render: (r) => frag(pct(r.pct_of_offer, 1), cite(r.source, r))},
      ]})));
    }
    if (o.timeline.length) {
      parts.push(h('div', null, h('h3', {class: 'mini-title', text: 'Timetable'}), h('ol', {class: 'timetable'}, o.timeline.map((t) => h('li', null,
        h('span', {class: 'tt-date', text: fmtDate(t.date)}),
        h('span', null, t.event, t.indicative ? h('span', {class: 'hint', text: ' (indicative)'}) : null, cite(t.source, t)))))));
    }
    return parts.length ? section('proceeds', 'Proceeds, allocation and timetable', null, h('div', {class: 'split'}, parts)) : null;
  }

  function assetsBlock(f, sm) {
    const assets = f.new_assets;
    const byId = Object.fromEntries(((sm.metrics && sm.metrics.new_assets) || []).map((a) => [a.asset_id, a]));
    const summary = assets.length > 1 ? h('div', {class: 'card', style: 'margin-bottom:8px'}, dataTable({
      rows: assets, sort: {key: 'price', dir: -1}, caption: 'Assets to be acquired',
      columns: [
        {key: 'name', label: 'Asset', get: (a) => a.name_en, render: (a) => h('button', {type: 'button', class: 'link', text: a.name_en, onclick: () => scrollToId(`asset-${a.asset_id}`)})},
        {key: 'type', label: 'Type', get: (a) => a.asset_type, render: (a) => a.asset_type},
        {key: 'prov', label: 'Province', get: (a) => a.location.province, render: (a) => a.location.province || '—'},
        {key: 'ten', label: 'Tenure', get: (a) => val(a.investment_type), render: (a) => val(a.investment_type) || '—'},
        {key: 'price', label: 'Price THB m', num: true, get: (a) => val(a.acquisition_price_thb_mn), render: (a) => num(val(a.acquisition_price_thb_mn), 1)},
        {key: 'low', label: 'Lower appraisal', num: true, get: (a) => (byId[a.asset_id] || {}).appraisal_low_thb_mn, render: (a) => num((byId[a.asset_id] || {}).appraisal_low_thb_mn, 1)},
        {key: 'vs', label: 'vs lower', num: true, get: (a) => (byId[a.asset_id] || {}).price_vs_low_appraisal_pct, render: (a) => signed((byId[a.asset_id] || {}).price_vs_low_appraisal_pct)},
        {key: 'occ', label: 'Occupancy', num: true, get: (a) => (byId[a.asset_id] || {}).occupancy_pct, render: (a) => pct((byId[a.asset_id] || {}).occupancy_pct, 1)},
        {key: 'left', label: 'Years left', num: true, get: (a) => (byId[a.asset_id] || {}).remaining_tenure_years, render: (a) => num((byId[a.asset_id] || {}).remaining_tenure_years, 1)},
      ]})) : null;
    return section('assets', 'New assets', `${plural(assets.length, 'asset')} to be acquired in this transaction.`,
      summary, assets.length ? assets.map((a) => assetSheet(a, byId[a.asset_id] || {})) : h('p', {class: 'nf', text: 'No asset details in the text filings.'}));
  }

  function assetSheet(a, am) {
    const loc = a.location; const ba = a.building_area;
    const where = [loc.subdistrict, loc.district, loc.province].filter(Boolean).join(', ');
    const facts = [
      ['Investment type', V(a.investment_type)],
      ['Tenure', V(a.tenure_years, years)],
      ['Lease expiry', V(a.lease_expiry, fmtDate)],
      ['Land', frag(V(a.land_area, sqm), a.land_area.as_filed ? h('span', {class: 'th', lang: 'th', text: a.land_area.as_filed}) : null)],
      ['Gross floor area', V(ba.gross_sqm, sqm)],
      ['Leasable area', V(ba.leasable_sqm, sqm)],
      isSV(ba.rooms) && ba.rooms.status !== 'not_applicable' ? ['Rooms', V(ba.rooms, (x) => num(x))] : null,
      ['Buildings', V(ba.buildings, (x) => num(x))],
      ['Acquisition price, max', V(a.acquisition_price_thb_mn, mn)],
      ['WALE', V(a.wale_years, (x) => `${num(x, 2)} years`)],
      isSV(a.completion_or_age) && a.completion_or_age.status === 'found' ? ['Completed / age', V(a.completion_or_age)] : null,
      ['Seller / lessor', V(a.seller_or_lessor)],
    ].filter(Boolean);
    return h('article', {class: 'asset', id: `asset-${a.asset_id}`, 'aria-labelledby': `asset-${a.asset_id}-h`},
      h('header', {class: 'asset-head'},
        h('div', null, h('h3', {class: 'asset-name', id: `asset-${a.asset_id}-h`, text: a.name_en}), a.name_th ? h('span', {class: 'th', lang: 'th', text: a.name_th}) : null),
        h('p', {class: 'asset-where'}, a.asset_type, where ? ` · ${where}` : '', loc.zone ? ` · ${loc.zone}` : '', cite(loc.source, loc))),
      h('dl', {class: 'facts is-compact'}, facts.map(([k, v]) => h('div', {class: 'fact'}, h('dt', {text: k}), h('dd', null, v)))),
      h('div', {class: 'asset-grid'}, valuationCard(a, am), tenureCard(a), performanceCard(a), leasingCard(a)),
      (a.notes || []).length ? h('ul', {class: 'notes'}, a.notes.map((n) => h('li', {text: n}))) : null);
  }

  function valuationCard(a, am) {
    const aps = a.appraisals || [];
    const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
    if (!aps.length && !isNum(val(a.acquisition_price_thb_mn))) {
      return card('Price and independent appraisals', null, h('p', {class: 'nf', text: 'No appraisal values in the text filings.'}), {plain: true});
    }
    const valued = aps.filter((ap) => isNum(ap.value_thb_mn));
    return card('Price and independent appraisals',
      isNum(am.price_vs_low_appraisal_pct) ? `The maximum price is ${signed(am.price_vs_low_appraisal_pct)} against the lower appraisal. THB million.` : 'THB million.',
      chart(valuationStrip(a)),
      {extra: [
        legend(valued.map((ap, i) => ({label: ap.appraiser, color: COLORS[i % 4], shape: 'dot'})).concat(isNum(val(a.acquisition_price_thb_mn)) ? [{label: 'Acquisition price, max', color: 'var(--ink)', shape: 'tick'}] : [])),
        aps.length ? dataTable({rows: aps, columns: [
          {key: 'a', label: 'Appraiser', render: (r) => frag(r.appraiser, r.method ? h('span', {class: 'detail', text: r.method}) : null)},
          {key: 'd', label: 'Valued', render: (r) => fmtDate(r.valuation_date)},
          {key: 'v', label: 'THB m', num: true, render: (r) => frag(num(r.value_thb_mn, 1), cite(r.source, r))},
          {key: 'dr', label: 'Discount', num: true, render: (r) => pct(r.discount_rate_pct)},
          {key: 'cr', label: 'Cap rate', num: true, render: (r) => pct(r.terminal_cap_rate_pct)},
        ]}) : null,
        aps.filter((ap) => ap.key_assumptions).map((ap) => h('p', {class: 'assumptions'}, h('b', {text: `${ap.appraiser}: `}), ap.key_assumptions)),
      ]});
  }

  function tenureCard(a) {
    const comps = a.components || [];
    const dated = comps.some((c) => toTime(c.expiry_date) || toTime(c.start_date));
    return card('Tenure', val(a.investment_type) || null,
      dated ? chart(tenureChart(comps)) : null,
      {extra: [comps.length ? h('ul', {class: 'comp-list'}, comps.map((c) => h('li', null,
        h('b', {text: c.component}), ` — ${c.right}`,
        isNum(c.tenure_years) ? `, ${years(c.tenure_years)}` : '',
        c.start_date || c.expiry_date ? `, ${c.start_date ? fmtDate(c.start_date) : '?'} → ${c.expiry_date ? fmtDate(c.expiry_date) : '?'}` : '',
        cite(c.source, c),
        c.renewal_option ? h('span', {class: 'detail', text: `Renewal: ${c.renewal_option}`}) : null))) : h('p', {class: 'nf', text: 'No tenure components in the text filings.'})]});
  }

  function performanceCard(a) {
    const rows = a.historical_performance || [];
    const occ = a.occupancy || [];
    if (!rows.length && !occ.length) return card('Operating history', null, h('p', {class: 'nf', text: 'No asset-level operating history in the text filings.'}), {plain: true});
    const noiName = (rows.find((r) => r.noi_definition) || {}).noi_definition || 'NOI';
    const series = [{key: 'revenue_thb_mn', label: 'Revenue', color: 'var(--s1)'}, {key: 'noi_thb_mn', label: noiName, color: 'var(--s2)'}].filter((sr) => rows.some((r) => isNum(r[sr.key])));
    const groups = rows.map((r) => ({label: r.period, projection: r.is_projection, values: Object.fromEntries(series.map((sr) => [sr.key, r[sr.key]])),
      tip: {title: `${r.period}${r.is_projection ? ' · projection' : ''}`, rows: series.map((sr) => ({label: sr.label, value: isNum(r[sr.key]) ? mn(r[sr.key]) : 'not disclosed', color: sr.color}))
        .concat(isNum(r.occupancy_pct) ? [{label: 'occupancy', value: pct(r.occupancy_pct, 1)}] : [])}}));
    const optional = {occ: 'occupancy_pct', adr: 'adr_thb', revpar: 'revpar_thb', rent: 'avg_rent_thb_sqm_month'};
    const columns = [
      {key: 'p', label: 'Period', render: (r) => frag(r.period, r.is_projection ? h('span', {class: 'hint', text: ' proj.'}) : null)},
      {key: 'rev', label: 'Revenue', num: true, render: (r) => num(r.revenue_thb_mn, 1)},
      {key: 'noi', label: noiName, num: true, render: (r) => num(r.noi_thb_mn, 1)},
      {key: 'occ', label: 'Occ.', num: true, render: (r) => pct(r.occupancy_pct, 1)},
      {key: 'adr', label: 'ADR', num: true, render: (r) => num(r.adr_thb)},
      {key: 'revpar', label: 'RevPAR', num: true, render: (r) => num(r.revpar_thb)},
      {key: 'rent', label: 'Rent/sqm/mo', num: true, render: (r) => num(r.avg_rent_thb_sqm_month)},
      {key: 'src', label: '', render: (r) => cite(r.source, r)},
    ].filter((c) => !optional[c.key] || rows.some((r) => isNum(r[optional[c.key]])));
    return card('Operating history', 'THB million; lighter columns are projections.',
      series.length && groups.length ? chart(columnsChart({groups, series})) : null,
      {extra: [
        series.length > 1 ? legend(series.map((sr) => ({label: sr.label, color: sr.color}))) : null,
        rows.length ? dataTable({columns, rows}) : null,
        occ.length ? h('p', {class: 'foot'}, 'Occupancy: ', occ.map((o, i) => frag(i ? '; ' : '', `${pct(o.occupancy_pct, 1)} at ${fmtDate(o.as_of)}${o.basis ? ` (${o.basis})` : ''}`, cite(o.source, o)))) : null,
      ]});
  }

  function leasingCard(a) {
    const tenants = a.key_tenants || [];
    const expiry = a.lease_expiry_profile || [];
    const prose = [['Lease structure', a.lease_structure], ['Rental guarantee', a.rental_guarantee], ['Tenant concentration', a.tenant_concentration], ['Encumbrances', a.encumbrances]]
      .filter(([, o]) => isSV(o) && o.status === 'found' || (isSV(o) && o.status === 'ambiguous'));
    return card('Leases and tenants', null, null, {extra: [
      prose.length ? h('dl', {class: 'prose is-tight'}, prose.map(([k, o]) => h('div', null, h('dt', {text: k}), h('dd', null, V(o))))) : null,
      tenants.length ? dataTable({rows: tenants, columns: [
        {key: 'n', label: 'Tenant', render: (t) => frag(t.name, t.related_to_sponsor ? h('span', {class: 'badge', text: 'sponsor group'}) : null, t.business ? h('span', {class: 'detail', text: t.business}) : null)},
        {key: 'a', label: 'sqm', num: true, render: (t) => num(t.area_sqm)},
        {key: 'pa', label: '% area', num: true, render: (t) => pct(t.pct_of_area, 1)},
        {key: 'pr', label: '% rev.', num: true, render: (t) => pct(t.pct_of_revenue, 1)},
        {key: 'x', label: 'Expiry', render: (t) => frag(fmtDate(t.lease_expiry), cite(t.source, t))},
      ]}) : h('p', {class: 'nf', text: 'No tenant list in the text filings.'}),
      expiry.length ? frag(h('h4', {class: 'mini-title', text: 'Lease expiry profile'}),
        chart(hbar({rows: expiry.map((e) => ({label: e.period, parts: [{key: 'x', value: e.pct || 0}], end: pct(e.pct, 1), tip: {title: e.period, rows: [{label: `of ${e.basis}`, value: pct(e.pct, 1)}]}})),
          keys: {x: {label: 'Share', color: 'var(--s1)'}}, tick: (t) => `${num(t)}%`, label: 96, endPad: 52, rowH: 26, barH: 12}))) : null,
    ]});
  }

  function tile(label, value, sub) {
    return h('div', {class: 'tile'}, h('p', {class: 'tile-label', text: label}), h('p', {class: 'tile-value'}, value), sub ? h('p', {class: 'tile-sub', text: sub}) : null);
  }

  function portfolioBlock(f, sm) {
    const ep = f.existing_portfolio;
    const ex = (sm.metrics && sm.metrics.existing) || {};
    const mp = ep.market_price_per_unit_thb;
    const tiles = h('div', {class: 'tiles'},
      tile('Total assets', V(ep.total_asset_value_thb_mn, mn), val(ep.as_of) ? `as of ${fmtDate(val(ep.as_of))}` : null),
      tile('Latest appraisal, existing assets', V(ep.latest_appraisal_total_thb_mn, mn), null),
      tile('NAV per unit', V(ep.nav_per_unit_thb, (x) => thb(x, 4)), null),
      tile('Market price', V(mp, thb), mp && mp.as_of ? `as of ${fmtDate(mp.as_of)}` : null),
      tile('Price to NAV', isNum(ex.price_to_nav) ? `${num(ex.price_to_nav, 2)}×` : '—', 'market price ÷ NAV per unit'),
      tile('Trailing DPU', isNum(ex.trailing_dpu_thb) ? thb(ex.trailing_dpu_thb, 4) : '—', ex.trailing_dpu_period ? `${ex.trailing_dpu_period}${isNum(ex.trailing_yield_at_market_pct) ? ` · ${pct(ex.trailing_yield_at_market_pct)} at market` : ''}` : null),
      tile('Deal vs trust size', isNum(ex.deal_vs_total_assets_pct) ? pct(ex.deal_vs_total_assets_pct, 1) : '—', 'total investment ÷ total assets'),
      tile('Max offer vs market', isNum(ex.max_offer_vs_market_pct) ? signed(ex.max_offer_vs_market_pct) : '—', 'maximum PO price vs last quoted price'),
    );

    const periods = [];
    const byPeriod = new Map();
    for (const d of ep.historical_dpu || []) {
      if (!isNum(d.dpu_thb)) continue;
      if (!byPeriod.has(d.period)) { byPeriod.set(d.period, []); periods.push(d.period); }
      byPeriod.get(d.period).push(d);
    }
    const dpuGroups = periods.map((p) => {
      const list = byPeriod.get(p);
      const total = list.find((r) => (r.component || '').toLowerCase() === 'total');
      const value = total ? total.dpu_thb : list.reduce((a, r) => a + r.dpu_thb, 0);
      return {label: p, values: {dpu: value}, tip: {title: p, rows: list.map((r) => ({label: r.component || 'distribution', value: thb(r.dpu_thb, 4)}))}};
    });
    const dpuCard = dpuGroups.length ? card('Distributions per unit', 'THB per unit by period, as reported in the filing.',
      chart(columnsChart({groups: dpuGroups, series: [{key: 'dpu', label: 'DPU', color: 'var(--s1)'}], height: 190, tick: (t) => num(t, 2)})),
      {extra: [dataTable({rows: ep.historical_dpu, columns: [
        {key: 'p', label: 'Period', render: (r) => r.period}, {key: 'c', label: 'Component', render: (r) => r.component || '—'},
        {key: 'v', label: 'THB / unit', num: true, render: (r) => frag(num(r.dpu_thb, 4), cite(r.source, r))},
      ]})]}) : null;

    const perf = ep.historical_performance || [];
    const perfCard = perf.length ? card('Operating performance', 'THB million.', dataTable({rows: perf, columns: [
      {key: 'p', label: 'Period', render: (r) => r.period},
      {key: 'r', label: 'Total revenue', num: true, render: (r) => num(r.total_revenue_thb_mn, 1)},
      {key: 'rs', label: 'Rental & service', num: true, render: (r) => num(r.rental_and_service_revenue_thb_mn, 1)},
      {key: 'n', label: 'Net investment income', num: true, render: (r) => num(r.net_investment_income_thb_mn, 1)},
      {key: 'ni', label: 'Net increase in net assets', num: true, render: (r) => num(r.net_increase_in_net_assets_thb_mn, 1)},
      {key: 'o', label: 'Occupancy', num: true, render: (r) => frag(pct(r.occupancy_pct, 1), cite(r.source, r))},
    ]}), {extra: perf.some((r) => r.other_metrics) ? [h('ul', {class: 'notes'}, perf.filter((r) => r.other_metrics).map((r) => h('li', {text: `${r.period}: ${r.other_metrics}`})))] : []}) : null;

    const assetsTable = ep.assets.length ? h('div', {class: 'card'}, dataTable({
      rows: ep.assets, sort: {key: 'appr', dir: -1}, scroll: ep.assets.length > 12, caption: 'Existing assets',
      columns: [
        {key: 'n', label: 'Asset', get: (x) => x.name_en, render: (x) => frag(x.name_en, x.name_th ? h('span', {class: 'th', lang: 'th', text: x.name_th}) : null)},
        {key: 't', label: 'Type', get: (x) => x.asset_type, render: (x) => x.asset_type},
        {key: 'p', label: 'Location', get: (x) => x.province, render: (x) => frag(x.province || '—', x.location ? h('span', {class: 'detail', text: x.location}) : null)},
        {key: 'i', label: 'Tenure', get: (x) => x.investment_type, render: (x) => frag(x.investment_type || '—', x.lease_expiry ? h('span', {class: 'detail', text: `to ${fmtDate(x.lease_expiry)}`}) : null)},
        {key: 'a', label: 'Area', num: true, get: (x) => x.leasable_area_sqm ?? x.rooms, render: (x) => (isNum(x.leasable_area_sqm) ? sqm(x.leasable_area_sqm) : isNum(x.rooms) ? `${num(x.rooms)} rooms` : '—')},
        {key: 'appr', label: 'Appraisal THB m', num: true, get: (x) => x.latest_appraisal_thb_mn, render: (x) => num(x.latest_appraisal_thb_mn, 1)},
        {key: 'o', label: 'Occupancy', num: true, get: (x) => x.occupancy_pct, render: (x) => pct(x.occupancy_pct, 1)},
        {key: 's', label: '', render: (x) => cite(x.source, x)},
      ]})) : h('p', {class: 'nf', text: 'No existing-asset list in the text filings.'});

    return section('portfolio', 'Existing portfolio', 'What the trust already owns — the new assets are excluded.',
      tiles,
      h('div', {class: 'asset-grid'}, dpuCard, perfCard),
      h('h3', {class: 'mini-title', text: `Assets · ${ep.assets.length}`}),
      assetsTable,
      (ep.notes || []).length ? h('ul', {class: 'notes'}, ep.notes.map((n) => h('li', {text: n}))) : null);
  }

  function risksBlock(f) {
    const risks = [...f.risks].sort((a, b) => Number(b.asset_specific) - Number(a.asset_specific));
    const assetNames = Object.fromEntries(f.new_assets.map((a) => [a.asset_id, a.name_en]));
    return section('risks', 'Key risks', 'Summarised from the risk-factor section, asset-specific risks first.',
      risks.length ? h('ul', {class: 'risk-list'}, risks.map((r) => h('li', {class: 'risk'},
        h('div', {class: 'risk-top'}, h('span', {class: 'tag', text: r.category}), r.asset_specific ? h('span', {class: 'tag is-accent', text: 'asset-specific'}) : null, cite(r.source, r)),
        h('h4', {text: r.title}),
        h('p', {text: r.summary}),
        (r.applies_to || []).length ? h('span', {class: 'detail', text: `Applies to ${r.applies_to.map((id) => assetNames[id] || id).join(', ')}`}) : null)))
        : h('p', {class: 'nf', text: 'No risk discussion in the text filings — see Data quality.'}));
  }

  function notesBlock(f) {
    return section('notes', 'Analyst notes', 'Factual flags recorded during extraction, each tied to its source.',
      f.analyst_notes.length ? h('ul', {class: 'note-list'}, f.analyst_notes.map((n) => h('li', {class: 'note'}, h('h4', null, n.topic, cite(n.source, n)), h('p', {text: n.observation}))))
        : h('p', {class: 'nf', text: 'No notes recorded.'}));
  }

  function qualityBlock(f, sm) {
    const ex = f.extraction;
    const counts = (sm.completeness || {}).counts || {};
    const SEG = [['found', 'Found', 'var(--good)'], ['derived', 'Derived', 'var(--good-soft)'], ['ambiguous', 'Ambiguous or draft', 'var(--warning)'], ['not_found', 'Not found', 'var(--critical)'], ['not_applicable', 'Not applicable', 'var(--rule-strong)']];
    const present = SEG.filter(([k]) => counts[k]);
    const inProgress = /IN PROGRESS/i.test(ex.extracted_by || '');
    return section('quality', 'Data quality', `${isNum((sm.completeness || {}).found_pct) ? `${pct(sm.completeness.found_pct, 0)} of applicable fields found in the text filings. ` : ''}Extracted by ${ex.extracted_by} on ${fmtDate((ex.extracted_at || '').slice(0, 10))}.`,
      inProgress ? h('p', null, resultPill('warn'), ' This extraction was saved mid-run and is not finished yet.') : null,
      present.length ? frag(
        h('div', {class: 'comp-bar', role: 'img', 'aria-label': present.map(([k, l]) => `${l}: ${counts[k]}`).join(', ')}, present.map(([k, l, color]) => h('span', {style: `flex-grow:${counts[k]};background:${color}`, title: `${l}: ${counts[k]}`}))),
        h('ul', {class: 'legend', style: 'margin-top:8px'}, present.map(([k, l, color]) => h('li', null, keyGlyph({color}), `${l} ${counts[k]}`)))) : null,
      h('div', {class: 'quality-grid'},
        card('Extractor self-checks', null, ex.self_checks.length ? h('ul', {class: 'check-list', style: 'grid-template-columns:minmax(0,1fr)'}, ex.self_checks.map((c) => h('li', {class: 'check'}, resultPill(c.result), h('div', null, h('p', {class: 'check-label', text: c.check}), c.detail ? h('p', {class: 'check-detail', text: c.detail}) : null)))) : h('p', {class: 'nf', text: 'None recorded.'})),
        card('Draft revisions', 'Differences between an older draft and the latest document.', f.filing.revision_notes.length ? dataTable({rows: f.filing.revision_notes, columns: [
          {key: 'f', label: 'Field', render: (r) => h('span', {class: 'field', text: r.field})},
          {key: 'e', label: 'Earlier', render: (r) => frag(String(r.earlier_value ?? '—'), h('span', {class: 'detail', text: docInfo(r.earlier_file).name}))},
          {key: 'l', label: 'Latest', render: (r) => frag(String(r.latest_value ?? '—'), h('span', {class: 'detail', text: docInfo(r.latest_file).name}), r.note ? h('span', {class: 'detail', text: r.note}) : null)},
        ]}) : h('p', {class: 'nf', text: 'No material revisions between drafts.'})),
      ),
      h('div', {class: 'quality-grid'},
        h('details', {class: 'list card'}, h('summary', {text: `Not found in the text filings · ${ex.not_found.length}`}),
          h('ul', null, ex.not_found.map((n) => h('li', null, h('span', {class: 'field', text: n.field}), ` — ${n.reason}`)))),
        h('details', {class: 'list card'}, h('summary', {text: `Ambiguities · ${ex.ambiguities.length}`}),
          h('ul', null, ex.ambiguities.map((n) => h('li', null, h('span', {class: 'field', text: n.field}), ` — ${n.detail}`)))),
      ),
      h('h3', {class: 'mini-title', text: `Documents read · ${(f.filing.documents_used || []).length}`}),
      h('div', {class: 'card'}, dataTable({rows: f.filing.documents_used || [], columns: [
        {key: 'd', label: 'Section', render: (r) => frag(docInfo(r.file).name, h('span', {class: 'detail mono', text: r.file}))},
        {key: 'u', label: 'Uploaded', render: (r) => fmtDate(docInfo(r.file).date)},
        {key: 'w', label: 'Used for', render: (r) => r.used_for},
      ]})));
  }

  /* ------------------------------------------------------------------ routing */
  function route() {
    teardown();
    const m = location.hash.match(/^#\/reit\/([A-Za-z0-9_]+)/);
    const id = m && FIL[m[1]] ? m[1] : null;
    renderRail(id);
    if (id) renderReit(id);
    else { currentFiling = null; document.title = 'Thai REIT Deal Docket'; renderOverview(); }
    window.scrollTo(0, 0);
    main.focus({preventScroll: true});
  }
  window.addEventListener('hashchange', route);
  route();
})();
