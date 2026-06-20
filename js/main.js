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
  const last = [...rows].reverse().find(r => r.price);
  if (!last) return;

  // 200 WMA
  if (last.ma200w) {
    const mult = last.price / last.ma200w;
    setCard('ma200w', fmtUSD(last.ma200w), fmt(mult, 2) + '× MA',
      mult < 1 ? 'buy' : mult < 2 ? 'neutral' : mult < 3.5 ? 'caution' : 'sell');
  }

  // Weekly RSI
  if (last.weeklyRsi != null) {
    setCard('rsi', fmt(last.weeklyRsi, 1),
      last.weeklyRsi < 30 ? 'Oversold' : last.weeklyRsi > 70 ? 'Overbought' : 'Neutral',
      last.weeklyRsi < 30 ? 'buy' : last.weeklyRsi > 70 ? 'sell' : 'neutral');
  }

  // Mayer Multiple
  if (last.mayer != null) {
    setCard('mayer', fmt(last.mayer, 2) + '×',
      last.mayer < 0.6 ? 'Undervalued' : last.mayer > 2.4 ? 'Overheated' : 'Neutral',
      last.mayer < 0.6 ? 'buy' : last.mayer > 2.4 ? 'sell' : 'neutral');
  } else {
    setCard('mayer', '—', 'Awaiting data', 'neutral');
  }

  // Puell Multiple
  if (last.puell != null) {
    setCard('puell', fmt(last.puell, 2),
      last.puell < 0.5 ? 'Buy Zone' : last.puell > 4 ? 'Sell Zone' : 'Neutral',
      last.puell < 0.5 ? 'buy' : last.puell > 4 ? 'sell' : 'neutral');
  } else {
    setCard('puell', '—', 'Awaiting data', 'neutral');
  }

  // Log Regression
  if (last.logRegrPct != null) {
    const pct = (last.logRegrPct * 100).toFixed(0);
    setCard('logregr', pct + 'th %ile',
      last.logRegrPct < 0.25 ? 'Undervalued' : last.logRegrPct > 0.75 ? 'Overvalued' : 'Fair value',
      last.logRegrPct < 0.25 ? 'buy' : last.logRegrPct > 0.75 ? 'sell' : 'neutral');
  }

  // Fear & Greed (find most recent)
  const lastFG = [...rows].reverse().find(r => r.fearGreed != null);
  if (lastFG) {
    const v = lastFG.fearGreed;
    const cls = v < 25 ? 'buy' : v > 75 ? 'sell' : 'neutral';
    const lbl = v < 25 ? 'Extreme Fear' : v < 45 ? 'Fear' : v > 75 ? 'Extreme Greed' : v > 55 ? 'Greed' : 'Neutral';
    setCard('fear', v + ' / 100', lbl, cls);
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

function renderSection(section) {
  const { rows, regression, residuals } = State;
  if (!rows.length) return;

  switch (section) {
    case 'dashboard':   ChartRenderers.overview('chart-overview', rows); break;
    case 'ma200w':      ChartRenderers.ma200w('chart-ma200w', rows); break;
    case 'rsi':         ChartRenderers.rsi('chart-rsi', rows); break;
    case 'mayer':       ChartRenderers.mayer('chart-mayer', rows); break;
    case 'puell':       ChartRenderers.puell('chart-puell', rows); break;
    case 'logregr':     ChartRenderers.logRegression('chart-logregr', rows, regression, residuals); break;
    case 'picycle':     ChartRenderers.piCycle('chart-picycle', rows); break;
    case 'risk':        ChartRenderers.risk('chart-risk', rows); break;
  }
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
    } catch (e) {
      setStatus('Failed to load price data. Check network / blockchain.info API.', true);
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

    // Current metrics
    const last = [...rows].reverse().find(r => r.price);
    if (last) {
      const logPct = last.logRegrPct ?? null;
      const lastFG = [...rows].reverse().find(r => r.fearGreed != null);
      State.currentRisk = Calc.riskScore({
        price:     last.price,
        ma200w:    last.ma200w,
        rsi:       last.weeklyRsi,
        mayer:     last.mayer,
        puell:     last.puell,
        logPct,
        fearGreed: lastFG?.fearGreed ?? null,
      });
    }

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

/* ── Wire up nav buttons ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $$('.nav-btn').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.section))
  );
  init();
});
