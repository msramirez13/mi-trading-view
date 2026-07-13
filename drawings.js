// ============================================================
// drawings.js — Herramientas de dibujo sobre el gráfico
// Línea horizontal, línea de tendencia, rayo, rectángulo y
// retroceso de Fibonacci. Dibujar / seleccionar / mover /
// editar puntas / borrar, con persistencia por símbolo.
// ============================================================

/* global LightweightCharts */

const Drawings = (() => {
  let chart = null;
  let series = null;
  let container = null;   // el div que contiene el canvas del gráfico
  let getCandles = null;  // () => array de velas actual

  let all = {};           // `${market}:${symbol}` -> [drawing, ...]
  let curKey = null;
  let tool = 'cursor';    // cursor | hline | trend | ray | rect | fib
  let draft = null;       // dibujo en construcción (puntos ya puestos)
  let selected = null;    // dibujo seleccionado
  let drag = null;        // estado de arrastre en curso
  let requestPaint = null;

  const HIT = 7;          // tolerancia de click en píxeles
  const DEFAULT_COLOR = '#2962ff';
  const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  // cuántos puntos necesita cada tipo antes de quedar terminado
  const POINTS = { hline: 1, trend: 2, ray: 2, rect: 2, fib: 2 };

  // ---------- Persistencia ----------

  function save() {
    try { localStorage.setItem('mtv-drawings', JSON.stringify(all)); } catch { /* lleno */ }
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem('mtv-drawings'));
      if (raw && typeof raw === 'object') all = raw;
    } catch { all = {}; }
  }

  function list() { return curKey && all[curKey] ? all[curKey] : []; }
  function setList(arr) { if (curKey) { all[curKey] = arr; save(); } }

  // ---------- Conversión de coordenadas (ancladas a tiempo/precio) ----------

  function candles() { return getCandles ? getCandles() : []; }

  function barDelta() {
    const c = candles();
    if (c.length < 2) return 3600;
    return (c[c.length - 1].time - c[0].time) / (c.length - 1);
  }

  // tiempo -> x en píxeles (interpola vía coordenada lógica; sirve cross-TF y a futuro)
  function timeToX(time) {
    const ts = chart.timeScale();
    const c = candles();
    if (!c.length) return null;
    const first = c[0].time, last = c[c.length - 1].time;
    let logical;
    if (time <= first) logical = -(first - time) / barDelta();
    else if (time >= last) logical = (c.length - 1) + (time - last) / barDelta();
    else {
      let lo = 0, hi = c.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].time <= time) lo = m; else hi = m; }
      const span = c[hi].time - c[lo].time || 1;
      logical = lo + (time - c[lo].time) / span;
    }
    return ts.logicalToCoordinate(logical);
  }

  // x en píxeles -> tiempo
  function xToTime(x) {
    const ts = chart.timeScale();
    const c = candles();
    if (!c.length) return null;
    const logical = ts.coordinateToLogical(x);
    if (logical <= 0) return c[0].time + logical * barDelta();
    if (logical >= c.length - 1) return c[c.length - 1].time + (logical - (c.length - 1)) * barDelta();
    const i = Math.floor(logical), frac = logical - i;
    return c[i].time + frac * (c[i + 1].time - c[i].time);
  }

  const priceToY = (p) => series.priceToCoordinate(p);
  const yToPrice = (y) => series.coordinateToPrice(y);

  function pt(x, y) { return { time: xToTime(x), price: yToPrice(y) }; }

  // ---------- Geometría para hit-testing ----------

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // devuelve {part} si el click cae sobre el dibujo d, o null
  function hitTest(d, mx, my) {
    const w = container.clientWidth;
    if (d.type === 'hline') {
      const y = priceToY(d.points[0].price);
      if (y != null && Math.abs(my - y) <= HIT) return { part: 'p0' };
      return null;
    }
    const p0 = d.points[0], p1 = d.points[1];
    const x0 = timeToX(p0.time), y0 = priceToY(p0.price);
    if (x0 == null || y0 == null) return null;
    let x1, y1;
    if (d.type === 'ray') {
      // el rayo se extiende al borde derecho
      const xr = timeToX(p1.time), yr = priceToY(p1.price);
      if (xr == null || yr == null) return null;
      const slope = (yr - y0) / ((xr - x0) || 0.0001);
      x1 = w; y1 = y0 + slope * (w - x0);
      if (Math.hypot(mx - xr, my - yr) <= HIT) return { part: 'p1' };
    } else {
      x1 = timeToX(p1.time); y1 = priceToY(p1.price);
      if (x1 == null || y1 == null) return null;
      if (Math.hypot(mx - x1, my - y1) <= HIT) return { part: 'p1' };
    }
    if (Math.hypot(mx - x0, my - y0) <= HIT) return { part: 'p0' };

    if (d.type === 'trend' || d.type === 'ray') {
      if (distToSeg(mx, my, x0, y0, x1, y1) <= HIT) return { part: 'body' };
    } else if (d.type === 'rect') {
      const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
      const near = distToSeg(mx, my, L, T, R, T) <= HIT || distToSeg(mx, my, L, B, R, B) <= HIT ||
                   distToSeg(mx, my, L, T, L, B) <= HIT || distToSeg(mx, my, R, T, R, B) <= HIT;
      if (near) return { part: 'body' };
      if (mx > L && mx < R && my > T && my < B) return { part: 'body' };
    } else if (d.type === 'fib') {
      const L = Math.min(x0, x1), R = Math.max(x0, x1);
      if (mx >= L - HIT && mx <= R + HIT) {
        for (const lv of FIB_LEVELS) {
          const price = p1.price + (p0.price - p1.price) * lv;
          const y = priceToY(price);
          if (y != null && Math.abs(my - y) <= HIT) return { part: 'body' };
        }
      }
    }
    return null;
  }

  function hitAny(mx, my) {
    const arr = list();
    for (let i = arr.length - 1; i >= 0; i--) {
      const h = hitTest(arr[i], mx, my);
      if (h) return { drawing: arr[i], ...h };
    }
    return null;
  }

  // ---------- Primitive de dibujo (render) ----------

  class DrawingPrimitive {
    attached(p) { requestPaint = p.requestUpdate; }
    detached() { requestPaint = null; }
    updateAllViews() { /* usa datos en vivo en draw */ }
    paneViews() {
      const self = this;
      return [{ zOrder: () => 'top', renderer: () => ({ draw: (t) => self._draw(t) }) }];
    }
    _draw(target) {
      target.useMediaCoordinateSpace((scope) => {
        const ctx = scope.context;
        const w = scope.mediaSize.width;
        const items = list().slice();
        if (draft) items.push(draft);
        for (const d of items) drawOne(ctx, d, w, d === selected);
      });
    }
  }

  function drawOne(ctx, d, w, isSel) {
    const color = d.color || DEFAULT_COLOR;
    const width = d.width || 2;
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = '11px sans-serif';

    if (d.type === 'hline') {
      const y = priceToY(d.points[0].price);
      if (y == null) return;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(fmt(d.points[0].price), 6, y - 4);
      if (isSel) handle(ctx, w / 2, y);
      return;
    }

    const p0 = d.points[0], p1 = d.points[1];
    if (!p1) { // en construcción con 1 punto (trend/ray/rect/fib): nada aún
      return;
    }
    const x0 = timeToX(p0.time), y0 = priceToY(p0.price);
    let x1 = timeToX(p1.time), y1 = priceToY(p1.price);
    if (x0 == null || y0 == null || x1 == null || y1 == null) return;

    if (d.type === 'trend' || d.type === 'ray') {
      let ex = x1, ey = y1;
      if (d.type === 'ray') {
        const slope = (y1 - y0) / ((x1 - x0) || 0.0001);
        ex = x1 >= x0 ? w : 0;
        ey = y0 + slope * (ex - x0);
      }
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(ex, ey); ctx.stroke();
      if (isSel) { handle(ctx, x0, y0); handle(ctx, x1, y1); }
    } else if (d.type === 'rect') {
      const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
      ctx.globalAlpha = 0.12; ctx.fillRect(L, T, R - L, B - T); ctx.globalAlpha = 1;
      ctx.strokeRect(L, T, R - L, B - T);
      if (isSel) { handle(ctx, x0, y0); handle(ctx, x1, y1); }
    } else if (d.type === 'fib') {
      const L = Math.min(x0, x1), R = Math.max(x0, x1);
      for (let i = 0; i < FIB_LEVELS.length; i++) {
        const lv = FIB_LEVELS[i];
        const price = p1.price + (p0.price - p1.price) * lv;
        const y = priceToY(price);
        if (y == null) continue;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillText(`${(lv * 100).toFixed(1)}%  ${fmt(price)}`, R + 4, y + 3);
        // sombreado entre niveles
        if (i > 0) {
          const prevPrice = p1.price + (p0.price - p1.price) * FIB_LEVELS[i - 1];
          const yPrev = priceToY(prevPrice);
          if (yPrev != null) { ctx.globalAlpha = 0.05; ctx.fillRect(L, Math.min(y, yPrev), R - L, Math.abs(y - yPrev)); ctx.globalAlpha = 1; }
        }
      }
      if (isSel) { handle(ctx, x0, y0); handle(ctx, x1, y1); }
    }
  }

  function handle(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = DEFAULT_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function fmt(v) {
    if (window.formatPrice) return window.formatPrice(v);
    return v != null ? v.toFixed(2) : '';
  }

  const primitive = new DrawingPrimitive();

  function repaint() { if (requestPaint) requestPaint(); }

  // ---------- Interacción con el mouse ----------

  function relPos(e) {
    const r = container.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - r.left, y: src.clientY - r.top };
  }

  // bloquea el paneo del gráfico mientras dibujamos o arrastramos
  function setChartLocked(locked) {
    chart.applyOptions({
      handleScroll: !locked,
      handleScale: !locked,
    });
  }

  // Modelo: hline = 1 click; los demás = click inicial + click final
  // (el punto final sigue al cursor entre ambos clicks).
  function onDown(e) {
    if (!curKey) return;
    const { x, y } = relPos(e);

    if (tool !== 'cursor') {
      e.preventDefault();
      const point = pt(x, y);
      if (point.time == null || point.price == null) return;
      if (!draft) {
        // primer click: crea el dibujo
        draft = { id: 'd' + Date.now(), type: tool, color: DEFAULT_COLOR, width: 2, points: [point] };
        if (POINTS[tool] === 1) { finishDraft(); return; }
        draft.points.push({ ...point });   // segundo punto (seguirá al cursor)
        setChartLocked(true);
      } else {
        // segundo click: fija el punto final y termina
        draft.points[1] = point;
        finishDraft();
      }
      repaint();
      return;
    }

    // modo cursor: seleccionar / arrastrar
    const hit = hitAny(x, y);
    if (hit) {
      e.preventDefault();
      selected = hit.drawing;
      drag = {
        drawing: hit.drawing, part: hit.part,
        origin: pt(x, y),
        snapshot: hit.drawing.points.map(p => ({ ...p })),
      };
      setChartLocked(true);
    } else {
      selected = null;
    }
    repaint();
    updateToolbar();
  }

  function onMove(e) {
    if (!curKey) return;
    const { x, y } = relPos(e);

    // el punto final del dibujo en curso sigue al cursor
    if (draft && draft.points.length === 2 && tool !== 'cursor') {
      draft.points[1] = pt(x, y);
      repaint();
      return;
    }
    if (!drag) return;
    e.preventDefault();
    const now = pt(x, y);
    if (now.time == null || now.price == null) return;
    const d = drag.drawing;
    if (drag.part === 'p0') d.points[0] = now;
    else if (drag.part === 'p1') d.points[1] = now;
    else {
      const dt = now.time - drag.origin.time;
      const dp = now.price - drag.origin.price;
      d.points = drag.snapshot.map(p => ({ time: p.time + dt, price: p.price + dp }));
    }
    repaint();
  }

  function onUp() {
    if (drag) { setList(list()); drag = null; setChartLocked(false); }
  }

  function finishDraft() {
    if (!draft) return;
    const arr = list();
    arr.push(draft);
    setList(arr);
    selected = draft;
    draft = null;
    setTool('cursor');
    setChartLocked(false);
    repaint();
    updateToolbar();
  }

  // ---------- API pública ----------

  function setTool(t) {
    tool = t;
    draft = null;              // cancela cualquier dibujo a medio hacer
    setChartLocked(false);     // el lock se reactiva al primer click de dibujo
    if (t !== 'cursor') selected = null;
    updateToolbar();
    repaint();
    container.style.cursor = t === 'cursor' ? '' : 'crosshair';
  }

  function deleteSelected() {
    if (!selected) return;
    setList(list().filter(d => d !== selected));
    selected = null;
    repaint();
    updateToolbar();
  }

  function clearAll() {
    if (!list().length) return;
    setList([]);
    selected = null;
    repaint();
    updateToolbar();
  }

  function setSymbol(key) {
    curKey = key;
    if (!all[key]) all[key] = [];
    selected = null;
    draft = null;
    repaint();
    updateToolbar();
  }

  let toolbarCb = null;
  function onToolbarUpdate(cb) { toolbarCb = cb; }
  function updateToolbar() { if (toolbarCb) toolbarCb({ tool, hasSelection: !!selected, count: list().length }); }

  function init(opts) {
    chart = opts.chart;
    series = opts.series;
    container = opts.container;
    getCandles = opts.getCandles;
    load();
    series.attachPrimitive(primitive);

    container.addEventListener('mousedown', onDown);
    container.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // táctil
    container.addEventListener('touchstart', onDown, { passive: false });
    container.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    window.addEventListener('keydown', (e) => {
      const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || '');
      if (typing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        // cancela dibujo en curso o vuelve al cursor
        if (draft) { draft = null; repaint(); }
        setTool('cursor');
      }
    });
  }

  return { init, setTool, deleteSelected, clearAll, setSymbol, onToolbarUpdate, repaint,
           getTool: () => tool };
})();
