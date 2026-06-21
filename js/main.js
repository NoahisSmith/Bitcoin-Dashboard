/* ─── Bitcoin Metrics Dashboard — Main ───────────────────────────────────── */

/* ════════════════════════════════════════════════════════════════════════ */
/*  State                                                                   */
/* ════════════════════════════════════════════════════════════════════════ */
const State = {
  rows:       [],
  regression: null,
  residuals:  [],
  currentPrice: null,
  currentRisk:  null,
  halfingInfo:  null,
  currentSection: 'dashboard',
  // Per-chart linear/log scale preference for the four price-based charts
  scalePrefs: {
    overview: 'log',
    ma200w:   'log',
    logregr:  'log',
    picycle:  'log',
    backtest: 'log',
  },
  // Global chart date range (null = unbounded). Stored as 'YYYY-MM-DD' strings
  // so they compare directly against row.dateStr.
  dateRange: { start: null, end: null },
  lastBacktest: null,
};

/* ════════════════════════════════════════════════════════════════════════ */
/*  Utility                                                                 */
/* ════════════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtUSD(n) {
  if (n == null) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return '$' + n.toFixed(2);
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  UI: top-strip risk colour                                               */
/* ════════════════════════════════════════════════════════════════════════ */
function applyRiskColor(score) {
  const info  = Calc.riskLabel(score);
  const color = info?.color || '#94a3b8';

  // glow strip at top
  const strip = $('risk-strip');
  if (strip) strip.style.background = color;

  // glow on risk gauge
  const gauge = $('risk-gauge-inner');
  if (gauge) {
    gauge.style.width      = `${(score / 10) * 100}%`;
    gauge.style.background = `linear-gradient(90deg, #10b981, ${color})`;
  }

  // update badge
  const badge = $('risk-score-val');
  if (badge) { badge.textContent = fmt(score, 1); badge.style.color = color; }

  const labelEl = $('risk-label');
  if (labelEl) { labelEl.textContent = info?.label || '—'; labelEl.style.color = color; }

  const actionEl = $('risk-action');
  if (actionEl) actionEl.textContent = info?.action || '—';

  const allocEl = $('risk-alloc');
  if (allocEl) allocEl.textContent = info?.alloc ? `DCA: ${info.alloc}` : '';

  // highlight matching row in DCA table
  $$('.dca-row').forEach(row => {
    const rMin = parseFloat(row.dataset.min);
    const rMax = parseFloat(row.dataset.max);
    row.classList.toggle('active', score >= rMin && score < rMax);
  });
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  UI: header price                                                        */
/* ════════════════════════════════════════════════════════════════════════ */
function updateHeader(priceSnap, lastRow) {
  const btc = priceSnap?.bitcoin;

  if (btc) {
    $('hdr-price').textContent = fmtUSD(btc.usd);
    const chg   = btc.usd_24h_change;
    const chgEl = $('hdr-change');
    chgEl.textContent = (chg >= 0 ? '+' : '') + fmt(chg, 2) + '%';
    chgEl.className   = 'hdr-change ' + (chg >= 0 ? 'pos' : 'neg');
    $('hdr-mcap').textContent = fmtUSD(btc.usd_market_cap);
    $('hdr-vol').textContent  = fmtUSD(btc.usd_24h_vol);
  } else if (lastRow) {
    // CoinGecko snapshot unavailable — fall back to most recent historical close
    $('hdr-price').textContent = fmtUSD(lastRow.price);
    const chgEl = $('hdr-change');
    chgEl.textContent = `as of ${lastRow.dateStr}`;
    chgEl.className   = 'hdr-change';
    $('hdr-mcap').textContent = fmtUSD(lastRow.marketCap);
    $('hdr-vol').textContent  = '—';
  }
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  UI: metric cards                                                        */
/* ════════════════════════════════════════════════════════════════════════ */
function updateMetricCards(rows) {
  // Different metrics go stale on different days (weekly RSI only has a
  // value once every 7 days; Puell depends on miner-revenue data that
  // often lags price by a day or more), so each card looks up the most
  // recent row where ITS OWN field is populated, rather than all reading
  // off one single "latest" row that may be missing some of them.
  const findLatest = field => [...rows].reverse().find(r => r[field] != null);

  const latestPrice = findLatest('price');
  if (!latestPrice) return;

  // 200 WMA
  const latestMA = findLatest('ma200w');
  if (latestMA) {
    const mult = latestPrice.price / latestMA.ma200w;
    setCard('ma200w', fmtUSD(latestMA.ma200w), fmt(mult, 2) + '× MA',
      mult < 1 ? 'buy' : mult < 2 ? 'neutral' : mult < 3.5 ? 'caution' : 'sell');
  }

  // Weekly RSI
  const latestRsi = findLatest('weeklyRsi');
  if (latestRsi) {
    const v = latestRsi.weeklyRsi;
    setCard('rsi', fmt(v, 1),
      v < 30 ? 'Oversold' : v > 70 ? 'Overbought' : 'Neutral',
      v < 30 ? 'buy' : v > 70 ? 'sell' : 'neutral');
  } else {
    setCard('rsi', '—', 'Awaiting data', 'neutral');
  }

  // Mayer Multiple
  const latestMayer = findLatest('mayer');
  if (latestMayer) {
    const v = latestMayer.mayer;
    setCard('mayer', fmt(v, 2) + '×',
      v < 0.6 ? 'Undervalued' : v > 2.4 ? 'Overheated' : 'Neutral',
      v < 0.6 ? 'buy' : v > 2.4 ? 'sell' : 'neutral');
  } else {
    setCard('mayer', '—', 'Awaiting data', 'neutral');
  }

  // Puell Multiple
  const latestPuell = findLatest('puell');
  if (latestPuell) {
    const v = latestPuell.puell;
    setCard('puell', fmt(v, 2),
      v < 0.5 ? 'Buy Zone' : v > 4 ? 'Sell Zone' : 'Neutral',
      v < 0.5 ? 'buy' : v > 4 ? 'sell' : 'neutral');
  } else {
    setCard('puell', '—', 'Awaiting data', 'neutral');
  }

  // Log Regression
  const latestLog = findLatest('logRegrPct');
  if (latestLog) {
    const pct = (latestLog.logRegrPct * 100).toFixed(0);
    setCard('logregr', pct + 'th %ile',
      latestLog.logRegrPct < 0.25 ? 'Undervalued' : latestLog.logRegrPct > 0.75 ? 'Overvalued' : 'Fair value',
      latestLog.logRegrPct < 0.25 ? 'buy' : latestLog.logRegrPct > 0.75 ? 'sell' : 'neutral');
  } else {
    setCard('logregr', '—', 'Awaiting data', 'neutral');
  }

  // Fear & Greed
  const latestFG = findLatest('fearGreed');
  if (latestFG) {
    const v = latestFG.fearGreed;
    const cls = v < 25 ? 'buy' : v > 75 ? 'sell' : 'neutral';
    const lbl = v < 25 ? 'Extreme Fear' : v < 45 ? 'Fear' : v > 75 ? 'Extreme Greed' : v > 55 ? 'Greed' : 'Neutral';
    setCard('fear', v + ' / 100', lbl, cls);
  } else {
    setCard('fear', '—', 'Awaiting data', 'neutral');
  }

  // MVRV Z-Score
  const latestMvrv = findLatest('mvrvZ');
  if (latestMvrv) {
    const v = latestMvrv.mvrvZ;
    setCard('mvrvz', fmt(v, 2),
      v < 0.1 ? 'Undervalued' : v > 7 ? 'Overheated' : v > 4 ? 'Elevated' : 'Neutral',
      v < 0.1 ? 'buy' : v > 7 ? 'sell' : v > 4 ? 'caution' : 'neutral');
  } else {
    setCard('mvrvz', '—', 'Awaiting data', 'neutral');
  }
}

function setCard(id, value, detail, signal) {
  const valEl    = $(`card-val-${id}`);
  const detailEl = $(`card-detail-${id}`);
  const dotEl    = $(`card-dot-${id}`);
  if (valEl)    valEl.textContent    = value;
  if (detailEl) detailEl.textContent = detail;
  if (dotEl)    dotEl.className      = `card-dot ${signal}`;
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  UI: halving countdown                                                   */
/* ════════════════════════════════════════════════════════════════════════ */
function updateHalving(info) {
  if (!info) return;
  const el = $('halving-info');
  if (el) el.textContent =
    `Next halving: block ${info.nextHalving.toLocaleString()} — `
    + `${info.blocksLeft.toLocaleString()} blocks away (~${info.daysLeft} days)`;
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Current normalized inputs (most recent value per metric)                */
/* ════════════════════════════════════════════════════════════════════════ */
function buildCurrentInputs(rows) {
  const keys = ['ma200w', 'mayer', 'logRegr', 'rsi', 'puell', 'fearGreed', 'mvrvZ'];
  const inp = {};
  for (const k of keys) {
    const r = [...rows].reverse().find(x =>
      x.riskInputs && x.riskInputs[k] != null && !isNaN(x.riskInputs[k]));
    inp[k] = r ? r.riskInputs[k] : null;
  }
  return inp;
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Actionable "this week" recommendation                                   */
/* ════════════════════════════════════════════════════════════════════════ */
function renderAction() {
  const out = $('action-output');
  if (!out) return;

  const score = State.currentRisk;
  const price = State.currentPrice;
  const info  = Calc.riskLabel(score);

  const sigEl = $('action-signal');
  if (sigEl) {
    sigEl.textContent = score == null ? 'Signal: —' : `Signal: ${info.label} (${fmt(score, 1)}/10)`;
    sigEl.style.color = info.color || 'var(--text-2)';
  }

  if (score == null) { out.innerHTML = '<span class="act-sub">Awaiting score…</span>'; return; }

  const mult     = Backtest.allocFor(score);          // +2.0 … 0 … −0.20
  const budget   = parseFloat($('act-budget')?.value)   || 0;
  const holdings = parseFloat($('act-holdings')?.value) || 0;

  if (mult > 0) {
    const usd = budget * mult;
    const btc = price ? usd / price : null;
    out.innerHTML =
      `<span class="act-verb buy">Buy ${fmtUSD(usd)}</span>` +
      (btc != null ? ` <span class="act-sub">≈ ${btc.toFixed(5)} ₿ this week</span>` : '') +
      ` <span class="act-mult">(${Math.round(mult * 100)}% of your $${fmt(budget, 0)} budget)</span>`;
  } else if (mult === 0) {
    out.innerHTML = `<span class="act-verb hold">Hold</span> <span class="act-sub">No buy this week — wait for a lower score.</span>`;
  } else {
    const pct = Math.round(-mult * 100);
    let extra = '';
    if (holdings > 0 && price) {
      const sellBtc = holdings * (-mult);
      extra = ` <span class="act-sub">≈ ${sellBtc.toFixed(5)} ₿ = ${fmtUSD(sellBtc * price)}</span>`;
    } else {
      extra = ` <span class="act-sub">enter holdings above for the ₿/$ amount</span>`;
    }
    out.innerHTML = `<span class="act-verb sell">Trim ${pct}%</span> <span class="act-sub">of your BTC holdings</span>${extra}`;
  }
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Score-contribution breakdown                                            */
/* ════════════════════════════════════════════════════════════════════════ */
function renderScoreBreakdown() {
  const el = $('risk-breakdown');
  if (!el) return;

  const bd = Calc.scoreBreakdown(State.currentInputs);
  if (!bd || bd.score == null) { el.innerHTML = '<div class="bd-note">Awaiting score…</div>'; return; }

  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';

  const cats = bd.cats.map(c => {
    const metricStr = c.metrics
      .map(m => m.present
        ? `${m.label} ${pct(m.value)}`
        : `<span class="bd-missing">${m.label} —</span>`)
      .join(' · ');
    const subPct = c.sub != null ? Math.round(c.sub * 100) : 0;
    const wLabel = Math.abs(c.effectiveWeight - c.weight) > 0.001
      ? `${Math.round(c.weight * 100)}% → ${Math.round(c.effectiveWeight * 100)}%`   // renormalized
      : `${Math.round(c.weight * 100)}%`;
    const name = c.name.charAt(0).toUpperCase() + c.name.slice(1);
    return `
      <div class="bd-cat">
        <div class="bd-cat-head">
          <span class="bd-cat-name">${name}</span>
          <span class="bd-cat-weight">weight ${wLabel}</span>
          <span class="bd-cat-contrib">+${fmt(c.contribution, 2)} pts</span>
        </div>
        <div class="bd-bar"><div class="bd-bar-fill" style="width:${subPct}%"></div></div>
        <div class="bd-metrics">${metricStr}</div>
      </div>`;
  }).join('');

  el.innerHTML =
    `<div class="bd-head">Why ${fmt(bd.score, 1)}/10? — category contributions (sum to the score)</div>` +
    cats +
    (bd.anyMissing
      ? `<div class="bd-note">Greyed metrics have no current reading (weekly RSI / Puell can lag); remaining weights are renormalized so the score still sums to 100%.</div>`
      : '');
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Navigation                                                              */
/* ════════════════════════════════════════════════════════════════════════ */
function navigate(section) {
  State.currentSection = section;

  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.section === section));
  $$('.section').forEach(s => s.classList.toggle('active', s.id === `sec-${section}`));

  // Lazy-render charts only when their section is first shown
  if (!$(`${section}-rendered`)) {
    renderSection(section);
    const marker = document.createElement('span');
    marker.id = `${section}-rendered`;
    marker.style.display = 'none';
    document.body.appendChild(marker);
  }
}

// Rows clipped to the global date range. Metrics are NOT recomputed — the full
// history is needed for moving averages, regression, etc. — we only restrict
// which rows the chart draws.
function rangedRows() {
  const { start, end } = State.dateRange;
  if (!start && !end) return State.rows;
  return State.rows.filter(r =>
    (!start || r.dateStr >= start) && (!end || r.dateStr <= end));
}

function renderSection(section) {
  const { regression, residuals } = State;
  if (!State.rows.length) return;
  const rows = rangedRows();

  switch (section) {
    case 'dashboard':   ChartRenderers.overview('chart-overview', rows, State.scalePrefs.overview); break;
    case 'ma200w':      ChartRenderers.ma200w('chart-ma200w', rows, State.scalePrefs.ma200w); break;
    case 'rsi':         ChartRenderers.rsi('chart-rsi', rows); break;
    case 'mayer':       ChartRenderers.mayer('chart-mayer', rows); break;
    case 'puell':       ChartRenderers.puell('chart-puell', rows); break;
    case 'mvrvz':       ChartRenderers.mvrvz('chart-mvrvz', rows); break;
    case 'logregr':     ChartRenderers.logRegression('chart-logregr', rows, regression, residuals, State.scalePrefs.logregr); break;
    case 'picycle':     ChartRenderers.piCycle('chart-picycle', rows, State.scalePrefs.picycle); break;
    case 'risk':        ChartRenderers.risk('chart-risk', rows); break;
    case 'backtest':    renderBacktest(); break;
  }
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Backtest                                                                */
/* ════════════════════════════════════════════════════════════════════════ */
// Current backtest options shared by the chart and the optimizer.
function backtestOpts() {
  return {
    weeklyAmount: $('bt-amount')?.value,
    feePct:       $('bt-fee')?.value,
    rotate:       document.querySelector('.bt-sell-btn.active')?.dataset.sell === 'rotate',
    startDate:    State.dateRange.start,
    endDate:      State.dateRange.end,
  };
}

function renderBacktest() {
  const { rows } = State;
  if (!rows.length) return;

  const result = Backtest.run(rows, backtestOpts());
  State.lastBacktest = result;

  ChartRenderers.backtest('chart-backtest', result, State.scalePrefs.backtest);
  renderBacktestStats(result);
}

function renderBacktestStats(result) {
  const el = $('bt-stats');
  if (!el) return;
  if (!result || !result.summary) { el.innerHTML = '<div class="bt-empty">No data in the selected range.</div>'; return; }

  const { plain, smart, lump, years } = result.summary;
  const cols = [plain, smart, lump];

  const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const usd = v => v == null ? '—' : fmtUSD(v);
  const btc = v => v == null ? '—' : v.toFixed(4) + ' ₿';
  const num = v => v == null ? '—' : v.toFixed(2);

  // dir: +1 higher is better, -1 lower is better, 0 no winner
  const rows = [
    { label: 'Capital deployed',  fmt: usd, get: s => s.deployed,    dir:  0 },
    { label: 'BTC stacked',       fmt: btc, get: s => s.btc,         dir:  1 },
    { label: 'Portfolio value',   fmt: usd, get: s => s.value,       dir:  1 },
    { label: 'Total return',      fmt: pct, get: s => s.roi,         dir:  1 },
    { label: 'Annualized (IRR)',  fmt: pct, get: s => s.irr,         dir:  1 },
    { label: 'Volatility (ann.)', fmt: pct, get: s => s.vol,         dir: -1 },
    { label: 'Sharpe',            fmt: num, get: s => s.sharpe,      dir:  1 },
    { label: 'Sortino',           fmt: num, get: s => s.sortino,     dir:  1 },
    { label: 'Max drawdown',      fmt: pct, get: s => s.maxDrawdown, dir: -1 },
  ];

  const header =
    `<div class="bt-trow bt-thead">
       <div class="bt-tcell bt-tlabel"></div>
       <div class="bt-tcell">Plain DCA</div>
       <div class="bt-tcell bt-thi">Score-Weighted</div>
       <div class="bt-tcell">Lump-Sum</div>
     </div>`;

  const body = rows.map(row => {
    const vals = cols.map(row.get);
    let bestIdx = -1, best = null;
    if (row.dir !== 0) vals.forEach((v, i) => {
      if (v != null && isFinite(v) && (best == null || (row.dir > 0 ? v > best : v < best))) { best = v; bestIdx = i; }
    });
    const cells = vals.map((v, i) =>
      `<div class="bt-tcell ${i === bestIdx ? 'win' : ''}">${row.fmt(v)}</div>`).join('');
    return `<div class="bt-trow"><div class="bt-tcell bt-tlabel">${row.label}</div>${cells}</div>`;
  }).join('');

  const a = smart.activity || { buys: 0, holds: 0, sells: 0 };
  const note =
    `<div class="bt-note">${result.periods.toLocaleString()} weekly periods (~${years.toFixed(1)} yrs). ` +
    `Score-weighted activity: ${a.buys} buys · ${a.holds} holds · ${a.sells} sells · idle cash ${fmtUSD(smart.proceeds)}. ` +
    `Returns, Sharpe and Sortino are contribution-adjusted (new cash isn't counted as gains); drawdown is on the growth index. ` +
    `Lump-sum deploys the same total capital as Plain DCA, all at the start.</div>`;

  el.innerHTML = `<div class="bt-table">${header}${body}</div>${note}`;
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Linear / Log scale toggles                                              */
/* ════════════════════════════════════════════════════════════════════════ */
function rerenderChart(chartKey) {
  const { regression, residuals } = State;
  if (!State.rows.length) return;
  const rows  = rangedRows();
  const scale = State.scalePrefs[chartKey];

  switch (chartKey) {
    case 'overview': ChartRenderers.overview('chart-overview', rows, scale); break;
    case 'ma200w':   ChartRenderers.ma200w('chart-ma200w', rows, scale); break;
    case 'logregr':  ChartRenderers.logRegression('chart-logregr', rows, regression, residuals, scale); break;
    case 'picycle':  ChartRenderers.piCycle('chart-picycle', rows, scale); break;
    case 'backtest': ChartRenderers.backtest('chart-backtest', State.lastBacktest, scale); break;
  }
}

function setupScaleToggles() {
  $$('.scale-toggle').forEach(group => {
    const chartKey = group.dataset.chart;
    group.querySelectorAll('.scale-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const scale = btn.dataset.scale;
        if (State.scalePrefs[chartKey] === scale) return;
        State.scalePrefs[chartKey] = scale;
        group.querySelectorAll('.scale-btn').forEach(b => b.classList.toggle('active', b === btn));
        rerenderChart(chartKey);
      });
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Loading/error states                                                    */
/* ════════════════════════════════════════════════════════════════════════ */
function setStatus(msg, isError = false) {
  const cls = isError ? 'status-error' : 'status-ok';
  [$('status-msg'), $('status-msg-bottom')].forEach(el => {
    if (el) { el.textContent = msg; el.className = cls; }
  });
}

function showApp() {
  $('loader').style.display    = 'none';
  $('app').style.display       = '';
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Boot                                                                    */
/* ════════════════════════════════════════════════════════════════════════ */
async function init() {
  try {
    setStatus('Loading price history…');

    // 1 — Blockchain.info price history (critical — full genesis-to-today series)
    let priceData;
    try {
      priceData = await API.fetchPriceHistory();
      if (!priceData?.values?.length) throw new Error('Empty response');
    } catch (e) {
      console.error('Price history fetch failed:', e);
      setStatus(
        `Failed to load price data (${e.message}). Open the browser console for details, `
        + `or test the URL directly: api.blockchain.info/charts/market-price`,
        true
      );
      showApp();
      return;
    }

    setStatus('Loading market cap & miner revenue…');

    // 2 — Market cap + miner revenue (optional — used for Puell Multiple)
    const [mcapData, revenueData] = await Promise.all([
      API.fetchMarketCap().catch(() => null),
      API.fetchMinerRevenue().catch(() => null),
    ]);

    setStatus('Loading sentiment data…');

    // 3 — Fear & Greed + MVRV Z-Score (optional)
    const [fgData, mvrvData] = await Promise.all([
      API.fetchFearGreed().catch(() => null),
      API.fetchMvrvZ().catch(() => null),
    ]);

    // 4 — Current price snapshot (optional — for header; falls back to last historical row)
    const priceSnap = await API.fetchCurrentPrice().catch(() => null);

    // 5 — Block height (optional — for halving)
    const height = await API.fetchBlockHeight().catch(() => null);

    setStatus('Computing metrics…');

    // Align & compute
    const aligned = Calc.alignData(priceData, mcapData, revenueData, fgData, mvrvData);
    if (!aligned.length) {
      setStatus('No historical data returned — blockchain.info API may be unavailable.', true);
      showApp();
      return;
    }
    const { rows, regression, residuals } = Calc.computeAll(aligned);

    State.rows       = rows;
    State.regression = regression;
    State.residuals  = residuals;

    // Live risk: take the most recent available normalized input for EACH
    // metric (weekly RSI and Puell don't update every day) and score that, so
    // the current reading reflects all categories rather than only whatever the
    // last daily row happened to carry.
    const findLatest = field => [...rows].reverse().find(r => r[field] != null);
    const last = findLatest('price');
    State.currentInputs = buildCurrentInputs(rows);
    State.currentRisk   = Calc.scoreFromInputs(State.currentInputs);
    State.currentPrice  = priceSnap?.bitcoin?.usd ?? last?.price ?? null;

    // Halving
    State.halvingInfo = Calc.halvingCountdown(height);

    // 6 — Render UI
    showApp();
    updateHeader(priceSnap, last);
    updateMetricCards(rows);
    updateHalving(State.halvingInfo);
    applyRiskColor(State.currentRisk ?? 5);
    renderAction();
    renderScoreBreakdown();
    navigate('dashboard');

    const ts = new Date().toLocaleTimeString();
    setStatus(`Updated ${ts} — ${rows.length.toLocaleString()} daily candles loaded`);

  } catch (e) {
    console.error(e);
    setStatus('Unexpected error: ' + e.message, true);
    showApp();
  }
}

/* ── Backtest controls ──────────────────────────────────────────────────── */
function setupBacktestControls() {
  const run = $('bt-run');
  if (run) run.addEventListener('click', renderBacktest);
  ['bt-amount', 'bt-fee'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', renderBacktest);
  });
  $$('.bt-sell-btn').forEach(btn => btn.addEventListener('click', () => {
    $$('.bt-sell-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderBacktest();
  }));
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Global date range                                                       */
/* ════════════════════════════════════════════════════════════════════════ */
// Re-render the active section, and drop the lazy-render markers so every other
// section redraws with the new range when next visited.
function refreshCharts() {
  $$('span[id$="-rendered"]').forEach(m => m.remove());
  renderSection(State.currentSection);
  const id = `${State.currentSection}-rendered`;
  if (!$(id)) {
    const marker = document.createElement('span');
    marker.id = id; marker.style.display = 'none';
    document.body.appendChild(marker);
  }
}

function applyDateRange(start, end) {
  State.dateRange = { start: start || null, end: end || null };
  const s = $('range-start'), e = $('range-end');
  if (s) s.value = State.dateRange.start || '';
  if (e) e.value = State.dateRange.end   || '';
  refreshCharts();
}

function setRangePreset(key, btn) {
  $$('.range-btn').forEach(b => b.classList.toggle('active', b === btn));
  if (key === 'all') { applyDateRange(null, null); return; }
  const rows = State.rows;
  if (!rows.length) return;
  const lastStr = rows[rows.length - 1].dateStr;
  const d = new Date(lastStr + 'T00:00:00Z');
  d.setUTCFullYear(d.getUTCFullYear() - parseInt(key, 10));
  applyDateRange(d.toISOString().slice(0, 10), null);
}

function setupDateRange() {
  $$('.range-btn').forEach(btn =>
    btn.addEventListener('click', () => setRangePreset(btn.dataset.range, btn))
  );
  ['range-start', 'range-end'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      $$('.range-btn').forEach(b => b.classList.remove('active'));  // custom = no preset
      applyDateRange($('range-start')?.value, $('range-end')?.value);
    });
  });
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Risk-score tuning + optimizer                                           */
/* ════════════════════════════════════════════════════════════════════════ */
// Snapshot the shipped defaults so "Reset" can restore them.
const TUNING_DEFAULTS = {
  window: CONFIG.PERCENTILE_WINDOW_DAYS,
  normalization: CONFIG.NORMALIZATION,
  weights: Object.fromEntries(
    Object.entries(CONFIG.RISK_CATEGORIES).map(([k, v]) => [k, v.weight])),
};
const CAT_KEYS = Object.keys(CONFIG.RISK_CATEGORIES);

// Re-score every row from current CONFIG and refresh the whole app. Pass
// rebuildInputs=false when only category weights changed (skips the heavier
// rolling-percentile recompute).
function recomputeScores(rebuildInputs = true) {
  if (!State.rows.length) return;
  Calc.applyScores(State.rows, rebuildInputs);
  State.currentInputs = buildCurrentInputs(State.rows);
  State.currentRisk   = Calc.scoreFromInputs(State.currentInputs);
  applyRiskColor(State.currentRisk ?? 5);
  renderAction();
  renderScoreBreakdown();
  refreshCharts();
}

/* ── Tuning controls ──────────────────────────────────────────────────── */
function syncTuningUI() {
  CAT_KEYS.forEach(k => {
    const pct = Math.round(CONFIG.RISK_CATEGORIES[k].weight * 100);
    const sl = $(`tune-w-${k}`);    if (sl)  sl.value = pct;
    const lb = $(`tune-wval-${k}`); if (lb)  lb.textContent = pct + '%';
  });
  const yrs = CONFIG.PERCENTILE_WINDOW_DAYS / 365;
  const ws = $('tune-window');     if (ws) ws.value = Math.round(yrs);
  const wl = $('tune-window-val'); if (wl) wl.textContent = (Math.round(yrs * 10) / 10) + 'y';
  $$('.tune-norm-btn[data-norm]').forEach(b => b.classList.toggle('active', b.dataset.norm === CONFIG.NORMALIZATION));
}

function onWeightChange() {
  CAT_KEYS.forEach(k => {
    const el = $(`tune-w-${k}`);
    if (el) CONFIG.RISK_CATEGORIES[k].weight = Number(el.value) / 100;
  });
  syncTuningUI();
  recomputeScores(false);      // weights only → reuse cached inputs
}
function onWindowChange() {
  CONFIG.PERCENTILE_WINDOW_DAYS = Math.round(Number($('tune-window').value) * 365);
  syncTuningUI();
  recomputeScores(true);
}
function onNormChange(mode) {
  CONFIG.NORMALIZATION = mode;
  syncTuningUI();
  recomputeScores(true);
}
function resetTuning() {
  CONFIG.PERCENTILE_WINDOW_DAYS = TUNING_DEFAULTS.window;
  CONFIG.NORMALIZATION = TUNING_DEFAULTS.normalization;
  CAT_KEYS.forEach(k => { CONFIG.RISK_CATEGORIES[k].weight = TUNING_DEFAULTS.weights[k]; });
  syncTuningUI();
  recomputeScores(true);
}

function setupTuning() {
  CAT_KEYS.forEach(k => {
    const sl = $(`tune-w-${k}`);
    if (sl) sl.addEventListener('input', onWeightChange);
  });
  const ws = $('tune-window'); if (ws) ws.addEventListener('input', onWindowChange);
  $$('.tune-norm-btn[data-norm]').forEach(b => b.addEventListener('click', () => onNormChange(b.dataset.norm)));
  const rb = $('tune-reset'); if (rb) rb.addEventListener('click', resetTuning);
  const ob = $('opt-run');    if (ob) ob.addEventListener('click', runOptimizer);
  const ab = $('opt-apply');  if (ab) ab.addEventListener('click', applyOptimizerBest);
  syncTuningUI();
}

/* ── Optimizer (grid search) ──────────────────────────────────────────── */
// Score from candidate category weights (membership fixed by CONFIG, weights
// supplied) without touching global CONFIG.
function scoreWithCats(inp, cats) {
  let tW = 0, tS = 0;
  for (const c of cats) {
    let sum = 0, n = 0;
    for (const m of c.metrics) { const v = inp[m]; if (v != null && !isNaN(v)) { sum += v; n++; } }
    if (!n) continue;
    tS += (sum / n) * c.weight; tW += c.weight;
  }
  return tW === 0 ? null : (tS / tW) * 10;
}

// All 4-category weight vectors summing to 1.0 in 0.1 steps, with every
// category ≥ `minTenths`/10. The floor (default 0.1) keeps the search away from
// degenerate corner solutions where the score collapses onto a single signal.
function weightCompositions(minTenths = 0) {
  const out = [];
  const m = minTenths;
  for (let a = m; a <= 10 - 3 * m; a++)
    for (let b = m; b <= 10 - a - 2 * m; b++)
      for (let c = m; c <= 10 - a - b - m; c++) {
        const d = 10 - a - b - c;
        out.push({ [CAT_KEYS[0]]: a / 10, [CAT_KEYS[1]]: b / 10, [CAT_KEYS[2]]: c / 10, [CAT_KEYS[3]]: d / 10 });
      }
  return out;
}

function objectiveValue(summary, kind) {
  if (!summary) return null;
  const s = summary.smart;
  if (kind === 'roi')     return s.roi;
  if (kind === 'btc')     return s.btcPer1k;
  if (kind === 'value')   return s.value;
  if (kind === 'sharpe')  return s.sharpe;
  if (kind === 'sortino') return s.sortino;
  if (kind === 'irr')     return s.irr;
  if (s.roi == null) return null;                       // risk-adjusted default
  return s.roi / Math.max(s.maxDrawdown, 0.01);
}

async function runOptimizer() {
  if (!State.rows.length) return;
  const runBtn = $('opt-run'), applyBtn = $('opt-apply'), status = $('opt-status');
  runBtn.disabled = true; applyBtn.style.display = 'none';

  const objective    = $('opt-objective')?.value || 'risk';
  const weeklyAmount = $('bt-amount')?.value || 100;
  const optFee       = $('bt-fee')?.value || 0;
  const optRotate    = document.querySelector('.bt-sell-btn.active')?.dataset.sell === 'rotate';
  const range        = State.dateRange;
  const windowsY     = [2, 3, 4, 5, 6];
  const minTenths    = Math.round((Number($('opt-minweight')?.value) || 0) / 10);
  const grid         = weightCompositions(minTenths);
  const savedWindow  = CONFIG.PERCENTILE_WINDOW_DAYS;
  let best = null;

  for (let wi = 0; wi < windowsY.length; wi++) {
    const yrs = windowsY[wi];
    if (status) status.textContent = `Testing ${yrs}-year window… (${wi + 1}/${windowsY.length})`;
    await new Promise(r => setTimeout(r, 16));          // let the UI paint

    CONFIG.PERCENTILE_WINDOW_DAYS = yrs * 365;
    const inputs = Calc.buildRiskInputs(State.rows);
    State.rows.forEach((r, i) => { r.riskInputs = inputs[i]; });

    for (const w of grid) {
      const cats = CAT_KEYS.map(k => ({ metrics: CONFIG.RISK_CATEGORIES[k].metrics, weight: w[k] }));
      const bt = Backtest.run(State.rows, {
        weeklyAmount, startDate: range.start, endDate: range.end,
        rotate: optRotate, feePct: optFee,
        scoreOf: r => scoreWithCats(r.riskInputs, cats),
      });
      const val = objectiveValue(bt.summary, objective);
      if (val != null && isFinite(val) && (!best || val > best.val)) {
        best = { val, windowY: yrs, weights: w, summary: bt.summary };
      }
    }
  }

  CONFIG.PERCENTILE_WINDOW_DAYS = savedWindow;
  recomputeScores(true);                                // restore user's settings
  State.optimizerBest = best;
  if (status) status.textContent = '';
  runBtn.disabled = false;
  renderOptimizerResult(best);
}

function renderOptimizerResult(best) {
  const el = $('opt-result'); if (!el) return;
  if (!best) { el.innerHTML = '<span class="bd-note">No result for this range.</span>'; return; }
  const wStr = CAT_KEYS.map(k => `${k} ${Math.round(best.weights[k] * 100)}%`).join(' · ');
  const s = best.summary.smart;
  const irr = s.irr != null ? (s.irr * 100).toFixed(0) + '%' : '—';
  const shp = s.sharpe != null ? s.sharpe.toFixed(2) : '—';
  el.innerHTML =
    `<div class="opt-best">Best: <strong>${best.windowY}y window</strong> · ${wStr}</div>` +
    `<div class="bd-note">IRR ${irr} · Sharpe ${shp} · max drawdown ${(s.maxDrawdown * 100).toFixed(0)}% · ${s.btcPer1k.toFixed(4)} ₿ per $1k</div>`;
  $('opt-apply').style.display = '';
}

function applyOptimizerBest() {
  const b = State.optimizerBest; if (!b) return;
  CONFIG.PERCENTILE_WINDOW_DAYS = b.windowY * 365;
  CAT_KEYS.forEach(k => { CONFIG.RISK_CATEGORIES[k].weight = b.weights[k]; });
  syncTuningUI();
  recomputeScores(true);
}

/* ── Wire up nav buttons ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $$('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.section))
  );
  setupScaleToggles();
  setupBacktestControls();
  setupDateRange();
  setupTuning();
  ['act-budget', 'act-holdings'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', renderAction);
  });
  init();
});
