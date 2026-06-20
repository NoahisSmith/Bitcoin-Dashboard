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

  /* ── Blockchain.com Charts API: free, keyless, FULL history ────────────
     Backbone data source for this dashboard. CoinGecko's free tier now
     caps historical lookback at 365 days (error_code 10012) and
     CoinMetrics' Community tier has similarly restricted price/cap
     metrics, so blockchain.info's charts endpoint — public since ~2014,
     no key, no documented rate limit — is the most reliable free source
     for genesis-to-today daily series. Same `/charts/$name` shape is
     reused for price, market cap, and miner revenue. ───────────────────── */
  async fetchBlockchainChart(chartName) {
    const key = `bc_chart_${chartName}`;
    const cached = this._getCache(key);
    if (cached) return cached;

    const url = `https://api.blockchain.info/charts/${chartName}`
              + `?timespan=all&format=json&sampled=false`;
    const data = await this._fetch(url);
    this._setCache(key, data);
    return data;
  },

  async fetchPriceHistory()  { return this.fetchBlockchainChart('market-price'); },
  async fetchMarketCap()     { return this.fetchBlockchainChart('market-cap'); },
  async fetchMinerRevenue()  { return this.fetchBlockchainChart('miners-revenue'); },

  /* ── CoinGecko: current price snapshot (not historical — unaffected) ──── */
  async fetchCurrentPrice() {
    const key = 'cg_price_now';
    const cached = this._getCache(key);
    if (cached) return cached;

    const url = 'https://api.coingecko.com/api/v3/simple/price'
              + '?ids=bitcoin&vs_currencies=usd'
              + '&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true';
    try {
      const data = await this._fetch(url);
      this._setCache(key, data);
      return data;
    } catch (e) {
      console.warn('CoinGecko snapshot unavailable:', e.message);
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

  /* ── Blockchain.info: halving block estimation ────────────────────────── */
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
