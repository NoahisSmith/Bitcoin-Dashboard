/* ─── Bitcoin Metrics Dashboard — Calculations ───────────────────────────── */

const Calc = {

  /* ── Simple Moving Average ──────────────────────────────────────────── */
  sma(arr, period) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += (arr[i] ?? 0);
      if (i >= period) sum -= (arr[i - period] ?? 0);
      if (i >= period - 1 && arr[i] != null) out[i] = sum / period;
    }
    return out;
  },

  /* ── Wilder RSI on arbitrary price array ────────────────────────────── */
  rsi(prices, period = 14) {
    const out = new Array(prices.length).fill(null);
    if (prices.length < period + 1) return out;

    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const d = prices[i] - prices[i - 1];
      avgGain += Math.max(d, 0);
      avgLoss += Math.max(-d, 0);
    }
    avgGain /= period;
    avgLoss /= period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

    for (let i = period + 1; i < prices.length; i++) {
      const d = prices[i] - prices[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  },

  /* ── Downsample daily → weekly (take last price of each 7-day block) ── */
  toWeekly(dates, prices) {
    const wDates = [], wPrices = [];
    for (let i = 6; i < prices.length; i += 7) {
      if (prices[i] != null) {
        wDates.push(dates[i]);
        wPrices.push(prices[i]);
      }
    }
    return { dates: wDates, prices: wPrices };
  },

  /* ── Log-log linear regression ──────────────────────────────────────── */
  // Returns { a, b, residuals }
  // Model: log10(price) = a + b * log10(days_since_genesis)
  logRegression(dates, prices) {
    const genesis = CONFIG.GENESIS.getTime();
    const pts = [];

    for (let i = 0; i < dates.length; i++) {
      const p = prices[i];
      if (!p || p <= 0) continue;
      const days = (new Date(dates[i]).getTime() - genesis) / 86400000;
      if (days <= 1) continue;
      pts.push({ x: Math.log10(days), y: Math.log10(p) });
    }

    const n   = pts.length;
    const mx  = pts.reduce((s, p) => s + p.x, 0) / n;
    const my  = pts.reduce((s, p) => s + p.y, 0) / n;
    const b   = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) /
                pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
    const a   = my - b * mx;

    const residuals = pts.map(p => p.y - (a + b * p.x));
    return { a, b, residuals };
  },

  /* ── Price at quantile for a given date ─────────────────────────────── */
  regrPriceAtQuantile(dateMs, regression, quantileOffset) {
    const days = (dateMs - CONFIG.GENESIS.getTime()) / 86400000;
    if (days <= 1) return null;
    return Math.pow(10, regression.a + regression.b * Math.log10(days) + quantileOffset);
  },

  /* ── Quantile of a sorted array ─────────────────────────────────────── */
  quantile(arr, q) {
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * q;
    const lo  = Math.floor(pos);
    return s[lo + 1] !== undefined
      ? s[lo] + (pos - lo) * (s[lo + 1] - s[lo])
      : s[lo];
  },

  /* ── Mayer Multiple ─────────────────────────────────────────────────── */
  // price / 200-day SMA. Free-data-derivable cycle indicator used here in
  // place of MVRV Z-Score: true MVRV needs a "realized cap" series (price
  // at which each coin last moved), which historically came from
  // CoinMetrics' free Community API. That tier has since restricted
  // price/cap metrics to a handful of recent data points, so there is no
  // longer a reliable *free, keyless, full-history* realized-cap source.
  // Mayer Multiple captures a similar "how stretched is price vs its
  // trend" signal using only price data, which we can source reliably.
  // See README for how to wire in a paid/registered MVRV provider instead.
  mayerSeries(prices) {
    const sma200d = this.sma(prices, 200);
    return prices.map((p, i) => (p != null && sma200d[i] != null && sma200d[i] > 0)
      ? p / sma200d[i]
      : null
    );
  },

  /* ── Puell Multiple ─────────────────────────────────────────────────── */
  // = daily miner revenue / 365-day MA of daily miner revenue
  puellSeries(revenues) {
    const ma365 = this.sma(revenues, 365);
    return revenues.map((r, i) => (r != null && ma365[i] != null && ma365[i] > 0)
      ? r / ma365[i]
      : null
    );
  },

  /* ── Pi Cycle Top (bonus indicator) ─────────────────────────────────── */
  // 111 DMA vs 2× 350 DMA
  piCycle(prices) {
    const m111  = this.sma(prices, 111);
    const m350  = this.sma(prices, 350);
    const m350x2 = m350.map(v => v != null ? v * 2 : null);
    return { m111, m350x2 };
  },

  /* ── Clamp + normalize helper ───────────────────────────────────────── */
  norm(value, min, max) {
    if (value == null || isNaN(value)) return null;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  },

  /* ── Walk-forward trailing-window percentile rank ───────────────────── */
  // For each index, the fraction of non-null values within the trailing
  // `windowMs` (and the current value itself) that are ≤ the current value,
  // in [0,1]. Null in → null out. Uses only data available up to that point
  // (no lookahead) and only the recent window (no permanent drag from the
  // ancient hyper-volatile era), so it tracks the prevailing regime.
  rollingPercentile(values, dates, windowMs) {
    const out = new Array(values.length).fill(null);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || isNaN(v)) continue;
      const cutoff = dates[i] - windowMs;
      let countLE = 0, total = 0;
      for (let j = i; j >= 0 && dates[j] >= cutoff; j--) {
        const w = values[j];
        if (w == null || isNaN(w)) continue;
        total++;
        if (w <= v) countLE++;
      }
      out[i] = total > 0 ? countLE / total : null;
    }
    return out;
  },

  /* ── Walk-forward log-regression percentile (lookahead-free) ────────── */
  // At each day t, fit the power law on data [0..t] only (incremental sums) —
  // the long-term structural law benefits from all prior data — then rank the
  // current residual against residuals within the trailing `windowMs`,
  // recomputed with that fit. Unlike the full-history fit used for the chart
  // overlay this never "knows" the future, and the windowed ranking keeps the
  // percentile relative to the recent regime.
  walkForwardLogPct(rows, windowMs) {
    const out = new Array(rows.length).fill(null);
    const g   = CONFIG.GENESIS.getTime();
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    const xs = [], ys = [], ds = [];

    for (let i = 0; i < rows.length; i++) {
      const p = rows[i].price;
      if (!p || p <= 0) continue;
      const t = rows[i].date.getTime();
      const days = (t - g) / 86400000;
      if (days <= 1) continue;

      const x = Math.log10(days), y = Math.log10(p);
      n++; sx += x; sy += y; sxx += x * x; sxy += x * y;
      xs.push(x); ys.push(y); ds.push(t);
      if (n < 2) continue;

      const denom = n * sxx - sx * sx;
      if (denom === 0) continue;
      const b = (n * sxy - sx * sy) / denom;
      const a = (sy - b * sx) / n;
      const resCur = y - (a + b * x);

      const cutoff = t - windowMs;
      let countLE = 0, total = 0;
      for (let k = xs.length - 1; k >= 0 && ds[k] >= cutoff; k--) {
        total++;
        if (ys[k] - (a + b * xs[k]) <= resCur) countLE++;
      }
      out[i] = total > 0 ? countLE / total : null;
    }
    return out;
  },

  /* ── Per-row normalized risk inputs (0–1 each, higher = more risk) ───── */
  // Returns one object per row with each metric mapped to a risk contribution.
  // 'percentile' mode: expanding-window percentile (cycle-relative, no lookahead).
  // 'fixed' mode: legacy static-range clamping with the full-history log pct.
  buildRiskInputs(rows) {
    const mode  = CONFIG.NORMALIZATION;
    const ratio = rows.map(r => (r.price && r.ma200w) ? r.price / r.ma200w : null);
    const mayer = rows.map(r => r.mayer);
    const rsi   = rows.map(r => r.weeklyRsi);
    const puell = rows.map(r => r.puell);
    const fg    = rows.map(r => r.fearGreed);

    let nMa, nMy, nRs, nPu, nFg, nLog;
    if (mode === 'fixed') {
      const R = CONFIG.RISK_RANGES;
      nMa  = ratio.map(v => this.norm(v, R.ma200w.min, R.ma200w.max));
      nMy  = mayer.map(v => this.norm(v, R.mayer.min,  R.mayer.max));
      nRs  = rsi.map(v   => this.norm(v, R.rsi.min,    R.rsi.max));
      nPu  = puell.map(v => this.norm(v, R.puell.min,  R.puell.max));
      nFg  = fg.map(v    => this.norm(v, R.fearGreed.min, R.fearGreed.max));
      nLog = rows.map(r  => r.logRegrPct ?? null);          // legacy full-history pct
    } else {
      const dates    = rows.map(r => r.date.getTime());
      const windowMs = CONFIG.PERCENTILE_WINDOW_DAYS * 86400000;
      nMa  = this.rollingPercentile(ratio, dates, windowMs);
      nMy  = this.rollingPercentile(mayer, dates, windowMs);
      nRs  = this.rollingPercentile(rsi,   dates, windowMs);
      nPu  = this.rollingPercentile(puell, dates, windowMs);
      nFg  = this.rollingPercentile(fg,    dates, windowMs);
      nLog = this.walkForwardLogPct(rows, windowMs);        // trailing-window pct
    }

    return rows.map((r, i) => ({
      ma200w: nMa[i], mayer: nMy[i], logRegr: nLog[i],
      rsi: nRs[i], puell: nPu[i], fearGreed: nFg[i],
    }));
  },

  /* ── Composite risk score 0 – 10 from normalized inputs ──────────────── */
  // 'percentile' mode: weighted average across metric categories so the
  // collinear price metrics share a single capped "valuation" weight.
  // 'fixed' mode: legacy flat per-metric weighted average.
  scoreFromInputs(inp) {
    if (!inp) return null;

    if (CONFIG.NORMALIZATION === 'fixed') {
      const W = CONFIG.RISK_WEIGHTS;
      let totalW = 0, totalS = 0;
      for (const [k, w] of Object.entries(W)) {
        if (inp[k] != null && !isNaN(inp[k])) { totalS += inp[k] * w; totalW += w; }
      }
      return totalW === 0 ? null : (totalS / totalW) * 10;
    }

    let totalW = 0, totalS = 0;
    for (const cat of Object.values(CONFIG.RISK_CATEGORIES)) {
      const vals = cat.metrics.map(m => inp[m]).filter(v => v != null && !isNaN(v));
      if (!vals.length) continue;
      const sub = vals.reduce((a, b) => a + b, 0) / vals.length;
      totalS += sub * cat.weight;
      totalW += cat.weight;
    }
    return totalW === 0 ? null : (totalS / totalW) * 10;
  },

  /* ── Risk label lookup ──────────────────────────────────────────────── */
  riskLabel(score) {
    if (score == null) return { label: '—', color: '#94a3b8', action: '—' };
    return CONFIG.DCA_TABLE.find(r => score >= r.min && score < r.max)
        || CONFIG.DCA_TABLE[CONFIG.DCA_TABLE.length - 1];
  },

  /* ── Halving countdown ──────────────────────────────────────────────── */
  halvingCountdown(currentHeight) {
    if (!currentHeight) return null;
    const HALVING_INTERVAL = 210000;
    const nextHalving = Math.ceil(currentHeight / HALVING_INTERVAL) * HALVING_INTERVAL;
    const blocksLeft  = nextHalving - currentHeight;
    const daysLeft    = Math.round(blocksLeft * 10 / 60 / 24); // ~10 min/block
    return { nextHalving, blocksLeft, daysLeft };
  },

  /* ── Align blockchain.info chart series + Fear & Greed by date ───────── */
  // Each blockchain.info chart returns { values: [{ x: unixSeconds, y }] }.
  // Price is the backbone series (most complete); market cap and miner
  // revenue are merged onto it by day. Timestamps occasionally drift by a
  // few hours between charts, so we bucket everything to a UTC date string.
  alignData(priceData, mcapData, revenueData, fgData) {
    const map = new Map();

    const toDateStr = unixSeconds => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

    (priceData?.values || []).forEach(({ x, y }) => {
      if (y == null || y <= 0) return; // pre-exchange days where price is 0
      const dateStr = toDateStr(x);
      map.set(dateStr, {
        date:      new Date(dateStr + 'T00:00:00Z'),
        dateStr,
        price:     y,
        marketCap:    null,
        minerRevenue: null,
        fearGreed:    null,
        // calculated later:
        ma200w:    null,
        weeklyRsi: null,
        mayer:     null,
        puell:     null,
        riskScore: null,
      });
    });

    (mcapData?.values || []).forEach(({ x, y }) => {
      const entry = map.get(toDateStr(x));
      if (entry) entry.marketCap = y;
    });

    (revenueData?.values || []).forEach(({ x, y }) => {
      const entry = map.get(toDateStr(x));
      if (entry) entry.minerRevenue = y;
    });

    // Merge Fear & Greed (timestamps are Unix seconds)
    if (fgData?.data) {
      fgData.data.forEach(row => {
        const entry = map.get(toDateStr(parseInt(row.timestamp)));
        if (entry) entry.fearGreed = parseInt(row.value);
      });
    }

    return Array.from(map.values()).sort((a, b) => a.date - b.date);
  },

  /* ── Main pipeline: derive all metrics on aligned array ──────────────── */
  computeAll(rows) {
    const prices     = rows.map(r => r.price);
    const revenues    = rows.map(r => r.minerRevenue);
    const dates      = rows.map(r => r.dateStr);

    // 200 Week MA
    const ma200wArr = this.sma(prices, CONFIG.MA_200W_DAYS);

    // Puell Multiple
    const puellArr  = this.puellSeries(revenues);

    // Mayer Multiple
    const mayerArr  = this.mayerSeries(prices);

    // Log regression (on full price history)
    const regression = this.logRegression(dates, prices);
    const sortedRes  = [...regression.residuals].sort((a, b) => a - b);

    // Weekly RSI — project weekly RSI back onto daily grid
    const weekly    = this.toWeekly(dates, prices);
    const wRsi      = this.rsi(weekly.prices, CONFIG.RSI_PERIOD);
    // Build date→rsi lookup
    const wRsiMap   = new Map();
    weekly.dates.forEach((d, i) => wRsiMap.set(d, wRsi[i]));

    // Pi Cycle
    const { m111, m350x2 } = this.piCycle(prices);

    // Attach calculated fields back onto rows
    rows.forEach((row, i) => {
      row.ma200w    = ma200wArr[i];
      row.puell     = puellArr[i];
      row.mayer     = mayerArr[i];
      row.weeklyRsi = wRsiMap.get(row.dateStr) ?? null;
      row.piM111    = m111[i];
      row.piM350x2  = m350x2[i];

      // Log regression residual & percentile
      const days = (row.date.getTime() - CONFIG.GENESIS.getTime()) / 86400000;
      if (days > 1 && row.price > 0) {
        const pred       = regression.a + regression.b * Math.log10(days);
        row.logRegrPred  = Math.pow(10, pred);
        const res        = Math.log10(row.price) - pred;
        const cnt        = sortedRes.filter(r => r <= res).length;
        row.logRegrPct   = cnt / sortedRes.length;
      }
    });

    // Risk score series (walk-forward, lookahead-free). Each row keeps its
    // normalized inputs for transparency/debugging, and the score is gated
    // until enough history exists for stable percentiles.
    const inputs    = this.buildRiskInputs(rows);
    const firstDate = rows.find(r => r.price)?.date.getTime();
    rows.forEach((row, i) => {
      row.riskInputs = inputs[i];
      const ageDays  = firstDate != null ? (row.date.getTime() - firstDate) / 86400000 : 0;
      row.riskScore  = (ageDays >= CONFIG.MIN_HISTORY_DAYS)
        ? this.scoreFromInputs(inputs[i])
        : null;
    });

    return { rows, regression, residuals: sortedRes };
  },
};
