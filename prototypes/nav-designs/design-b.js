/* Design B — "Timeline board".
   The rail stops being the index and shrinks to a 56px strip of views. Year becomes a timeline
   across the top that scopes the page, the filings become a faceted board grouped by quarter, and
   Ctrl/Cmd-K opens a palette that reaches any filing in any year without changing the scope. */
(() => {
  'use strict';
  const N = window.NAV;
  if (!N) return;
  const {h, s, frag, ALL, YEARS, YEAR_STATS, MAX_YEAR_SIZE, REAL_YEAR, STAGE, STAGE_SHORT, STAGE_ORDER, SECTORS,
    num, mn, mnShort, pct, fmtDate, plural, dateOf, sum, sectorColor, stageDot, typeTag, search,
    shortSector, demoBanner, demoChip, openHref} = N;

  const root = document.getElementById('b-root');

  const ico = (...d) => s('svg', {viewBox: '0 0 16 16', 'aria-hidden': 'true'}, d.map((p) => s('path', {d: p, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'})));
  const I = {
    board: () => ico('M2.5 2.5h4.2v11H2.5zM9.3 2.5h4.2v6.4H9.3z'),
    chart: () => ico('M2.5 13.5h11', 'M4.5 11V6.5', 'M8 11V3.5', 'M11.5 11V8'),
    table: () => ico('M2.5 3.5h11v9h-11z', 'M2.5 6.8h11', 'M6.4 6.8v5.7'),
    check: () => ico('M8 1.8 13.5 4v4c0 3-2.3 5.3-5.5 6.2C4.8 13.3 2.5 11 2.5 8V4L8 1.8Z', 'm6 7.8 1.6 1.6L10.3 6'),
    search: () => ico('M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Z', 'm10.6 10.6 3 3'),
    help: () => ico('M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4Z', 'M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4', 'M8 11.6h.01'),
  };

  /* ---------------------------------------------------------------- state */
  const ST = {
    scope: String(REAL_YEAR),   // a year, or 'all'
    view: 'board',              // board | timeline | table | quality
    sector: null, type: null, stage: null,
    pal: false, palQ: '', palSel: 0,
  };

  const inScope = () => (ST.scope === 'all' ? ALL : ALL.filter((c) => String(c.year) === ST.scope));
  const faceted = () => inScope().filter((c) =>
    (!ST.sector || c.sector === ST.sector) && (!ST.type || c.type === ST.type) && (!ST.stage || c.stage === ST.stage));
  const scopeLabel = () => (ST.scope === 'all' ? 'All years' : ST.scope);

  /* ---------------------------------------------------------------- icon rail */
  function rail() {
    const btn = (view, icon, tip) => h('button', {
      type: 'button', class: `b-ico${ST.view === view ? ' is-active' : ''}`, 'data-tip': tip, 'aria-label': tip,
      onclick: () => { ST.view = view; render(); },
    }, icon);
    return h('aside', {class: 'b-rail', 'aria-label': 'Views'},
      h('a', {class: 'b-mark', href: '../index.html', 'aria-label': 'REIT Deal Docket', text: '69'}),
      btn('board', I.board(), 'Deal board'),
      btn('timeline', I.chart(), 'Year comparison'),
      btn('table', I.table(), 'Table'),
      btn('quality', I.check(), 'Data quality'),
      h('div', {class: 'b-spacer'}),
      h('button', {type: 'button', class: 'b-ico', 'data-tip': 'Search everything  Ctrl K', 'aria-label': 'Search', onclick: () => openPal()}, I.search()));
  }

  /* ---------------------------------------------------------------- year timeline */
  function timeline() {
    const bar = h('div', {class: 'b-timeline', role: 'tablist', 'aria-label': 'Filing year'});
    const allSize = sum(ALL, 'size');
    const asc = YEARS.slice().sort((a, b) => a - b);
    /* the All tile carries a sparkline of every year, so the shape is readable before you pick one */
    bar.append(h('button', {
      type: 'button', role: 'tab', class: `b-yr b-yr-all${ST.scope === 'all' ? ' is-on' : ''}`, 'aria-selected': ST.scope === 'all',
      onclick: () => { ST.scope = 'all'; render(); },
    }, h('b', {text: 'All'}),
      h('div', {class: 'b-yr-bar'}, asc.map((y) => h('i', {style: `height:${Math.max(8, (YEAR_STATS[y].size / MAX_YEAR_SIZE) * 100)}%`, title: `${y}: ${mnShort(YEAR_STATS[y].size)}`}))),
      h('small', {text: `${ALL.length} · ${mnShort(allSize)}`})));

    for (const y of YEARS.slice().sort((a, b) => a - b)) {
      const st = YEAR_STATS[y];
      const on = ST.scope === String(y);
      bar.append(h('button', {
        type: 'button', role: 'tab', class: `b-yr${on ? ' is-on' : ''}`, 'aria-selected': on,
        title: `${y}: ${plural(st.count, 'filing')}, THB ${mnShort(st.size)}${st.live ? `, ${st.live} still live` : ''}`,
        onclick: () => { ST.scope = String(y); render(); },
      },
        h('b', null, String(y), st.live ? h('span', {class: 'b-live', title: `${st.live} still live`}) : null),
        h('div', {class: 'b-yr-bar'}, h('i', {style: `height:${Math.max(6, (st.size / MAX_YEAR_SIZE) * 100)}%`})),
        h('small', {text: `${st.count} · ${mnShort(st.size)}`})));
    }
    return bar;
  }

  /* ---------------------------------------------------------------- facets */
  function facets() {
    const rows = inScope();
    const chip = (on, label, count, onclick, swatch) => h('button', {
      type: 'button', class: `b-chip${on ? ' is-on' : ''}`, onclick,
    }, swatch ? h('span', {class: 'sw', style: `background:${swatch}`}) : null, label, count != null ? h('em', {text: String(count)}) : null);

    const sectors = SECTORS.filter((x) => rows.some((r) => r.sector === x));
    const stages = STAGE_ORDER.filter((x) => rows.some((r) => r.stage === x));
    const any = ST.sector || ST.type || ST.stage;

    return h('div', {class: 'b-facets'},
      sectors.map((sec) => chip(ST.sector === sec, shortSector(sec), rows.filter((r) => r.sector === sec).length,
        () => { ST.sector = ST.sector === sec ? null : sec; render(); }, sectorColor(sec))),
      h('div', {class: 'b-facet-sep'}),
      ['IPO', 'PO'].map((t) => chip(ST.type === t, t, rows.filter((r) => r.type === t).length,
        () => { ST.type = ST.type === t ? null : t; render(); })),
      h('div', {class: 'b-facet-sep'}),
      stages.map((k) => chip(ST.stage === k, STAGE_SHORT[k], rows.filter((r) => r.stage === k).length,
        () => { ST.stage = ST.stage === k ? null : k; render(); })),
      any ? h('button', {type: 'button', class: 'b-clear', text: 'Clear filters', onclick: () => { ST.sector = ST.type = ST.stage = null; render(); }}) : null,
      h('span', {class: 'b-count', text: `${faceted().length} of ${rows.length} shown`}));
  }

  /* ---------------------------------------------------------------- board */
  function card(c) {
    const href = openHref(c);
    return h('a', {
      class: 'b-card', href: href || '#', style: `--c:${sectorColor(c.sector)}`, title: c.name_en,
      onclick: href ? null : (e) => e.preventDefault(),
    },
      h('div', {class: 'b-card-top'}, h('b', {text: c.ticker}), typeTag(c.type), h('span', {class: 'grow'}), demoChip(c), stageDot(c.stage)),
      h('div', {class: 'b-card-name', text: c.name_en}),
      h('div', {class: 'b-card-figs'},
        h('div', null, h('span', {text: 'Size'}), h('strong', {text: mnShort(c.size)})),
        h('div', null, h('span', {text: 'Yield'}), h('strong', {text: pct(c.yield_pct)})),
        h('div', null, h('span', {text: 'LTV after'}), h('strong', {text: pct(c.ltv_after)}))),
      h('div', {class: 'b-card-foot'}, shortSector(c.sector), h('span', {class: 'sep', text: '·'}),
        STAGE_SHORT[c.stage] || c.stage, h('span', {class: 'sep', text: '·'}), fmtDate(dateOf(c))));
  }

  function viewBoard() {
    const rows = faceted();
    if (!rows.length) return h('div', {class: 'b-empty'}, h('b', {text: 'Nothing matches those filters'}), 'Clear a chip above, or pick All on the timeline.');
    const board = h('div', {class: 'b-board'});
    const groups = ST.scope === 'all'
      ? YEARS.map((y) => [String(y), rows.filter((r) => r.year === y)])
      : ['Q1', 'Q2', 'Q3', 'Q4', 'Undated'].map((q) => [q, rows.filter((r) => r.quarter === q)]);
    for (const [key, members] of groups.filter(([, v]) => v.length)) {
      board.append(h('section', {class: 'b-q'},
        h('div', {class: 'b-q-head'}, h('h2', {text: ST.scope === 'all' ? `Filed ${key}` : `Filed ${key} ${ST.scope}`}), h('hr'),
          h('em', {text: `${members.length} · THB ${mnShort(sum(members, 'size'))}`})),
        h('div', {class: 'b-grid'}, members.map(card))));
    }
    return board;
  }

  function viewTimeline() {
    const years = YEARS.slice().sort((a, b) => a - b);
    const max = MAX_YEAR_SIZE;
    return h('div', {class: 'b-board'},
      h('section', {class: 'b-q'},
        h('div', {class: 'b-q-head'}, h('h2', {text: 'Property value by year'}), h('hr')),
        h('div', {class: 'a-table-wrap'}, h('table', {class: 'a-table'},
          h('thead', null, h('tr', null, h('th', {text: 'Filed'}), h('th', {class: 'n', text: 'Filings'}), h('th', {class: 'n', text: 'IPO'}),
            h('th', {class: 'n', text: 'Property value'}), h('th', {class: 'n', text: 'New units'}), h('th', {class: 'n', text: 'New debt'}), h('th', {text: ''}))),
          h('tbody', null, years.map((y) => {
            const st = YEAR_STATS[y];
            return h('tr', null,
              h('td', null, h('a', {href: '#', text: String(y), onclick: (e) => { e.preventDefault(); ST.scope = String(y); ST.view = 'board'; render(); }}), st.real ? null : frag(' ', h('span', {class: 'demo-chip is-inline', text: 'copies'}))),
              h('td', {class: 'n', text: String(st.count)}), h('td', {class: 'n', text: String(st.ipo)}),
              h('td', {class: 'n', text: mn(st.size)}), h('td', {class: 'n', text: mn(st.equity)}), h('td', {class: 'n', text: mn(st.debt)}),
              h('td', null, h('span', {style: `display:block;height:9px;border-radius:2px;background:var(--accent);width:${Math.max(4, (st.size / max) * 100)}%;min-width:120px`})));
          }))))));
  }

  function viewTable() {
    const rows = faceted();
    return h('div', {class: 'b-board'}, h('section', {class: 'b-q'},
      h('div', {class: 'b-q-head'}, h('h2', {text: `${scopeLabel()} · ${plural(rows.length, 'filing')}`}), h('hr')),
      h('div', {class: 'a-table-wrap'}, h('table', {class: 'a-table'},
        h('thead', null, h('tr', null, h('th', {text: 'Filing'}), h('th', {text: 'Filed'}), h('th', {text: 'Sector'}), h('th', {text: 'Stage'}),
          h('th', {class: 'n', text: 'Size'}), h('th', {class: 'n', text: 'Yield'}), h('th', {class: 'n', text: 'LTV after'}))),
        h('tbody', null, rows.map((c) => {
          const href = openHref(c);
          return h('tr', null,
            h('td', null, href ? h('a', {href, text: c.ticker}) : h('b', {text: c.ticker}), ' ', typeTag(c.type), ' ', demoChip(c)),
            h('td', {class: 'yr', text: String(c.year)}),
            h('td', null, h('span', {class: 'swatch', style: `background:${sectorColor(c.sector)};display:inline-block;margin-right:6px`}), shortSector(c.sector)),
            h('td', null, h('span', {style: 'display:inline-flex;align-items:center;gap:6px'}, stageDot(c.stage), STAGE_SHORT[c.stage] || c.stage)),
            h('td', {class: 'n', text: mn(c.size)}), h('td', {class: 'n', text: pct(c.yield_pct)}), h('td', {class: 'n', text: pct(c.ltv_after)}));
        }))))));
  }

  function viewQuality() {
    return h('div', {class: 'b-board'}, h('div', {class: 'b-empty'},
      h('b', {text: 'Data quality'}), 'Placeholder in this prototype — the cross-year version of the checks and not-found lists the dashboard already renders per filing.'));
  }

  /* ---------------------------------------------------------------- command palette */
  /* With nothing typed the palette opens on the year you are most likely to want — the one the real
     data is in — rather than on next year's thin pipeline. */
  const HOME_FIRST = ALL.slice().sort((a, b) => (Math.abs(a.year - REAL_YEAR) - Math.abs(b.year - REAL_YEAR)) || (b.year - a.year) || a.ticker.localeCompare(b.ticker));
  const palRows = () => (ST.palQ.trim() ? search(ALL, ST.palQ) : HOME_FIRST).slice(0, 40);

  function openPal() { ST.pal = true; ST.palQ = ''; ST.palSel = 0; render({focusPal: true}); }
  function closePal() { ST.pal = false; render(); }
  function choose(c) {
    const href = openHref(c);
    ST.scope = String(c.year); ST.view = 'board'; ST.pal = false;
    render();
    if (href) window.location.href = href;
  }

  function palette() {
    if (!ST.pal) return null;
    const rows = palRows();
    const groups = [];
    for (const c of rows) {
      const g = groups.find(([y]) => y === c.year);
      g ? g[1].push(c) : groups.push([c.year, [c]]);
    }
    let i = -1;
    const body = h('div', {class: 'b-pal-body'});
    for (const [y, members] of groups) {
      body.append(h('p', {class: 'b-pal-head', text: `${y}${YEAR_STATS[y].real ? '' : ' · copies'}`}));
      for (const c of members) {
        i += 1;
        const idx = i;
        body.append(h('a', {
          class: `b-pal-row${idx === ST.palSel ? ' is-sel' : ''}`, href: openHref(c) || '#', 'data-i': idx,
          onclick: (e) => { e.preventDefault(); choose(c); },
          onmouseenter: () => { if (ST.palSel !== idx) { ST.palSel = idx; paintSel(); } },
        },
          h('span', {class: 'sw', style: `width:8px;height:8px;border-radius:2px;background:${sectorColor(c.sector)}`}),
          h('span', null, h('b', null, c.ticker, typeTag(c.type), demoChip(c)), h('small', {text: c.name_en})),
          h('span', {class: 'r', text: mnShort(c.size)})));
      }
    }
    if (!rows.length) body.append(h('p', {class: 'b-pal-head', text: 'No filing matches'}));

    return h('div', {class: 'b-scrim', onclick: (e) => { if (e.target.classList.contains('b-scrim')) closePal(); }},
      h('div', {class: 'b-pal', role: 'dialog', 'aria-label': 'Find a filing'},
        h('div', {class: 'b-pal-in'}, I.search(),
          h('input', {
            id: 'b-pal-q', type: 'text', value: ST.palQ, autocomplete: 'off', spellcheck: 'false',
            placeholder: 'Find any filing — ticker, sponsor, sector, year…',
            oninput: (e) => { ST.palQ = e.target.value; ST.palSel = 0; render({focusPal: true, keepCaret: true}); },
          }),
          h('kbd', {text: 'Esc'})),
        body,
        h('div', {class: 'b-pal-foot'},
          h('span', null, h('kbd', {text: '↑↓'}), ' move'),
          h('span', null, h('kbd', {text: '↵'}), ' open'),
          h('span', {class: 'muted', text: `${ALL.length} filings across ${YEARS.length} years`}))));
  }

  function paintSel() {
    root.querySelectorAll('.b-pal-row').forEach((el) => el.classList.toggle('is-sel', +el.dataset.i === ST.palSel));
    root.querySelector('.b-pal-row.is-sel')?.scrollIntoView({block: 'nearest'});
  }

  /* ---------------------------------------------------------------- render */
  function render(opts) {
    const o = opts || {};
    const caret = o.keepCaret ? document.getElementById('b-pal-q')?.selectionStart : null;
    const st = ST.scope === 'all' ? null : YEAR_STATS[+ST.scope];

    root.replaceChildren(
      demoBanner(),
      h('div', {class: 'b-app'}, rail(),
        h('div', {class: 'b-main'},
          h('div', {class: 'b-top'},
            h('div', {class: 'b-topbar'},
              h('div', null,
                h('h1', {text: ST.scope === 'all' ? 'Every filing on the docket' : `${ST.scope} filing book`}),
                h('p', {text: st
                  ? `${plural(st.count, 'filing')} · ${st.ipo} IPO, ${st.po} PO · THB ${mnShort(st.size)} of property${st.live ? ` · ${st.live} still live` : ''}`
                  : `${plural(ALL.length, 'filing')} across ${YEARS.length} years · THB ${mnShort(sum(ALL, 'size'))}`})),
              h('button', {type: 'button', class: 'b-k', onclick: openPal},
                I.search(), h('span', {text: 'Find a filing…'}), h('kbd', {text: 'Ctrl K'}))),
            timeline(), facets()),
          ST.view === 'timeline' ? viewTimeline() : ST.view === 'table' ? viewTable() : ST.view === 'quality' ? viewQuality() : viewBoard())),
      palette(),
      h('div', {class: 'proto-switch'}, h('a', {href: 'design-a.html', text: 'A · Year book'}), h('span', {class: 'is-here', text: 'B · Timeline'}), h('a', {href: '../index.html', text: 'Live'})));

    if (o.focusPal) {
      const el = document.getElementById('b-pal-q');
      if (el) { el.focus(); if (caret !== null) el.setSelectionRange(caret, caret); }
    }
  }

  /* keyboard: Ctrl/Cmd-K opens the palette, arrows move, Enter opens, Escape closes */
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ST.pal ? closePal() : openPal(); return; }
    if (!ST.pal) {
      if (e.key === '/' && !typing) { e.preventDefault(); openPal(); }
      return;
    }
    const rows = palRows();
    if (e.key === 'Escape') { e.preventDefault(); closePal(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); ST.palSel = Math.min(ST.palSel + 1, rows.length - 1); paintSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ST.palSel = Math.max(ST.palSel - 1, 0); paintSel(); }
    else if (e.key === 'Enter' && rows[ST.palSel]) { e.preventDefault(); choose(rows[ST.palSel]); }
  });

  render();
})();
