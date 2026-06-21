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

  /* ── Max drawdown of a value series (peak-to-trough, as a fraction) ───── */
  maxDrawdown(values) {
    let peak = -Infinity, mdd = 0;
    for (const v of values) {
      if (v > peak) peak = v;
      if (peak > 0) mdd = Math.max(mdd, (peak - v) / peak);
    }
    return mdd;
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

    const periods = this.weeklyPeriods(rows, startMs, endMs);
    if (!periods.length) return { series: [], summary: null, periods: 0 };

    const plain = { btc: 0, deployed: 0 };
    const smart = { btc: 0, deployed: 0, proceeds: 0 };
    const series = [];

    for (const r of periods) {
      const price = r.price;
      const score = scoreOf(r);

      // Plain DCA — fixed buy every week
      plain.btc += weeklyAmount / price;
      plain.deployed += weeklyAmount;

      // Score-weighted DCA
      const mult = this.allocFor(score);
      if (mult > 0) {
        const spend = weeklyAmount * mult;
        smart.btc += spend / price;
        smart.deployed += spend;
      } else if (mult < 0) {
        const sellBtc = smart.btc * (-mult);   // sell a fraction of holdings
        smart.btc -= sellBtc;
        smart.proceeds += sellBtc * price;
      }
      // mult === 0 → hold (no buy, no sell)

      series.push({
        date:          r.date,
        price,
        score,
        plainValue:    plain.btc * price,
        plainBtc:      plain.btc,
        plainDeployed: plain.deployed,
        smartValue:    smart.btc * price + smart.proceeds,
        smartBtc:      smart.btc,
        smartDeployed: smart.deployed,
        smartProceeds: smart.proceeds,
      });
    }

    return {
      series,
      periods: periods.length,
      summary: this.summarize(plain, smart, series),
    };
  },

  /* ── Build headline comparison stats ─────────────────────────────────── */
  summarize(plain, smart, series) {
    const lastPrice = series[series.length - 1].price;
    const plainValue = plain.btc * lastPrice;
    const smartValue = smart.btc * lastPrice + smart.proceeds;

    const mk = (deployed, btc, value) => ({
      deployed,
      btc,
      value,
      roi:        deployed > 0 ? (value / deployed - 1) : null,
      btcPer1k:   deployed > 0 ? (btc / deployed) * 1000 : null,
      maxDrawdown: 0,                                  // filled below
    });

    const plainStats = mk(plain.deployed, plain.btc, plainValue);
    const smartStats = mk(smart.deployed, smart.btc, smartValue);
    smartStats.proceeds = smart.proceeds;

    plainStats.maxDrawdown = this.maxDrawdown(series.map(s => s.plainValue));
    smartStats.maxDrawdown = this.maxDrawdown(series.map(s => s.smartValue));

    return { plain: plainStats, smart: smartStats, lastPrice };
  },
};
