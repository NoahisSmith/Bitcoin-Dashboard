# ₿ Bitcoin Metrics Dashboard

A free, static Bitcoin metrics dashboard deployable to **GitHub Pages** — no backend, no API keys required.

## Features

| Chart | Description |
|---|---|
| **200 Week MA Heatmap** | Price coloured by distance from 200W MA — never-broken cycle bottom indicator |
| **Weekly RSI** | 14-period RSI on weekly closes (Wilder's smoothing) |
| **MVRV Z-Score** | (Market Cap − Realized Cap) / σ — best on-chain cycle indicator |
| **Puell Multiple** | Daily miner revenue ÷ 365d MA — miner capitulation & euphoria |
| **Log Regression + Quantile Fan** | Power-law regression bands (10th – 90th percentile) |
| **Pi Cycle Top** | 111 DMA vs 2× 350 DMA crossover — historical top signal |
| **Composite Risk Score** | Weighted 0–10 score used for DCA allocation decisions |

## Data Sources (all free, no key)

| Source | Endpoint | Used for |
|---|---|---|
| [CoinGecko](https://coingecko.com) | `/coins/bitcoin/market_chart` | Full price + market cap history |
| [CoinMetrics Community](https://coinmetrics.io) | `/v4/timeseries/asset-metrics` | Realized cap + miner revenue |
| [Alternative.me](https://alternative.me) | `/fng/` | Fear & Greed Index |
| [Blockchain.info](https://blockchain.info) | `/q/getblockcount` | Current block height (halving countdown) |

All responses are cached in `localStorage` for **15 minutes** to respect rate limits.

---

## Deploy to GitHub Pages

### 1 — Fork or create the repo

```bash
git init bitcoin-metrics
cd bitcoin-metrics
# Copy all files from this project
git add .
git commit -m "initial commit"
gh repo create bitcoin-metrics --public --push
```

### 2 — Enable GitHub Pages

1. Go to your repo on GitHub → **Settings → Pages**
2. Under **Source**, choose `Deploy from a branch`
3. Select `main` branch, `/ (root)` folder
4. Click **Save** — your site will be live at:
   `https://YOUR_USERNAME.github.io/bitcoin-metrics/`

### 3 — Update the footer link

In `index.html`, replace:
```html
href="https://github.com/YOUR_USERNAME/bitcoin-metrics"
```
with your actual GitHub URL.

---

## File Structure

```
bitcoin-metrics/
├── index.html          ← Single HTML entry point
├── css/
│   └── style.css       ← Dark terminal theme
├── js/
│   ├── config.js       ← Risk weights, DCA table, constants
│   ├── api.js          ← API fetching + localStorage cache
│   ├── calculations.js ← MA, RSI, MVRV, Puell, log regression
│   ├── charts.js       ← Chart.js renderers (one per metric)
│   └── main.js         ← App orchestration, navigation, UI
└── README.md
```

---

## Risk Score: How It Works

The composite **0–10 risk score** is a weighted average of six normalized sub-scores:

| Metric | Weight | Buy Signal | Sell Signal |
|---|---|---|---|
| 200W MA Multiple (price/MA) | 20% | ratio < 0.75 | ratio > 3.5 |
| Weekly RSI | 15% | RSI < 20 | RSI > 90 |
| MVRV Z-Score | 25% | Z < −1 | Z > 7 |
| Puell Multiple | 20% | Puell < 0.3 | Puell > 4.0 |
| Log Regression Percentile | 15% | 0th %ile | 100th %ile |
| Fear & Greed Index | 5% | F&G < 5 | F&G > 95 |

Each metric is linearly scaled to [0, 1] and then multiplied by its weight. The final composite is multiplied by 10 to give a 0–10 score.

### DCA Allocation Guide

| Risk Score | Signal | Action |
|---|---|---|
| 0 – 2 | 🟢 Strong Buy | +200% of normal DCA |
| 2 – 3 | 🟢 Buy | +150% |
| 3 – 4 | 🟡 Soft Buy | +100% |
| 4 – 6 | ⚪ Neutral | +50% |
| 6 – 7 | 🟠 Caution | 0% — stop buying |
| 7 – 8 | 🔴 Take Profits | −10% of holdings |
| 8 – 9 | 🔴 Sell | −25% of holdings |
| 9 – 10 | 🔴 Strong Sell | −50% of holdings |

---

## Customisation

### Change risk weights

In `js/config.js`, adjust `RISK_WEIGHTS` (values must sum to 1.0):

```js
RISK_WEIGHTS: {
  ma200w:    0.25,   // increase 200W MA weight
  rsi:       0.10,
  mvrv:      0.30,   // MVRV is most historically reliable
  puell:     0.20,
  logRegr:   0.10,
  fearGreed: 0.05,
},
```

### Change cache duration

```js
CACHE_TTL: 30 * 60 * 1000,  // 30 minutes instead of 15
```

### Add custom buy/sell alerts

In `js/main.js`, inside `init()` after `applyRiskColor()`:

```js
if (State.currentRisk < 2) {
  // Trigger browser notification or sound
  console.log('STRONG BUY signal!');
}
```

---

## Known Limitations

- **MVRV & Puell** require [CoinMetrics Community API](https://coinmetrics.io) to be reachable. If it's down, those cards show `—` and the risk score uses the remaining four metrics.
- CoinGecko free tier has strict rate limits — the 15-minute cache prevents most issues.
- Log regression extends across all BTC history from the genesis block. Very early data (2009–2012) has sparse trading history and should be viewed as an approximation.

---

## Disclaimer

This dashboard is for **educational and research purposes only**.  
Nothing here constitutes financial advice. Bitcoin is highly volatile.  
Always do your own research before making investment decisions.
