// AI Swarm scanner: one rule-based analysis agent per instrument × contract family.
import { computeSignal, stdev } from "./ta";

export type Family = "EVEN_ODD" | "OVER_UNDER" | "MATCH_DIFF" | "RISE_FALL" | "HIGHER_LOWER";
export const FAMILY_LABEL: Record<Family, string> = {
  EVEN_ODD: "Even / Odd", OVER_UNDER: "Over / Under", MATCH_DIFF: "Matches / Differs", RISE_FALL: "Rise / Fall", HIGHER_LOWER: "Higher / Lower",
};

export type Order = {
  symbol: string;
  family: Family;
  type: string;           // Deriv contract_type
  barrier?: string;       // digit "0-9" or price offset "+0.12" / "-0.12"
  duration: number;
  unit: "t" | "m";
  confidence: number;     // 0-99
  reason: string;
};

export type SymbolCaps = { digits: boolean; ticks: boolean };

const clamp = (n: number, a = 0, b = 99) => Math.max(a, Math.min(b, Math.round(n)));

/** Digit-family agents. Barriers always respect Deriv rules: OVER 0-8, UNDER 1-9, MATCH/DIFF 0-9. */
export function digitAgents(symbol: string, digits: number[]): Order[] {
  if (digits.length < 30) return [];
  const out: Order[] = [];
  const recent = digits.slice(-100);
  const n = recent.length;
  const freq = Array.from({ length: 10 }, (_, d) => recent.filter((x) => x === d).length / n);

  // Even/Odd: parity imbalance + 3-streak reversion
  const evenPct = recent.filter((d) => d % 2 === 0).length / n;
  const last3 = digits.slice(-3);
  const streakEven = last3.every((d) => d % 2 === 0), streakOdd = last3.every((d) => d % 2 === 1);
  if (streakEven || streakOdd) {
    const type = streakEven ? "DIGITODD" : "DIGITEVEN";
    const support = streakEven ? 1 - evenPct : evenPct;
    out.push({ symbol, family: "EVEN_ODD", type, duration: 1, unit: "t", confidence: clamp(55 + (support - 0.5) * 200 + 10), reason: `3× ${streakEven ? "EVEN" : "ODD"} streak · ${(support * 100).toFixed(0)}% ${streakEven ? "odd" : "even"} over ${n}` });
  } else {
    const type = evenPct >= 0.5 ? "DIGITEVEN" : "DIGITODD";
    out.push({ symbol, family: "EVEN_ODD", type, duration: 1, unit: "t", confidence: clamp(50 + Math.abs(evenPct - 0.5) * 200), reason: `Parity bias ${(Math.max(evenPct, 1 - evenPct) * 100).toFixed(0)}%` });
  }

  // Over/Under: OVER 2 if low digits 0-2 are cold, UNDER 7 if high digits 7-9 are cold
  const low = freq[0]! + freq[1]! + freq[2]!, high = freq[7]! + freq[8]! + freq[9]!;
  if (low <= high) out.push({ symbol, family: "OVER_UNDER", type: "DIGITOVER", barrier: "2", duration: 1, unit: "t", confidence: clamp(70 + (0.3 - low) * 150), reason: `Digits 0-2 cold (${(low * 100).toFixed(0)}%) → OVER 2` });
  else out.push({ symbol, family: "OVER_UNDER", type: "DIGITUNDER", barrier: "7", duration: 1, unit: "t", confidence: clamp(70 + (0.3 - high) * 150), reason: `Digits 7-9 cold (${(high * 100).toFixed(0)}%) → UNDER 7` });

  // Matches/Differs: DIFFERS on the coldest digit
  let cold = 0;
  freq.forEach((f, d) => { if (f < freq[cold]!) cold = d; });
  out.push({ symbol, family: "MATCH_DIFF", type: "DIGITDIFF", barrier: String(cold), duration: 1, unit: "t", confidence: clamp(90 - freq[cold]! * 100 + 5), reason: `Digit ${cold} coldest (${(freq[cold]! * 100).toFixed(0)}%) → DIFFERS ${cold}` });
  return out;
}

/** Formats a Higher/Lower price offset: non-zero, pip-rounded, signed. */
export function hlBarrier(prices: number[], pip: number, dir: "CALL" | "PUT", duration: number): string {
  const diffs = prices.slice(-100).map((p, i, a) => (i ? p - a[i - 1]! : 0)).slice(1);
  const unit = 10 ** -pip;
  const raw = stdev(diffs) * Math.sqrt(duration) * 0.6;
  const off = Math.max(unit, Math.round(raw / unit) * unit);
  // Higher: barrier below spot (easier); Lower: barrier above spot
  return `${dir === "CALL" ? "-" : "+"}${off.toFixed(pip)}`;
}

/** Price-action agents (Rise/Fall, Higher/Lower) from multi-indicator confluence. */
export function priceAgents(symbol: string, prices: number[], pip: number, caps: SymbolCaps): Order[] {
  const sig = computeSignal(prices);
  if (!sig.dir) return [];
  const out: Order[] = [];
  const word = sig.dir === "CALL" ? "RISE" : "FALL";
  if (caps.ticks) {
    out.push({ symbol, family: "RISE_FALL", type: sig.dir, duration: 5, unit: "t", confidence: sig.confidence, reason: `${word} · ${sig.note}` });
    const barrier = hlBarrier(prices, pip, sig.dir, 5);
    out.push({ symbol, family: "HIGHER_LOWER", type: sig.dir, barrier, duration: 5, unit: "t", confidence: clamp(sig.confidence + 6), reason: `${sig.dir === "CALL" ? "HIGHER" : "LOWER"} barrier ${barrier} · ${sig.note}` });
  } else {
    out.push({ symbol, family: "RISE_FALL", type: sig.dir, duration: 15, unit: "m", confidence: sig.confidence, reason: `${word} 15m · ${sig.note}` });
  }
  return out;
}

export function scanSymbol(symbol: string, prices: number[], digits: number[], pip: number, caps: SymbolCaps): Order[] {
  return [...(caps.digits ? digitAgents(symbol, digits) : []), ...priceAgents(symbol, prices, pip, caps)].sort((a, b) => b.confidence - a.confidence);
}

/** Paper settlement for any scanner contract. */
export function settleOrder(type: string, entry: number, exit: number, exitDigit: number, barrier?: string): boolean {
  switch (type) {
    case "DIGITEVEN": return exitDigit % 2 === 0;
    case "DIGITODD": return exitDigit % 2 === 1;
    case "DIGITOVER": return exitDigit > Number(barrier);
    case "DIGITUNDER": return exitDigit < Number(barrier);
    case "DIGITMATCH": return exitDigit === Number(barrier);
    case "DIGITDIFF": return exitDigit !== Number(barrier);
    case "CALL": return exit > entry + Number(barrier ?? 0);
    case "PUT": return exit < entry + Number(barrier ?? 0);
  }
  return false;
}

/** Approximate payout ratio (profit / stake). */
export function orderPayout(type: string, barrier?: string): number {
  const b = Number(barrier ?? 0);
  let p = 0.5;
  if (type === "DIGITOVER") p = (9 - b) / 10;
  if (type === "DIGITUNDER") p = b / 10;
  if (type === "DIGITMATCH") p = 0.1;
  if (type === "DIGITDIFF") p = 0.9;
  if ((type === "CALL" || type === "PUT") && barrier && b !== 0) p = 0.62;
  if (p <= 0) return 0;
  return Math.max(0.01, (1 / p) * 0.95 - 1);
}
