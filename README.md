# ₿ Bitcoin Metrics Dashboard

A free, static Bitcoin metrics dashboard deployable to **GitHub Pages** — no backend, no API keys required.

## Features

| Chart | Description |
|---|---|
| **200 Week MA Heatmap** | Price coloured by distance from 200W MA — never-broken cycle bottom indicator |
| **Weekly RSI** | 14-period RSI on weekly closes (Wilder's smoothing) |
| **Mayer Multiple** | Price ÷ 200-day MA — over/undervaluation vs trend |
| **Puell Multiple** | Daily miner revenue ÷ 365d MA — miner capitulation & euphoria |
| **Log Regression + Quantile Fan** | Power-law regression bands (10th – 90th percentile) |
| **Pi Cycle Top** | 111 DMA vs 2× 350 DMA crossover — historical top signal |
| **Composite Risk Score** | Weighted 0–10 score used for DCA allocation decisions |

## Data Sources (all free, no key)

| Source | Endpoint | Used for |
|---|---|---|
| [Blockchain.info](https://blockchain.info) | `/charts/market-price` | Full daily price history (genesis → today) |
| [Blockchain.info](https://blockchain.info) | `/charts/market-cap` | Market capitalization history |
| [Blockchain.info](https://blockchain.info) | `/charts/miners-revenue` | Daily miner revenue (for Puell Multiple) |
| [Blockchain.info](https://blockchain.info) | `/q/getblockcount` | Current block height (halving countdown) |
| [CoinGecko](https://coingecko.com) | `/simple/price` | Live price snapshot for the header (24h change, volume) |
| [Alternative.me](https://alternative.me) | `/fng/` | Fear & Greed Index |

All responses are cached in `localStorage` for **15 minutes** to respect rate limits.

### Why blockchain.info instead of CoinGecko for history?

The original version of this dashboard used CoinGecko's `/market_chart?days=max` endpoint for full price history. CoinGecko has since restricted that endpoint on the free tier to the **trailing 365 days** (`error_code 10012`), which silently breaks any indicator needing multi-year data — the 200W MA, log regression, and Pi Cycle Top all need it. Blockchain.info's charts API has offered free, keyless, unrestricted full-history daily series for years and has no documented historical cap, so it's now the backbone data source. CoinGecko is still used for the live header price/24h-change snapshot, since that's a lightweight, non-historical call unaffected by the restriction.

### Why Mayer Multiple instead of MVRV Z-Score?

True MVRV Z-Score needs a **realized cap** series (the aggregate price at which each coin last moved on-chain). That data historically came free from CoinMetrics' Community API. CoinMetrics has since restricted price/cap metrics on its free, keyless tier to a handful of recent data points, so there's no longer a reliable *free, keyless, full-history* realized-cap source. Rather than ship a broken or faked metric, this dashboard uses the **Mayer Multiple** (price ÷ 200-day MA) instead — a simpler but well-established indicator that targets a similar "how stretched is price from trend" signal, fully derivable from price data alone.

If you want true MVRV Z-Score, you have two options:
1. **Register a free API key** with [BGeometrics](https://bitcoin-data.com) (formerly bitcoin-data.com), which offers a free tier (~8 req/hour) that includes a pre-computed MVRV Z-Score endpoint. Add the key to `js/config.js` and wire up a new `API.fetchMVRV()` call following the existing `fetchFearGreed()` pattern, then merge it into `Calc.alignData()`.
2. **Use a paid provider** (Glassnode, CoinMetrics Pro, Coin Metrics Network Data Pro) if you need institutional-grade realized cap history.

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
│   ├── calculations.js ← MA, RSI, Mayer, Puell, log regression
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
| Mayer Multiple | 25% | ratio < 0.6 | ratio > 2.4 |
| Puell Multiple | 20% | Puell < 0.3 | Puell > 4.0 |
| Log Regression Percentile | 15% | 0th %ile | 100th %ile |
| Fear & Greed Index | 5% | F&G < 5 | F&G > 95 |

Each metric is linearly scaled to [0, 1] and then multiplied by its weight. The final composite is multiplied by 10 to give a 0–10 score. If a metric is temporarily unavailable (e.g. an API is down), its weight is dropped and the remaining weights are renormalized — the score never silently breaks.

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
  mayer:     0.30,
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

- **Puell Multiple** depends on blockchain.info's `miners-revenue` chart. If that endpoint is ever unreachable, the Puell card shows `—` and the risk score renormalizes across the remaining five metrics.
- **Mayer Multiple replaces MVRV Z-Score** for the reasons explained above — see that section if you want to wire in true MVRV via a registered provider.
- Free, keyless APIs can and do change their terms over time (this rebuild exists because CoinGecko and CoinMetrics both tightened their free tiers). If a chart stops updating, open the browser console first — it will show which fetch failed — then check that provider's current API docs before assuming the dashboard code is at fault.
- Log regression extends across all BTC history from the genesis block. Very early data (2009–2012) has sparse trading history and should be viewed as an approximation.

---

## Disclaimer

This dashboard is for **educational and research purposes only**.
Nothing here constitutes financial advice. Bitcoin is highly volatile.
Always do your own research before making investment decisions.
