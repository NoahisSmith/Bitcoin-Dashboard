/* ─── Bitcoin Metrics Dashboard — Config ─────────────────────────────────── */

const CONFIG = {
  // Cache TTL: 15 minutes
  CACHE_TTL: 15 * 60 * 1000,

  // Bitcoin genesis block: Jan 3, 2009
  GENESIS: new Date('2009-01-03T00:00:00Z'),

  // 200-week MA = 1400 calendar days
  MA_200W_DAYS: 1400,

  // Weekly RSI period (14 weeks)
  RSI_PERIOD: 14,

  // ── Risk-score normalization mode ───────────────────────────────────────
  // 'percentile' (default): each metric's risk input is its walk-forward
  //   *trailing-window* percentile rank — cycle-relative and lookahead-free, so
  //   the ceiling adapts as each cycle tops lower than the last.
  // 'fixed': legacy behaviour — clamp each metric into the static RISK_RANGES
  //   below with flat per-metric RISK_WEIGHTS. Kept for A/B comparison in the
  //   backtester and for the absolute reading (e.g. "Mayer 2.4 = euphoria").
  NORMALIZATION: 'percentile',

  // Trailing window for the percentile rank, in days. A full-history (expanding)
  // window let the 2010–2013 hyper-volatile era — when price ran 5–10× its 200W
  // MA — permanently bias modern readings toward "cheap". Ranking each value only
  // against the most recent ~4 years (one halving cycle) keeps the score honest
  // about today's much lower-volatility regime instead of an era that no longer
  // recurs. Larger = smoother/longer memory; smaller = more reactive.
  PERCENTILE_WINDOW_DAYS: 1460,   // ≈ 4 years (one cycle)

  // Require this much history before emitting a score. Early-history percentiles
  // are unstable (few samples), so the score is suppressed until the dataset is
  // at least this old (≈ one full cycle of context).
  MIN_HISTORY_DAYS: 730,

  // Category weighting (used in 'percentile' mode). Grouping the price-derived
  // metrics into a single "valuation" category caps their combined influence at
  // the category weight instead of letting four collinear price signals quietly
  // dominate. Each category score is the mean of its available metric inputs,
  // then categories are combined by these weights. Tune via the backtester.
  RISK_CATEGORIES: {
    valuation: { weight: 0.45, metrics: ['ma200w', 'mayer', 'logRegr', 'mvrvZ'] },
    momentum:  { weight: 0.20, metrics: ['rsi'] },
    miner:     { weight: 0.20, metrics: ['puell'] },
    sentiment: { weight: 0.15, metrics: ['fearGreed'] },
  },

  // Legacy flat weights (used only in 'fixed' mode)
  RISK_WEIGHTS: {
    ma200w:    0.20,
    rsi:       0.15,
    mayer:     0.25,
    puell:     0.20,
    logRegr:   0.15,
    fearGreed: 0.05,
  },

  // Normalization ranges for each metric (used only in 'fixed' mode)
  RISK_RANGES: {
    ma200w:    { min: 0.75,  max: 3.5  },   // price / 200W MA ratio
    rsi:       { min: 20,    max: 90   },   // weekly RSI
    mayer:     { min: 0.6,   max: 2.4  },   // Mayer Multiple (price / 200D MA)
    puell:     { min: 0.3,   max: 4.0  },   // Puell Multiple
    logRegr:   { min: 0,     max: 1    },   // percentile (0–1)
    fearGreed: { min: 5,     max: 95   },   // F&G Index (0–100)
    mvrvZ:     { min: 0,     max: 7    },   // MVRV Z-Score (≈0 bottoms, ≈7 tops)
  },

  // DCA allocation table keyed by risk score floor.
  // Allocations are deliberately gentle: the strategy keeps buying across most of
  // the range (BTC's long-term uptrend rewards staying invested) and only trims
  // modestly at genuine extremes. Aggressive selling on every elevated reading
  // historically dumped the stack cheaply on false signals — see backtester.
  DCA_TABLE: [
    { min: 0,  max: 2,  label: 'Strong Buy',   action: 'Accumulate heavily',  alloc: '200%', color: '#10b981' },
    { min: 2,  max: 3,  label: 'Buy',          action: 'Increase DCA',        alloc: '150%', color: '#34d399' },
    { min: 3,  max: 4,  label: 'Soft Buy',     action: 'Normal DCA',          alloc: '100%', color: '#6ee7b7' },
    { min: 4,  max: 6,  label: 'Neutral',      action: 'Steady DCA',          alloc: '75%',  color: '#94a3b8' },
    { min: 6,  max: 7,  label: 'Caution',      action: 'Reduce DCA size',     alloc: '25%',  color: '#f59e0b' },
    { min: 7,  max: 8,  label: 'Take Profits', action: 'Trim ~5%',            alloc: '−5%',  color: '#f97316' },
    { min: 8,  max: 9,  label: 'Sell',         action: 'Trim ~10%',           alloc: '−10%', color: '#ef4444' },
    { min: 9,  max: 10, label: 'Strong Sell',  action: 'Trim ~20%',           alloc: '−20%', color: '#b91c1c' },
  ],

  // Log-regression quantile bands to draw
  QUANTILE_BANDS: [0.10, 0.25, 0.50, 0.75, 0.90],

  // Chart color palette
  C: {
    btc:    '#f7931a',
    green:  '#10b981',
    red:    '#ef4444',
    yellow: '#f59e0b',
    blue:   '#3b82f6',
    purple: '#8b5cf6',
    white:  '#e2e8f0',
    muted:  '#4a5568',
    bg:     '#07070e',
    surface:'#0c0c18',
  },
};
