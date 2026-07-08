/* Canvas HiDPI candle demo — vanilla JS
 * Sections: constants, data, viewport, canvas, coords, render, chart, app
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // [1] Constants & utils
  // ---------------------------------------------------------------------------

  const CANDLE_COUNT = 2000;
  const SEED = 42;
  const MIN_VISIBLE = 20;
  const INITIAL_VISIBLE = 500;
  const PRESET_500 = 500;
  const PRESET_40 = 40;
  const PAD_TOP = 12;
  const PAD_LEFT = 8;
  const PAD_RIGHT = 56;
  const PAD_BOTTOM = 28;
  const PRICE_PAD_RATIO = 0.05;
  const GESTURE_THRESHOLD = 8;
  const K_DRAG = 0.005;
  const K_WHEEL = 0.0015;
  const BUTTON_ZOOM_FACTOR = 1.2;
  const START_TIME_UTC = Date.UTC(2024, 0, 1, 9, 0, 0);
  const MINUTE_MS = 60 * 1000;
  const MA_PERIODS = [
    { period: 5, key: "ma5", colorKey: "ma5", label: "MA5" },
    { period: 20, key: "ma20", colorKey: "ma20", label: "MA20" },
    { period: 60, key: "ma60", colorKey: "ma60", label: "MA60" },
    { period: 120, key: "ma120", colorKey: "ma120", label: "MA120" },
  ];

  const COLORS = {
    background: "#fbfcfd",
    grid: "#e6ebef",
    axis: "#9aa7b2",
    axisText: "#4a5560",
    up: "#0b7a4b",
    down: "#c0392b",
    wick: "#5c6770",
    highLine: "#0b6e4f",
    lowLine: "#b42318",
    labelBg: "rgba(255,255,255,0.85)",
    rangeFill: "rgba(37, 99, 235, 0.18)",
    rangeStroke: "rgba(37, 99, 235, 0.85)",
    ma5: "#7c3aed",
    ma20: "#2563eb",
    ma60: "#d97706",
    ma120: "#0f766e",
  };

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function nearlyEqual(a, b, eps) {
    return Math.abs(a - b) < (eps || 1e-6);
  }

  function viewportsEqual(a, b) {
    return (
      nearlyEqual(a.startIndex, b.startIndex) &&
      nearlyEqual(a.visibleCount, b.visibleCount)
    );
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function formatPrice(n) {
    return n.toLocaleString("ko-KR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function formatTimeUTC(ms, stepMs) {
    const d = new Date(ms);
    const mm = pad2(d.getUTCMonth() + 1);
    const dd = pad2(d.getUTCDate());
    const hh = pad2(d.getUTCHours());
    const mi = pad2(d.getUTCMinutes());
    if (stepMs >= 24 * 60 * MINUTE_MS) return mm + "/" + dd;
    if (hh === "00" && mi === "00") return mm + "/" + dd;
    return hh + ":" + mi;
  }

  // ---------------------------------------------------------------------------
  // [2] Data generation
  // ---------------------------------------------------------------------------

  function generateCandles(count, seed) {
    const rand = mulberry32(seed);
    const candles = [];
    let price = 10000 + rand() * 2000;

    for (let i = 0; i < count; i++) {
      const drift = (rand() - 0.48) * 40;
      const open = price;
      const close = Math.max(100, open + drift + (rand() - 0.5) * 20);
      const bodyHigh = Math.max(open, close);
      const bodyLow = Math.min(open, close);
      const high = bodyHigh + rand() * 25;
      const low = Math.max(1, bodyLow - rand() * 25);
      candles.push({
        time: START_TIME_UTC + i * MINUTE_MS,
        open,
        high,
        low,
        close,
      });
      price = close;
    }
    return candles;
  }

  /** Simple moving average of close. Values before `period-1` are null. */
  function computeSMA(candles, period) {
    const out = new Array(candles.length).fill(null);
    if (period < 1 || candles.length < period) return out;
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function computeMovingAverages(candles) {
    const series = {};
    for (let i = 0; i < MA_PERIODS.length; i++) {
      const { period, key } = MA_PERIODS[i];
      series[key] = computeSMA(candles, period);
    }
    return series;
  }

  // ---------------------------------------------------------------------------
  // [3] Viewport helpers
  // ---------------------------------------------------------------------------

  function clampViewport(viewport, length) {
    const visibleCount = clamp(viewport.visibleCount, MIN_VISIBLE, length);
    const startIndex = clamp(viewport.startIndex, 0, length - visibleCount);
    return { startIndex, visibleCount };
  }

  function defaultViewport(length) {
    const visibleCount = Math.min(INITIAL_VISIBLE, length);
    return {
      startIndex: Math.max(0, length - visibleCount),
      visibleCount,
    };
  }

  function getVisibleRange(viewport, length) {
    const from = Math.max(0, Math.floor(viewport.startIndex));
    const toExclusive = Math.min(
      length,
      Math.ceil(viewport.startIndex + viewport.visibleCount)
    );
    return { from, toExclusive };
  }

  function getPriceExtent(candles, from, toExclusive) {
    let min = Infinity;
    let max = -Infinity;
    let highIndex = from;
    let lowIndex = from;
    for (let i = from; i < toExclusive; i++) {
      const c = candles[i];
      if (c.high > max) {
        max = c.high;
        highIndex = i;
      }
      if (c.low < min) {
        min = c.low;
        lowIndex = i;
      }
    }
    if (!isFinite(min) || !isFinite(max)) {
      min = 0;
      max = 1;
    }
    const pad = (max - min) * PRICE_PAD_RATIO || 1;
    return {
      min: min - pad,
      max: max + pad,
      rawMin: min,
      rawMax: max,
      highIndex,
      lowIndex,
    };
  }

  // ---------------------------------------------------------------------------
  // [4] Canvas prep (DPR on/off)
  // ---------------------------------------------------------------------------

  function resizeCanvas(canvas, useDPR) {
    const cssW = Math.max(1, Math.floor(canvas.clientWidth));
    const cssH = Math.max(1, Math.floor(canvas.clientHeight));
    const dpr = useDPR ? window.devicePixelRatio || 1 : 1;
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;

    const ctx = canvas.getContext("2d");
    if (useDPR) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    return { cssW, cssH, dpr, ctx };
  }

  function computeLayout(cssW, cssH) {
    const plotLeft = PAD_LEFT;
    const plotTop = PAD_TOP;
    const plotWidth = Math.max(1, cssW - PAD_LEFT - PAD_RIGHT);
    const plotHeight = Math.max(1, cssH - PAD_TOP - PAD_BOTTOM);
    return { cssW, cssH, plotLeft, plotTop, plotWidth, plotHeight };
  }

  // ---------------------------------------------------------------------------
  // [5] Coordinate transforms
  // ---------------------------------------------------------------------------

  function indexToX(index, viewport, layout) {
    return (
      layout.plotLeft +
      ((index - viewport.startIndex) / viewport.visibleCount) *
        layout.plotWidth
    );
  }

  function priceToY(price, extent, layout) {
    const t = (price - extent.min) / (extent.max - extent.min || 1);
    return layout.plotTop + (1 - t) * layout.plotHeight;
  }

  function xToIndex(x, viewport, layout) {
    const ratio = (x - layout.plotLeft) / layout.plotWidth;
    return viewport.startIndex + clamp(ratio, 0, 1) * viewport.visibleCount;
  }

  function hitPlot(x, y, layout) {
    return (
      x >= layout.plotLeft &&
      x <= layout.plotLeft + layout.plotWidth &&
      y >= layout.plotTop &&
      y <= layout.plotTop + layout.plotHeight
    );
  }

  // ---------------------------------------------------------------------------
  // [6] Nice ticks + render
  // ---------------------------------------------------------------------------

  function nicePriceStep(raw) {
    if (!(raw > 0)) return 1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    const residual = raw / magnitude;
    const niceResiduals = [1, 2, 5, 10];
    for (let i = 0; i < niceResiduals.length; i++) {
      if (niceResiduals[i] >= residual) return niceResiduals[i] * magnitude;
    }
    return 10 * magnitude;
  }

  function priceTicks(min, max, targetCount) {
    const raw = (max - min) / (targetCount || 5);
    const step = nicePriceStep(raw);
    const start = Math.ceil(min / step) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 0.001; v += step) {
      ticks.push(v);
    }
    return { ticks, step };
  }

  const TIME_CANDIDATES = [
    MINUTE_MS,
    5 * MINUTE_MS,
    15 * MINUTE_MS,
    30 * MINUTE_MS,
    60 * MINUTE_MS,
    3 * 60 * MINUTE_MS,
    6 * 60 * MINUTE_MS,
    12 * 60 * MINUTE_MS,
    24 * 60 * MINUTE_MS,
  ];

  function chooseTimeStep(rangeMs, targetCount) {
    const target = targetCount || 6;
    for (let i = 0; i < TIME_CANDIDATES.length; i++) {
      const c = TIME_CANDIDATES[i];
      if (rangeMs / c <= target) return c;
    }
    return TIME_CANDIDATES[TIME_CANDIDATES.length - 1];
  }

  function timeTicks(tStart, tEnd, targetCount) {
    const rangeMs = Math.max(1, tEnd - tStart);
    const step = chooseTimeStep(rangeMs, targetCount);
    const start = Math.ceil(tStart / step) * step;
    const ticks = [];
    for (let t = start; t <= tEnd; t += step) ticks.push(t);
    return { ticks, step };
  }

  function drawMovingAverage(ctx, values, from, toExclusive, viewport, layout, extent, color) {
    ctx.beginPath();
    let started = false;
    for (let i = from; i < toExclusive; i++) {
      const v = values[i];
      if (v == null || !isFinite(v)) {
        started = false;
        continue;
      }
      const x = indexToX(i + 0.5, viewport, layout);
      const y = priceToY(v, extent, layout);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    if (!started) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function drawMaLegend(ctx, layout) {
    const x0 = layout.plotLeft + 8;
    let y = layout.plotTop + 14;
    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 0; i < MA_PERIODS.length; i++) {
      const item = MA_PERIODS[i];
      ctx.strokeStyle = COLORS[item.colorKey];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 16, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.axisText;
      ctx.fillText(item.label, x0 + 22, y);
      y += 16;
    }
    ctx.restore();
  }

  function drawChart(ctx, candles, maSeries, viewport, layout, selection) {
    const { cssW, cssH, plotLeft, plotTop, plotWidth, plotHeight } = layout;
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssW, cssH);

    const { from, toExclusive } = getVisibleRange(viewport, candles.length);
    if (from >= toExclusive) return;

    const extent = getPriceExtent(candles, from, toExclusive);
    const first = candles[from];
    const last = candles[toExclusive - 1];
    const { ticks: pTicks } = priceTicks(extent.min, extent.max, 5);
    const { ticks: tTicks, step: tStep } = timeTicks(
      first.time,
      last.time,
      6
    );

    // grid + price axis
    ctx.save();
    ctx.strokeStyle = COLORS.grid;
    ctx.fillStyle = COLORS.axisText;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;

    for (let i = 0; i < pTicks.length; i++) {
      const price = pTicks[i];
      const y = priceToY(price, extent, layout);
      if (y < plotTop || y > plotTop + plotHeight) continue;
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      ctx.fillText(formatPrice(price), plotLeft + plotWidth + 6, y);
    }

    // time axis
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < tTicks.length; i++) {
      const t = tTicks[i];
      const idx = (t - START_TIME_UTC) / MINUTE_MS;
      const x = indexToX(idx + 0.5, viewport, layout);
      if (x < plotLeft || x > plotLeft + plotWidth) continue;
      ctx.strokeStyle = COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotTop + plotHeight);
      ctx.stroke();
      ctx.fillStyle = COLORS.axisText;
      ctx.fillText(formatTimeUTC(t, tStep), x, plotTop + plotHeight + 6);
    }

    // plot border
    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(plotLeft + 0.5, plotTop + 0.5, plotWidth - 1, plotHeight - 1);

    // candles (clipped)
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
    ctx.clip();

    const candleW = Math.max(
      1,
      (plotWidth / viewport.visibleCount) * 0.7
    );

    for (let i = from; i < toExclusive; i++) {
      const c = candles[i];
      const x = indexToX(i + 0.5, viewport, layout);
      const yHigh = priceToY(c.high, extent, layout);
      const yLow = priceToY(c.low, extent, layout);
      const yOpen = priceToY(c.open, extent, layout);
      const yClose = priceToY(c.close, extent, layout);
      const up = c.close >= c.open;
      const color = up ? COLORS.up : COLORS.down;

      ctx.strokeStyle = COLORS.wick;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillStyle = color;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    }

    // moving averages (above candles, still clipped)
    for (let i = 0; i < MA_PERIODS.length; i++) {
      const item = MA_PERIODS[i];
      drawMovingAverage(
        ctx,
        maSeries[item.key],
        from,
        toExclusive,
        viewport,
        layout,
        extent,
        COLORS[item.colorKey]
      );
    }

    // guide lines stay inside plot
    const highCandle = candles[extent.highIndex];
    const lowCandle = candles[extent.lowIndex];
    const yHi = priceToY(highCandle.high, extent, layout);
    const yLo = priceToY(lowCandle.low, extent, layout);
    const xHi = indexToX(extent.highIndex + 0.5, viewport, layout);
    const xLo = indexToX(extent.lowIndex + 0.5, viewport, layout);

    ctx.strokeStyle = COLORS.highLine;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(plotLeft, yHi);
    ctx.lineTo(plotLeft + plotWidth, yHi);
    ctx.stroke();
    ctx.strokeStyle = COLORS.lowLine;
    ctx.beginPath();
    ctx.moveTo(plotLeft, yLo);
    ctx.lineTo(plotLeft + plotWidth, yLo);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // labels outside clip: above the high wick / below the low wick of that candle
    drawCandlePriceLabel(
      ctx,
      layout,
      xHi,
      yHi,
      COLORS.highLine,
      "최고 " + formatPrice(highCandle.high),
      "above"
    );
    drawCandlePriceLabel(
      ctx,
      layout,
      xLo,
      yLo,
      COLORS.lowLine,
      "최저 " + formatPrice(lowCandle.low),
      "below"
    );
    drawMaLegend(ctx, layout);

    if (selection && selection.x0 != null && selection.x1 != null) {
      drawRangeSelection(ctx, layout, selection.x0, selection.x1);
    }

    ctx.restore();
  }

  function drawRangeSelection(ctx, layout, x0, x1) {
    const left = clamp(
      Math.min(x0, x1),
      layout.plotLeft,
      layout.plotLeft + layout.plotWidth
    );
    const right = clamp(
      Math.max(x0, x1),
      layout.plotLeft,
      layout.plotLeft + layout.plotWidth
    );
    const w = Math.max(1, right - left);
    ctx.save();
    ctx.fillStyle = COLORS.rangeFill;
    ctx.fillRect(left, layout.plotTop, w, layout.plotHeight);
    ctx.strokeStyle = COLORS.rangeStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + 0.5, layout.plotTop + 0.5, w - 1, layout.plotHeight - 1);
    ctx.restore();
  }

  /** Place a price label centered on a candle, above its high or below its low. */
  function drawCandlePriceLabel(ctx, layout, candleX, wickY, color, label, place) {
    const { plotLeft, plotTop, plotWidth, plotHeight } = layout;
    const gap = 6;
    const boxH = 16;
    const padX = 4;

    ctx.save();
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textW = ctx.measureText(label).width;
    const boxW = textW + padX * 2;

    let cx = clamp(
      candleX,
      plotLeft + boxW / 2 + 2,
      plotLeft + plotWidth - boxW / 2 - 2
    );
    let cy;
    if (place === "above") {
      cy = wickY - gap - boxH / 2;
      if (cy - boxH / 2 < plotTop + 2) {
        cy = Math.min(wickY + gap + boxH / 2, plotTop + plotHeight - boxH / 2 - 2);
      }
    } else {
      cy = wickY + gap + boxH / 2;
      if (cy + boxH / 2 > plotTop + plotHeight - 2) {
        cy = Math.max(wickY - gap - boxH / 2, plotTop + boxH / 2 + 2);
      }
    }

    ctx.fillStyle = COLORS.labelBg;
    ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
    ctx.fillStyle = color;
    ctx.fillText(label, cx, cy);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // [7] Chart instance (gestures)
  // ---------------------------------------------------------------------------

  function createChart({
    id,
    canvas,
    candles,
    maSeries,
    useDPR,
    getViewport,
    requestViewport,
    onInteract,
    isRangeZoomMode,
  }) {
    let layout = computeLayout(1, 1);
    const pointers = new Map();
    let gesture = { mode: "idle" };
    let pinch = null;
    let selection = null;

    function measureAndDraw() {
      const { cssW, cssH, ctx } = resizeCanvas(canvas, useDPR);
      layout = computeLayout(cssW, cssH);
      drawChart(ctx, candles, maSeries, getViewport(), layout, selection);
    }

    function localPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function wantsRangeZoom(e) {
      return !!(e.shiftKey || (isRangeZoomMode && isRangeZoomMode()));
    }

    function zoomAt(anchorIndex, factor, ratioX) {
      const vp = getViewport();
      const visibleCount = clamp(
        vp.visibleCount * factor,
        MIN_VISIBLE,
        candles.length
      );
      const rx = ratioX == null ? 0.5 : clamp(ratioX, 0, 1);
      const startIndex = clamp(
        anchorIndex - rx * visibleCount,
        0,
        candles.length - visibleCount
      );
      requestViewport({ startIndex, visibleCount });
    }

    function panByPixels(dx) {
      const vp = getViewport();
      const deltaIndex = (-dx / layout.plotWidth) * vp.visibleCount;
      requestViewport({
        startIndex: vp.startIndex + deltaIndex,
        visibleCount: vp.visibleCount,
      });
    }

    function applyRangeZoom(x0, x1) {
      const left = Math.min(x0, x1);
      const right = Math.max(x0, x1);
      if (right - left < 4) return;
      const vp = getViewport();
      const i0 = xToIndex(left, vp, layout);
      const i1 = xToIndex(right, vp, layout);
      const startIndex = Math.min(i0, i1);
      const endIndex = Math.max(i0, i1);
      const visibleCount = clamp(
        endIndex - startIndex,
        MIN_VISIBLE,
        candles.length
      );
      requestViewport(
        clampViewport({ startIndex, visibleCount }, candles.length)
      );
    }

    function beginPinch() {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return;
      selection = null;
      const [a, b] = pts;
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const midX = (a.x + b.x) / 2;
      const vp = getViewport();
      const ratioX = clamp((midX - layout.plotLeft) / layout.plotWidth, 0, 1);
      pinch = {
        startDist: dist,
        startViewport: { ...vp },
        anchorIndex: xToIndex(midX, vp, layout),
        ratioX,
      };
      gesture = { mode: "pinch" };
    }

    function onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      onInteract(id);
      canvas.setPointerCapture(e.pointerId);
      const p = localPoint(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 1) {
        const inPlot = hitPlot(p.x, p.y, layout);
        if (inPlot && wantsRangeZoom(e)) {
          gesture = {
            mode: "rangeSelect",
            startX: p.x,
            startY: p.y,
            lastX: p.x,
            lastY: p.y,
            inPlot: true,
          };
          selection = { x0: p.x, x1: p.x };
          measureAndDraw();
        } else {
          gesture = {
            mode: "pending",
            startX: p.x,
            startY: p.y,
            lastX: p.x,
            lastY: p.y,
            inPlot: inPlot,
          };
          selection = null;
        }
      } else if (pointers.size === 2) {
        beginPinch();
        measureAndDraw();
      }
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!pointers.has(e.pointerId)) return;
      const p = localPoint(e);
      pointers.set(e.pointerId, p);

      if (gesture.mode === "pinch" && pinch && pointers.size >= 2) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
        const factor = pinch.startDist / dist;
        const visibleCount = clamp(
          pinch.startViewport.visibleCount * factor,
          MIN_VISIBLE,
          candles.length
        );
        const startIndex = clamp(
          pinch.anchorIndex - pinch.ratioX * visibleCount,
          0,
          candles.length - visibleCount
        );
        requestViewport({ startIndex, visibleCount });
        e.preventDefault();
        return;
      }

      if (gesture.mode === "rangeSelect") {
        const x = clamp(
          p.x,
          layout.plotLeft,
          layout.plotLeft + layout.plotWidth
        );
        selection = { x0: gesture.startX, x1: x };
        measureAndDraw();
        e.preventDefault();
        return;
      }

      if (gesture.mode === "idle" || !gesture.inPlot) return;

      const dx = p.x - gesture.lastX;
      const dy = p.y - gesture.lastY;
      gesture.lastX = p.x;
      gesture.lastY = p.y;

      if (gesture.mode === "pending") {
        const adx = Math.abs(p.x - gesture.startX);
        const ady = Math.abs(p.y - gesture.startY);
        if (adx < GESTURE_THRESHOLD && ady < GESTURE_THRESHOLD) return;
        if (adx >= ady) {
          gesture.mode = "lockedPan";
        } else {
          gesture.mode = "lockedZoom";
        }
      }

      if (gesture.mode === "lockedPan") {
        panByPixels(dx);
      } else if (gesture.mode === "lockedZoom") {
        const factor = Math.exp(dy * K_DRAG);
        const vp = getViewport();
        const ratioX = 0.5;
        const anchorIndex = vp.startIndex + ratioX * vp.visibleCount;
        zoomAt(anchorIndex, factor, ratioX);
      }
      e.preventDefault();
    }

    function endPointer(e) {
      if (gesture.mode === "rangeSelect" && selection) {
        applyRangeZoom(selection.x0, selection.x1);
        selection = null;
        measureAndDraw();
      }

      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        gesture = { mode: "idle" };
        pinch = null;
        if (selection) {
          selection = null;
          measureAndDraw();
        }
      } else if (pointers.size === 1) {
        pinch = null;
        const remaining = Array.from(pointers.values())[0];
        gesture = {
          mode: "pending",
          startX: remaining.x,
          startY: remaining.y,
          lastX: remaining.x,
          lastY: remaining.y,
          inPlot: hitPlot(remaining.x, remaining.y, layout),
        };
      }
    }

    function onWheel(e) {
      onInteract(id);
      const p = localPoint(e);
      if (!hitPlot(p.x, p.y, layout)) return;
      e.preventDefault();
      const vp = getViewport();
      const ratioX = clamp((p.x - layout.plotLeft) / layout.plotWidth, 0, 1);
      const anchorIndex = xToIndex(p.x, vp, layout);
      const factor = Math.exp(e.deltaY * K_WHEEL);
      zoomAt(anchorIndex, factor, ratioX);
    }

    function updateCursor() {
      canvas.style.cursor = isRangeZoomMode && isRangeZoomMode()
        ? "crosshair"
        : "crosshair";
      canvas.classList.toggle(
        "range-zoom-active",
        !!(isRangeZoomMode && isRangeZoomMode())
      );
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("lostpointercapture", endPointer);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return {
      id,
      canvas,
      useDPR,
      draw: measureAndDraw,
      updateCursor,
      zoomCentered(factor) {
        onInteract(id);
        const vp = getViewport();
        const ratioX = 0.5;
        const anchorIndex = vp.startIndex + ratioX * vp.visibleCount;
        zoomAt(anchorIndex, factor, ratioX);
      },
      setVisibleCount(count) {
        onInteract(id);
        const vp = getViewport();
        const visibleCount = clamp(count, MIN_VISIBLE, candles.length);
        const center = vp.startIndex + vp.visibleCount / 2;
        const startIndex = clamp(
          center - visibleCount / 2,
          0,
          candles.length - visibleCount
        );
        requestViewport({ startIndex, visibleCount });
      },
      reset() {
        onInteract(id);
        requestViewport(defaultViewport(candles.length));
      },
      destroy() {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endPointer);
        canvas.removeEventListener("pointercancel", endPointer);
        canvas.removeEventListener("lostpointercapture", endPointer);
        canvas.removeEventListener("wheel", onWheel);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // [8] App orchestration
  // ---------------------------------------------------------------------------

  const candles = generateCandles(CANDLE_COUNT, SEED);
  const maSeries = computeMovingAverages(candles);
  const viewports = {
    raw: defaultViewport(candles.length),
    dpr: defaultViewport(candles.length),
  };

  let activeChartId = "dpr";
  let syncEnabled = false;
  let rangeZoomMode = false;
  let isApplyingSync = false;
  let lastDpr = window.devicePixelRatio || 1;

  const dprLabel = document.getElementById("dpr-label");
  const syncToggle = document.getElementById("sync-toggle");
  const rangeZoomBtn = document.getElementById("range-zoom-toggle");
  const panels = {
    raw: document.getElementById("panel-raw"),
    dpr: document.getElementById("panel-dpr"),
  };

  function updateDprLabel() {
    const dpr = window.devicePixelRatio || 1;
    dprLabel.textContent = "현재 devicePixelRatio: " + dpr;
  }

  function setRangeZoomMode(on) {
    rangeZoomMode = !!on;
    if (rangeZoomBtn) {
      rangeZoomBtn.classList.toggle("is-pressed", rangeZoomMode);
      rangeZoomBtn.setAttribute("aria-pressed", rangeZoomMode ? "true" : "false");
    }
    document.body.classList.toggle("range-zoom-mode", rangeZoomMode);
    if (charts) {
      charts.raw.updateCursor();
      charts.dpr.updateCursor();
    }
  }

  function setActiveChart(id) {
    activeChartId = id;
    Object.keys(panels).forEach(function (key) {
      const panel = panels[key];
      const badge = panel.querySelector(".active-badge");
      const active = key === id;
      panel.classList.toggle("is-active", active);
      if (badge) badge.hidden = !active;
    });
  }

  function otherId(id) {
    return id === "raw" ? "dpr" : "raw";
  }

  function applyViewport(sourceId, nextViewport, options) {
    const opts = options || {};
    const sync = opts.sync != null ? opts.sync : syncEnabled;
    if (isApplyingSync) return;

    const clamped = clampViewport(nextViewport, candles.length);
    const current = viewports[sourceId];
    if (!viewportsEqual(current, clamped)) {
      viewports[sourceId] = clamped;
      charts[sourceId].draw();
    }

    if (sync) {
      const oid = otherId(sourceId);
      if (!viewportsEqual(viewports[oid], clamped)) {
        isApplyingSync = true;
        viewports[oid] = { ...clamped };
        charts[oid].draw();
        isApplyingSync = false;
      }
    }
  }

  function requestFromChart(id) {
    return function (next) {
      applyViewport(id, next);
    };
  }

  const charts = {
    raw: createChart({
      id: "raw",
      canvas: document.getElementById("chart-raw"),
      candles,
      maSeries,
      useDPR: false,
      getViewport: function () {
        return viewports.raw;
      },
      requestViewport: requestFromChart("raw"),
      onInteract: setActiveChart,
      isRangeZoomMode: function () {
        return rangeZoomMode;
      },
    }),
    dpr: createChart({
      id: "dpr",
      canvas: document.getElementById("chart-dpr"),
      candles,
      maSeries,
      useDPR: true,
      getViewport: function () {
        return viewports.dpr;
      },
      requestViewport: requestFromChart("dpr"),
      onInteract: setActiveChart,
      isRangeZoomMode: function () {
        return rangeZoomMode;
      },
    }),
  };

  function handleAction(action, forcedId) {
    const id = forcedId || activeChartId || "raw";
    if (forcedId) setActiveChart(forcedId);
    const chart = charts[id];

    if (action === "zoom-in") {
      chart.zoomCentered(1 / BUTTON_ZOOM_FACTOR);
    } else if (action === "zoom-out") {
      chart.zoomCentered(BUTTON_ZOOM_FACTOR);
    } else if (action === "reset") {
      chart.reset();
    } else if (action === "preset-500") {
      chart.setVisibleCount(PRESET_500);
    } else if (action === "preset-40") {
      chart.setVisibleCount(PRESET_40);
    } else if (action === "align-now") {
      const source = activeChartId || "raw";
      const target = otherId(source);
      isApplyingSync = true;
      viewports[target] = { ...viewports[source] };
      charts[target].draw();
      isApplyingSync = false;
    }
  }

  document.querySelector(".toolbar").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    handleAction(btn.getAttribute("data-action"));
  });

  Object.keys(panels).forEach(function (id) {
    panels[id].addEventListener("click", function (e) {
      const btn = e.target.closest("[data-local-action]");
      if (!btn) return;
      handleAction(btn.getAttribute("data-local-action"), id);
    });
  });

  syncToggle.addEventListener("change", function () {
    syncEnabled = syncToggle.checked;
  });

  if (rangeZoomBtn) {
    rangeZoomBtn.addEventListener("click", function () {
      setRangeZoomMode(!rangeZoomMode);
    });
  }

  function redrawAll() {
    charts.raw.draw();
    charts.dpr.draw();
  }

  function onResizeOrDpr() {
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== lastDpr) {
      lastDpr = dpr;
      updateDprLabel();
    }
    redrawAll();
  }

  const ro = new ResizeObserver(onResizeOrDpr);
  ro.observe(document.getElementById("chart-raw").parentElement);
  ro.observe(document.getElementById("chart-dpr").parentElement);

  // resolution media query for monitor moves
  function bindDprMedia() {
    const dpr = window.devicePixelRatio || 1;
    const mq = window.matchMedia("(resolution: " + dpr + "dppx)");
    const handler = function () {
      updateDprLabel();
      redrawAll();
      // rebind with new dpr
      if (mq.removeEventListener) mq.removeEventListener("change", handler);
      else if (mq.removeListener) mq.removeListener(handler);
      bindDprMedia();
    };
    if (mq.addEventListener) mq.addEventListener("change", handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  updateDprLabel();
  setActiveChart("dpr");
  redrawAll();
  bindDprMedia();
  window.addEventListener("resize", onResizeOrDpr);
})();
