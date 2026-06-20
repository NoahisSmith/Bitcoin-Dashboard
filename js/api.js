/* ─── Bitcoin Metrics Dashboard — API Layer ──────────────────────────────── */

const API = {

  /* ── localStorage cache helpers ─────────────────────────────────────── */
  _getCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (Date.now() - ts > CONFIG.CACHE_TTL) return null;
      return data;
    } catch { return null; }
  },

  _setCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch { /* quota exceeded — skip */ }
  },

  /* ── Shared fetch with timeout ───────────────────────────────────────── */
  async _fetch(url, timeout = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  },

  /* ── CoinGecko: full daily price history ─────────────────────────────── */
  async fetchPriceHistory() {
    const key = 'cg_price_max';
    const cached = this._getCache(key);
    if (cached) return cached;

    // CoinGecko free tier — no key required; daily granularity with days=max
    const url = 'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart'
              + '?vs_currency=usd&days=max&interval=daily';
    const data = await this._fetch(url);
    this._setCache(key, data);
    return data;
  },

  /* ── CoinGecko: current price snapshot ───────────────────────────────── */
  async fetchCurrentPrice() {
    const key = 'cg_price_now';
    const cached = this._getCache(key);
    if (cached) return cached;

    const url = 'https://api.coingecko.com/api/v3/simple/price'
              + '?ids=bitcoin&vs_currencies=usd'
              + '&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true';
    const data = await this._fetch(url);
    this._setCache(key, data);
    return data;
  },

  /* ── CoinMetrics Community: realized cap + miner revenue ─────────────── */
  async fetchOnChain() {
    const key = 'cm_onchain';
    const cached = this._getCache(key);
    if (cached) return cached;

    // Community API — free, no key, 10 k rows covers all of BTC history
    const metrics = 'CapRealUSD,RevUSD';
    const url = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics`
              + `?assets=btc&metrics=${metrics}&frequency=1d`
              + `&start_time=2010-07-01&page_size=10000`;
    try {
      const data = await this._fetch(url);
      this._setCache(key, data);
      return data;
    } catch (e) {
      console.warn('CoinMetrics unavailable:', e.message);
      return null;
    }
  },

  /* ── Alternative.me: Fear & Greed Index (365 days) ──────────────────── */
  async fetchFearGreed() {
    const key = 'altme_fg';
    const cached = this._getCache(key);
    if (cached) return cached;

    const url = 'https://api.alternative.me/fng/?limit=365&format=json';
    try {
      const data = await this._fetch(url);
      this._setCache(key, data);
      return data;
    } catch (e) {
      console.warn('Fear & Greed unavailable:', e.message);
      return null;
    }
  },

  /* ── Blockchain.com: halving block estimation ────────────────────────── */
  async fetchBlockHeight() {
    const key = 'bc_height';
    const cached = this._getCache(key);
    if (cached) return cached;

    const url = 'https://blockchain.info/q/getblockcount?cors=true';
    try {
      const text = await fetch(url).then(r => r.text());
      const height = parseInt(text, 10);
      this._setCache(key, height);
      return height;
    } catch {
      return null;
    }
  },
};
