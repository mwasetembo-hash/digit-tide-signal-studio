import { useCallback, useEffect, useRef, useState } from "react";

export type MarketCat = "synthetic" | "forex" | "commodities" | "crypto";
export const INSTRUMENTS: { symbol: string; name: string; cat: MarketCat }[] = [
  { symbol: "R_100", name: "Volatility 100", cat: "synthetic" },
  { symbol: "R_75", name: "Volatility 75", cat: "synthetic" },
  { symbol: "R_50", name: "Volatility 50", cat: "synthetic" },
  { symbol: "R_25", name: "Volatility 25", cat: "synthetic" },
  { symbol: "R_10", name: "Volatility 10", cat: "synthetic" },
  { symbol: "frxEURUSD", name: "EUR/USD", cat: "forex" },
  { symbol: "frxGBPUSD", name: "GBP/USD", cat: "forex" },
  { symbol: "frxXAUUSD", name: "XAU/USD", cat: "commodities" },
  { symbol: "cryBTCUSD", name: "BTC/USD", cat: "crypto" },
];

export type Mode = "demo" | "manual" | "auto";
export type Strategy = "meanrev" | "overunder" | "matchdiff";
export type ConnStatus = "connecting" | "connected" | "reconnecting" | "error";
export type LogLevel = "info" | "ws" | "signal" | "trade" | "win" | "loss" | "error";
export type LogEntry = { id: number; t: string; level: LogLevel; msg: string };
export type Quote = { price: number; prev: number; open: number; pip: number; time: number };

export type Settings = {
  strategy: Strategy;
  barrier: number;
  ouDirection: "DIGITOVER" | "DIGITUNDER";
  mdDirection: "DIGITMATCH" | "DIGITDIFF";
  stake: number;
  martingale: number;
  maxLosses: number;
  stopLoss: number;
  takeProfit: number;
  cooldown: number;
};

export const DEFAULT_SETTINGS: Settings = {
  strategy: "meanrev",
  barrier: 5,
  ouDirection: "DIGITOVER",
  mdDirection: "DIGITDIFF",
  stake: 1,
  martingale: 2.1,
  maxLosses: 5,
  stopLoss: 50,
  takeProfit: 25,
  cooldown: 3,
};

export const lastDigit = (price: number, pip: number) => {
  const s = price.toFixed(pip);
  return Number(s[s.length - 1]);
};

/** Pure evaluation of a digit contract outcome. */
export function evaluateDigit(type: string, digit: number, barrier: number): boolean {
  switch (type) {
    case "DIGITEVEN": return digit % 2 === 0;
    case "DIGITODD": return digit % 2 === 1;
    case "DIGITOVER": return digit > barrier;
    case "DIGITUNDER": return digit < barrier;
    case "DIGITMATCH": return digit === barrier;
    case "DIGITDIFF": return digit !== barrier;
  }
  return false;
}

/** Approximate Deriv payout ratio (profit / stake) for digit contracts. */
export function payoutRatio(type: string, barrier: number): number {
  let p = 0.5;
  if (type === "DIGITOVER") p = (9 - barrier) / 10;
  if (type === "DIGITUNDER") p = barrier / 10;
  if (type === "DIGITMATCH") p = 0.1;
  if (type === "DIGITDIFF") p = 0.9;
  if (p <= 0) return 0;
  return Math.max(0.01, (1 / p) * 0.95 - 1);
}

/** Next stake after a result, applying martingale and the max-loss reset. */
export function nextStake(base: number, current: number, won: boolean, lossStreak: number, mult: number, maxLosses: number) {
  if (won || lossStreak >= maxLosses) return base;
  return Math.round(current * mult * 100) / 100;
}

/** Detect a signal on the digit history according to the chosen strategy. */
export function detectSignal(digits: number[], s: Settings): { type: string; barrier?: number; reason: string } | null {
  if (digits.length < 3) return null;
  const last3 = digits.slice(-3);
  if (s.strategy === "meanrev") {
    if (last3.every((d) => d % 2 === 0)) return { type: "DIGITODD", reason: "3x EVEN streak → reversion to ODD" };
    if (last3.every((d) => d % 2 === 1)) return { type: "DIGITEVEN", reason: "3x ODD streak → reversion to EVEN" };
    return null;
  }
  if (s.strategy === "overunder") {
    const recent = digits.slice(-20);
    const hits = recent.filter((d) => evaluateDigit(s.ouDirection, d, s.barrier)).length / recent.length;
    if (hits >= 0.5 || digits.length % 4 === 0)
      return { type: s.ouDirection, barrier: s.barrier, reason: `${s.ouDirection === "DIGITOVER" ? "OVER" : "UNDER"} ${s.barrier} hit-rate ${(hits * 100).toFixed(0)}%` };
    return null;
  }
  const recent = digits.slice(-30);
  const freq = recent.filter((d) => d === s.barrier).length / recent.length;
  if (s.mdDirection === "DIGITDIFF" && freq <= 0.1) return { type: "DIGITDIFF", barrier: s.barrier, reason: `Digit ${s.barrier} cold (${(freq * 100).toFixed(0)}%)` };
  if (s.mdDirection === "DIGITMATCH" && freq >= 0.17) return { type: "DIGITMATCH", barrier: s.barrier, reason: `Digit ${s.barrier} hot (${(freq * 100).toFixed(0)}%)` };
  return null;
}

type Pending = { type: string; barrier: number; stake: number; startCount: number; contractId?: number; live: boolean };

const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

export function useDerivEngine(appId: string, token: string, target: string) {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [digits, setDigits] = useState<number[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [account, setAccount] = useState<{ loginid: string; currency: string; balance: number; virtual: boolean } | null>(null);
  const [demoBalance, setDemoBalance] = useState(10000);
  const [stats, setStats] = useState({ pnl: 0, wins: 0, losses: 0, lossStreak: 0 });
  const [currentStake, setCurrentStake] = useState(DEFAULT_SETTINGS.stake);
  const [running, setRunning] = useState(false);
  const [botState, setBotState] = useState("IDLE");
  const [mode, setMode] = useState<Mode>("demo");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const wsRef = useRef<WebSocket | null>(null);
  const logId = useRef(0);
  const digitsRef = useRef<number[]>([]);
  const pending = useRef<Pending | null>(null);
  const cooldownUntil = useRef(0);
  const reqId = useRef(1);
  const callbacks = useRef(new Map<number, (m: any) => void>());
  const st = useRef({ settings, mode, running, stats, currentStake, account });
  st.current = { settings, mode, running, stats, currentStake, account };

  const log = useCallback((level: LogLevel, msg: string) => {
    setLogs((l) => [...l.slice(-299), { id: ++logId.current, t: ts(), level, msg }]);
  }, []);

  const send = useCallback((payload: Record<string, unknown>, cb?: (m: any) => void) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const id = reqId.current++;
    if (cb) callbacks.current.set(id, cb);
    ws.send(JSON.stringify({ ...payload, req_id: id }));
    return true;
  }, []);

  const settle = useCallback((won: boolean, profit: number, digit: number | null) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const s = st.current.settings;
    setStats((prev) => {
      const lossStreak = won ? 0 : prev.lossStreak + 1;
      const ns = {
        pnl: Math.round((prev.pnl + profit) * 100) / 100,
        wins: prev.wins + (won ? 1 : 0),
        losses: prev.losses + (won ? 0 : 1),
        lossStreak: lossStreak >= s.maxLosses ? 0 : lossStreak,
      };
      const stake = nextStake(s.stake, p.stake, won, lossStreak, s.martingale, s.maxLosses);
      setCurrentStake(stake);
      if (!won && lossStreak >= s.maxLosses) log("info", `Max consecutive losses (${s.maxLosses}) reached → stake reset to $${s.stake}`);
      if (ns.pnl <= -s.stopLoss) { setRunning(false); setBotState("STOP LOSS"); log("error", `STOP LOSS hit at ${ns.pnl.toFixed(2)} — bot halted`); }
      else if (ns.pnl >= s.takeProfit) { setRunning(false); setBotState("TAKE PROFIT"); log("win", `TAKE PROFIT hit at +${ns.pnl.toFixed(2)} — bot halted`); }
      else setBotState(st.current.running ? "COOLDOWN" : "IDLE");
      return ns;
    });
    if (!p.live) setDemoBalance((b) => Math.round((b + profit) * 100) / 100);
    log(won ? "win" : "loss", `${won ? "WIN" : "LOSS"} ${p.type}${digit !== null ? ` (exit digit ${digit})` : ""} → ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}`);
    cooldownUntil.current = Date.now() + st.current.settings.cooldown * 1000;
  }, [log]);

  const placeTrade = useCallback((type: string, barrier: number, stakeOverride?: number) => {
    if (pending.current) { log("info", "Contract already open — skipping"); return; }
    const { mode, account, currentStake } = st.current;
    const stake = stakeOverride ?? currentStake;
    const live = mode !== "demo" && !!account;
    if (!live) {
      pending.current = { type, barrier, stake, startCount: digitsRef.current.length, live: false };
      setBotState("IN TRADE");
      log("trade", `[PAPER] Buy ${type}${type.includes("EVEN") || type.includes("ODD") ? "" : ` ${barrier}`} stake $${stake.toFixed(2)} · 1 tick`);
      return;
    }
    const needsBarrier = !(type === "DIGITEVEN" || type === "DIGITODD");
    setBotState("PROPOSAL");
    log("trade", `Proposal ${type}${needsBarrier ? ` ${barrier}` : ""} $${stake.toFixed(2)} on ${target}`);
    pending.current = { type, barrier, stake, startCount: 0, live: true };
    send({ proposal: 1, amount: stake, basis: "stake", contract_type: type, currency: account!.currency || "USD", duration: 1, duration_unit: "t", symbol: target, ...(needsBarrier ? { barrier: String(barrier) } : {}) }, (m) => {
      if (m.error) { log("error", `Proposal error: ${m.error.message}`); pending.current = null; setBotState("IDLE"); return; }
      const pr = m.proposal;
      log("trade", `Proposal ${pr.id.slice(0, 8)}… payout $${pr.payout} → BUY`);
      send({ buy: pr.id, price: stake }, (b) => {
        if (b.error) { log("error", `Buy error: ${b.error.message}`); pending.current = null; setBotState("IDLE"); return; }
        const cid = b.buy.contract_id;
        if (pending.current) pending.current.contractId = cid;
        setBotState("IN TRADE");
        log("trade", `Purchased contract #${cid} · balance $${b.buy.balance_after}`);
        send({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 });
      });
    });
  }, [log, send, target]);

  // Connection
  useEffect(() => {
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const connect = () => {
      setStatus(attempts ? "reconnecting" : "connecting");
      const id = /^\d+$/.test(appId) ? appId : "1089";
      const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${id}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setStatus("connected");
        log("ws", `Socket open · app_id=${id}`);
        INSTRUMENTS.forEach((i) => ws.send(JSON.stringify({ ticks: i.symbol, subscribe: 1 })));
        ws.send(JSON.stringify({ ticks_history: target, count: 100, end: "latest", style: "ticks", req_id: 0 }));
        if (token) ws.send(JSON.stringify({ authorize: token }));
        else log("info", "No API token — running in paper/demo mode");
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.req_id && callbacks.current.has(m.req_id)) {
          const cb = callbacks.current.get(m.req_id)!;
          callbacks.current.delete(m.req_id);
          cb(m);
          return;
        }
        if (m.error && m.msg_type !== "tick") { log("error", `${m.msg_type}: ${m.error.message}`); if (m.msg_type === "authorize") setAccount(null); return; }
        switch (m.msg_type) {
          case "authorize":
            setAccount({ loginid: m.authorize.loginid, currency: m.authorize.currency, balance: Number(m.authorize.balance), virtual: !!m.authorize.is_virtual });
            log("ws", `Authorized ${m.authorize.loginid} · ${m.authorize.currency} ${m.authorize.balance}`);
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            break;
          case "balance":
            setAccount((a) => (a ? { ...a, balance: Number(m.balance.balance) } : a));
            break;
          case "history": {
            const pip = String(m.history.prices[0]).split(".")[1]?.length ?? 2;
            const ds = m.history.prices.map((p: number) => lastDigit(p, Math.max(pip, 2)));
            digitsRef.current = ds;
            setDigits(ds);
            log("ws", `Loaded ${ds.length} historical ticks for ${target}`);
            break;
          }
          case "tick": {
            const t = m.tick;
            setQuotes((q) => {
              const prev = q[t.symbol];
              return { ...q, [t.symbol]: { price: t.quote, prev: prev?.price ?? t.quote, open: prev?.open ?? t.quote, pip: t.pip_size, time: t.epoch } };
            });
            if (t.symbol === target) onTargetTick(lastDigit(t.quote, t.pip_size));
            break;
          }
          case "proposal_open_contract": {
            const c = m.proposal_open_contract;
            if (c?.is_sold && pending.current?.contractId === c.contract_id) {
              const won = c.status === "won";
              const exit = c.exit_tick_display_value ? Number(String(c.exit_tick_display_value).slice(-1)) : null;
              settle(won, Number(c.profit), exit);
            }
            break;
          }
        }
      };
      ws.onerror = () => { setStatus("error"); log("error", "WebSocket error"); };
      ws.onclose = () => {
        if (stop) return;
        attempts++;
        setStatus("reconnecting");
        log("ws", `Socket closed — reconnecting in ${Math.min(attempts * 2, 10)}s`);
        retry = setTimeout(connect, Math.min(attempts * 2000, 10000));
      };
    };
    const onTargetTick = (d: number) => {
      digitsRef.current = [...digitsRef.current.slice(-199), d];
      setDigits(digitsRef.current);
      const p = pending.current;
      if (p && !p.live && digitsRef.current.length > p.startCount) {
        const won = evaluateDigit(p.type, d, p.barrier);
        const profit = won ? Math.round(p.stake * payoutRatio(p.type, p.barrier) * 100) / 100 : -p.stake;
        settle(won, profit, d);
        return;
      }
      const { running, mode, settings } = st.current;
      if (!running || mode !== "auto" && mode !== "demo" || pending.current || Date.now() < cooldownUntil.current) return;
      setBotState("SCANNING");
      const sig = detectSignal(digitsRef.current, settings);
      if (sig) {
        log("signal", `Pattern: ${sig.reason}`);
        placeTrade(sig.type, sig.barrier ?? settings.barrier);
      }
    };
    connect();
    return () => { stop = true; clearTimeout(retry); wsRef.current?.close(); };
  }, [appId, token, target, log, settle, placeTrade]);

  return {
    status, quotes, digits, logs, account, demoBalance, stats, currentStake, running, botState, mode, settings,
    setMode, setSettings: (s: Settings) => { setSettings(s); if (!pending.current) setCurrentStake(s.stake); },
    start: () => { setRunning(true); setBotState("SCANNING"); log("info", `Bot STARTED · ${st.current.mode.toUpperCase()} · ${st.current.settings.strategy}`); },
    stop: () => { setRunning(false); setBotState("IDLE"); log("info", "Bot STOPPED"); },
    resetSession: () => { setStats({ pnl: 0, wins: 0, losses: 0, lossStreak: 0 }); setCurrentStake(st.current.settings.stake); log("info", "Session stats reset"); },
    clearLogs: () => setLogs([]),
    placeTrade, log,
  };
}
