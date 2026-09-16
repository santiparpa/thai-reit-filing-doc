/* Design A — "Year book".
   The rail keeps its job as the index, but gains three controls above the list: a scope (which year
   the whole page is looking at), a search box, and a grouping choice. The list is grouped and
   collapsible, so it stays the same height whether the docket holds 9 filings or 200. */
(() => {
  'use strict';
  const N = window.NAV;
  if (!N) return;
  const {h, s, frag, ALL, YEARS, YEAR_STATS, MAX_YEAR_SIZE, REAL_YEAR, STAGE, STAGE_SHORT, STAGE_ORDER, SECTORS,
    isNum, num, mn, mnShort, pct, fmtDate, plural, dateOf, sum, sectorColor, stageDot, typeTag, search,
    shortSector, demoBanner, demoChip, openHref} = N;

  const root = document.getElementById('a-root');

  /* icons */
  const ico = (...d) => s('svg', {viewBox: '0 0 16 16', 'aria-hidden': 'true'}, d.map((p) => s('path', {d: p, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})));
  const I = {
    search: () => ico('M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Z', 'm10.6 10.6 3 3'),
    grid: () => ico('M2.5 2.5h4.2v4.2H2.5zM9.3 2.5h4.2v4.2H9.3zM2.5 9.3h4.2v4.2H2.5zM9.3 9.3h4.2v4.2H9.3z'),
    layers: () => ico('m8 1.8 6 3-6 3-6-3 6-3Z', 'm2 8 6 3 6-3', 'm2 11.2 6 3 6-3'),
    chart: () => ico('M2.5 13.5h11', 'M4.5 11V6.5', 'M8 11V3.5', 'M11.5 11V8'),
    check: () => ico('M8 1.8 13.5 4v4c0 3-2.3 5.3-5.5 6.2C4.8 13.3 2.5 11 2.5 8V4L8 1.8Z', 'm6 7.8 1.6 1.6L10.3 6'),
    caret: () => s('svg', {class: 'a-scope-caret', viewBox: '0 0 10 10', 'aria-hidden': 'true'}, s('path', {d: 'm2.5 4 2.5 2.5L7.5 4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})),
    tw: () => s('svg', {class: 'a-tw', viewBox: '0 0 10 10', 'aria-hidden': 'true'}, s('path', {d: 'm2.5 4 2.5 2.5L7.5 4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})),
  };

  /* ---------------------------------------------------------------- state */
  const ST = {
    scope: String(REAL_YEAR),   // a year, or 'all'
    page: 'overview',           // overview | filing
    filing: null,
    q: '',
    group: 'year',              // year | sector | stage
    shut: new Set(),
    collapsed: false,
    menu: false,
  };

  const scopeRows = () => (ST.scope === 'all' ? ALL : ALL.filter((c) => String(c.year) === ST.scope));
  const listRows = () => search(scopeRows(), ST.q);
  const scopeLabel = () => (ST.scope === 'all' ? 'All years' : ST.scope);

  /* ---------------------------------------------------------------- rail */
  function scopeControl() {
    const stat = ST.scope === 'all' ? null : YEAR_STATS[+ST.scope];
    const sub = stat ? `${plural(stat.count, 'filing')} · THB ${mnShort(stat.size)}` : `${plural(ALL.length, 'filing')} · ${YEARS.length} years`;

    const opt = (value, label, meta) => h('button', {
      type: 'button', class: 'a-scope-opt', role: 'option', 'aria-selected': ST.scope === value,
      onclick: () => { ST.scope = value; ST.menu = false; if (ST.page === 'filing') ST.page = 'overview'; render(); },
    }, h('span', {text: label}), h('small', {text: meta}));

    return h('div', {class: 'a-scope'},
      h('button', {
        type: 'button', class: 'a-scope-btn', 'aria-haspopup': 'listbox', 'aria-expanded': ST.menu,
        title: 'Which year the whole page is looking at',
        onclick: (e) => { e.stopPropagation(); ST.menu = !ST.menu; render(); },
      }, h('span', null, h('b', {text: scopeLabel()}), h('small', {text: sub})), I.caret()),
      h('div', {class: 'a-scope-menu', role: 'listbox', 'aria-label': 'Year', hidden: !ST.menu},
        YEARS.map((y) => {
          const st = YEAR_STATS[y];
          return opt(String(y), `${y}${st.real ? '' : ' · copies'}`, `${st.count} · ${mnShort(st.size)}`);
        }),
        h('div', {class: 'a-scope-sep'}),
        opt('all', 'All years', `${ALL.length} · ${mnShort(sum(ALL, 'size'))}`)),
    );
  }

  function railNav() {
    const link = (page, icon, label, meta) => h('a', {
      class: `a-nav-a${ST.page === page ? ' is-active' : ''}`, href: '#', 'aria-current': ST.page === page ? 'page' : null,
      onclick: (e) => { e.preventDefault(); ST.page = page; ST.filing = null; render(); },
    }, icon, h('span', {text: label}), meta ? h('em', {text: meta}) : null);
    // one class name the CSS targets
    const wrap = h('nav', {class: 'a-nav', 'aria-label': 'Views'});
    for (const el of [
      link('overview', I.grid(), scopeLabel() === 'All years' ? 'All filings' : `${scopeLabel()} book`, String(scopeRows().length)),
      link('compare', I.chart(), 'Compare years', String(YEARS.length)),
      link('quality', I.check(), 'Data quality', null),
    ]) { el.classList.add('a-nav-item'); wrap.append(el); }
    return wrap;
  }

  function groupsOf(rows) {
    if (ST.group === 'sector') {
      const order = [...SECTORS.filter((x) => rows.some((r) => r.sector === x)), 'Other'];
      return order.map((k) => [k, rows.filter((r) => (r.sector || 'Other') === k)]).filter(([, v]) => v.length);
    }
    if (ST.group === 'stage') {
      return STAGE_ORDER.map((k) => [STAGE_SHORT[k], rows.filter((r) => r.stage === k)]).filter(([, v]) => v.length);
    }
    return YEARS.map((y) => [String(y), rows.filter((r) => r.year === y)]).filter(([, v]) => v.length);
  }

  function item(c) {
    const href = openHref(c);
    return h('a', {
      class: `a-item${ST.filing === c.id ? ' is-active' : ''}`,
      href: href || '#', title: c.name_en,
      onclick: (e) => { e.preventDefault(); ST.page = 'filing'; ST.filing = c.id; render(); },
    },
      h('span', {class: 'a-swatch', style: `background:${sectorColor(c.sector)}`}),
      h('span', {class: 'a-tick'}, h('b', {text: c.ticker}), typeTag(c.type)),
      h('span', {class: 'a-size', text: mnShort(c.size)}),
      /* everything secondary sits on the second line, so a long ticker never has to truncate */
      h('span', {class: 'a-sub'}, stageDot(c.stage), STAGE_SHORT[c.stage] || c.stage,
        ST.group !== 'year' ? frag(h('span', {class: 'sep', text: '·'}), String(c.year)) : null,
        ST.group !== 'sector' ? frag(h('span', {class: 'sep', text: '·'}), shortSector(c.sector)) : null,
        demoChip(c)));
  }

  function railList() {
    const rows = listRows();
    const wrap = h('div', {class: 'a-list'});
    if (!rows.length) {
      wrap.append(h('p', {class: 'a-empty'}, `Nothing matches “${ST.q}” in ${scopeLabel().toLowerCase()}. `,
        h('a', {href: '#', text: 'Search all years', onclick: (e) => { e.preventDefault(); ST.scope = 'all'; render(); }})));
      return wrap;
    }
    for (const [key, members] of groupsOf(rows)) {
      const shut = ST.shut.has(key) && !ST.q;
      wrap.append(h('section', {class: `a-group${shut ? ' is-shut' : ''}`},
        h('button', {
          type: 'button', class: 'a-group-head', 'aria-expanded': !shut,
          onclick: () => { ST.shut.has(key) ? ST.shut.delete(key) : ST.shut.add(key); render(); },
        }, I.tw(), h('span', {text: key}), h('em', {text: String(members.length)})),
        h('div', {class: 'a-group-body'}, members.map(item))));
    }
    return wrap;
  }

  function rail() {
    const find = h('div', {class: `a-find${ST.q ? ' has-text' : ''}`},
      I.search(),
      h('input', {
        type: 'search', id: 'a-find', value: ST.q, autocomplete: 'off', spellcheck: 'false',
        placeholder: ST.scope === 'all' ? 'Search all years…' : `Search ${scopeLabel()}…`,
        'aria-label': 'Search filings',
        oninput: (e) => { ST.q = e.target.value; render({keepFocus: 'a-find'}); },
      }),
      h('kbd', {text: '/'}));

    return h('aside', {class: 'a-rail', 'aria-label': 'Filings'},
      h('div', {class: 'a-rail-top'},
        h('a', {class: 'a-brand', href: '../index.html'},
          h('span', {class: 'a-brand-mark', 'aria-hidden': 'true', text: '69'}),
          h('span', {class: 'a-brand-text'}, h('b', {text: 'REIT Deal Docket'}), h('small', {text: 'Thai SEC Form 69-REIT'}))),
        scopeControl(), find),
      railNav(),
      h('div', {class: 'a-groupbar'},
        h('span', {text: 'Group by'}),
        h('div', {class: 'a-seg', role: 'radiogroup', 'aria-label': 'Group filings by'},
          [['year', 'Year'], ['sector', 'Sector'], ['stage', 'Stage']].map(([v, l]) => frag(
            h('input', {type: 'radio', name: 'a-group', id: `a-group-${v}`, checked: ST.group === v, onchange: () => { ST.group = v; ST.shut.clear(); render(); }}),
            h('label', {for: `a-group-${v}`, text: l}))))),
      railList(),
      h('div', {class: 'a-rail-foot'},
        h('span', {text: `Built ${fmtDate(N.generated)}`}),
        h('button', {type: 'button', class: 'a-collapse', title: 'Collapse the rail  [', text: ST.collapsed ? '›' : '‹', onclick: () => { ST.collapsed = !ST.collapsed; render(); }})),
    );
  }

  /* ---------------------------------------------------------------- main */
  const kpi = (l, v, sub) => h('div', {class: 'a-kpi'}, h('p', {class: 'a-kpi-l', text: l}), h('p', {class: 'a-kpi-v', text: v}), sub ? h('p', {class: 'a-kpi-s', text: sub}) : null);

  function yearStrip() {
    return h('div', {class: 'a-years'}, YEARS.slice().sort((a, b) => a - b).map((y) => {
      const st = YEAR_STATS[y];
      const on = ST.scope === String(y);
      return h('a', {
        class: `a-year-card${on ? ' is-on' : ''}`, href: '#',
        onclick: (e) => { e.preventDefault(); ST.scope = String(y); ST.page = 'overview'; render(); },
      },
        h('b', {text: String(y)}),
        h('i', {text: `${st.count} filings · ${st.ipo} IPO`}),
        h('div', {class: 'a-year-bar'}, h('span', {style: `width:${Math.max(3, (st.size / MAX_YEAR_SIZE) * 100)}%`})),
        h('u', {text: `THB ${mnShort(st.size)}`}));
    }));
  }

  function filingTable(rows) {
    return h('div', {class: 'a-table-wrap'}, h('table', {class: 'a-table'},
      h('thead', null, h('tr', null,
        h('th', {text: 'Filing'}), h('th', {text: 'Filed'}), h('th', {text: 'Sector'}), h('th', {text: 'Stage'}),
        h('th', {class: 'n', text: 'Size'}), h('th', {class: 'n', text: 'Yield'}), h('th', {class: 'n', text: 'LTV after'}))),
      h('tbody', null, rows.map((c) => h('tr', null,
        h('td', null, h('a', {href: '#', text: c.ticker, onclick: (e) => { e.preventDefault(); ST.page = 'filing'; ST.filing = c.id; render(); }}), ' ', typeTag(c.type), ' ', demoChip(c)),
        h('td', {class: 'yr', text: String(c.year)}),
        h('td', null, h('span', {class: 'swatch', style: `background:${sectorColor(c.sector)};display:inline-block;margin-right:6px`}), shortSector(c.sector)),
        h('td', null, h('span', {style: 'display:inline-flex;align-items:center;gap:6px'}, stageDot(c.stage), STAGE_SHORT[c.stage] || c.stage)),
        h('td', {class: 'n', text: mn(c.size)}),
        h('td', {class: 'n', text: pct(c.yield_pct)}),
        h('td', {class: 'n', text: pct(c.ltv_after)}))))));
  }

  function pageOverview() {
    const rows = listRows();
    const all = ST.scope === 'all';
    const st = all ? null : YEAR_STATS[+ST.scope];
    const live = rows.filter((c) => N.LIVE.has(c.stage)).length;
    return frag(
      h('div', {class: 'a-crumb'}, h('a', {href: '#', text: 'Docket', onclick: (e) => { e.preventDefault(); ST.scope = 'all'; render(); }}), '›', h('span', {text: scopeLabel()})),
      h('h1', {class: 'a-title', text: all ? 'Every filing on the docket' : `The ${ST.scope} book`}),
      h('p', {class: 'a-lede', text: all
        ? `${plural(ALL.length, 'filing')} across ${YEARS.length} years. The rail is scoped to all years, so search and grouping reach the whole docket.`
        : `${plural(st.count, 'filing')} first submitted to the SEC in ${ST.scope} — ${st.ipo} IPO and ${st.po} PO — worth THB ${mnShort(st.size)} of property. Switch year at the top of the rail; everything on this page follows it.`}),
      yearStrip(),
      h('div', {class: 'a-kpis'},
        kpi('Filings', String(rows.length), ST.q ? `matching “${ST.q}”` : (all ? `${YEARS.length} years` : `${st.ipo} IPO · ${st.po} PO`)),
        kpi('Property value', `THB ${mnShort(sum(rows, 'size'))}`, 'total investment'),
        kpi('New units', `THB ${mnShort(sum(rows, 'equity'))}`, 'offering size'),
        kpi('New debt', `THB ${mnShort(sum(rows, 'debt'))}`, 'borrowings at closing'),
        kpi('Still live', String(live), 'in review, effective or offering')),
      h('div', {class: 'a-sec-head'}, h('h2', {text: ST.q ? `Matching “${ST.q}” · ${rows.length}` : 'Filings'}),
        h('span', {class: 'muted mono', style: 'font-size:12px', text: `scope: ${scopeLabel().toLowerCase()}`})),
      filingTable(rows));
  }

  function pageCompare() {
    const years = YEARS.slice().sort((a, b) => a - b);
    return frag(
      h('div', {class: 'a-crumb'}, h('span', {text: 'Docket'}), '›', h('span', {text: 'Compare years'})),
      h('h1', {class: 'a-title', text: 'Year against year'}),
      h('p', {class: 'a-lede', text: 'The view the single-year rail cannot give you on its own: how the books stack up. Reachable from the rail whatever year is in scope.'}),
      yearStrip(),
      h('div', {class: 'a-sec-head'}, h('h2', {text: 'By year'})),
      h('div', {class: 'a-table-wrap'}, h('table', {class: 'a-table'},
        h('thead', null, h('tr', null, h('th', {text: 'Filed'}), h('th', {class: 'n', text: 'Filings'}), h('th', {class: 'n', text: 'IPO'}), h('th', {class: 'n', text: 'PO'}),
          h('th', {class: 'n', text: 'Property value'}), h('th', {class: 'n', text: 'New units'}), h('th', {class: 'n', text: 'New debt'}), h('th', {text: 'Sector mix'}))),
        h('tbody', null, years.map((y) => {
          const st = YEAR_STATS[y];
          const mix = SECTORS.map((sec) => [sec, st.rows.filter((r) => r.sector === sec).length]).filter(([, n]) => n);
          return h('tr', null,
            h('td', null, h('a', {href: '#', text: String(y), onclick: (e) => { e.preventDefault(); ST.scope = String(y); ST.page = 'overview'; render(); }}), st.real ? null : ' ', st.real ? null : h('span', {class: 'demo-chip is-inline', text: 'copies'})),
            h('td', {class: 'n', text: String(st.count)}), h('td', {class: 'n', text: String(st.ipo)}), h('td', {class: 'n', text: String(st.po)}),
            h('td', {class: 'n', text: mn(st.size)}), h('td', {class: 'n', text: mn(st.equity)}), h('td', {class: 'n', text: mn(st.debt)}),
            h('td', null, h('span', {style: 'display:inline-flex;gap:3px;align-items:center'},
              mix.map(([sec, n]) => h('span', {title: `${sec}: ${n}`, style: `width:${6 + n * 5}px;height:9px;border-radius:2px;background:${sectorColor(sec)}`})))));
        })))));
  }

  function pageQuality() {
    return frag(
      h('div', {class: 'a-crumb'}, h('span', {text: 'Docket'}), '›', h('span', {text: 'Data quality'})),
      h('h1', {class: 'a-title', text: 'Data quality'}),
      h('p', {class: 'a-lede', text: 'Placeholder in this prototype — in the real build this is the cross-year version of the checks and not-found lists the dashboard already renders per filing.'}));
  }

  function pageFiling() {
    const c = N.BY_ID[ST.filing];
    if (!c) { ST.page = 'overview'; return pageOverview(); }
    const href = openHref(c);
    return frag(
      h('div', {class: 'a-crumb'},
        h('a', {href: '#', text: 'Docket', onclick: (e) => { e.preventDefault(); ST.page = 'overview'; ST.filing = null; render(); }}), '›',
        h('a', {href: '#', text: String(c.year), onclick: (e) => { e.preventDefault(); ST.scope = String(c.year); ST.page = 'overview'; ST.filing = null; render(); }}), '›',
        h('span', {text: c.ticker})),
      h('h1', {class: 'a-title'}, c.ticker, ' ', typeTag(c.type), ' ', demoChip(c)),
      h('p', {class: 'a-lede', text: c.name_en}),
      h('div', {class: 'a-kpis'},
        kpi('Filing year', String(c.year), c.first_filed ? `first filed ${fmtDate(c.first_filed)}` : `not on the SEC list · earliest document ${fmtDate(c.earliest_doc)}`),
        kpi('Property value', mn(c.size), 'total investment'),
        kpi('Projected yield', pct(c.yield_pct), 'at the filed price'),
        kpi('LTV after', pct(c.ltv_after), 'post-transaction'),
        kpi('Stage', STAGE_SHORT[c.stage] || c.stage, (STAGE[c.stage] || {}).label)),
      h('p', {class: 'a-lede'}, href
        ? frag('This prototype only shows navigation. ', h('a', {href, text: 'Open the real filing page →'}))
        : 'This row is a dated copy of a 2026 filing, so it has no page of its own — pick a 2026 filing to reach the real one.'));
  }

  /* ---------------------------------------------------------------- render */
  function render(opts) {
    const focus = opts && opts.keepFocus;
    const sel = focus && document.getElementById(focus) ? document.getElementById(focus).selectionStart : null;
    const scroll = root.querySelector('.a-list')?.scrollTop;

    const main = h('main', {class: 'a-main', id: 'a-main', tabindex: '-1'},
      ST.page === 'compare' ? pageCompare() : ST.page === 'quality' ? pageQuality() : ST.page === 'filing' ? pageFiling() : pageOverview());

    root.replaceChildren(
      demoBanner(),
      h('div', {class: `a-app${ST.collapsed ? ' is-collapsed' : ''}`}, rail(), main),
      h('div', {class: 'proto-switch'}, h('span', {class: 'is-here', text: 'A · Year book'}), h('a', {href: 'design-b.html', text: 'B · Timeline'}), h('a', {href: '../index.html', text: 'Live'})));

    const list = root.querySelector('.a-list');
    if (list && scroll) list.scrollTop = scroll;
    if (focus) {
      const el = document.getElementById(focus);
      if (el) { el.focus(); if (sel !== null) el.setSelectionRange(sel, sel); }
    }
  }

  /* keyboard: "/" focuses search, "[" collapses the rail, Escape clears */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === '/' && !typing) { e.preventDefault(); document.getElementById('a-find')?.focus(); }
    else if (e.key === '[' && !typing) { ST.collapsed = !ST.collapsed; render(); }
    else if (e.key === 'Escape') {
      if (ST.menu) { ST.menu = false; render(); }
      else if (ST.q) { ST.q = ''; render({keepFocus: 'a-find'}); }
    }
  });
  document.addEventListener('click', () => { if (ST.menu) { ST.menu = false; render(); } });

  render();
})();
