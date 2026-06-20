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

  // Risk score metric weights (must sum to 1.0)
  RISK_WEIGHTS: {
    ma200w:    0.20,
    rsi:       0.15,
    mayer:     0.25,
    puell:     0.20,
    logRegr:   0.15,
    fearGreed: 0.05,
  },

  // Normalization ranges for each metric (min = 0 risk, max = 10 risk)
  RISK_RANGES: {
    ma200w:    { min: 0.75,  max: 3.5  },   // price / 200W MA ratio
    rsi:       { min: 20,    max: 90   },   // weekly RSI
    mayer:     { min: 0.6,   max: 2.4  },   // Mayer Multiple (price / 200D MA)
    puell:     { min: 0.3,   max: 4.0  },   // Puell Multiple
    logRegr:   { min: 0,     max: 1    },   // percentile (0–1)
    fearGreed: { min: 5,     max: 95   },   // F&G Index (0–100)
  },

  // DCA allocation table keyed by risk score floor
  DCA_TABLE: [
    { min: 0,  max: 2,  label: 'Strong Buy',   action: 'Accumulate heavily',  alloc: '200%', color: '#10b981' },
    { min: 2,  max: 3,  label: 'Buy',          action: 'Increase DCA',        alloc: '150%', color: '#34d399' },
    { min: 3,  max: 4,  label: 'Soft Buy',     action: 'Normal DCA',          alloc: '100%', color: '#6ee7b7' },
    { min: 4,  max: 6,  label: 'Neutral',      action: 'Minimum DCA / hold',  alloc: '50%',  color: '#94a3b8' },
    { min: 6,  max: 7,  label: 'Caution',      action: 'Reduce DCA size',     alloc: '0%',   color: '#f59e0b' },
    { min: 7,  max: 8,  label: 'Take Profits', action: 'DCA out ~10%',        alloc: '−10%', color: '#f97316' },
    { min: 8,  max: 9,  label: 'Sell',         action: 'DCA out ~25%',        alloc: '−25%', color: '#ef4444' },
    { min: 9,  max: 10, label: 'Strong Sell',  action: 'DCA out ~50%',        alloc: '−50%', color: '#b91c1c' },
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
