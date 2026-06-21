/* ─── Bitcoin Metrics Dashboard — Strategy Backtester ────────────────────── */
/*
 * Compares two weekly DCA strategies over historical price data:
 *   • Plain DCA          — invest a fixed amount every week, always.
 *   • Score-weighted DCA — scale each week's buy by the risk score's DCA
 *                          allocation (e.g. 200% near lows), and sell a slice
 *                          of holdings when the score signals distribution.
 *
 * Runs entirely on the already-computed State.rows (which carry the
 * lookahead-free riskScore), so it doubles as the tuning tool for the risk
 * weights/normalization in config.js: change those, reload, compare stats.
 */

const Backtest = {

  WEEK_MS: 7 * 86400000,

  /* ── Parse a DCA_TABLE alloc string into a numeric multiplier ─────────── */
  // '200%' → 2.0 (buy 2× the base amount); '0%' → 0 (skip the buy);
  // '−25%' → -0.25 (sell 25% of current holdings). Handles the unicode minus
  // sign used in the table as well as a plain hyphen.
  parseAlloc(s) {
    const n = parseFloat(String(s).replace(/[−–—]/g, '-').replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 1 : n / 100;
  },

  /* ── Allocation multiplier for a given score ─────────────────────────── */
  allocFor(score) {
    if (score == null) return 1;                 // no score yet → normal DCA
    const row = CONFIG.DCA_TABLE.find(r => score >= r.min && score < r.max)
             || CONFIG.DCA_TABLE[CONFIG.DCA_TABLE.length - 1];
    return this.parseAlloc(row.alloc);
  },

  // Largest positive buy multiplier in the DCA table (e.g. 2.0 at Strong Buy);
  // used to scale how aggressively the rotate strategy redeploys its cash.
  maxBuyMult() {
    return Math.max(1, ...CONFIG.DCA_TABLE.map(r => this.parseAlloc(r.alloc)));
  },

  /* ── Pick one row per ~7-day block within the date window ─────────────── */
  weeklyPeriods(rows, startMs, endMs) {
    const periods = [];
    let last = -Infinity;
    for (const r of rows) {
      if (!r.price) continue;
      const t = r.date.getTime();
      if (t < startMs || t > endMs) continue;
      if (t - last < this.WEEK_MS) continue;
      last = t;
      periods.push(r);
    }
    return periods;
  },

  /* ── Stats helpers ───────────────────────────────────────────────────── */
  _mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; },
  _std(a, mean) {
    if (a.length < 2) return 0;
    return Math.sqrt(a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1));
  },
  _downsideStd(a) {                                   // deviation of sub-zero returns
    const neg = a.filter(x => x < 0);
    if (!neg.length) return 0;
    return Math.sqrt(neg.reduce((s, x) => s + x * x, 0) / a.length);
  },

  // Money-weighted annualized return (IRR). cf[t] = external cashflow that
  // period (negative = money in); the final portfolio value is added to the
  // last period as a positive inflow. Solved for the periodic rate by bisection,
  // then annualized (ppy periods/yr). Null if there's no sign change.
  irr(contributions, finalValue, ppy) {
    const cf = contributions.map(x => -x);
    cf[cf.length - 1] += finalValue;
    const npv = rate => cf.reduce((s, x, t) => s + x / Math.pow(1 + rate, t), 0);
    let lo = -0.9999, hi = 1, flo = npv(lo), fhi = npv(hi), tries = 0;
    while (flo * fhi > 0 && hi < 1e6 && tries < 80) { hi *= 1.5; fhi = npv(hi); tries++; }
    if (flo * fhi > 0) return null;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (flo * fm <= 0) { hi = mid; } else { lo = mid; flo = fm; }
    }
    return Math.pow(1 + (lo + hi) / 2, ppy) - 1;
  },

  // Per-strategy risk/return metrics from its value (V) & contribution (C)
  // series. Period returns are adjusted for that period's external contribution
  // so adding cash isn't mistaken for investment performance; drawdown is taken
  // on the contribution-free growth index (true investment risk).
  metrics(V, C, deployed, btc) {
    const last = V[V.length - 1];
    const r = [];
    for (let t = 1; t < V.length; t++) {
      if (V[t - 1] > 0) r.push((V[t] - C[t]) / V[t - 1] - 1);
    }
    const mean = this._mean(r), sd = this._std(r, mean), dsd = this._downsideStd(r);
    const PPY = 52;
    let g = 1, peak = 1, mdd = 0;
    for (const x of r) { g *= (1 + x); if (g > peak) peak = g; if (peak > 0) mdd = Math.max(mdd, (peak - g) / peak); }
    return {
      deployed, btc, value: last,
      roi:      deployed > 0 ? last / deployed - 1 : null,
      btcPer1k: deployed > 0 ? (btc / deployed) * 1000 : null,
      irr:      this.irr(C, last, PPY),
      vol:      sd * Math.sqrt(PPY),
      sharpe:   sd  > 0 ? (mean / sd)  * Math.sqrt(PPY) : null,
      sortino:  dsd > 0 ? (mean / dsd) * Math.sqrt(PPY) : null,
      maxDrawdown: mdd,
    };
  },

  /* ── Run the simulation ──────────────────────────────────────────────── */
  // opts: { weeklyAmount, startDate, endDate, scoreOf }
  // scoreOf(row) lets callers (e.g. the optimizer) supply candidate scores
  // without mutating the rows; defaults to each row's stored riskScore.
  run(rows, opts = {}) {
    const weeklyAmount = Number(opts.weeklyAmount) > 0 ? Number(opts.weeklyAmount) : 100;
    const startMs = opts.startDate ? new Date(opts.startDate).getTime() : -Infinity;
    const endMs   = opts.endDate   ? new Date(opts.endDate).getTime()   :  Infinity;
    const scoreOf = typeof opts.scoreOf === 'function' ? opts.scoreOf : (r => r.riskScore);
    const rotate  = !!opts.rotate;                              // redeploy sell cash on buys
    const fee     = Math.max(0, Number(opts.feePct) || 0) / 100; // per-trade cost
    const maxBuy  = this.maxBuyMult();

    const periods = this.weeklyPeriods(rows, startMs, endMs);
    if (!periods.length) return { series: [], summary: null, periods: 0 };

    const plain = { btc: 0, deployed: 0 };
    // `cash` is sell proceeds: idle in hold mode, redeployable dry powder in rotate mode.
    const smart = { btc: 0, deployed: 0, cash: 0, buys: 0, holds: 0, sells: 0 };

    // Lump-sum / buy-and-hold benchmark: deploy the same total capital that
    // plain DCA will spend over the whole window, all at the first price.
    const totalCapital = weeklyAmount * periods.length;
    const lumpBtc = totalCapital * (1 - fee) / periods[0].price;

    const series = [];
    const Vp = [], Cp = [], Vs = [], Cs = [], Vl = [], Cl = [];

    periods.forEach((r, idx) => {
      const price = r.price;
      const score = scoreOf(r);

      // Plain DCA — fixed buy every week
      plain.btc += weeklyAmount * (1 - fee) / price; plain.deployed += weeklyAmount;
      const cP = weeklyAmount;

      // Score-weighted DCA
      const mult = this.allocFor(score);
      let cS = 0;
      if (mult > 0) {
        const spend = weeklyAmount * mult;
        smart.btc += spend * (1 - fee) / price; smart.deployed += spend; cS = spend; smart.buys++;
        // Rotate: redeploy a slice of accumulated cash, scaled by buy strength
        // (all of it at Strong Buy, proportionally less on weaker buys).
        if (rotate && smart.cash > 0) {
          const dep = smart.cash * Math.min(1, mult / maxBuy);
          smart.btc += dep * (1 - fee) / price; smart.cash -= dep;
        }
      } else if (mult < 0) {
        const sellBtc = smart.btc * (-mult);
        smart.btc -= sellBtc; smart.cash += sellBtc * price * (1 - fee); smart.sells++;
      } else smart.holds++;

      // Lump-sum — single deployment at the first period
      const cL = idx === 0 ? totalCapital : 0;

      const plainValue = plain.btc * price;
      const smartValue = smart.btc * price + smart.cash;
      const lumpValue  = lumpBtc * price;

      Vp.push(plainValue); Cp.push(cP);
      Vs.push(smartValue); Cs.push(cS);
      Vl.push(lumpValue);  Cl.push(cL);

      series.push({
        date: r.date, price, score,
        plainValue, smartValue, lumpValue,
        plainBtc: plain.btc, smartBtc: smart.btc, lumpBtc,
        plainDeployed: plain.deployed, smartDeployed: smart.deployed, smartProceeds: smart.cash,
      });
    });

    const summary = {
      plain: this.metrics(Vp, Cp, plain.deployed, plain.btc),
      smart: this.metrics(Vs, Cs, smart.deployed, smart.btc),
      lump:  this.metrics(Vl, Cl, totalCapital, lumpBtc),
      lastPrice: periods[periods.length - 1].price,
      years: (periods[periods.length - 1].date - periods[0].date) / (365.25 * 86400000),
    };
    summary.smart.proceeds = smart.cash;                       // idle / un-redeployed cash
    summary.smart.activity = { buys: smart.buys, holds: smart.holds, sells: smart.sells };

    return { series, periods: periods.length, summary };
  },
};
