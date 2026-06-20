/* ─── Bitcoin Metrics Dashboard — Charts ─────────────────────────────────── */

// Register the annotation plugin (loaded via CDN before this script)
if (typeof ChartAnnotation !== 'undefined') {
  Chart.register(ChartAnnotation);
} else if (window['chartjs-plugin-annotation']) {
  Chart.register(window['chartjs-plugin-annotation']);
}

// Global Chart.js defaults
Chart.defaults.color            = '#8891a8';
Chart.defaults.font.family      = "'IBM Plex Mono', monospace";
Chart.defaults.font.size        = 11;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.elements.point.radius  = 0;
Chart.defaults.elements.point.hitRadius = 6;

const CHARTS = {};  // registry so we can destroy before recreating

function destroyChart(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
}

/* ── Shared chart options ──────────────────────────────────────────────── */
function baseOptions(yLog = false, yLabel = 'USD', yMin = undefined) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      tooltip: {
        backgroundColor: '#0c0c18',
        borderColor: '#1e1e30',
        borderWidth: 1,
        titleColor: '#f7931a',
        bodyColor: '#e2e8f0',
        padding: 10,
        callbacks: {
          label(ctx) {
            const v = ctx.parsed.y;
            if (v == null) return null;
            return ` ${ctx.dataset.label}: ${formatVal(v, ctx.dataset._fmt)}`;
          },
        },
      },
      annotation: { annotations: {} },
    },
    scales: {
      x: {
        type: 'time',
        // No fixed unit — Chart.js auto-selects (year for full history, down to
        // month/week as the date-range filter narrows the window).
        time: { tooltipFormat: 'MMM d, yyyy' },
        grid:  { color: '#1a1a2a' },
        ticks: { maxTicksLimit: 10, color: '#4a5568', autoSkip: true },
      },
      y: {
        type:     yLog ? 'logarithmic' : 'linear',
        position: 'right',
        min:      yMin,
        grid:     { color: '#1a1a2a' },
        ticks: {
          color: '#4a5568',
          callback: v => formatVal(v, yLabel),
          maxTicksLimit: 8,
        },
      },
    },
  };
}

function formatVal(v, fmt = 'USD') {
  if (v == null || isNaN(v)) return '—';
  if (fmt === 'USD') {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return '$' + v.toLocaleString(undefined, { maximumFractionDigits: 0 });
    return '$' + v.toFixed(2);
  }
  if (fmt === 'NUM') return v.toFixed(2);
  if (fmt === 'PCT') return (v * 100).toFixed(1) + '%';
  return String(v);
}

/* ── Annotation helpers ────────────────────────────────────────────────── */
function hZone(id, yMin, yMax, color, label = '') {
  return {
    [id]: {
      type: 'box',
      yMin, yMax,
      backgroundColor: color + '22',
      borderColor: color + '55',
      borderWidth: 1,
      label: label ? {
        content: label, display: true,
        color: color, font: { size: 10 },
        position: { x: 'start', y: 'center' },
      } : undefined,
    },
  };
}

function hLine(id, yVal, color, label = '') {
  return {
    [id]: {
      type: 'line',
      yMin: yVal, yMax: yVal,
      borderColor: color + 'aa',
      borderWidth: 1,
      borderDash: [4, 4],
      label: label ? { content: label, display: true, color, position: 'start', font: { size: 10 } } : undefined,
    },
  };
}

/* ── Thin daily data to at most N points for performance ─────────────── */
function thin(rows, maxPts = 1500) {
  if (rows.length <= maxPts) return rows;
  const step = Math.ceil(rows.length / maxPts);
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Chart renderers                                                        */
/* ═══════════════════════════════════════════════════════════════════════ */

const ChartRenderers = {

  /* ── Overview: price + 200 WMA ───────────────────────────────────────── */
  overview(canvasId, rows, scaleType = 'log') {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.price));
    const opts = baseOptions(scaleType === 'log', 'USD');

    opts.plugins.annotation.annotations = {
      ...hLine('zero', 1, '#4a5568'),
    };

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [
          {
            label: 'BTC Price', _fmt: 'USD',
            data: pts.map(r => r.price),
            borderColor: CONFIG.C.btc, borderWidth: 1.5,
            fill: false, tension: 0,
          },
          {
            label: '200W MA', _fmt: 'USD',
            data: pts.map(r => r.ma200w),
            borderColor: '#10b981', borderWidth: 1.5,
            borderDash: [6, 3], fill: false, tension: 0,
          },
        ],
      },
      options: opts,
    });
  },

  /* ── 200 Week Moving Average ──────────────────────────────────────────── */
  ma200w(canvasId, rows, scaleType = 'log') {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.price));
    const opts = baseOptions(scaleType === 'log', 'USD');

    // Colour‐coded price dataset (green below MA, orange above)
    const colorData = pts.map(r => {
      if (!r.ma200w || !r.price) return '#f7931a44';
      const mult = r.price / r.ma200w;
      if (mult < 1)   return '#10b981';
      if (mult < 1.5) return '#34d399';
      if (mult < 2.5) return '#f59e0b';
      if (mult < 4)   return '#f97316';
      return '#ef4444';
    });

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [
          {
            label: 'BTC Price', _fmt: 'USD',
            data: pts.map(r => r.price),
            borderColor: pts.map(r => {
              if (!r.ma200w) return CONFIG.C.btc;
              const m = r.price / r.ma200w;
              if (m < 1) return '#10b981'; if (m < 2) return '#f59e0b';
              if (m < 3.5) return '#f97316'; return '#ef4444';
            }),
            borderWidth: 1.5, fill: false, tension: 0,
            segment: { borderColor: ctx => colorData[ctx.p0DataIndex] || CONFIG.C.btc },
          },
          {
            label: '200W MA', _fmt: 'USD',
            data: pts.map(r => r.ma200w),
            borderColor: '#10b981', borderWidth: 2,
            fill: false, tension: 0,
          },
          {
            label: '200W MA × 5', _fmt: 'USD',
            data: pts.map(r => r.ma200w ? r.ma200w * 5 : null),
            borderColor: '#ef444466', borderWidth: 1,
            borderDash: [4, 4], fill: false, tension: 0,
          },
        ],
      },
      options: opts,
    });
  },

  /* ── Weekly RSI ───────────────────────────────────────────────────────── */
  rsi(canvasId, rows) {
    destroyChart(canvasId);
    // Only rows that have a weeklyRsi value
    const pts = thin(rows.filter(r => r.weeklyRsi != null));
    const opts = baseOptions(false, 'NUM');
    opts.scales.y.min = 0;
    opts.scales.y.max = 100;

    opts.plugins.annotation.annotations = {
      ...hZone('sell', 70, 100, '#ef4444', 'Sell Zone'),
      ...hZone('buy',  0,  30,  '#10b981', 'Buy Zone'),
      ...hLine('mid', 50, '#4a5568'),
    };

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [{
          label: 'Weekly RSI', _fmt: 'NUM',
          data: pts.map(r => r.weeklyRsi),
          borderColor: CONFIG.C.btc,
          borderWidth: 1.5, fill: false, tension: 0.2,
        }],
      },
      options: opts,
    });
  },

  /* ── Mayer Multiple ──────────────────────────────────────────────────── */
  mayer(canvasId, rows) {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.mayer != null));
    if (pts.length === 0) { showNoData(canvasId, 'Mayer Multiple data unavailable'); return; }
    const opts = baseOptions(false, 'NUM');

    opts.plugins.annotation.annotations = {
      ...hZone('sell', 2.4, 6,   '#ef4444', 'Overheated >2.4'),
      ...hZone('buy',  0,   0.6, '#10b981', 'Undervalued <0.6'),
      ...hLine('one', 1, '#4a5568'),
    };

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [{
          label: 'Mayer Multiple', _fmt: 'NUM',
          data: pts.map(r => r.mayer),
          borderColor: CONFIG.C.blue,
          borderWidth: 1.5, fill: false, tension: 0.1,
        }],
      },
      options: opts,
    });
  },

  /* ── Puell Multiple ──────────────────────────────────────────────────── */
  puell(canvasId, rows) {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.puell != null));
    if (pts.length === 0) { showNoData(canvasId, 'Puell data unavailable'); return; }
    const opts = baseOptions(false, 'NUM');

    opts.plugins.annotation.annotations = {
      ...hZone('sell', 4,   12,  '#ef4444', 'Sell Zone >4'),
      ...hZone('buy',  0,   0.5, '#10b981', 'Buy Zone <0.5'),
      ...hLine('one', 1, '#4a5568'),
    };

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [{
          label: 'Puell Multiple', _fmt: 'NUM',
          data: pts.map(r => r.puell),
          borderColor: CONFIG.C.purple,
          borderWidth: 1.5, fill: false, tension: 0.1,
        }],
      },
      options: opts,
    });
  },

  /* ── Logarithmic Regression + Quantile Fan ───────────────────────────── */
  logRegression(canvasId, rows, regression, residuals, scaleType = 'log') {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.price && r.logRegrPred));
    const opts = baseOptions(scaleType === 'log', 'USD');

    const quantileOffsets = CONFIG.QUANTILE_BANDS.map(q => Calc.quantile(residuals, q));
    const bandColors = ['#10b981', '#34d399', '#f7931a', '#f97316', '#ef4444'];
    const bandLabels = ['10th %ile', '25th %ile', 'Median (50th)', '75th %ile', '90th %ile'];

    const datasets = [
      {
        label: 'BTC Price', _fmt: 'USD',
        data: pts.map(r => r.price),
        borderColor: CONFIG.C.btc, borderWidth: 1.5, fill: false, tension: 0,
        order: 0,
      },
      ...quantileOffsets.map((offset, qi) => ({
        label: bandLabels[qi], _fmt: 'USD',
        data: pts.map(r => {
          const days = (r.date.getTime() - CONFIG.GENESIS.getTime()) / 86400000;
          if (days <= 1) return null;
          return Math.pow(10, regression.a + regression.b * Math.log10(days) + offset);
        }),
        borderColor: bandColors[qi],
        borderWidth: qi === 2 ? 1.5 : 1,
        borderDash:  qi === 2 ? [] : [5, 3],
        fill: qi > 0 ? '-1' : false,
        backgroundColor: bandColors[qi] + '0a',
        tension: 0,
        order: qi + 1,
      })),
    ];

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: { labels: pts.map(r => r.date), datasets },
      options: { ...opts, plugins: { ...opts.plugins, legend: { display: true, labels: { color: '#8891a8', boxWidth: 20, font: { size: 10 } } } } },
    });
  },

  /* ── Pi Cycle Top ────────────────────────────────────────────────────── */
  piCycle(canvasId, rows, scaleType = 'log') {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.price && r.piM111 != null && r.piM350x2 != null));
    const opts = baseOptions(scaleType === 'log', 'USD');

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [
          { label: 'BTC Price', _fmt: 'USD', data: pts.map(r => r.price), borderColor: CONFIG.C.btc, borderWidth: 1.5, fill: false, tension: 0 },
          { label: '111 DMA',   _fmt: 'USD', data: pts.map(r => r.piM111),   borderColor: '#10b981', borderWidth: 1.5, fill: false, tension: 0 },
          { label: '350 DMA×2', _fmt: 'USD', data: pts.map(r => r.piM350x2), borderColor: '#ef4444', borderWidth: 1.5, fill: false, tension: 0 },
        ],
      },
      options: { ...opts, plugins: { ...opts.plugins, legend: { display: true, labels: { color: '#8891a8', boxWidth: 20, font: { size: 10 } } } } },
    });
  },

  /* ── Composite Risk Score ─────────────────────────────────────────────── */
  risk(canvasId, rows) {
    destroyChart(canvasId);
    const pts = thin(rows.filter(r => r.riskScore != null));
    const opts = baseOptions(false, 'NUM');
    opts.scales.y.min = 0;
    opts.scales.y.max = 10;

    // Colour each segment by risk level
    const riskColor = v => {
      if (v == null) return '#4a5568';
      if (v < 2) return '#10b981'; if (v < 4) return '#34d399';
      if (v < 6) return '#f59e0b'; if (v < 7) return '#f97316';
      if (v < 8) return '#ef4444'; return '#b91c1c';
    };

    opts.plugins.annotation.annotations = {
      ...hZone('sb',  0,  2,  '#10b981'),
      ...hZone('buy', 2,  4,  '#34d399'),
      ...hZone('neu', 4,  6,  '#94a3b8'),
      ...hZone('cau', 6,  7,  '#f59e0b'),
      ...hZone('sel', 7,  10, '#ef4444'),
    };

    CHARTS[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'line',
      data: {
        labels: pts.map(r => r.date),
        datasets: [
          {
            label: 'Risk Score', _fmt: 'NUM',
            data: pts.map(r => r.riskScore),
            borderColor: pts.map(r => riskColor(r.riskScore)),
            borderWidth: 2, fill: false, tension: 0.15,
            segment: { borderColor: ctx => riskColor(ctx.p1.parsed.y) },
          },
          {
            label: 'BTC Price (log)', _fmt: 'USD',
            data: pts.map(r => r.price),
            borderColor: CONFIG.C.btc + '44', borderWidth: 1,
            fill: false, tension: 0,
            yAxisID: 'yPrice',
          },
        ],
      },
      options: {
        ...opts,
        scales: {
          ...opts.scales,
          yPrice: {
            type: 'logarithmic',
            position: 'left',
            grid: { display: false },
            ticks: { color: '#f7931a44', callback: v => formatVal(v, 'USD'), maxTicksLimit: 6 },
          },
        },
      },
    });
  },

  /* ── Backtest: portfolio value, Plain DCA vs Score-Weighted ──────────── */
  backtest(canvasId, result, scaleType = 'log') {
    destroyChart(canvasId);
    if (!result || !result.series.length) { showNoData(canvasId, 'No data in selected range'); return; }

    const canvas = document.getElementById(canvasId);
    if (canvas) canvas.style.display = '';   // un-hide if a prior run showed no-data
    const parent = canvas?.parentElement;
    const ph = parent?.querySelector('.no-data');
    if (ph) ph.remove();

    const pts  = thin(result.series, 2000);
    const opts = baseOptions(scaleType === 'log', 'USD');

    CHARTS[canvasId] = new Chart(canvas, {
      type: 'line',
      data: {
        labels: pts.map(s => s.date),
        datasets: [
          {
            label: 'Score-Weighted DCA', _fmt: 'USD',
            data: pts.map(s => s.smartValue),
            borderColor: CONFIG.C.green, borderWidth: 1.8, fill: false, tension: 0,
          },
          {
            label: 'Plain DCA', _fmt: 'USD',
            data: pts.map(s => s.plainValue),
            borderColor: CONFIG.C.btc, borderWidth: 1.5, fill: false, tension: 0,
          },
        ],
      },
      options: { ...opts, plugins: { ...opts.plugins, legend: { display: true, labels: { color: '#8891a8', boxWidth: 20, font: { size: 10 } } } } },
    });
  },
};

/* ── No-data placeholder ─────────────────────────────────────────────────── */
function showNoData(canvasId, msg) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const parent = canvas.parentElement;
  canvas.style.display = 'none';
  let ph = parent.querySelector('.no-data');
  if (!ph) { ph = document.createElement('div'); ph.className = 'no-data'; parent.appendChild(ph); }
  ph.textContent = msg;
}
