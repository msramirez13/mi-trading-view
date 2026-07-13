// ============================================================
// app.js — Mi TradingView
// Lightweight Charts v5 + Binance (WebSocket en tiempo real),
// KuCoin (REST vía proxy) y Yahoo Finance (acciones/CEDEARs).
// ============================================================

/* global LightweightCharts, Indicators */

// ---------------- Configuración ----------------

const TIMEFRAMES = [
  { id: '1m',  label: '1m',  binance: '1m',  bybit: '1',   yahoo: { interval: '1m',  range: '7d'   } },
  { id: '5m',  label: '5m',  binance: '5m',  bybit: '5',   yahoo: { interval: '5m',  range: '60d'  } },
  { id: '15m', label: '15m', binance: '15m', bybit: '15',  yahoo: { interval: '15m', range: '60d'  } },
  { id: '30m', label: '30m', binance: '30m', bybit: '30',  yahoo: { interval: '30m', range: '60d'  } },
  { id: '1h',  label: '1h',  binance: '1h',  bybit: '60',  yahoo: { interval: '1h',  range: '730d' } },
  { id: '4h',  label: '4h',  binance: '4h',  bybit: '240', yahoo: null },
  { id: '1d',  label: 'D',   binance: '1d',  bybit: 'D',   yahoo: { interval: '1d',  range: '5y'   } },
  { id: '1w',  label: 'W',   binance: '1w',  bybit: 'W',   yahoo: { interval: '1wk', range: 'max'  } },
  { id: '1M',  label: 'M',   binance: '1M',  bybit: 'M',   yahoo: { interval: '1mo', range: 'max'  } },
  // 3M no existe nativo: se agregan 3 velas mensuales por trimestre
  { id: '3M',  label: '3M',  binance: '1M',  bybit: 'M', agg: 3, yahoo: { interval: '3mo', range: 'max' } },
];

const FAVORITES = {
  binance: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT'],
  kucoin: ['HYPEUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'SUIUSDT'],
  yahoo: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN', 'SPY', 'MELI',
          'GGAL', 'YPF', 'AAPL.BA', 'GGAL.BA', 'YPFD.BA', 'NVDA.BA'],
};

// La clave interna 'kucoin' se conserva para no romper listas/estado ya
// guardados, pero la fuente de datos real es Bybit (directo, sin proxy).
const SOURCE_NAMES = { binance: 'Binance', kucoin: 'Bybit', yahoo: 'Yahoo' };

// copia profunda — declarada temprano porque loadWatchlists() la usa al arrancar
const clone = (o) => JSON.parse(JSON.stringify(o));

const DEFAULT_WATCHLIST = [
  { title: 'Mercado Cripto', items: [
    { sym: 'BTCUSDT',  market: 'binance' },
    { sym: 'ETHUSDT',  market: 'binance' },
    { sym: 'HYPEUSDT', market: 'kucoin' },
    { sym: 'SOLUSDT',  market: 'binance' },
    { sym: 'BNBUSDT',  market: 'binance' },
  ]},
  { title: 'SP500 · Commodities', items: [
    { sym: '^GSPC', label: 'SPX',    market: 'yahoo' },
    { sym: 'GC=F',  label: 'GOLD',   market: 'yahoo' },
    { sym: 'SI=F',  label: 'SILVER', market: 'yahoo' },
    { sym: 'NVDA',  market: 'yahoo' },
    { sym: 'GOOGL', market: 'yahoo' },
    { sym: 'AAPL',  market: 'yahoo' },
    { sym: 'MSFT',  market: 'yahoo' },
    { sym: 'AMZN',  market: 'yahoo' },
    { sym: 'TSM',   market: 'yahoo' },
    { sym: 'META',  market: 'yahoo' },
    { sym: 'NU',    market: 'yahoo' },
  ]},
];

// Varias listas con nombre, como en TradingView. WATCHLIST siempre
// apunta a las secciones de la lista activa.
const WL = loadWatchlists();
let WATCHLIST = WL.lists[WL.active];

function isValidSections(w) {
  return Array.isArray(w) &&
    w.every(s => typeof s.title === 'string' && Array.isArray(s.items));
}

function saveWatchlist() {
  localStorage.setItem('mtv-watchlists', JSON.stringify(WL));
}

function loadWatchlists() {
  try {
    const w = JSON.parse(localStorage.getItem('mtv-watchlists'));
    if (w && w.lists && typeof w.lists === 'object' &&
        w.active && isValidSections(w.lists[w.active])) {
      return w;
    }
  } catch { /* estructura corrupta */ }
  // migración desde la versión de lista única
  try {
    const old = JSON.parse(localStorage.getItem('mtv-watchlist'));
    if (isValidSections(old) && old.length) {
      return { active: 'Principal', lists: { Principal: old } };
    }
  } catch { /* sin lista vieja */ }
  return { active: 'Principal', lists: { Principal: clone(DEFAULT_WATCHLIST) } };
}

function switchList(name) {
  if (!WL.lists[name]) return;
  WL.active = name;
  WATCHLIST = WL.lists[name];
  saveWatchlist();
  refreshListButton();
  buildWatchlist();
  renderWatchlistValues();
  // trae cotizaciones de los símbolos de la lista nueva
  pollBinanceQuotes();
  pollKuCoinQuotes();
  pollYahooQuotes();
}

function refreshListButton() {
  document.getElementById('wl-list-btn').textContent = `${WL.active} ▾`;
}

const DEFAULT_SETTINGS = {
  medias: {
    type: 'ema',
    lines: [
      { len: 10,  color: '#2962ff', width: 2, on: true  },
      { len: 55,  color: '#8d6e63', width: 2, on: true  },
      { len: 200, color: '#ab47bc', width: 2, on: false },
      { len: 21,  color: '#cddc39', width: 2, on: true  },
    ],
  },
  rsi: { period: 14, ob: 70, os: 30, color: '#ab47bc', width: 2 },
  macd: { fast: 12, slow: 26, signal: 9, macdColor: '#2962ff', signalColor: '#ff6d00' },
  squeeze: {
    bbLen: 20, bbMult: 2, kcLen: 20, kcMult: 1.5, useTR: true,
    mode: 'area',
    posUp: '#00e676', posDown: '#1b5e20', negDown: '#ff1744', negUp: '#8e2020',
    zeroOn: '#ff9800', zeroOff: '#5d606b',
  },
  adx: {
    period: 14, keyLevel: 23, adxColor: '#ffffff', adxWidth: 2,
    showPlus: false, plusColor: '#26a69a', showMinus: false, minusColor: '#ef5350',
    merge: true,   // dibujar en el mismo panel que el Squeeze
  },
  vp: {
    rows: 500,             // Row Size
    volMode: 'total',      // total | updown | delta
    vaPct: 70,             // Value Area Volume %
    widthPct: 30,          // ancho (% del panel)
    placement: 'right',    // right | left
    upColor: '#2962ff', downColor: '#e91e63',
    vaUpColor: '#2962ff', vaDownColor: '#e91e63',
    showPoc: true, pocColor: '#ffffff',
    showVah: false, vahColor: '#787b86',
    showVal: false, valColor: '#787b86',
  },
};

const state = {
  market: 'binance',
  symbol: 'BTCUSDT',
  symbolLabel: null,     // nombre para mostrar (ej: GOLD para GC=F)
  timeframe: '1h',
  candles: [],
  ws: null,
  pollTimer: null,
  pendingBars: null,
  settings: clone(DEFAULT_SETTINGS),
  toggles: { medias: true, rsi: true, macd: true, squeeze: true, adx: true, vp: true },
  series: {},
  loadToken: 0,
};

const quotes = {};       // `${market}:${sym}` → {last, chg, pct, bid, ask}

// ---------------- Persistencia ----------------

function saveState() {
  localStorage.setItem('mtv-state-v6', JSON.stringify({
    market: state.market, symbol: state.symbol, symbolLabel: state.symbolLabel,
    timeframe: state.timeframe, settings: state.settings, toggles: state.toggles,
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem('mtv-state-v6');
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.market && SOURCE_NAMES[s.market]) state.market = s.market;
    if (s.symbol) state.symbol = s.symbol;
    if (s.symbolLabel) state.symbolLabel = s.symbolLabel;
    if (s.timeframe) state.timeframe = s.timeframe;
    if (s.settings) {
      // fusionar con defaults para tolerar settings de versiones anteriores
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (!s.settings[k]) continue;
        state.settings[k] = { ...clone(DEFAULT_SETTINGS[k]), ...s.settings[k] };
        if (k === 'medias') {
          const saved = Array.isArray(s.settings.medias.lines) ? s.settings.medias.lines : [];
          state.settings.medias.lines = clone(DEFAULT_SETTINGS.medias.lines)
            .map((d, i) => ({ ...d, ...(saved[i] || {}) }));
        }
      }
    }
    if (s.toggles) state.toggles = { ...state.toggles, ...s.toggles };
  } catch { /* estado corrupto: usar defaults */ }
}

// ---------------- Barra de estado ----------------

const statusEl = document.getElementById('status');
function showError(msg) { statusEl.textContent = msg; statusEl.className = ''; }
function showInfo(msg) { statusEl.textContent = msg; statusEl.className = 'info'; }
function hideStatus() { statusEl.className = 'hidden'; }

// ---------------- Proxy CORS (para KuCoin y Yahoo) ----------------

// Proxies CORS para las APIs que no permiten fetch directo (KuCoin, Yahoo).
// `wrap: true` significa que la respuesta viene envuelta en {contents: "..."}.
// Se prueban EN SECUENCIA (no en paralelo): cada intento es UN solo golpe a
// la API destino. El paralelo multiplicaba los golpes y disparaba el rate
// limit de KuCoin (429). corsproxy.io y cors.sh funcionan desde el navegador
// (el 403 sólo aparece desde server sin Origin). Orden = más rápido primero.
const CORS_PROXIES = [
  { url: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`, wrap: false },
  { url: (u) => `https://proxy.cors.sh/${u}`, wrap: false },
  { url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, wrap: false },
  { url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`, wrap: true },
];

async function fetchViaProxy(proxy, targetUrl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(proxy.url(targetUrl), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const body = proxy.wrap ? JSON.parse(text).contents : text;
    return JSON.parse(body); // si es una página de error HTML, tira y probamos el siguiente
  } finally {
    clearTimeout(timer);
  }
}

// Prueba los proxies uno por uno; devuelve el primero que dé JSON válido.
async function fetchProxyJson(url, timeoutMs = 9000) {
  let lastErr = null;
  for (const proxy of CORS_PROXIES) {
    try {
      return await fetchViaProxy(proxy, url, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('No se pudo conectar con ningún proxy');
}

// Agrupa velas mensuales en trimestres (para el timeframe 3M)
function aggregateCandles(candles, months) {
  const out = [];
  let cur = null, curKey = null;
  for (const c of candles) {
    const d = new Date(c.time * 1000);
    const key = d.getUTCFullYear() * 12 + Math.floor(d.getUTCMonth() / months) * months;
    if (key !== curKey) {
      if (cur) out.push(cur);
      curKey = key;
      cur = { ...c };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------------- Datos: Binance ----------------

async function fetchBinance(symbol, tf) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf.binance}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 400) throw new Error(`Símbolo "${symbol}" no encontrado en Binance`);
    throw new Error(`Binance respondió ${res.status}`);
  }
  const rows = await res.json();
  const candles = rows.map(r => ({
    time: r[0] / 1000,
    open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
  }));
  return tf.agg ? aggregateCandles(candles, tf.agg) : candles;
}

function openBinanceWS(symbol, tf, token) {
  closeWS();
  const stream = `${symbol.toLowerCase()}@kline_${tf.binance}`;
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${stream}`);
  state.ws = ws;

  ws.onmessage = (ev) => {
    if (token !== state.loadToken) return;
    const k = JSON.parse(ev.data).k;
    if (!k) return;
    const candle = {
      time: k.t / 1000,
      open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v,
    };
    const last = state.candles[state.candles.length - 1];
    if (last && candle.time === last.time) {
      state.candles[state.candles.length - 1] = candle;
    } else if (!last || candle.time > last.time) {
      state.candles.push(candle);
    } else {
      return;
    }
    updateLastCandle(candle);
  };

  ws.onclose = () => {
    if (token === state.loadToken) {
      setTimeout(() => {
        if (token === state.loadToken) openBinanceWS(symbol, tf, token);
      }, 3000);
    }
  };
}

function closeWS() {
  if (state.ws) {
    const ws = state.ws;
    state.ws = null;
    ws.onclose = null;
    try { ws.close(); } catch { /* ya cerrado */ }
  }
}

// ---------------- Datos: Bybit (fuente de la clave 'kucoin') ----------------

// Bybit permite fetch directo del navegador (CORS abierto): sin proxy, sin
// rate-limit de IP compartida. Formato de símbolo igual a Binance (HYPEUSDT).
async function fetchKuCoin(symbol, tf) {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}` +
              `&interval=${tf.bybit}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bybit respondió ${res.status}`);
  const json = await res.json();
  const list = json?.result?.list;
  if (json.retCode !== 0 || !Array.isArray(list) || !list.length) {
    throw new Error(`Símbolo "${symbol}" no encontrado en Bybit`);
  }
  // formato Bybit: [startMs, open, high, low, close, volume, turnover], más nuevo primero
  const candles = list.map(r => ({
    time: +r[0] / 1000,
    open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5],
  })).reverse();
  return tf.agg ? aggregateCandles(candles, tf.agg) : candles;
}

async function fetchBybitTicker(symbol) {
  const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`);
  if (!res.ok) throw new Error(`Bybit respondió ${res.status}`);
  const json = await res.json();
  const t = json?.result?.list?.[0];
  if (json.retCode !== 0 || !t) throw new Error(`"${symbol}" no existe en Bybit`);
  const last = +t.lastPrice;
  const prev = +t.prevPrice24h;
  return {
    last,
    chg: last - prev,
    pct: (+t.price24hPcnt) * 100,
    bid: +t.bid1Price || null,
    ask: +t.ask1Price || null,
  };
}

// ---------------- Datos: Yahoo Finance ----------------

async function fetchYahoo(symbol, tf) {
  if (!tf.yahoo) throw new Error(`El intervalo ${tf.label} no está disponible para acciones`);
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
                 `?interval=${tf.yahoo.interval}&range=${tf.yahoo.range}`;
  const json = await fetchProxyJson(target);
  const result = json?.chart?.result?.[0];
  if (!result) {
    const desc = json?.chart?.error?.description;
    throw new Error(desc || `Símbolo "${symbol}" no encontrado`);
  }
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] == null || q.close?.[i] == null ||
        q.high?.[i] == null || q.low?.[i] == null) continue;
    candles.push({
      time: ts[i],
      open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i],
      volume: q.volume?.[i] || 0,
    });
  }
  if (!candles.length) throw new Error(`Sin datos para "${symbol}"`);
  return candles;
}

// ---------------- Refresco periódico (KuCoin / Yahoo) ----------------

function startRefreshPolling(fetchFn, intervalMs, token) {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (token !== state.loadToken) return;
    try {
      const candles = await fetchFn();
      if (token !== state.loadToken) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      state.candles = candles;
      setAllData();
      if (range) chart.timeScale().setVisibleLogicalRange(range);
    } catch { /* reintenta en el próximo ciclo */ }
  }, intervalMs);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ---------------- Perfil de Volumen con POC (primitive) ----------------

class VolumeProfilePrimitive {
  constructor() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._candles = [];
    this.cfg = null;       // settings.vp (se inyecta en buildIndicatorSeries)
    this.enabled = true;
    this._onRange = null;
    this._profile = null;  // perfil precalculado en updateAllViews()
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
    this._onRange = () => requestUpdate();
    chart.timeScale().subscribeVisibleLogicalRangeChange(this._onRange);
  }

  detached() {
    if (this._chart && this._onRange) {
      this._chart.timeScale().unsubscribeVisibleLogicalRangeChange(this._onRange);
    }
  }

  setCandles(candles) {
    this._candles = candles;
    if (this._requestUpdate) this._requestUpdate();
  }

  refresh() { if (this._requestUpdate) this._requestUpdate(); }

  // La librería llama esto antes de CADA render: acá recalculamos el
  // perfil con el rango visible vigente (leerlo dentro de draw puede
  // dar un rango viejo durante el paneo/zoom).
  updateAllViews() { this._recompute(); }

  _recompute() {
    this._profile = null;
    const cfg = this.cfg;
    if (!this.enabled || !cfg || !this._chart || !this._candles.length) return;
    const lr = this._chart.timeScale().getVisibleLogicalRange();
    if (!lr) return;

    const from = Math.max(0, Math.ceil(lr.from));
    const to = Math.min(this._candles.length - 1, Math.floor(lr.to));
    if (to - from < 2) return;

    let min = Infinity, max = -Infinity;
    for (let i = from; i <= to; i++) {
      min = Math.min(min, this._candles[i].low);
      max = Math.max(max, this._candles[i].high);
    }
    const rows = Math.max(6, Math.min(1000, cfg.rows));
    const step = (max - min) / rows;
    if (!(step > 0)) return;

    // volumen por fila: distribuido a lo largo del rango high-low de
    // cada vela (como el VRVP de TV), separado comprador/vendedor
    const volUp = new Array(rows).fill(0);
    const volDn = new Array(rows).fill(0);
    for (let i = from; i <= to; i++) {
      const c = this._candles[i];
      const cLo = Math.min(c.low, c.high);
      const cHi = Math.max(c.low, c.high);
      const bucket = c.close >= c.open ? volUp : volDn;
      const r0 = Math.min(rows - 1, Math.max(0, Math.floor((cLo - min) / step)));
      const r1 = Math.min(rows - 1, Math.max(0, Math.floor((cHi - min) / step)));
      const span = cHi - cLo;
      if (span <= 0 || r0 === r1) {
        bucket[r0] += c.volume;
      } else {
        for (let r = r0; r <= r1; r++) {
          const rowLo = min + r * step;
          const overlap = Math.min(cHi, rowLo + step) - Math.max(cLo, rowLo);
          if (overlap > 0) bucket[r] += c.volume * (overlap / span);
        }
      }
    }
    const vol = volUp.map((v, r) => v + volDn[r]);
    const totalVol = vol.reduce((a, b) => a + b, 0);
    if (totalVol <= 0) return;

    const barVal = (r) => cfg.volMode === 'delta' ? Math.abs(volUp[r] - volDn[r]) : vol[r];
    let maxVal = 0;
    for (let r = 0; r < rows; r++) maxVal = Math.max(maxVal, barVal(r));
    if (maxVal <= 0) return;

    const pocIdx = vol.indexOf(Math.max(...vol));

    // Value Area: expandir desde el POC hasta acumular vaPct% del volumen
    const inVA = new Array(rows).fill(false);
    inVA[pocIdx] = true;
    let acc = vol[pocIdx];
    let hi = pocIdx + 1, lo = pocIdx - 1;
    const vaTarget = totalVol * (cfg.vaPct / 100);
    while (acc < vaTarget && (hi < rows || lo >= 0)) {
      const vHi = hi < rows ? vol[hi] : -1;
      const vLo = lo >= 0 ? vol[lo] : -1;
      if (vHi >= vLo) { inVA[hi] = true; acc += vHi; hi++; }
      else { inVA[lo] = true; acc += vLo; lo--; }
    }

    this._profile = {
      rows, min, step, vol, volUp, volDn, maxVal, pocIdx, inVA,
      vahPrice: min + hi * step,
      valPrice: min + (lo + 1) * step,
    };
  }

  paneViews() {
    const self = this;
    return [{
      zOrder() { return 'bottom'; },
      renderer() {
        return { draw(target) { self._draw(target); } };
      },
    }];
  }

  _draw(target) {
    const cfg = this.cfg;
    const p = this._profile;
    if (!this.enabled || !cfg || !p) return;
    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context;
      const width = scope.mediaSize.width;
      const { rows, min, step, vol, volUp, volDn, maxVal, pocIdx, inVA, vahPrice, valPrice } = p;

      const maxBarW = width * (Math.max(5, Math.min(60, cfg.widthPct)) / 100);
      const right = cfg.placement !== 'left';
      const rect = (start, len, y, h) => {
        if (len <= 0) return;
        if (right) ctx.fillRect(width - start - len, y, len, h);
        else ctx.fillRect(start, y, len, h);
      };

      for (let r = 0; r < rows; r++) {
        if (vol[r] <= 0) continue;
        const pLow = min + r * step;
        const y1 = this._series.priceToCoordinate(pLow + step);
        const y2 = this._series.priceToCoordinate(pLow);
        if (y1 == null || y2 == null) continue;
        const yTop = Math.min(y1, y2);
        // filas contiguas: sin separación para que el perfil se vea sólido
        const h = Math.max(0.5, Math.abs(y2 - y1));
        const cUp = inVA[r] ? cfg.vaUpColor : cfg.upColor;
        const cDn = inVA[r] ? cfg.vaDownColor : cfg.downColor;
        const aMain = inVA[r] ? 0.85 : 0.45;

        if (cfg.volMode === 'updown') {
          const wUp = (volUp[r] / maxVal) * maxBarW;
          const wDn = (volDn[r] / maxVal) * maxBarW;
          ctx.fillStyle = hexA(cUp, aMain);
          rect(0, wUp, yTop, h);
          ctx.fillStyle = hexA(cDn, aMain);
          rect(wUp, wDn, yTop, h);
        } else if (cfg.volMode === 'delta') {
          const delta = volUp[r] - volDn[r];
          const w = (Math.abs(delta) / maxVal) * maxBarW;
          ctx.fillStyle = hexA(delta >= 0 ? cUp : cDn, aMain);
          rect(0, w, yTop, h);
        } else { // total
          const w = (vol[r] / maxVal) * maxBarW;
          ctx.fillStyle = hexA(cUp, aMain);
          rect(0, w, yTop, h);
        }
      }

      // líneas POC / VAH / VAL
      const hLine = (price, color, label) => {
        const y = this._series.priceToCoordinate(price);
        if (y == null) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = 'bold 11px sans-serif';
        const x = right ? 8 : width - 130;
        ctx.fillText(`${label} ${formatPrice(price)}`, x, y - 4);
      };
      if (cfg.showVah) hLine(vahPrice, cfg.vahColor, 'VAH');
      if (cfg.showVal) hLine(valPrice, cfg.valColor, 'VAL');
      if (cfg.showPoc) hLine(min + (pocIdx + 0.5) * step, cfg.pocColor, 'POC');
    });
  }
}

// ---------------- Gráfico ----------------

const LWC = LightweightCharts;

const chart = LWC.createChart(document.getElementById('chart'), {
  autoSize: true,
  layout: {
    background: { type: 'solid', color: '#131722' },
    textColor: '#d1d4dc',
    panes: { separatorColor: '#363a45', separatorHoverColor: 'rgba(41,98,255,0.3)' },
  },
  grid: {
    vertLines: { color: 'rgba(54,58,69,0.5)' },
    horzLines: { color: 'rgba(54,58,69,0.5)' },
  },
  crosshair: { mode: LWC.CrosshairMode.Normal },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#363a45' },
  rightPriceScale: { borderColor: '#363a45' },
});

const candleSeries = chart.addSeries(LWC.CandlestickSeries, {
  upColor: '#26a69a', downColor: '#ef5350',
  wickUpColor: '#26a69a', wickDownColor: '#ef5350',
  borderVisible: false,
});

const volumeSeries = chart.addSeries(LWC.HistogramSeries, {
  priceScaleId: 'volume',
  priceFormat: { type: 'volume' },
  lastValueVisible: false,
  priceLineVisible: false,
});
chart.priceScale('volume').applyOptions({
  scaleMargins: { top: 0.85, bottom: 0 },
});

const vpPrimitive = new VolumeProfilePrimitive();
candleSeries.attachPrimitive(vpPrimitive);

// ---------------- Series de indicadores ----------------

// '#rrggbb' + alfa → 'rgba(...)'
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function removeIndicatorSeries() {
  const s = state.series;
  const all = [
    ...(s.mas || []),
    s.rsi, s.macdHist, s.macdLine, s.macdSignal,
    s.sqzArea, s.sqzZero, s.adx, s.plusDI, s.minusDI,
  ].filter(Boolean);
  for (const serie of all) {
    try { chart.removeSeries(serie); } catch { /* ya removida */ }
  }
  state.series = {};
}

function buildIndicatorSeries() {
  removeIndicatorSeries();
  const s = state.series;
  const t = state.toggles;
  const cfg = state.settings;
  let pane = 0;

  if (t.medias) {
    const m = cfg.medias;
    s.masLines = m.lines.filter(l => l.on && l.len >= 2);
    s.mas = s.masLines.map(l =>
      chart.addSeries(LWC.LineSeries, {
        color: l.color,
        lineWidth: l.width,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: `${m.type.toUpperCase()} ${l.len}`,
      }, 0));
  }

  if (t.rsi) {
    pane++;
    const r = cfg.rsi;
    s.rsi = chart.addSeries(LWC.LineSeries, {
      color: r.color, lineWidth: r.width, title: `RSI ${r.period}`,
      priceLineVisible: false,
    }, pane);
    s.rsi.createPriceLine({ price: r.ob, color: '#787b86', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });
    s.rsi.createPriceLine({ price: r.os, color: '#787b86', lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: false });
    s.rsi.createPriceLine({ price: 50, color: 'rgba(120,123,134,0.4)', lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: false });
  }

  if (t.macd) {
    pane++;
    s.macdHist = chart.addSeries(LWC.HistogramSeries, {
      title: 'MACD', priceLineVisible: false, lastValueVisible: false,
    }, pane);
    s.macdLine = chart.addSeries(LWC.LineSeries, {
      color: cfg.macd.macdColor, lineWidth: 2, priceLineVisible: false,
    }, pane);
    s.macdSignal = chart.addSeries(LWC.LineSeries, {
      color: cfg.macd.signalColor, lineWidth: 2, priceLineVisible: false,
    }, pane);
  }

  // Squeeze + ADX en el mismo panel (como DMI/ADX sobre SQZMOM en TV):
  // el momentum va en una escala superpuesta y el ADX usa el eje derecho.
  const mergeSA = t.squeeze && t.adx && cfg.adx.merge;

  if (t.squeeze) {
    pane++;
    const q = cfg.squeeze;
    const overlay = mergeSA ? { priceScaleId: 'sqz-ovl' } : {};
    if (q.mode === 'hist') {
      // histograma clásico LazyBear de 4 colores
      s.sqzArea = chart.addSeries(LWC.HistogramSeries, {
        title: 'SQZMOM', priceLineVisible: false, lastValueVisible: false,
        ...overlay,
      }, pane);
    } else {
      // área suave verde/roja
      s.sqzArea = chart.addSeries(LWC.BaselineSeries, {
        title: 'SQZMOM',
        baseValue: { type: 'price', price: 0 },
        topLineColor: q.posUp,
        topFillColor1: hexA(q.posUp, 0.55),
        topFillColor2: hexA(q.posUp, 0.06),
        bottomLineColor: q.negDown,
        bottomFillColor1: hexA(q.negDown, 0.06),
        bottomFillColor2: hexA(q.negDown, 0.55),
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        ...overlay,
      }, pane);
    }
    // línea de cero: color según squeeze activo/liberado
    s.sqzZero = chart.addSeries(LWC.LineSeries, {
      lineWidth: 2, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false, color: q.zeroOff,
      ...overlay,
    }, pane);
    if (mergeSA) {
      s.sqzArea.priceScale().applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
    }
  }

  if (t.adx) {
    const a = cfg.adx;
    const adxPane = mergeSA ? pane : ++pane;
    s.adx = chart.addSeries(LWC.LineSeries, {
      color: a.adxColor, lineWidth: a.adxWidth, title: `ADX ${a.period}`, priceLineVisible: false,
    }, adxPane);
    if (a.showPlus) {
      s.plusDI = chart.addSeries(LWC.LineSeries, {
        color: a.plusColor, lineWidth: 1, title: '+DI', priceLineVisible: false, lastValueVisible: false,
      }, adxPane);
    }
    if (a.showMinus) {
      s.minusDI = chart.addSeries(LWC.LineSeries, {
        color: a.minusColor, lineWidth: 1, title: '-DI', priceLineVisible: false, lastValueVisible: false,
      }, adxPane);
    }
    // nivel clave: línea continua blanca (fuerza de tendencia)
    s.adx.createPriceLine({ price: a.keyLevel, color: '#ffffff', lineWidth: 1, lineStyle: LWC.LineStyle.Solid, axisLabelVisible: true });
  }

  vpPrimitive.enabled = t.vp;
  vpPrimitive.cfg = cfg.vp;
  vpPrimitive.refresh();

  applyPaneLayout();
}

function applyPaneLayout() {
  try {
    const panes = chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
  } catch { /* API de panes no disponible */ }
}

// ---------------- Cálculo y volcado de datos ----------------

function toLine(times, values) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined) {
      out.push({ time: times[i], value: values[i] });
    }
  }
  return out;
}

function recomputeIndicators() {
  const candles = state.candles;
  if (!candles.length) return;
  const s = state.series;
  const cfg = state.settings;
  const times = candles.map(c => c.time);
  const closes = candles.map(c => c.close);

  if (s.mas) {
    const fn = cfg.medias.type === 'sma' ? Indicators.sma : Indicators.ema;
    s.masLines.forEach((l, i) => {
      if (s.mas[i]) s.mas[i].setData(toLine(times, fn(closes, l.len)));
    });
  }

  if (s.rsi) {
    s.rsi.setData(toLine(times, Indicators.rsi(closes, cfg.rsi.period)));
  }

  if (s.macdHist) {
    const { macdLine, signal, hist } = Indicators.macd(closes, cfg.macd.fast, cfg.macd.slow, cfg.macd.signal);
    const histData = [];
    for (let i = 0; i < hist.length; i++) {
      if (hist[i] === null) continue;
      const prev = i > 0 && hist[i - 1] !== null ? hist[i - 1] : hist[i];
      const rising = hist[i] >= prev;
      const color = hist[i] >= 0
        ? (rising ? '#26a69a' : 'rgba(38,166,154,0.45)')
        : (rising ? 'rgba(239,83,80,0.45)' : '#ef5350');
      histData.push({ time: times[i], value: hist[i], color });
    }
    s.macdHist.setData(histData);
    s.macdLine.setData(toLine(times, macdLine));
    s.macdSignal.setData(toLine(times, signal));
  }

  if (s.sqzArea) {
    const q = cfg.squeeze;
    const { momentum, squeezeOn } = Indicators.squeezeMomentum(
      state.candles, q.bbLen, q.bbMult, q.kcLen, q.kcMult, q.useTR);

    if (q.mode === 'hist') {
      // colores LazyBear: creciente/decreciente arriba y abajo de cero
      const histData = [];
      for (let i = 0; i < momentum.length; i++) {
        if (momentum[i] === null) continue;
        const prev = i > 0 && momentum[i - 1] !== null ? momentum[i - 1] : momentum[i];
        const rising = momentum[i] >= prev;
        const color = momentum[i] >= 0
          ? (rising ? q.posUp : q.posDown)
          : (rising ? q.negUp : q.negDown);
        histData.push({ time: times[i], value: momentum[i], color });
      }
      s.sqzArea.setData(histData);
    } else {
      s.sqzArea.setData(toLine(times, momentum));
    }

    const zeroData = [];
    for (let i = 0; i < squeezeOn.length; i++) {
      if (squeezeOn[i] !== null) {
        zeroData.push({ time: times[i], value: 0, color: squeezeOn[i] ? q.zeroOn : q.zeroOff });
      }
    }
    s.sqzZero.setData(zeroData);
  }

  if (s.adx) {
    const { adxLine, plusDI, minusDI } = Indicators.adx(state.candles, cfg.adx.period);
    s.adx.setData(toLine(times, adxLine));
    if (s.plusDI) s.plusDI.setData(toLine(times, plusDI));
    if (s.minusDI) s.minusDI.setData(toLine(times, minusDI));
  }
}

function volumeBar(c) {
  return {
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)',
  };
}

function setAllData() {
  const candles = state.candles;
  candleSeries.setData(candles);
  volumeSeries.setData(candles.map(volumeBar));
  vpPrimitive.setCandles(candles);
  recomputeIndicators();
  const last = candles[candles.length - 1];
  updateLegend(last);
  updateTradeChips(last ? last.close : null);
  updateSymbolInfo();
}

function updateLastCandle(candle) {
  candleSeries.update(candle);
  volumeSeries.update(volumeBar(candle));
  vpPrimitive.setCandles(state.candles);
  recomputeIndicators();
  updateLegend(candle);
  updateTradeChips(candle.close);
  updateSymbolInfo();
  checkAlertsFor(state.market, state.symbol, candle.close);
}

// ---------------- Formato ----------------

function formatPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.01) return v.toFixed(4);
  return v.toFixed(8);
}

function formatVolume(v) {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return v.toFixed(0);
}

function displayName() { return state.symbolLabel || state.symbol; }

// ---------------- Leyenda + chips SELL/BUY ----------------

const legendEl = document.getElementById('legend');
const chipsEl = document.getElementById('trade-chips');

function updateLegend(candle) {
  if (!candle) { legendEl.innerHTML = ''; return; }
  const dir = candle.close >= candle.open ? 'up' : 'down';
  const change = candle.open ? ((candle.close - candle.open) / candle.open) * 100 : 0;
  const tfLabel = TIMEFRAMES.find(t => t.id === state.timeframe)?.label || state.timeframe;
  legendEl.innerHTML =
    `<span class="sym">${displayName()} · ${tfLabel} · ${SOURCE_NAMES[state.market]}</span>` +
    `<span class="dim">A</span> <span class="${dir}">${formatPrice(candle.open)}</span> ` +
    `<span class="dim">M</span> <span class="${dir}">${formatPrice(candle.high)}</span> ` +
    `<span class="dim">m</span> <span class="${dir}">${formatPrice(candle.low)}</span> ` +
    `<span class="dim">C</span> <span class="${dir}">${formatPrice(candle.close)}</span> ` +
    `<span class="${dir}">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span> ` +
    `<span class="dim">Vol</span> ${formatVolume(candle.volume)}`;
}

function updateTradeChips(price) {
  if (price == null) { chipsEl.classList.add('hidden'); return; }
  chipsEl.classList.remove('hidden');
  const q = quotes[`${state.market}:${state.symbol}`];
  let sell, buy;
  if (q && q.bid && q.ask) {
    sell = q.bid; buy = q.ask;
  } else {
    const half = price * 0.0002;
    sell = price - half; buy = price + half;
  }
  document.getElementById('sell-price').textContent = formatPrice(sell);
  document.getElementById('buy-price').textContent = formatPrice(buy);
  document.getElementById('spread').textContent = formatPrice(buy - sell);
}

chart.subscribeCrosshairMove((param) => {
  if (!param || !param.time) {
    updateLegend(state.candles[state.candles.length - 1]);
    return;
  }
  const d = param.seriesData.get(candleSeries);
  if (d) {
    const full = state.candles.find(c => c.time === param.time);
    updateLegend(full || { ...d, volume: 0 });
  }
});

// ---------------- Panel de símbolo (sidebar) ----------------

function updateSymbolInfo() {
  const last = state.candles[state.candles.length - 1];
  const q = quotes[`${state.market}:${state.symbol}`];
  const price = q ? q.last : (last ? last.close : null);

  document.getElementById('si-symbol').textContent = displayName();
  document.getElementById('si-desc').textContent =
    `${state.symbol} · ${SOURCE_NAMES[state.market]}`;
  document.getElementById('si-currency').textContent =
    state.market === 'yahoo' ? 'USD' : 'USDT';
  document.getElementById('si-last').textContent = formatPrice(price);

  const chEl = document.getElementById('si-change');
  if (q && Number.isFinite(q.chg)) {
    const up = q.chg >= 0;
    chEl.textContent = `${up ? '+' : ''}${formatPrice(Math.abs(q.chg)) === '—' ? q.chg.toFixed(2) : (up ? '' : '-') + formatPrice(Math.abs(q.chg))} (${up ? '+' : ''}${q.pct.toFixed(2)}%)`;
    chEl.className = `si-change ${up ? 'up' : 'down'}`;
  } else {
    chEl.textContent = '';
    chEl.className = 'si-change';
  }

  const stEl = document.getElementById('si-status');
  stEl.innerHTML = state.market === 'yahoo'
    ? '<span class="dot delay"></span> Datos con demora (Yahoo)'
    : '<span class="dot"></span> Market open · 24/7';
}

// ---------------- Lista de seguimiento ----------------

const wlBody = document.getElementById('wl-body');

function badgeColor(label) {
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

function wlKey(item) { return `${item.market}:${item.sym}`; }

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildWatchlist() {
  wlBody.innerHTML = '';

  for (const section of WATCHLIST) {
    wlBody.appendChild(buildSectionHeader(section));
    if (!section.collapsed) {
      for (const item of section.items) {
        wlBody.appendChild(buildSymbolRow(section, item));
      }
    }
  }

  if (!WATCHLIST.length) {
    const hint = document.createElement('p');
    hint.className = 'search-hint';
    hint.textContent = 'Lista vacía — creá una sección y agregá activos con el +.';
    wlBody.appendChild(hint);
  }

  // fila para crear una sección nueva
  const add = document.createElement('div');
  add.className = 'wl-new-section';
  add.textContent = '＋ Nueva sección';
  add.addEventListener('click', () => startNewSection(add));
  wlBody.appendChild(add);

  highlightActiveRow();
}

// --- Secciones plegables (como en TV) ---

function buildSectionHeader(section) {
  const head = document.createElement('div');
  head.className = 'wl-section';
  head.innerHTML =
    `<span class="chev">${section.collapsed ? '▸' : '▾'}</span>` +
    `<span class="tit">${escHtml(section.title)}</span>` +
    `<span class="cnt">${section.items.length}</span>` +
    `<span class="sec-act" data-a="edit" title="Renombrar sección">✎</span>` +
    `<span class="sec-act sec-del" data-a="del" title="Eliminar sección">✕</span>`;

  head.addEventListener('click', (e) => {
    const action = e.target.dataset ? e.target.dataset.a : null;
    if (action === 'edit') {
      e.stopPropagation();
      startRenameSection(head, section);
      return;
    }
    if (action === 'del') {
      e.stopPropagation();
      handleDeleteSection(e.target, section);
      return;
    }
    section.collapsed = !section.collapsed;
    saveWatchlist();
    buildWatchlist();
    renderWatchlistValues();
  });
  makeDropTarget(head, section); // soltar sobre el título mueve a esa sección
  return head;
}

function startRenameSection(head, section) {
  const tit = head.querySelector('.tit');
  const inp = document.createElement('input');
  inp.className = 'sec-input';
  inp.maxLength = 30;
  inp.value = section.title;
  tit.replaceWith(inp);
  inp.focus();
  inp.select();
  inp.addEventListener('click', (e) => e.stopPropagation());

  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    const name = inp.value.trim().slice(0, 30);
    if (apply && name) {
      section.title = name;
      saveWatchlist();
    }
    buildWatchlist();
    renderWatchlistValues();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

function handleDeleteSection(el, section) {
  if (!el.dataset.armed) {
    el.dataset.armed = '1';
    el.textContent = '¿otra vez?';
    el.classList.add('armed');
    setTimeout(() => {
      if (el.isConnected) {
        delete el.dataset.armed;
        el.textContent = '✕';
        el.classList.remove('armed');
      }
    }, 3500);
    return;
  }
  WL.lists[WL.active] = WATCHLIST.filter(s => s !== section);
  WATCHLIST = WL.lists[WL.active];
  saveWatchlist();
  buildWatchlist();
  renderWatchlistValues();
}

function startNewSection(rowEl) {
  if (rowEl.classList.contains('editing')) return;
  rowEl.classList.add('editing');
  rowEl.innerHTML = '';
  const inp = document.createElement('input');
  inp.className = 'sec-input';
  inp.maxLength = 30;
  inp.placeholder = 'Nombre de la sección';
  const ok = document.createElement('button');
  ok.textContent = 'OK';
  rowEl.appendChild(inp);
  rowEl.appendChild(ok);
  inp.focus();

  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    const name = inp.value.trim().slice(0, 30);
    if (apply && name && !WATCHLIST.some(s => s.title === name)) {
      WATCHLIST.push({ title: name, items: [], collapsed: false });
      saveWatchlist();
    }
    buildWatchlist();
    renderWatchlistValues();
  };
  ok.addEventListener('click', (e) => { e.stopPropagation(); finish(true); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => setTimeout(() => finish(true), 150));
}

// --- Mover activos entre secciones ---

let dragCtx = null; // {section, item} durante un arrastre

function moveItem(ctx, target) {
  if (!ctx || ctx.section === target) return;
  ctx.section.items = ctx.section.items.filter(i => i !== ctx.item);
  target.items.push(ctx.item);
  target.collapsed = false;
  dragCtx = null;
  saveWatchlist();
  buildWatchlist();
  renderWatchlistValues();
}

function clearDropTargets() {
  for (const el of document.querySelectorAll('.drop-target')) el.classList.remove('drop-target');
}

function closeMoveMenu() { document.getElementById('move-menu')?.remove(); }

function openMoveMenu(e, section, item) {
  closeMoveMenu();
  const menu = document.createElement('div');
  menu.id = 'move-menu';
  const title = document.createElement('h5');
  title.textContent = `Mover ${item.label || item.sym} a…`;
  menu.appendChild(title);

  let options = 0;
  for (const s of WATCHLIST) {
    if (s === section) continue;
    options++;
    const b = document.createElement('button');
    b.className = 'wl-menu-item';
    b.textContent = s.title;
    b.addEventListener('click', () => {
      closeMoveMenu();
      moveItem({ section, item }, s);
    });
    menu.appendChild(b);
  }
  if (!options) {
    const p = document.createElement('p');
    p.className = 'search-hint';
    p.textContent = 'No hay otra sección: creá una con “＋ Nueva sección”.';
    menu.appendChild(p);
  }

  document.body.appendChild(menu);
  menu.style.left = Math.max(8, Math.min(e.clientX - 60, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.min(e.clientY + 8, window.innerHeight - menu.offsetHeight - 8) + 'px';
  setTimeout(() => document.addEventListener('click', closeMoveMenu, { once: true }), 0);
}

// convierte un elemento en destino de arrastre hacia `targetSection`
function makeDropTarget(el, targetSection) {
  el.addEventListener('dragover', (e) => {
    if (dragCtx && dragCtx.section !== targetSection) {
      e.preventDefault();
      el.classList.add('drop-target');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drop-target');
    moveItem(dragCtx, targetSection);
  });
}

function buildSymbolRow(section, item) {
  const label = item.label || item.sym;
  const row = document.createElement('div');
  row.className = 'wl-row';
  row.dataset.key = wlKey(item);
  row.innerHTML =
    `<span class="wl-sym"><span class="wl-badge" style="background:${badgeColor(label)}">${label[0]}</span>${escHtml(label)}</span>` +
    `<span class="num last">—</span>` +
    `<span class="num chg">—</span>` +
    `<span class="num pct">—</span>` +
    `<span class="wl-move" title="Mover a otra sección">⇄</span>` +
    `<span class="wl-del" title="Quitar de la lista">✕</span>`;
  row.querySelector('.wl-del').addEventListener('click', (e) => {
    e.stopPropagation();
    section.items = section.items.filter(i => i !== item);
    saveWatchlist();
    buildWatchlist();
    renderWatchlistValues();
  });
  row.querySelector('.wl-move').addEventListener('click', (e) => {
    e.stopPropagation();
    openMoveMenu(e, section, item);
  });

  // arrastrar y soltar (escritorio)
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    dragCtx = { section, item };
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    dragCtx = null;
    clearDropTargets();
  });
  makeDropTarget(row, section);
  row.addEventListener('click', () => {
    state.market = item.market;
    state.symbol = item.sym;
    state.symbolLabel = item.label || null;
    marketEl.value = item.market;
    symbolEl.value = item.sym;
    refreshFavorites();
    const tf = TIMEFRAMES.find(t => t.id === state.timeframe);
    if (state.market === 'yahoo' && !tf.yahoo) state.timeframe = '1d';
    refreshTimeframeButtons();
    loadSymbol();
    closeSidebar(); // en móvil, volver al gráfico
  });
  return row;
}

function highlightActiveRow() {
  const activeKey = `${state.market}:${state.symbol}`;
  for (const row of wlBody.querySelectorAll('.wl-row')) {
    row.classList.toggle('active', row.dataset.key === activeKey);
  }
}

function renderWatchlistValues() {
  for (const row of wlBody.querySelectorAll('.wl-row')) {
    const q = quotes[row.dataset.key];
    if (!q) continue;
    const cls = q.chg > 0 ? 'up' : q.chg < 0 ? 'down' : 'flat';
    const lastEl = row.querySelector('.last');
    const chgEl = row.querySelector('.chg');
    const pctEl = row.querySelector('.pct');
    lastEl.textContent = formatPrice(q.last);
    chgEl.textContent = `${q.chg >= 0 ? '' : '-'}${formatPrice(Math.abs(q.chg))}`;
    pctEl.textContent = `${q.pct >= 0 ? '' : '-'}${Math.abs(q.pct).toFixed(2)}%`;
    lastEl.className = `num last ${cls}`;
    chgEl.className = `num chg ${cls}`;
    pctEl.className = `num pct ${cls}`;
  }
}

// --- Agregar / quitar símbolos de la lista ---

async function validateAndQuote(market, sym) {
  if (market === 'binance') {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`);
    if (!res.ok) throw new Error(`"${sym}" no existe en Binance`);
    const t = await res.json();
    return { last: +t.lastPrice, chg: +t.priceChange, pct: +t.priceChangePercent, bid: +t.bidPrice || null, ask: +t.askPrice || null };
  }
  if (market === 'kucoin') {
    return await fetchBybitTicker(sym);
  }
  const json = await fetchProxyJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error(`"${sym}" no existe en Yahoo Finance`);
  return { last: meta.regularMarketPrice, chg: 0, pct: 0, bid: null, ask: null };
}

// ---------------- Menú de listas ----------------

const wlMenuEl = document.getElementById('wl-menu');

function renderListMenu() {
  const box = document.getElementById('wl-menu-lists');
  box.innerHTML = '';
  for (const name of Object.keys(WL.lists)) {
    const count = WL.lists[name].reduce((a, s) => a + s.items.length, 0);
    const btn = document.createElement('button');
    btn.className = 'wl-menu-item' + (name === WL.active ? ' active' : '');
    btn.innerHTML =
      `<span>${escHtml(name)}</span>` +
      `<span class="count">${count}</span>` +
      (name === WL.active ? '<span class="check">✓</span>' : '');
    btn.addEventListener('click', () => {
      closeListMenu();
      if (name !== WL.active) switchList(name);
    });
    box.appendChild(btn);
  }
}

function closeListMenu() {
  wlMenuEl.classList.add('hidden');
  hideNameForm();
  disarmDelete();
}

document.getElementById('wl-list-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (wlMenuEl.classList.contains('hidden')) {
    renderListMenu();
    wlMenuEl.classList.remove('hidden');
  } else {
    closeListMenu();
  }
});

document.addEventListener('click', (e) => {
  if (!wlMenuEl.classList.contains('hidden') && !wlMenuEl.contains(e.target)) {
    closeListMenu();
  }
});

// formulario propio (los prompt() nativos fallan en algunas PWA de Android)
const nameFormEl = document.getElementById('wl-name-form');
const nameInputEl = document.getElementById('wl-name-input');
let nameMode = null; // 'new' | 'rename'

function showNameForm(mode) {
  disarmDelete();
  nameMode = mode;
  nameFormEl.classList.remove('hidden');
  nameInputEl.value = mode === 'rename' ? WL.active : '';
  nameInputEl.placeholder = mode === 'new' ? 'Nombre de la lista nueva' : 'Nuevo nombre';
  nameInputEl.focus();
}

function hideNameForm() {
  nameMode = null;
  nameFormEl.classList.add('hidden');
}

function applyNameForm() {
  const name = nameInputEl.value.trim().slice(0, 30);
  if (!name) return;
  if (WL.lists[name] && !(nameMode === 'rename' && name === WL.active)) {
    showError(`⚠ Ya existe una lista llamada "${name}"`);
    return;
  }
  hideStatus();
  if (nameMode === 'new') {
    WL.lists[name] = [];
    closeListMenu();
    switchList(name);
  } else if (nameMode === 'rename' && name !== WL.active) {
    WL.lists[name] = WL.lists[WL.active];
    delete WL.lists[WL.active];
    WL.active = name;
    WATCHLIST = WL.lists[name];
    saveWatchlist();
    refreshListButton();
    closeListMenu();
  } else {
    closeListMenu();
  }
}

document.getElementById('wl-new').addEventListener('click', () => showNameForm('new'));
document.getElementById('wl-rename').addEventListener('click', () => showNameForm('rename'));
document.getElementById('wl-name-ok').addEventListener('click', applyNameForm);
nameInputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyNameForm(); });

// eliminar con doble toque de confirmación (sin confirm() nativo)
const deleteBtnEl = document.getElementById('wl-delete');
let deleteArmed = false;
let deleteTimer = null;

function disarmDelete() {
  deleteArmed = false;
  clearTimeout(deleteTimer);
  deleteBtnEl.classList.remove('armed');
  deleteBtnEl.textContent = '🗑 Eliminar esta lista';
}

deleteBtnEl.addEventListener('click', () => {
  if (Object.keys(WL.lists).length <= 1) {
    showError('⚠ No podés eliminar la única lista');
    closeListMenu();
    return;
  }
  if (!deleteArmed) {
    hideNameForm();
    deleteArmed = true;
    deleteBtnEl.classList.add('armed');
    deleteBtnEl.textContent = `¿Eliminar "${WL.active}"? Tocá otra vez`;
    deleteTimer = setTimeout(disarmDelete, 4000);
    return;
  }
  delete WL.lists[WL.active];
  closeListMenu();
  switchList(Object.keys(WL.lists)[0]);
});

// agrega un ítem a la watchlist y trae su cotización en segundo plano
function addToWatchlist(market, sym, label, sectionTitle) {
  const key = `${market}:${sym}`;
  if (WATCHLIST.some(s => s.items.some(i => wlKey(i) === key))) return false;

  // sección elegida por el usuario, o la automática según el mercado
  let section = sectionTitle ? WATCHLIST.find(s => s.title === sectionTitle) : null;
  if (!section) {
    const auto = market === 'yahoo' ? 'SP500 · Commodities' : 'Mercado Cripto';
    section = WATCHLIST.find(s => s.title === auto);
    if (!section) {
      section = { title: auto, items: [] };
      WATCHLIST.push(section);
    }
  }
  section.collapsed = false; // que se vea lo recién agregado
  const item = { sym, market };
  if (label && label !== sym) item.label = label;
  section.items.push(item);
  saveWatchlist();
  buildWatchlist();
  renderWatchlistValues();

  validateAndQuote(market, sym)
    .then((q) => { quotes[key] = q; renderWatchlistValues(); updateSymbolInfo(); })
    .catch(() => { /* la fila queda en “—” hasta el próximo poll */ });
  if (market === 'yahoo') setTimeout(pollYahooQuotes, 1500); // completa el cambio diario
  return true;
}

// ---------------- Buscador de símbolos (estilo TV) ----------------

const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

const QUOTE_ASSETS = ['USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR', 'ARS', 'KCS'];

function splitPair(sym) {
  for (const q of QUOTE_ASSETS) {
    if (sym.endsWith(q) && sym.length > q.length) {
      return `${sym.slice(0, -q.length)} / ${q}`;
    }
  }
  return sym;
}

const catalogs = { binance: null, kucoin: null };

async function loadCatalogs() {
  if (!catalogs.binance) {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/price');
      const data = await res.json();
      catalogs.binance = data.map(t => t.symbol);
    } catch { catalogs.binance = []; }
  }
  if (!catalogs.kucoin) {
    try {
      // instrumentos spot de Bybit (directo, sin proxy)
      const res = await fetch('https://api.bybit.com/v5/market/instruments-info?category=spot');
      const json = await res.json();
      catalogs.kucoin = (json?.result?.list || [])
        .filter(s => s.status === 'Trading')
        .map(s => ({ sym: s.symbol, base: s.baseCoin, quote: s.quoteCoin }));
    } catch { catalogs.kucoin = []; }
  }
}

let searchFilter = 'all';
let searchTimer = null;
let searchToken = 0;

async function runSearch() {
  const q = searchInput.value.trim().toUpperCase();
  const token = ++searchToken;
  if (q.length < 2) {
    searchResults.innerHTML = '<p class="search-hint">Escribí al menos 2 caracteres para buscar…</p>';
    return;
  }
  searchResults.innerHTML = '<p class="search-hint">Buscando…</p>';

  const out = [];

  if (searchFilter !== 'stocks') {
    await loadCatalogs();
    if (token !== searchToken) return;
    const bin = catalogs.binance.filter(s => s.includes(q)).slice(0, 10);
    for (const s of bin) out.push({ sym: s, name: splitPair(s), market: 'binance', tag: 'BINANCE' });
    const seen = new Set(bin);
    const ku = catalogs.kucoin
      .filter(s => s.sym.includes(q) && !seen.has(s.sym))
      .slice(0, 8);
    for (const s of ku) out.push({ sym: s.sym, name: `${s.base} / ${s.quote}`, market: 'kucoin', tag: 'BYBIT' });
  }

  if (searchFilter !== 'crypto') {
    try {
      const json = await fetchProxyJson(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
      if (token !== searchToken) return;
      for (const r of (json.quotes || [])) {
        if (!r.symbol) continue;
        out.push({
          sym: r.symbol.toUpperCase(),
          name: r.shortname || r.longname || '',
          market: 'yahoo',
          tag: (r.exchDisp || r.exchange || 'YAHOO').toUpperCase().slice(0, 10),
        });
      }
    } catch { /* Yahoo caído: mostrar solo cripto */ }
  }

  if (token !== searchToken) return;
  renderSearchResults(out);
}

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = '<p class="search-hint">Sin resultados. Probá con otro término.</p>';
    return;
  }
  searchResults.innerHTML = '';
  for (const r of results) {
    const key = `${r.market}:${r.sym}`;
    const already = WATCHLIST.some(s => s.items.some(i => wlKey(i) === key));
    const row = document.createElement('div');
    row.className = 'sr-row';
    row.innerHTML =
      `<span class="wl-badge" style="background:${badgeColor(r.sym)}">${r.sym[0]}</span>` +
      `<span class="sr-sym">${r.sym}</span>` +
      `<span class="sr-name">${r.name}</span>` +
      `<span class="sr-tag ${r.market}">${r.tag}</span>` +
      `<span class="sr-add ${already ? 'added' : ''}">${already ? '✓' : '+'}</span>`;
    row.addEventListener('click', () => {
      const addEl = row.querySelector('.sr-add');
      if (addEl.classList.contains('added')) return;
      const dest = document.getElementById('search-section').value || undefined;
      if (addToWatchlist(r.market, r.sym, undefined, dest === '__auto' ? undefined : dest)) {
        addEl.textContent = '✓';
        addEl.classList.add('added');
      }
    });
    searchResults.appendChild(row);
  }
}

function refreshSearchSections() {
  const sel = document.getElementById('search-section');
  const prev = sel.value;
  sel.innerHTML = '<option value="__auto">Automática (según el mercado)</option>' +
    WATCHLIST.map(s => `<option value="${escHtml(s.title)}">${escHtml(s.title)}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

document.getElementById('wl-add').addEventListener('click', () => {
  searchOverlay.classList.remove('hidden');
  searchInput.value = '';
  searchResults.innerHTML = '<p class="search-hint">Escribí al menos 2 caracteres para buscar…</p>';
  refreshSearchSections();
  searchInput.focus();
  loadCatalogs(); // precarga en segundo plano
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 300);
});

for (const b of document.querySelectorAll('.search-tabs button')) {
  b.addEventListener('click', () => {
    searchFilter = b.dataset.f;
    for (const x of document.querySelectorAll('.search-tabs button')) {
      x.classList.toggle('active', x === b);
    }
    runSearch();
  });
}

function closeSearch() { searchOverlay.classList.add('hidden'); }
document.getElementById('search-x').addEventListener('click', closeSearch);
searchOverlay.addEventListener('click', (e) => { if (e.target === searchOverlay) closeSearch(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !searchOverlay.classList.contains('hidden')) closeSearch();
});

// --- Cotizaciones: Binance (batch, cada 10 s) ---

async function pollBinanceQuotes() {
  const syms = WATCHLIST.flatMap(s => s.items)
    .filter(i => i.market === 'binance').map(i => i.sym);
  if (!syms.length) return;
  try {
    const url = `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(syms))}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    for (const t of data) {
      quotes[`binance:${t.symbol}`] = {
        last: +t.lastPrice, chg: +t.priceChange, pct: +t.priceChangePercent,
        bid: +t.bidPrice || null, ask: +t.askPrice || null,
      };
    }
    renderWatchlistValues();
    updateSymbolInfo();
    checkAlertsFromQuotes();
  } catch { /* siguiente ciclo */ }
}

// --- Cotizaciones: Bybit (clave 'kucoin', cada 30 s) ---

async function pollKuCoinQuotes() {
  const items = WATCHLIST.flatMap(s => s.items).filter(i => i.market === 'kucoin');
  for (const item of items) {
    try {
      quotes[wlKey(item)] = await fetchBybitTicker(item.sym);
    } catch { /* siguiente ciclo */ }
  }
  renderWatchlistValues();
  updateSymbolInfo();
  checkAlertsFromQuotes();
}

// --- Cotizaciones: Yahoo (cada 60 s) ---

async function pollYahooQuotes() {
  const items = WATCHLIST.flatMap(s => s.items).filter(i => i.market === 'yahoo');
  await Promise.all(items.map(async (item) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.sym)}?interval=1d&range=5d`;
      const json = await fetchProxyJson(url);
      const result = json?.chart?.result?.[0];
      const meta = result?.meta;
      if (!meta || meta.regularMarketPrice == null) return;
      // cierre de AYER: penúltima vela diaria si la última es la sesión de hoy
      const ts = result.timestamp || [];
      const rawCloses = result.indicators?.quote?.[0]?.close || [];
      const daily = [];
      for (let i = 0; i < ts.length; i++) {
        if (rawCloses[i] != null) daily.push({ t: ts[i], c: rawCloses[i] });
      }
      let prev = meta.chartPreviousClose ?? meta.regularMarketPrice;
      if (daily.length >= 2) {
        const lastBar = daily[daily.length - 1];
        const sameDay = meta.regularMarketTime &&
          new Date(lastBar.t * 1000).toDateString() === new Date(meta.regularMarketTime * 1000).toDateString();
        prev = sameDay ? daily[daily.length - 2].c : lastBar.c;
      }
      const chg = meta.regularMarketPrice - prev;
      quotes[wlKey(item)] = {
        last: meta.regularMarketPrice, chg,
        pct: prev ? (chg / prev) * 100 : 0,
        bid: null, ask: null,
      };
    } catch { /* siguiente ciclo */ }
  }));
  renderWatchlistValues();
  updateSymbolInfo();
  checkAlertsFromQuotes();
}

function startWatchlistPolling() {
  pollBinanceQuotes(); setInterval(pollBinanceQuotes, 10000);
  pollKuCoinQuotes(); setInterval(pollKuCoinQuotes, 30000);
  pollYahooQuotes(); setInterval(pollYahooQuotes, 60000);
}

// ---------------- Ajuste de rango visible ----------------

// Muestra las últimas N velas ancladas al presente: fija el zoom
// (barSpacing) y desplaza el borde derecho hasta la última vela.
function fitChart() {
  const n = state.candles.length;
  if (!n) return;
  const wanted = state.pendingBars;
  state.pendingBars = null;
  const visible = wanted === 0 ? n : Math.min(n, wanted || 250);

  // setVisibleLogicalRange ancla AMBOS bordes por índice de vela: el zoom y
  // la posición quedan fijos sin depender de scrollToPosition (que arrastraba
  // el gráfico hacia atrás al cambiar de timeframe). Varias pasadas porque el
  // layout puede no estar listo en el primer frame (sobre todo en móvil).
  const apply = () => {
    chart.timeScale().setVisibleLogicalRange({ from: n - visible, to: n + 3 });
  };
  apply();
  setTimeout(apply, 50);
  setTimeout(apply, 250);
}

// ---------------- Carga de datos ----------------

async function loadSymbol() {
  const token = ++state.loadToken;
  closeWS();
  stopPolling();
  showInfo(`Cargando ${displayName()}…`);

  const tf = TIMEFRAMES.find(t => t.id === state.timeframe);
  try {
    let candles;
    if (state.market === 'binance') candles = await fetchBinance(state.symbol, tf);
    else if (state.market === 'kucoin') candles = await fetchKuCoin(state.symbol, tf);
    else candles = await fetchYahoo(state.symbol, tf);
    if (token !== state.loadToken) return;

    state.candles = candles;
    setAllData();
    fitChart();
    hideStatus();
    highlightActiveRow();
    updateAlertLines();
    Drawings.setSymbol(`${state.market}:${state.symbol}`);
    saveState();

    if (state.market === 'binance' && !tf.agg) {
      openBinanceWS(state.symbol, tf, token);
    } else if (state.market === 'binance') {
      // velas agregadas (3M): refresco por REST
      startRefreshPolling(() => fetchBinance(state.symbol, tf), 60000, token);
    } else if (state.market === 'kucoin') {
      startRefreshPolling(() => fetchKuCoin(state.symbol, tf), 30000, token);
    } else {
      startRefreshPolling(() => fetchYahoo(state.symbol, tf), 60000, token);
    }
  } catch (e) {
    if (token !== state.loadToken) return;
    showError(`⚠ ${e.message}`);
  }
}

// ---------------- UI: toolbar ----------------

const marketEl = document.getElementById('market');
const symbolEl = document.getElementById('symbol');
const datalistEl = document.getElementById('symbol-list');

function refreshFavorites() {
  datalistEl.innerHTML = FAVORITES[state.market]
    .map(s => `<option value="${s}">`).join('');
}

// ---------------- Desplegables: temporalidad e indicadores ----------------

const DROP_PANELS = [
  { btn: 'tf-btn', panel: 'tf-panel' },
  { btn: 'ind-btn', panel: 'ind-panel' },
];

function closePanels() {
  for (const p of DROP_PANELS) document.getElementById(p.panel).classList.add('hidden');
}

function togglePanel(btnId, panelId) {
  const panel = document.getElementById(panelId);
  const willOpen = panel.classList.contains('hidden');
  closePanels();
  if (!willOpen) return;
  if (window.innerWidth > 860) {
    // escritorio: desplegable debajo de su botón
    const r = document.getElementById(btnId).getBoundingClientRect();
    panel.style.left = Math.min(r.left, window.innerWidth - 280) + 'px';
    panel.style.top = (r.bottom + 6) + 'px';
  } else {
    // móvil: hoja inferior (posición por CSS)
    panel.style.left = '';
    panel.style.top = '';
  }
  panel.classList.remove('hidden');
}

for (const p of DROP_PANELS) {
  document.getElementById(p.btn).addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel(p.btn, p.panel);
  });
}

document.addEventListener('click', (e) => {
  for (const p of DROP_PANELS) {
    const panel = document.getElementById(p.panel);
    if (!panel.classList.contains('hidden') && !panel.contains(e.target)) {
      panel.classList.add('hidden');
    }
  }
});

function tfLongLabel(tf) {
  const names = {
    '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos', '30m': '30 minutos',
    '1h': '1 hora', '4h': '4 horas', '1d': '1 día', '1w': '1 semana',
    '1M': '1 mes', '3M': '3 meses',
  };
  return names[tf.id] || tf.label;
}

function buildTimeframeButtons() {
  const box = document.getElementById('ctrl-tfs');
  box.innerHTML = '';
  for (const tf of TIMEFRAMES) {
    const row = document.createElement('div');
    row.className = 'sheet-row tf-row';
    row.dataset.tf = tf.id;
    row.innerHTML = `<span>${tfLongLabel(tf)}</span><span class="sheet-check"></span>`;
    row.addEventListener('click', () => {
      if (row.classList.contains('disabled')) return;
      state.timeframe = tf.id;
      refreshTimeframeButtons();
      closePanels();
      loadSymbol();
    });
    box.appendChild(row);
  }
  refreshTimeframeButtons();
}

function refreshTimeframeButtons() {
  for (const row of document.querySelectorAll('#ctrl-tfs .tf-row')) {
    const tf = TIMEFRAMES.find(t => t.id === row.dataset.tf);
    row.classList.toggle('disabled', state.market === 'yahoo' && !tf.yahoo);
    row.querySelector('.sheet-check').textContent = row.dataset.tf === state.timeframe ? '✓' : '';
  }
  const cur = TIMEFRAMES.find(t => t.id === state.timeframe);
  document.getElementById('tf-btn').textContent = `${cur ? cur.label : state.timeframe} ▾`;
}

const INDICATOR_LABELS = {
  medias: 'Medias', rsi: 'RSI', macd: 'MACD',
  squeeze: 'Squeeze', adx: 'ADX', vp: 'Perfil Vol',
};

function buildIndicatorToggles() {
  const list = document.getElementById('ctrl-inds');
  list.innerHTML = '';
  for (const key of Object.keys(INDICATOR_LABELS)) {
    const row = document.createElement('div');
    row.className = 'sheet-row';

    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'switch';
    sw.checked = state.toggles[key];
    sw.addEventListener('change', () => {
      state.toggles[key] = sw.checked;
      buildIndicatorSeries();
      recomputeIndicators();
      saveState();
    });

    const name = document.createElement('span');
    name.textContent = INDICATOR_LABELS[key];

    const gear = document.createElement('button');
    gear.className = 'gear-btn';
    gear.textContent = '⚙';
    gear.title = `Configurar ${INDICATOR_LABELS[key]}`;
    gear.addEventListener('click', () => {
      closePanels();
      openIndicatorDialog(key);
    });

    row.appendChild(sw);
    row.appendChild(name);
    row.appendChild(gear);
    list.appendChild(row);
  }
}

marketEl.addEventListener('change', () => {
  state.market = marketEl.value;
  const tf = TIMEFRAMES.find(t => t.id === state.timeframe);
  if (state.market === 'yahoo' && !tf.yahoo) state.timeframe = '1d';
  state.symbol = FAVORITES[state.market][0];
  state.symbolLabel = null;
  symbolEl.value = state.symbol;
  refreshFavorites();
  refreshTimeframeButtons();
  loadSymbol();
});

function submitSymbol() {
  const sym = symbolEl.value.trim().toUpperCase();
  if (!sym) return;
  state.symbol = sym;
  state.symbolLabel = null;
  symbolEl.value = sym;
  loadSymbol();
}

document.getElementById('load-btn').addEventListener('click', submitSymbol);
symbolEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitSymbol(); });
symbolEl.addEventListener('change', () => {
  if (FAVORITES[state.market].includes(symbolEl.value.trim().toUpperCase())) submitSymbol();
});

// ---------------- UI: reloj ----------------

function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    const d = new Date();
    const off = -d.getTimezoneOffset() / 60;
    el.textContent = `${d.toLocaleTimeString('es-AR', { hour12: false })} UTC${off >= 0 ? '+' : ''}${off}`;
  };
  tick();
  setInterval(tick, 1000);
}

// ---------------- Diálogo de indicador (estilo TradingView) ----------------

const dlgOverlay = document.getElementById('dlg-overlay');
const dlgInputsEl = document.getElementById('dlg-inputs');
const dlgStyleEl = document.getElementById('dlg-style');

// helpers de formulario
const fNum = (id, label, val, step = 1, min = 1, max = 1000) =>
  `<label class="f-row">${label} <input type="number" id="${id}" value="${val}" step="${step}" min="${min}" max="${max}"></label>`;
const fSelect = (id, label, val, opts) =>
  `<label class="f-row">${label} <select id="${id}">` +
  opts.map(([v, txt]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${txt}</option>`).join('') +
  `</select></label>`;
const fCheck = (id, label, on) =>
  `<label class="dlg-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
const fColorRow = (id, label, val) =>
  `<label class="f-row">${label} <input type="color" id="${id}" value="${val}"></label>`;
const fWidth = (id, val) =>
  `<select id="${id}">` +
  [1, 2, 3, 4].map(w => `<option value="${w}" ${w === val ? 'selected' : ''}>${w}px</option>`).join('') +
  `</select>`;
const gNum = (id, def) => {
  const v = parseFloat(document.getElementById(id).value);
  return Number.isFinite(v) ? v : def;
};
const gInt = (id, def) => Math.round(gNum(id, def));
const gVal = (id) => document.getElementById(id).value;
const gChk = (id) => document.getElementById(id).checked;

const IND_DIALOGS = {
  medias: {
    title: '4EMA · Medias móviles',
    inputs: (c) =>
      fSelect('f-matype', 'Tipo', c.type, [['ema', 'EMA'], ['sma', 'SMA']]) +
      c.lines.map((l, i) => fNum(`f-len-${i}`, `Length${i + 1}`, l.len, 1, 2, 1000)).join(''),
    style: (c) =>
      c.lines.map((l, i) =>
        `<div class="style-row">
          <input type="checkbox" id="f-on-${i}" ${l.on ? 'checked' : ''}>
          <span>Media ${i + 1} (${l.len})</span>
          <input type="color" id="f-color-${i}" value="${l.color}">
          ${fWidth(`f-width-${i}`, l.width)}
        </div>`).join(''),
    read: (c) => {
      c.type = gVal('f-matype');
      c.lines.forEach((l, i) => {
        l.len = Math.min(1000, Math.max(2, gInt(`f-len-${i}`, l.len)));
        l.on = gChk(`f-on-${i}`);
        l.color = gVal(`f-color-${i}`);
        l.width = gInt(`f-width-${i}`, l.width);
      });
    },
  },

  rsi: {
    title: 'RSI',
    inputs: (c) =>
      fNum('f-rsi-p', 'Período', c.period, 1, 2, 100) +
      fNum('f-rsi-ob', 'Sobrecompra', c.ob, 1, 50, 100) +
      fNum('f-rsi-os', 'Sobreventa', c.os, 1, 0, 50),
    style: (c) =>
      fColorRow('f-rsi-color', 'Color', c.color) +
      `<label class="f-row">Grosor ${fWidth('f-rsi-w', c.width)}</label>`,
    read: (c) => {
      c.period = gInt('f-rsi-p', c.period);
      c.ob = gInt('f-rsi-ob', c.ob);
      c.os = gInt('f-rsi-os', c.os);
      c.color = gVal('f-rsi-color');
      c.width = gInt('f-rsi-w', c.width);
    },
  },

  macd: {
    title: 'MACD',
    inputs: (c) =>
      fNum('f-macd-f', 'Rápida', c.fast, 1, 2, 100) +
      fNum('f-macd-s', 'Lenta', c.slow, 1, 2, 200) +
      fNum('f-macd-sig', 'Señal', c.signal, 1, 2, 100),
    style: (c) =>
      fColorRow('f-macd-c1', 'Línea MACD', c.macdColor) +
      fColorRow('f-macd-c2', 'Línea señal', c.signalColor),
    read: (c) => {
      c.fast = gInt('f-macd-f', c.fast);
      c.slow = gInt('f-macd-s', c.slow);
      c.signal = gInt('f-macd-sig', c.signal);
      c.macdColor = gVal('f-macd-c1');
      c.signalColor = gVal('f-macd-c2');
    },
  },

  squeeze: {
    title: 'SQZMOM_LB · Squeeze Momentum',
    inputs: (c) =>
      fNum('f-sqz-bbl', 'BB Length', c.bbLen, 1, 5, 100) +
      fNum('f-sqz-bbm', 'BB MultFactor', c.bbMult, 0.1, 0.5, 5) +
      fNum('f-sqz-kcl', 'KC Length', c.kcLen, 1, 5, 100) +
      fNum('f-sqz-kcm', 'KC MultFactor', c.kcMult, 0.1, 0.5, 5) +
      fCheck('f-sqz-tr', 'Use TrueRange (KC)', c.useTR),
    style: (c) =>
      fSelect('f-sqz-mode', 'Estilo', c.mode, [['area', 'Área suave'], ['hist', 'Histograma 4 colores']]) +
      `<div class="dlg-section">Momentum</div>` +
      fColorRow('f-sqz-c0', 'Color 0 · positivo creciente', c.posUp) +
      fColorRow('f-sqz-c1', 'Color 1 · positivo decreciente', c.posDown) +
      fColorRow('f-sqz-c2', 'Color 2 · negativo decreciente', c.negDown) +
      fColorRow('f-sqz-c3', 'Color 3 · negativo creciente', c.negUp) +
      `<div class="dlg-section">Línea de cero</div>` +
      fColorRow('f-sqz-zon', 'Squeeze activo', c.zeroOn) +
      fColorRow('f-sqz-zoff', 'Squeeze liberado', c.zeroOff),
    read: (c) => {
      c.bbLen = gInt('f-sqz-bbl', c.bbLen);
      c.bbMult = gNum('f-sqz-bbm', c.bbMult);
      c.kcLen = gInt('f-sqz-kcl', c.kcLen);
      c.kcMult = gNum('f-sqz-kcm', c.kcMult);
      c.useTR = gChk('f-sqz-tr');
      c.mode = gVal('f-sqz-mode');
      c.posUp = gVal('f-sqz-c0');
      c.posDown = gVal('f-sqz-c1');
      c.negDown = gVal('f-sqz-c2');
      c.negUp = gVal('f-sqz-c3');
      c.zeroOn = gVal('f-sqz-zon');
      c.zeroOff = gVal('f-sqz-zoff');
    },
  },

  adx: {
    title: 'DMI / ADX / KEYLEVEL',
    inputs: (c) =>
      fNum('f-adx-p', 'Período', c.period, 1, 2, 100) +
      fNum('f-adx-kl', 'Nivel clave', c.keyLevel, 1, 5, 60) +
      fCheck('f-adx-merge', 'Unir con Squeeze (mismo panel)', c.merge),
    style: (c) =>
      `<div class="style-row">
        <input type="checkbox" checked disabled>
        <span>ADX</span>
        <input type="color" id="f-adx-c" value="${c.adxColor}">
        ${fWidth('f-adx-w', c.adxWidth)}
      </div>` +
      `<div class="style-row">
        <input type="checkbox" id="f-adx-plus" ${c.showPlus ? 'checked' : ''}>
        <span>+DI</span>
        <input type="color" id="f-adx-pc" value="${c.plusColor}">
        <span></span>
      </div>` +
      `<div class="style-row">
        <input type="checkbox" id="f-adx-minus" ${c.showMinus ? 'checked' : ''}>
        <span>−DI</span>
        <input type="color" id="f-adx-mc" value="${c.minusColor}">
        <span></span>
      </div>`,
    read: (c) => {
      c.period = gInt('f-adx-p', c.period);
      c.keyLevel = gInt('f-adx-kl', c.keyLevel);
      c.merge = gChk('f-adx-merge');
      c.adxColor = gVal('f-adx-c');
      c.adxWidth = gInt('f-adx-w', c.adxWidth);
      c.showPlus = gChk('f-adx-plus');
      c.plusColor = gVal('f-adx-pc');
      c.showMinus = gChk('f-adx-minus');
      c.minusColor = gVal('f-adx-mc');
    },
  },

  vp: {
    title: 'VRVP · Perfil de Volumen',
    inputs: (c) =>
      fNum('f-vp-rows', 'Row Size (filas)', c.rows, 1, 6, 1000) +
      fSelect('f-vp-mode', 'Volumen', c.volMode, [
        ['total', 'Total'], ['updown', 'Subida/Bajada'], ['delta', 'Delta'],
      ]) +
      fNum('f-vp-va', 'Value Area Volume %', c.vaPct, 1, 30, 99),
    style: (c) =>
      fNum('f-vp-width', 'Ancho (% del panel)', c.widthPct, 1, 5, 60) +
      fSelect('f-vp-place', 'Ubicación', c.placement, [['right', 'Derecha'], ['left', 'Izquierda']]) +
      `<div class="dlg-section">Volumen</div>` +
      fColorRow('f-vp-up', 'Up Volume', c.upColor) +
      fColorRow('f-vp-dn', 'Down Volume', c.downColor) +
      fColorRow('f-vp-vau', 'Value Area Up', c.vaUpColor) +
      fColorRow('f-vp-vad', 'Value Area Down', c.vaDownColor) +
      `<div class="dlg-section">Líneas</div>` +
      `<div class="style-row">
        <input type="checkbox" id="f-vp-poc" ${c.showPoc ? 'checked' : ''}>
        <span>POC</span>
        <input type="color" id="f-vp-pocc" value="${c.pocColor}">
        <span></span>
      </div>` +
      `<div class="style-row">
        <input type="checkbox" id="f-vp-vah" ${c.showVah ? 'checked' : ''}>
        <span>VAH</span>
        <input type="color" id="f-vp-vahc" value="${c.vahColor}">
        <span></span>
      </div>` +
      `<div class="style-row">
        <input type="checkbox" id="f-vp-val" ${c.showVal ? 'checked' : ''}>
        <span>VAL</span>
        <input type="color" id="f-vp-valc" value="${c.valColor}">
        <span></span>
      </div>`,
    read: (c) => {
      c.rows = gInt('f-vp-rows', c.rows);
      c.volMode = gVal('f-vp-mode');
      c.vaPct = gInt('f-vp-va', c.vaPct);
      c.widthPct = gInt('f-vp-width', c.widthPct);
      c.placement = gVal('f-vp-place');
      c.upColor = gVal('f-vp-up');
      c.downColor = gVal('f-vp-dn');
      c.vaUpColor = gVal('f-vp-vau');
      c.vaDownColor = gVal('f-vp-vad');
      c.showPoc = gChk('f-vp-poc');
      c.pocColor = gVal('f-vp-pocc');
      c.showVah = gChk('f-vp-vah');
      c.vahColor = gVal('f-vp-vahc');
      c.showVal = gChk('f-vp-val');
      c.valColor = gVal('f-vp-valc');
    },
  },
};

let dlgKey = null;

function renderDialog(cfg) {
  const def = IND_DIALOGS[dlgKey];
  dlgInputsEl.innerHTML = def.inputs(cfg);
  dlgStyleEl.innerHTML = def.style(cfg);
}

function switchDlgTab(tab) {
  for (const b of document.querySelectorAll('.dlg-tabs button')) {
    b.classList.toggle('active', b.dataset.tab === tab);
  }
  dlgInputsEl.classList.toggle('hidden', tab !== 'inputs');
  dlgStyleEl.classList.toggle('hidden', tab !== 'style');
}

function openIndicatorDialog(key) {
  dlgKey = key;
  document.getElementById('dlg-title').textContent = IND_DIALOGS[key].title;
  renderDialog(state.settings[key]);
  switchDlgTab('inputs');
  dlgOverlay.classList.remove('hidden');
}

function closeDialog() { dlgOverlay.classList.add('hidden'); dlgKey = null; }

for (const b of document.querySelectorAll('.dlg-tabs button')) {
  b.addEventListener('click', () => switchDlgTab(b.dataset.tab));
}

document.getElementById('dlg-ok').addEventListener('click', () => {
  if (!dlgKey) return;
  IND_DIALOGS[dlgKey].read(state.settings[dlgKey]);
  buildIndicatorSeries();
  recomputeIndicators();
  saveState();
  closeDialog();
});

document.getElementById('dlg-defaults').addEventListener('click', () => {
  // repone el formulario con los valores de fábrica; se aplican recién con Ok
  if (dlgKey) renderDialog(clone(DEFAULT_SETTINGS[dlgKey]));
});

document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
document.getElementById('dlg-x').addEventListener('click', closeDialog);
dlgOverlay.addEventListener('click', (e) => { if (e.target === dlgOverlay) closeDialog(); });

// ---------------- Móvil: panel de watchlist deslizante ----------------

const sidebarEl = document.getElementById('sidebar');

function closeSidebar() {
  sidebarEl.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.remove();
}

document.getElementById('sidebar-btn').addEventListener('click', () => {
  if (sidebarEl.classList.contains('open')) { closeSidebar(); return; }
  sidebarEl.classList.add('open');
  const bk = document.createElement('div');
  bk.id = 'sidebar-backdrop';
  bk.addEventListener('click', closeSidebar);
  document.getElementById('main-row').appendChild(bk);
});

// ---------------- Alertas de precio ----------------

let ALERTS = [];
try {
  const raw = JSON.parse(localStorage.getItem('mtv-alerts'));
  if (Array.isArray(raw)) ALERTS = raw;
} catch { /* sin alertas guardadas */ }

const alertPrev = {};   // id → último precio observado (solo en memoria)
let alertLines = [];    // price lines dibujadas en el gráfico

function saveAlerts() { localStorage.setItem('mtv-alerts', JSON.stringify(ALERTS)); }

function condText(a) { return a.cond === 'above' ? 'subió y cruzó' : 'bajó y cruzó'; }

// tres bips cortos con WebAudio (sin archivos de sonido)
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22, 0.44].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.18);
    });
  } catch { /* sin audio disponible */ }
}

function toast(msg) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.addEventListener('click', () => t.remove());
  box.appendChild(t);
  setTimeout(() => t.remove(), 12000);
}

function fireAlert(a, price) {
  a.triggered = Date.now();
  saveAlerts();
  const msg = `🔔 ${a.label || a.sym} ${condText(a)} ${formatPrice(a.price)} — ahora ${formatPrice(price)}`;
  toast(msg);
  beep();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('Alerta de precio', { body: msg, icon: 'icons/icon-192.png' });
    } catch { /* notificación no disponible */ }
  }
  refreshAlertBadge();
  renderAlertList();
  updateAlertLines();
}

// evalúa cruce real: el precio tiene que pasar de un lado al otro del nivel
function checkAlertsFor(market, sym, price) {
  if (price == null || !Number.isFinite(price)) return;
  for (const a of ALERTS) {
    if (a.triggered || a.market !== market || a.sym !== sym) continue;
    const prev = alertPrev[a.id];
    alertPrev[a.id] = price;
    if (prev == null) continue;
    const crossed = a.cond === 'above'
      ? (prev < a.price && price >= a.price)
      : (prev > a.price && price <= a.price);
    if (crossed) fireAlert(a, price);
  }
}

// revisa las alertas cubiertas por las cotizaciones de la watchlist
function checkAlertsFromQuotes() {
  const seen = new Set();
  for (const a of ALERTS) {
    if (a.triggered) continue;
    const key = `${a.market}:${a.sym}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const q = quotes[key];
    if (q && Number.isFinite(q.last)) checkAlertsFor(a.market, a.sym, q.last);
  }
}

// poller para alertas de símbolos que no están ni en la watchlist ni cargados
setInterval(async () => {
  for (const a of ALERTS) {
    if (a.triggered) continue;
    const key = `${a.market}:${a.sym}`;
    if (quotes[key]) continue;
    if (a.market === state.market && a.sym === state.symbol) continue;
    try {
      const q = await validateAndQuote(a.market, a.sym);
      quotes[key] = q;
      checkAlertsFor(a.market, a.sym, q.last);
    } catch { /* siguiente ciclo */ }
  }
}, 30000);

// líneas de alerta sobre el gráfico (solo las del símbolo cargado)
function updateAlertLines() {
  for (const l of alertLines) {
    try { candleSeries.removePriceLine(l); } catch { /* ya removida */ }
  }
  alertLines = [];
  for (const a of ALERTS) {
    if (a.market !== state.market || a.sym !== state.symbol) continue;
    alertLines.push(candleSeries.createPriceLine({
      price: a.price,
      color: a.triggered ? '#787b86' : '#ff9800',
      lineWidth: 1,
      lineStyle: LWC.LineStyle.Dashed,
      axisLabelVisible: true,
      title: '🔔',
    }));
  }
}

function refreshAlertBadge() {
  const armed = ALERTS.filter(a => !a.triggered).length;
  document.getElementById('alert-btn').textContent = armed ? `🔔 ${armed}` : '🔔';
}

// --- diálogo de alertas ---

const alertOverlay = document.getElementById('alert-overlay');

function renderAlertList() {
  const list = document.getElementById('alert-list');
  list.innerHTML = '';
  if (!ALERTS.length) {
    list.innerHTML = '<p class="search-hint">Sin alertas todavía.</p>';
    return;
  }
  const sorted = [...ALERTS].sort((a, b) => (a.triggered ? 1 : 0) - (b.triggered ? 1 : 0));
  for (const a of sorted) {
    const row = document.createElement('div');
    row.className = 'alert-row' + (a.triggered ? ' done' : '');
    const estado = a.triggered
      ? `disparada ${new Date(a.triggered).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
      : 'armada';
    row.innerHTML =
      `<span class="dot ${a.triggered ? 'off' : ''}"></span>` +
      `<span class="alert-txt">${escHtml(a.label || a.sym)} ${a.cond === 'above' ? '≥' : '≤'} ${formatPrice(a.price)}</span>` +
      `<span class="alert-state">${estado}</span>` +
      `<span class="wl-del" title="Eliminar alerta">✕</span>`;
    row.querySelector('.wl-del').addEventListener('click', () => {
      ALERTS = ALERTS.filter(x => x !== a);
      delete alertPrev[a.id];
      saveAlerts();
      renderAlertList();
      refreshAlertBadge();
      updateAlertLines();
    });
    list.appendChild(row);
  }
}

function openAlertDialog() {
  document.getElementById('alert-sym').textContent =
    `${displayName()} · ${SOURCE_NAMES[state.market]} · ${TIMEFRAMES.find(t => t.id === state.timeframe)?.label || ''}`;
  const last = state.candles[state.candles.length - 1];
  document.getElementById('alert-price').value = last ? last.close : '';
  renderAlertList();
  alertOverlay.classList.remove('hidden');
}

document.getElementById('alert-btn').addEventListener('click', openAlertDialog);
document.getElementById('alert-x').addEventListener('click', () => alertOverlay.classList.add('hidden'));
alertOverlay.addEventListener('click', (e) => {
  if (e.target === alertOverlay) alertOverlay.classList.add('hidden');
});

document.getElementById('alert-create').addEventListener('click', () => {
  const price = parseFloat(document.getElementById('alert-price').value);
  if (!Number.isFinite(price) || price <= 0) {
    showError('⚠ Ingresá un precio válido para la alerta');
    return;
  }
  hideStatus();
  const a = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    market: state.market,
    sym: state.symbol,
    label: state.symbolLabel || null,
    cond: document.getElementById('alert-cond').value,
    price,
    created: Date.now(),
    triggered: null,
  };
  ALERTS.push(a);
  const last = state.candles[state.candles.length - 1];
  if (last) alertPrev[a.id] = last.close; // arranca el seguimiento desde ya
  saveAlerts();
  renderAlertList();
  refreshAlertBadge();
  updateAlertLines();
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
});

// ---------------- PWA: service worker ----------------

if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* sin PWA: la app funciona igual */ });
}

// ---------------- Herramientas de dibujo ----------------

Drawings.init({
  chart,
  series: candleSeries,
  container: document.getElementById('chart'),
  getCandles: () => state.candles,
});

const drawToolbar = document.getElementById('draw-toolbar');
for (const btn of drawToolbar.querySelectorAll('button[data-tool]')) {
  btn.addEventListener('click', () => Drawings.setTool(btn.dataset.tool));
}
document.getElementById('draw-del').addEventListener('click', () => Drawings.deleteSelected());
document.getElementById('draw-clear').addEventListener('click', () => Drawings.clearAll());

// barra de estilo: paleta de colores + grosor
const drawStyle = document.getElementById('draw-style');
const drawColors = document.getElementById('draw-colors');
for (const color of Drawings.palette()) {
  const sw = document.createElement('button');
  sw.className = 'sw';
  sw.style.background = color;
  sw.dataset.color = color;
  sw.addEventListener('click', () => Drawings.setSelectedStyle({ color }));
  drawColors.appendChild(sw);
}
for (const b of drawStyle.querySelectorAll('.dw')) {
  b.addEventListener('click', () => Drawings.setSelectedStyle({ width: +b.dataset.w }));
}

Drawings.onToolbarUpdate(({ tool, hasSelection, style }) => {
  for (const btn of drawToolbar.querySelectorAll('button[data-tool]')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
  document.getElementById('draw-del').disabled = !hasSelection;

  drawStyle.classList.toggle('hidden', !hasSelection);
  if (style) {
    for (const sw of drawColors.children) sw.classList.toggle('active', sw.dataset.color === style.color);
    for (const b of drawStyle.querySelectorAll('.dw')) b.classList.toggle('active', +b.dataset.w === style.width);
  }
});

// ---------------- Inicio ----------------

loadState();
marketEl.value = state.market;
symbolEl.value = state.symbol;
refreshFavorites();
buildTimeframeButtons();
buildIndicatorToggles();
buildIndicatorSeries();
refreshListButton();
buildWatchlist();
refreshAlertBadge();
startClock();
startWatchlistPolling();
loadSymbol();
