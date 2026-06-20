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

  /* ── Composite risk score 0 – 10 ────────────────────────────────────── */
  riskScore({ price, ma200w, rsi, mayer, puell, logPct, fearGreed }) {
    const W = CONFIG.RISK_WEIGHTS;
    const R = CONFIG.RISK_RANGES;

    const scores = {
      ma200w:    price && ma200w ? this.norm(price / ma200w, R.ma200w.min, R.ma200w.max) : null,
      rsi:       this.norm(rsi,       R.rsi.min,       R.rsi.max),
      mayer:     this.norm(mayer,     R.mayer.min,     R.mayer.max),
      puell:     this.norm(puell,     R.puell.min,     R.puell.max),
      logRegr:   logPct,
      fearGreed: this.norm(fearGreed, R.fearGreed.min, R.fearGreed.max),
    };

    let totalW = 0, totalS = 0;
    for (const [k, w] of Object.entries(W)) {
      if (scores[k] != null) { totalS += scores[k] * w; totalW += w; }
    }
    return totalW === 0 ? null : (totalS / totalW) * 10;
  },

  /* ── Risk score series over time ────────────────────────────────────── */
  riskScoreSeries(data, regression, residualQuantiles) {
    return data.map(d => {
      if (!d.price) return null;

      // Log regression percentile
      let logPct = null;
      if (regression && d.date) {
        const days = (d.date - CONFIG.GENESIS.getTime()) / 86400000;
        if (days > 1) {
          const pred = regression.a + regression.b * Math.log10(days);
          const res  = Math.log10(d.price) - pred;
          const cnt  = residualQuantiles.filter(r => r <= res).length;
          logPct     = cnt / residualQuantiles.length;
        }
      }

      return this.riskScore({
        price:     d.price,
        ma200w:    d.ma200w,
        rsi:       d.weeklyRsi,
        mayer:     d.mayer,
        puell:     d.puell,
        logPct,
        fearGreed: d.fearGreed,
      });
    });
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

    // Risk score series
    const riskArr = this.riskScoreSeries(rows, regression, sortedRes);
    rows.forEach((row, i) => { row.riskScore = riskArr[i]; });

    return { rows, regression, residuals: sortedRes };
  },
};
