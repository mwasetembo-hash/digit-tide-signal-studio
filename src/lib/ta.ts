// Multi-indicator technical confluence (ported from Direct Trade Exec).

export type Direction = "CALL" | "PUT";

/** Exponential moving average of the last values. */
export function ema(values: number[], period: number) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let e = values[0] ?? 0;
  for (let i = 1; i < values.length; i++) e = (values[i] ?? e) * k + e * (1 - k);
  return e;
}

function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50;
  let gain = 0, loss = 0;
  const s = values.slice(-(period + 1));
  for (let i = 1; i < s.length; i++) {
    const d = (s[i] ?? 0) - (s[i - 1] ?? 0);
    if (d > 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Group ticks into pseudo-candles of n ticks. */
function candles(prices: number[], n = 5) {
  const out: { o: number; h: number; l: number; c: number }[] = [];
  for (let i = 0; i + n <= prices.length; i += n) {
    const s = prices.slice(i, i + n);
    out.push({ o: s[0] ?? 0, c: s[s.length - 1] ?? 0, h: Math.max(...s), l: Math.min(...s) });
  }
  return out;
}

export type SignalPart = { name: string; score: number; bias: Direction | null; detail: string };

/**
 * Multi-signal confluence across trend, momentum, SMC structure, MACD, Bollinger,
 * stochastic, candle patterns and support/resistance, weighted by market regime.
 * Confidence = weighted agreement with the dominant direction. Not a guarantee.
 */
export function computeSignal(prices: number[]): { dir: Direction | null; confidence: number; note: string; parts: SignalPart[] } {
  if (prices.length < 60) return { dir: null, confidence: 0, note: "Collecting ticks…", parts: [] };
  const recent = prices.slice(-200);
  const last = recent[recent.length - 1] ?? 0;

  // 1. Triple EMA
  const e9 = ema(recent, 9), e21 = ema(recent, 21), e50 = ema(recent, 50);
  let trend: SignalPart;
  if (e9 > e21 && e21 > e50) trend = { name: "Trend EMA 9/21/50", score: 1, bias: "CALL", detail: "Stacked bullish" };
  else if (e9 < e21 && e21 < e50) trend = { name: "Trend EMA 9/21/50", score: 1, bias: "PUT", detail: "Stacked bearish" };
  else trend = { name: "Trend EMA 9/21/50", score: 0.3, bias: e9 > e21 ? "CALL" : "PUT", detail: "Mixed / ranging" };

  // 2. RSI
  const r = rsi(recent, 14);
  let mom: SignalPart;
  if (r > 75) mom = { name: "RSI 14", score: 0.6, bias: "PUT", detail: `${r.toFixed(0)} overbought` };
  else if (r < 25) mom = { name: "RSI 14", score: 0.6, bias: "CALL", detail: `${r.toFixed(0)} oversold` };
  else if (r >= 52) mom = { name: "RSI 14", score: Math.min(1, (r - 50) / 20), bias: "CALL", detail: `${r.toFixed(0)} bullish` };
  else if (r <= 48) mom = { name: "RSI 14", score: Math.min(1, (50 - r) / 20), bias: "PUT", detail: `${r.toFixed(0)} bearish` };
  else mom = { name: "RSI 14", score: 0, bias: null, detail: `${r.toFixed(0)} neutral` };

  // 3. SMC: last unmitigated FVG + order block
  const cs = candles(recent, 5);
  let smc: SignalPart = { name: "SMC FVG / OB", score: 0, bias: null, detail: "No structure" };
  for (let i = cs.length - 1; i >= 2; i--) {
    const a = cs[i - 2]!, c = cs[i]!;
    if (c.l > a.h && last > a.h) { smc = { name: "SMC FVG / OB", score: 0.8, bias: "CALL", detail: "Bullish FVG holding" }; break; }
    if (c.h < a.l && last < a.l) { smc = { name: "SMC FVG / OB", score: 0.8, bias: "PUT", detail: "Bearish FVG holding" }; break; }
  }
  const n = cs.length;
  if (n >= 3) {
    const p = cs[n - 3]!, q = cs[n - 2]!, z = cs[n - 1]!;
    if (p.c < p.o && q.c > q.o && z.c > p.h) smc = { name: "SMC FVG / OB", score: 1, bias: "CALL", detail: "Bullish order block break" };
    else if (p.c > p.o && q.c < q.o && z.c < p.l) smc = { name: "SMC FVG / OB", score: 1, bias: "PUT", detail: "Bearish order block break" };
  }

  // 4. Tick velocity
  const t = prices.slice(-11);
  let ups = 0;
  for (let i = 1; i < t.length; i++) if ((t[i] ?? 0) > (t[i - 1] ?? 0)) ups++;
  const vel: SignalPart = ups >= 6
    ? { name: "Tick velocity", score: (ups - 5) / 5, bias: "CALL", detail: `${ups}/10 up` }
    : ups <= 4 ? { name: "Tick velocity", score: (5 - ups) / 5, bias: "PUT", detail: `${ups}/10 up` }
    : { name: "Tick velocity", score: 0, bias: null, detail: "5/10 flat" };

  // 5. MACD (12/26/9)
  const macdSeries: number[] = [];
  for (let k = Math.max(30, recent.length - 40); k <= recent.length; k++) {
    const sl = recent.slice(0, k);
    macdSeries.push(ema(sl, 12) - ema(sl, 26));
  }
  const macd = macdSeries[macdSeries.length - 1] ?? 0;
  const sigLine = ema(macdSeries, 9);
  const hist = macd - sigLine;
  const sdAll = stdev(recent.slice(1).map((v, k) => v - recent[k]!)) || 1e-9;
  const macdP: SignalPart = { name: "MACD 12/26/9", score: Math.min(1, Math.abs(hist) / (sdAll * 0.5)), bias: hist > 0 ? "CALL" : hist < 0 ? "PUT" : null, detail: `hist ${hist > 0 ? "+" : ""}${(hist / sdAll).toFixed(2)}σ` };

  // 6. Bollinger Bands (20, 2)
  const b20 = recent.slice(-20);
  const mid = b20.reduce((a, b) => a + b, 0) / b20.length;
  const bsd = stdev(b20) || 1e-9;
  const pctB = (last - (mid - 2 * bsd)) / (4 * bsd);
  const squeeze = (4 * bsd) / (stdev(recent.slice(-100)) * 4 || 1e-9) < 0.6;
  let boll: SignalPart;
  if (pctB > 1) boll = { name: "Bollinger 20/2", score: squeeze ? 0.9 : 0.5, bias: squeeze ? "CALL" : "PUT", detail: squeeze ? "Squeeze breakout up" : "Above upper band (stretched)" };
  else if (pctB < 0) boll = { name: "Bollinger 20/2", score: squeeze ? 0.9 : 0.5, bias: squeeze ? "PUT" : "CALL", detail: squeeze ? "Squeeze breakout down" : "Below lower band (stretched)" };
  else boll = { name: "Bollinger 20/2", score: Math.abs(pctB - 0.5), bias: pctB > 0.5 ? "CALL" : "PUT", detail: `%B ${(pctB * 100).toFixed(0)}${squeeze ? " · squeeze" : ""}` };

  // 7. Stochastic (14,3)
  const kOf = (end: number) => { const w = recent.slice(end - 14, end); const lo = Math.min(...w), hi = Math.max(...w); return hi === lo ? 50 : ((recent[end - 1]! - lo) / (hi - lo)) * 100; };
  const kv = [kOf(recent.length), kOf(recent.length - 1), kOf(recent.length - 2)];
  const kNow = kv[0]!, dNow = (kv[0]! + kv[1]! + kv[2]!) / 3;
  let stoch: SignalPart;
  if (kNow < 20 && kNow > dNow) stoch = { name: "Stochastic 14/3", score: 0.9, bias: "CALL", detail: `${kNow.toFixed(0)} oversold cross up` };
  else if (kNow > 80 && kNow < dNow) stoch = { name: "Stochastic 14/3", score: 0.9, bias: "PUT", detail: `${kNow.toFixed(0)} overbought cross down` };
  else stoch = { name: "Stochastic 14/3", score: Math.abs(kNow - dNow) / 30, bias: kNow > dNow ? "CALL" : "PUT", detail: `%K ${kNow.toFixed(0)} / %D ${dNow.toFixed(0)}` };

  // 8. Candlestick patterns (engulfing, pin bar, three soldiers/crows)
  let pat: SignalPart = { name: "Candle patterns", score: 0, bias: null, detail: "None" };
  if (n >= 3) {
    const a = cs[n - 3]!, b = cs[n - 2]!, c = cs[n - 1]!;
    const body = (x: typeof c) => Math.abs(x.c - x.o), rng = (x: typeof c) => x.h - x.l || 1e-9;
    if (b.c < b.o && c.c > c.o && c.c > b.o && c.o <= b.c) pat = { name: "Candle patterns", score: 0.9, bias: "CALL", detail: "Bullish engulfing" };
    else if (b.c > b.o && c.c < c.o && c.c < b.o && c.o >= b.c) pat = { name: "Candle patterns", score: 0.9, bias: "PUT", detail: "Bearish engulfing" };
    else if (body(c) / rng(c) < 0.3 && Math.min(c.o, c.c) - c.l > 2 * body(c)) pat = { name: "Candle patterns", score: 0.7, bias: "CALL", detail: "Hammer / bullish pin" };
    else if (body(c) / rng(c) < 0.3 && c.h - Math.max(c.o, c.c) > 2 * body(c)) pat = { name: "Candle patterns", score: 0.7, bias: "PUT", detail: "Shooting star / bearish pin" };
    else if ([a, b, c].every((x) => x.c > x.o) && c.c > b.c && b.c > a.c) pat = { name: "Candle patterns", score: 0.8, bias: "CALL", detail: "Three white soldiers" };
    else if ([a, b, c].every((x) => x.c < x.o) && c.c < b.c && b.c < a.c) pat = { name: "Candle patterns", score: 0.8, bias: "PUT", detail: "Three black crows" };
  }

  // 9. Support / resistance breakout (swing high/low of last 100 ticks)
  const sw = recent.slice(-100, -5);
  const res = Math.max(...sw), sup = Math.min(...sw);
  let sr: SignalPart;
  if (last > res) sr = { name: "Support/Resistance", score: 0.9, bias: "CALL", detail: "Broke resistance" };
  else if (last < sup) sr = { name: "Support/Resistance", score: 0.9, bias: "PUT", detail: "Broke support" };
  else { const pos = (last - sup) / (res - sup || 1e-9); sr = pos < 0.15 ? { name: "Support/Resistance", score: 0.6, bias: "CALL", detail: "Bouncing off support" } : pos > 0.85 ? { name: "Support/Resistance", score: 0.6, bias: "PUT", detail: "Rejecting resistance" } : { name: "Support/Resistance", score: 0, bias: null, detail: `Mid-range ${(pos * 100).toFixed(0)}%` }; }

  // Market regime: efficiency ratio (trending vs ranging) re-weights trend vs mean-reversion tools
  const er = Math.abs(last - recent[recent.length - 50]!) / (recent.slice(-50).reduce((a, v, k, arr) => a + (k ? Math.abs(v - arr[k - 1]!) : 0), 0) || 1e-9);
  const trending = er > 0.3;
  const regime: SignalPart = { name: "Market regime", score: 0, bias: null, detail: `${trending ? "Trending" : "Ranging"} (efficiency ${(er * 100).toFixed(0)}%)` };

  const parts = [trend, mom, smc, vel, macdP, boll, stoch, pat, sr];
  const w = trending ? [0.2, 0.06, 0.16, 0.1, 0.16, 0.06, 0.04, 0.1, 0.12] : [0.08, 0.14, 0.14, 0.06, 0.08, 0.16, 0.14, 0.1, 0.1];
  let up = 0, down = 0;
  parts.forEach((p, i) => { const s = Math.min(1, p.score); if (p.bias === "CALL") up += s * w[i]!; else if (p.bias === "PUT") down += s * w[i]!; });
  const dir: Direction = up >= down ? "CALL" : "PUT";
  const agreeing = parts.filter((p) => p.bias === dir && p.score > 0.2).length;
  const confluence = agreeing / parts.length;
  const raw = (Math.max(up, down) - Math.min(up, down)) / (up + down || 1);
  const confidence = Math.max(0, Math.min(99, Math.round((raw * 0.6 + confluence * 0.4) * 100)));
  return { dir, confidence, note: `${agreeing}/${parts.length} signals agree · ${regime.detail}`, parts: [...parts, regime] };
}

function stdev(v: number[]) {
  if (!v.length) return 0;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}
export { stdev };
