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
    case 'logregr':     ChartRenderers.logRegression('chart-logregr', rows, regression, residuals, State.scalePrefs.logregr); break;
    case 'picycle':     ChartRenderers.piCycle('chart-picycle', rows, State.scalePrefs.picycle); break;
    case 'risk':        ChartRenderers.risk('chart-risk', rows); break;
    case 'backtest':    renderBacktest(); break;
  }
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  Backtest                                                                */
/* ════════════════════════════════════════════════════════════════════════ */
function renderBacktest() {
  const { rows } = State;
  if (!rows.length) return;

  // The simulation window follows the global date range.
  const result = Backtest.run(rows, {
    weeklyAmount: $('bt-amount')?.value,
    startDate:    State.dateRange.start,
    endDate:      State.dateRange.end,
  });
  State.lastBacktest = result;

  ChartRenderers.backtest('chart-backtest', result, State.scalePrefs.backtest);
  renderBacktestStats(result);
}

function renderBacktestStats(result) {
  const el = $('bt-stats');
  if (!el) return;
  if (!result || !result.summary) { el.innerHTML = '<div class="bt-empty">No data in the selected range.</div>'; return; }

  const { plain, smart } = result.summary;
  const pct  = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
  const btc  = v => v == null ? '—' : v.toFixed(4) + ' ₿';
  const win  = (a, b) => a > b ? 'pos' : a < b ? 'neg' : '';

  const stat = (label, plainVal, smartVal, smartCls) => `
    <div class="bt-stat">
      <div class="bt-stat-label">${label}</div>
      <div class="bt-stat-row"><span>Plain</span><strong>${plainVal}</strong></div>
      <div class="bt-stat-row"><span>Weighted</span><strong class="${smartCls}">${smartVal}</strong></div>
    </div>`;

  el.innerHTML =
    stat('Capital deployed', fmtUSD(plain.deployed), fmtUSD(smart.deployed), '') +
    stat('BTC stacked',      btc(plain.btc),         btc(smart.btc),        win(smart.btc, plain.btc)) +
    stat('Portfolio value',  fmtUSD(plain.value),    fmtUSD(smart.value),   win(smart.value, plain.value)) +
    stat('Return on capital', pct(plain.roi),        pct(smart.roi),        win(smart.roi, plain.roi)) +
    stat('Max drawdown',     pct(plain.maxDrawdown), pct(smart.maxDrawdown), win(plain.maxDrawdown, smart.maxDrawdown)) +
    stat('Realized cash',    '—',                    fmtUSD(smart.proceeds), '') +
    `<div class="bt-note">${result.periods.toLocaleString()} weekly periods simulated. "Weighted" portfolio value includes realized cash from sells.</div>`;
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

    // 3 — Fear & Greed (optional)
    const fgData = await API.fetchFearGreed().catch(() => null);

    // 4 — Current price snapshot (optional — for header; falls back to last historical row)
    const priceSnap = await API.fetchCurrentPrice().catch(() => null);

    // 5 — Block height (optional — for halving)
    const height = await API.fetchBlockHeight().catch(() => null);

    setStatus('Computing metrics…');

    // Align & compute
    const aligned = Calc.alignData(priceData, mcapData, revenueData, fgData);
    if (!aligned.length) {
      setStatus('No historical data returned — blockchain.info API may be unavailable.', true);
      showApp();
      return;
    }
    const { rows, regression, residuals } = Calc.computeAll(aligned);

    State.rows       = rows;
    State.regression = regression;
    State.residuals  = residuals;

    // Current risk = the latest row that carries a (walk-forward) score.
    // computeAll already builds the score series with per-field staleness and
    // history gating baked in, so the live read is just the most recent value
    // rather than a separately re-derived calculation.
    const findLatest = field => [...rows].reverse().find(r => r[field] != null);
    const last = findLatest('price');
    State.currentRisk = findLatest('riskScore')?.riskScore ?? null;

    // Halving
    State.halvingInfo = Calc.halvingCountdown(height);

    // 6 — Render UI
    showApp();
    updateHeader(priceSnap, last);
    updateMetricCards(rows);
    updateHalving(State.halvingInfo);
    applyRiskColor(State.currentRisk ?? 5);
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
  const amt = $('bt-amount');
  if (amt) amt.addEventListener('change', renderBacktest);
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

/* ── Wire up nav buttons ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $$('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.section))
  );
  setupScaleToggles();
  setupBacktestControls();
  setupDateRange();
  init();
});
