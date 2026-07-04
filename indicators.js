// ============================================================
// indicators.js — Cálculo de indicadores técnicos
// Todas las funciones reciben arrays y devuelven arrays de la
// misma longitud, con null donde el indicador aún no existe.
// ============================================================

const Indicators = (() => {

  // ---------- Helpers básicos ----------

  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
      if (prev === null) {
        // arranque: promedio simple de los primeros `period`
        if (i === period - 1) {
          let sum = 0;
          for (let j = 0; j < period; j++) sum += values[j];
          prev = sum / period;
          out[i] = prev;
        }
      } else {
        prev = values[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function stdev(values, period) {
    const out = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      const mean = sum / period;
      let sq = 0;
      for (let j = i - period + 1; j <= i; j++) sq += (values[j] - mean) ** 2;
      out[i] = Math.sqrt(sq / period);
    }
    return out;
  }

  function highest(values, period) {
    const out = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let h = -Infinity;
      for (let j = i - period + 1; j <= i; j++) h = Math.max(h, values[j]);
      out[i] = h;
    }
    return out;
  }

  function lowest(values, period) {
    const out = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let l = Infinity;
      for (let j = i - period + 1; j <= i; j++) l = Math.min(l, values[j]);
      out[i] = l;
    }
    return out;
  }

  // Regresión lineal: valor del extremo de la recta de mínimos
  // cuadrados sobre la ventana (equivale a linreg() de Pine Script)
  function linreg(values, period) {
    const out = new Array(values.length).fill(null);
    const n = period;
    let sumX = 0, sumX2 = 0;
    for (let j = 0; j < n; j++) { sumX += j; sumX2 += j * j; }
    for (let i = period - 1; i < values.length; i++) {
      let sumY = 0, sumXY = 0, ok = true;
      for (let j = 0; j < n; j++) {
        const y = values[i - n + 1 + j];
        if (y === null || y === undefined || Number.isNaN(y)) { ok = false; break; }
        sumY += y; sumXY += j * y;
      }
      if (!ok) continue;
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      out[i] = intercept + slope * (n - 1);
    }
    return out;
  }

  function trueRange(candles) {
    const out = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (i === 0) { out[i] = c.high - c.low; continue; }
      const pc = candles[i - 1].close;
      out[i] = Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    }
    return out;
  }

  // ---------- RSI (suavizado de Wilder) ----------

  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      const gain = Math.max(ch, 0), loss = Math.max(-ch, 0);
      if (i <= period) {
        avgGain += gain / period;
        avgLoss += loss / period;
        if (i === period) {
          out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
        }
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    }
    return out;
  }

  // ---------- MACD ----------

  function macd(closes, fast = 12, slow = 26, signalP = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const macdLine = closes.map((_, i) =>
      emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null);

    // EMA de la línea MACD ignorando los null iniciales
    const firstIdx = macdLine.findIndex(v => v !== null);
    const signal = new Array(closes.length).fill(null);
    if (firstIdx >= 0) {
      const valid = macdLine.slice(firstIdx);
      const sig = ema(valid, signalP);
      for (let i = 0; i < sig.length; i++) signal[firstIdx + i] = sig[i];
    }
    const hist = macdLine.map((v, i) =>
      v !== null && signal[i] !== null ? v - signal[i] : null);
    return { macdLine, signal, hist };
  }

  // ---------- ADX (+DI / -DI, suavizado de Wilder) ----------

  function adx(candles, period = 14) {
    const len = candles.length;
    const plusDI = new Array(len).fill(null);
    const minusDI = new Array(len).fill(null);
    const adxLine = new Array(len).fill(null);
    if (len <= period * 2) return { adxLine, plusDI, minusDI };

    const tr = trueRange(candles);
    let smTR = 0, smPlus = 0, smMinus = 0;
    const dx = new Array(len).fill(null);

    for (let i = 1; i < len; i++) {
      const upMove = candles[i].high - candles[i - 1].high;
      const downMove = candles[i - 1].low - candles[i].low;
      const pDM = (upMove > downMove && upMove > 0) ? upMove : 0;
      const mDM = (downMove > upMove && downMove > 0) ? downMove : 0;

      if (i <= period) {
        smTR += tr[i]; smPlus += pDM; smMinus += mDM;
      } else {
        smTR = smTR - smTR / period + tr[i];
        smPlus = smPlus - smPlus / period + pDM;
        smMinus = smMinus - smMinus / period + mDM;
      }
      if (i >= period && smTR > 0) {
        const p = 100 * smPlus / smTR;
        const m = 100 * smMinus / smTR;
        plusDI[i] = p; minusDI[i] = m;
        dx[i] = (p + m) > 0 ? 100 * Math.abs(p - m) / (p + m) : 0;
      }
    }
    // ADX = media de Wilder del DX
    let sum = 0, count = 0, prevADX = null;
    for (let i = 0; i < len; i++) {
      if (dx[i] === null) continue;
      if (prevADX === null) {
        sum += dx[i]; count++;
        if (count === period) { prevADX = sum / period; adxLine[i] = prevADX; }
      } else {
        prevADX = (prevADX * (period - 1) + dx[i]) / period;
        adxLine[i] = prevADX;
      }
    }
    return { adxLine, plusDI, minusDI };
  }

  // ---------- Squeeze Momentum (LazyBear) ----------
  // Bollinger dentro de Keltner = squeeze activo.
  // Momentum = linreg del precio contra su punto medio de Donchian/SMA.

  function squeezeMomentum(candles, bbLen = 20, bbMult = 2.0, kcLen = 20, kcMult = 1.5, useTR = true) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const basis = sma(closes, bbLen);
    const dev = stdev(closes, bbLen);
    const kcMa = sma(closes, kcLen);
    const range = useTR ? trueRange(candles) : candles.map(c => c.high - c.low);
    const rangeMA = sma(range, kcLen);
    const hh = highest(highs, kcLen);
    const ll = lowest(lows, kcLen);

    const len = candles.length;
    const squeezeOn = new Array(len).fill(null);
    const source = new Array(len).fill(null);

    for (let i = 0; i < len; i++) {
      if (basis[i] === null || dev[i] === null || kcMa[i] === null ||
          rangeMA[i] === null || hh[i] === null || ll[i] === null) continue;
      const upperBB = basis[i] + bbMult * dev[i];
      const lowerBB = basis[i] - bbMult * dev[i];
      const upperKC = kcMa[i] + kcMult * rangeMA[i];
      const lowerKC = kcMa[i] - kcMult * rangeMA[i];
      squeezeOn[i] = lowerBB > lowerKC && upperBB < upperKC;
      const mid = ((hh[i] + ll[i]) / 2 + kcMa[i]) / 2;
      source[i] = closes[i] - mid;
    }
    const momentum = linreg(source, kcLen);
    return { momentum, squeezeOn };
  }

  return { sma, ema, stdev, rsi, macd, adx, squeezeMomentum, trueRange };
})();
