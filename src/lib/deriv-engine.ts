import { useCallback, useEffect, useRef, useState } from "react";
import { scanSymbol, settleOrder, orderPayout, type Order } from "./scanner";

export type MarketCat = "synthetic" | "forex" | "commodities" | "crypto";
export type Instrument = { symbol: string; name: string; cat: MarketCat; digits: boolean; ticks: boolean };
const syn = (symbol: string, name: string, digits = true): Instrument => ({ symbol, name, cat: "synthetic", digits, ticks: true });
const mk = (symbol: string, name: string, cat: MarketCat): Instrument => ({ symbol, name, cat, digits: false, ticks: false });
export const INSTRUMENTS: Instrument[] = [
  ...["10", "25", "50", "75", "100"].flatMap((v) => [syn(`R_${v}`, `Volatility ${v}`), syn(`1HZ${v}V`, `Volatility ${v} (1s)`)]),
  ...["10", "25", "50", "75", "100"].map((v) => syn(`JD${v}`, `Jump ${v}`)),
  syn("stpRNG", "Step Index"),
  syn("RDBULL", "Bull Market", false),
  syn("RDBEAR", "Bear Market", false),
  ...["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "EURGBP", "GBPJPY"].map((p) => mk(`frx${p}`, `${p.slice(0, 3)}/${p.slice(3)}`, "forex")),
  mk("frxXAUUSD", "XAU/USD", "commodities"),
  mk("frxXAGUSD", "XAG/USD", "commodities"),
  mk("cryBTCUSD", "BTC/USD", "crypto"),
  mk("cryETHUSD", "ETH/USD", "crypto"),
];

export type Mode = "demo" | "manual" | "auto";
export type Strategy = "swarm" | "meanrev" | "overunder" | "matchdiff";
export type ConnStatus = "connecting" | "connected" | "reconnecting" | "error";
export type LogLevel = "info" | "ws" | "signal" | "trade" | "win" | "loss" | "error";
export type LogEntry = { id: number; t: string; level: LogLevel; msg: string };
export type Quote = { price: number; prev: number; open: number; pip: number; time: number };
export type { Order };

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
  minConfidence: number;
};

export const DEFAULT_SETTINGS: Settings = {
  strategy: "swarm",
  barrier: 5,
  ouDirection: "DIGITOVER",
  mdDirection: "DIGITDIFF",
  stake: 1,
  martingale: 2.1,
  maxLosses: 5,
  stopLoss: 50,
  takeProfit: 25,
  cooldown: 3,
  minConfidence: 75,
};

export const DEFAULT_APP_ID = "34ARk0NOmxpaMAqV6Bwgg";

export const lastDigit = (price: number, pip: number) => {
  const s = price.toFixed(pip);
  return Number(s[s.length - 1]);
};

export function evaluateDigit(type: string, digit: number, barrier: number): boolean {
  return settleOrder(type, 0, 0, digit, String(barrier));
}

export function payoutRatio(type: string, barrier: number): number {
  return orderPayout(type, String(barrier));
}

export function nextStake(base: number, current: number, won: boolean, lossStreak: number, mult: number, maxLosses: number) {
  if (won || lossStreak >= maxLosses) return base;
  return Math.round(current * mult * 100) / 100;
}

/** Single-target digit strategies (legacy deck). */
export function detectSignal(digits: number[], s: Settings): { type: string; barrier?: number; reason: string } | null {
  if (digits.length < 3) return null;
  const last3 = digits.slice(-3);
  if (s.strategy === "meanrev" || s.strategy === "swarm") {
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

/** Valid digit barrier for a contract type (OVER 0-8, UNDER 1-9). */
export function clampDigitBarrier(type: string, b: number) {
  const n = Math.round(b);
  if (type === "DIGITOVER") return Math.max(0, Math.min(8, n));
  if (type === "DIGITUNDER") return Math.max(1, Math.min(9, n));
  return Math.max(0, Math.min(9, n));
}

type Pending = { order: Order; stake: number; entry: number; startCount: number; endAt: number; contractId?: number; live: boolean };
export type TradeAccount = { id: string; currency: string; balance: number; virtual: boolean };

const ts = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const DERIV_API = "https://api.derivws.com";

async function derivRest(path: string, appId: string, token: string, method = "GET") {
  const res = await fetch(`${DERIV_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Deriv-App-ID": appId } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message ?? "";
    if (res.status === 401) throw new Error(`Deriv rejected the App ID or token (401) ${msg}`);
    if (res.status === 403) throw new Error(`Token lacks "trade" scope (403) ${msg}`);
    throw new Error(`Deriv error ${res.status} ${msg}`);
  }
  return body;
}

export function useDerivEngine(appId: string, token: string, target: string) {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [tradeStatus, setTradeStatus] = useState<"none" | "connecting" | "ready" | "error">("none");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [digits, setDigits] = useState<number[]>([]);
  const [signals, setSignals] = useState<Order[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [account, setAccount] = useState<{ loginid: string; currency: string; balance: number; virtual: boolean } | null>(null);
  const [accounts, setAccounts] = useState<{ account_id: string; currency: string; balance: number; account_type: string }[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [demoBalance, setDemoBalance] = useState(10000);
  const [stats, setStats] = useState({ pnl: 0, wins: 0, losses: 0, lossStreak: 0 });
  const [currentStake, setCurrentStake] = useState(DEFAULT_SETTINGS.stake);
  const [running, setRunning] = useState(false);
  const [botState, setBotState] = useState("IDLE");
  const [mode, setMode] = useState<Mode>("demo");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const wsRef = useRef<WebSocket | null>(null);      // market data (+ legacy trading)
  const tradeWs = useRef<WebSocket | null>(null);    // new API OTP trading socket
  const logId = useRef(0);
  const prices = useRef(new Map<string, number[]>());
  const digitMap = useRef(new Map<string, number[]>());
  const pipMap = useRef(new Map<string, number>());
  const pending = useRef<Pending | null>(null);
  const cooldownUntil = useRef(0);
  const reqId = useRef(1);
  const callbacks = useRef(new Map<number, (m: any) => void>());
  const st = useRef({ settings, mode, running, stats, currentStake, account, signals, target });
  st.current = { settings, mode, running, stats, currentStake, account, signals, target };

  const log = useCallback((level: LogLevel, msg: string) => {
    setLogs((l) => [...l.slice(-299), { id: ++logId.current, t: ts(), level, msg }]);
  }, []);

  const sendOn = useCallback((ws: WebSocket | null, payload: Record<string, unknown>, cb?: (m: any) => void) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const id = reqId.current++;
    if (cb) callbacks.current.set(id, cb);
    ws.send(JSON.stringify({ ...payload, req_id: id }));
    return true;
  }, []);
  const tradeSend = useCallback((payload: Record<string, unknown>, cb?: (m: any) => void) =>
    sendOn(tradeWs.current?.readyState === WebSocket.OPEN ? tradeWs.current : wsRef.current, payload, cb), [sendOn]);

  const settle = useCallback((won: boolean, profit: number, detail: string) => {
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
      setCurrentStake(nextStake(s.stake, p.stake, won, lossStreak, s.martingale, s.maxLosses));
      if (!won && lossStreak >= s.maxLosses) log("info", `Max consecutive losses (${s.maxLosses}) reached → stake reset to $${s.stake}`);
      if (ns.pnl <= -s.stopLoss) { setRunning(false); setBotState("STOP LOSS"); log("error", `STOP LOSS hit at ${ns.pnl.toFixed(2)} — bot halted`); }
      else if (ns.pnl >= s.takeProfit) { setRunning(false); setBotState("TAKE PROFIT"); log("win", `TAKE PROFIT hit at +${ns.pnl.toFixed(2)} — bot halted`); }
      else setBotState(st.current.running ? "COOLDOWN" : "IDLE");
      return ns;
    });
    if (!p.live) setDemoBalance((b) => Math.round((b + profit) * 100) / 100);
    log(won ? "win" : "loss", `${won ? "WIN" : "LOSS"} ${p.order.symbol} ${p.order.type}${p.order.barrier ? ` ${p.order.barrier}` : ""} ${detail} → ${profit >= 0 ? "+" : ""}${profit.toFixed(2)}`);
    cooldownUntil.current = Date.now() + s.cooldown * 1000;
  }, [log]);

  const placeOrder = useCallback((order: Order, stakeOverride?: number) => {
    if (pending.current) { log("info", "Contract already open — skipping"); return; }
    const { mode, account, currentStake } = st.current;
    const stake = stakeOverride ?? currentStake;
    const live = mode !== "demo" && !!account;
    const entry = prices.current.get(order.symbol)?.slice(-1)[0] ?? 0;
    const desc = `${order.symbol} ${order.type}${order.barrier ? ` ${order.barrier}` : ""} · ${order.duration}${order.unit}`;
    const base: Pending = { order, stake, entry, startCount: prices.current.get(order.symbol)?.length ?? 0, endAt: Date.now() + (order.unit === "m" ? order.duration * 60000 : 0), live };
    if (!live) {
      pending.current = base;
      setBotState("IN TRADE");
      log("trade", `[PAPER] Buy ${desc} stake $${stake.toFixed(2)}`);
      return;
    }
    setBotState("PROPOSAL");
    log("trade", `Proposal ${desc} $${stake.toFixed(2)}`);
    pending.current = base;
    const req: Record<string, unknown> = { proposal: 1, amount: stake, basis: "stake", contract_type: order.type, currency: account!.currency || "USD", duration: order.duration, duration_unit: order.unit, underlying_symbol: order.symbol };
    if (order.barrier !== undefined) req["barrier"] = order.barrier;
    const legacy = !(tradeWs.current?.readyState === WebSocket.OPEN);
    if (legacy) { req["symbol"] = order.symbol; delete req["underlying_symbol"]; }
    tradeSend(req, (m) => {
      if (m.error) { log("error", `Proposal error: ${m.error.message}`); pending.current = null; setBotState("IDLE"); return; }
      const pr = m.proposal;
      log("trade", `Proposal ${String(pr.id).slice(0, 8)}… payout $${pr.payout} → BUY`);
      tradeSend({ buy: pr.id, price: stake }, (b) => {
        if (b.error) { log("error", `Buy error: ${b.error.message}`); pending.current = null; setBotState("IDLE"); return; }
        const cid = b.buy.contract_id;
        if (pending.current) pending.current.contractId = cid;
        setBotState("IN TRADE");
        log("trade", `Purchased contract #${cid} · balance $${b.buy.balance_after}`);
        tradeSend({ proposal_open_contract: 1, contract_id: cid, subscribe: 1 });
      });
    });
  }, [log, tradeSend]);

  const placeTrade = useCallback((type: string, barrier: number, stakeOverride?: number) => {
    const isDigit = type.startsWith("DIGIT");
    const needsB = !(type === "DIGITEVEN" || type === "DIGITODD") && isDigit;
    placeOrder({ symbol: st.current.target, family: "EVEN_ODD", type, barrier: needsB ? String(clampDigitBarrier(type, barrier)) : undefined, duration: isDigit ? 1 : 5, unit: "t", confidence: 0, reason: "manual" }, stakeOverride);
  }, [placeOrder]);

  const handleContract = useCallback((c: any) => {
    if (c?.is_sold && pending.current?.contractId === c.contract_id) settle(c.status === "won", Number(c.profit), `(exit ${c.exit_tick_display_value ?? "—"})`);
  }, [settle]);

  // Market data socket
  useEffect(() => {
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const legacyId = /^\d+$/.test(appId) ? appId : "1089";
    const connect = () => {
      setStatus(attempts ? "reconnecting" : "connecting");
      const legacyAuth = !!token && !token.startsWith("pat_") && /^\d+$/.test(appId);
      const ws = new WebSocket(legacyAuth ? `wss://ws.derivws.com/websockets/v3?app_id=${legacyId}` : "wss://api.derivws.com/trading/v1/options/ws/public");
      wsRef.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setStatus("connected");
        log("ws", `Market feed open · scanning ${INSTRUMENTS.length} instruments`);
        INSTRUMENTS.forEach((i) => {
          sendOn(ws, { ticks_history: i.symbol, count: 300, end: "latest", style: "ticks" }, (m) => {
            if (m.error) return;
            const ps: number[] = m.history.prices.map(Number);
            const pip = pipMap.current.get(i.symbol) ?? Math.max(2, String(m.history.prices.slice(-1)[0]).split(".")[1]?.length ?? 2);
            pipMap.current.set(i.symbol, pip);
            prices.current.set(i.symbol, ps);
            digitMap.current.set(i.symbol, ps.map((p) => lastDigit(p, pip)));
            if (i.symbol === st.current.target) setDigits(digitMap.current.get(i.symbol)!.slice(-200));
          });
          ws.send(JSON.stringify({ ticks: i.symbol, subscribe: 1 }));
        });
        if (legacyAuth) ws.send(JSON.stringify({ authorize: token }));
      };
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.req_id && callbacks.current.has(m.req_id)) {
          const cb = callbacks.current.get(m.req_id)!;
          callbacks.current.delete(m.req_id);
          cb(m);
          return;
        }
        if (m.error) {
          if (m.msg_type === "tick") return; // closed markets
          log("error", `${m.msg_type}: ${m.error.message}`);
          if (m.msg_type === "authorize") setAccount(null);
          return;
        }
        switch (m.msg_type) {
          case "authorize":
            setAccount({ loginid: m.authorize.loginid, currency: m.authorize.currency, balance: Number(m.authorize.balance), virtual: !!m.authorize.is_virtual });
            log("ws", `Authorized ${m.authorize.loginid} · ${m.authorize.currency} ${m.authorize.balance}`);
            ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
            break;
          case "balance":
            setAccount((a) => (a ? { ...a, balance: Number(m.balance.balance) } : a));
            break;
          case "tick": onTick(m.tick); break;
          case "proposal_open_contract": handleContract(m.proposal_open_contract); break;
        }
      };
      ws.onerror = () => { setStatus("error"); };
      ws.onclose = () => {
        if (stop) return;
        attempts++;
        setStatus("reconnecting");
        log("ws", `Market feed closed — reconnecting in ${Math.min(attempts * 2, 10)}s`);
        retry = setTimeout(connect, Math.min(attempts * 2000, 10000));
      };
    };
    const onTick = (t: any) => {
      const sym = t.symbol as string;
      pipMap.current.set(sym, t.pip_size);
      const ps = [...(prices.current.get(sym) ?? []).slice(-299), Number(t.quote)];
      prices.current.set(sym, ps);
      const d = lastDigit(t.quote, t.pip_size);
      const ds = [...(digitMap.current.get(sym) ?? []).slice(-299), d];
      digitMap.current.set(sym, ds);
      setQuotes((q) => {
        const prev = q[sym];
        return { ...q, [sym]: { price: t.quote, prev: prev?.price ?? t.quote, open: prev?.open ?? t.quote, pip: t.pip_size, time: t.epoch } };
      });
      if (sym === st.current.target) setDigits(ds.slice(-200));
      // paper settlement
      const p = pending.current;
      if (p && !p.live && p.order.symbol === sym) {
        const done = p.order.unit === "m" ? Date.now() >= p.endAt : ps.length - p.startCount >= p.order.duration;
        if (done) {
          const won = settleOrder(p.order.type, p.entry, Number(t.quote), d, p.order.barrier);
          const profit = won ? Math.round(p.stake * orderPayout(p.order.type, p.order.barrier) * 100) / 100 : -p.stake;
          settle(won, profit, `(exit ${Number(t.quote).toFixed(t.pip_size)})`);
        }
      }
    };
    connect();
    return () => { stop = true; clearTimeout(retry); wsRef.current?.close(); };
  }, [appId, token, log, settle, sendOn, handleContract]);

  // New Deriv API trading socket (alphanumeric App ID + pat_ token)
  useEffect(() => {
    if (!token.startsWith("pat_")) { setTradeStatus("none"); return; }
    let cancelled = false;
    const id = appId || DEFAULT_APP_ID;
    (async () => {
      try {
        setTradeStatus("connecting");
        const b = await derivRest("/trading/v1/options/accounts", id, token);
        const list = (b?.data ?? []) as any[];
        if (cancelled) return;
        setAccounts(list);
        const acc = list.find((a) => a.account_id === accountId) ?? list.find((a) => a.account_type === "demo") ?? list[0];
        if (!acc) throw new Error("No Options accounts found for this token");
        const o = await derivRest(`/trading/v1/options/accounts/${encodeURIComponent(acc.account_id)}/otp`, id, token, "POST");
        const url = o?.data?.url;
        if (!url || cancelled) return;
        const ws = new WebSocket(url);
        tradeWs.current = ws;
        ws.onopen = () => {
          setTradeStatus("ready");
          setAccount({ loginid: acc.account_id, currency: acc.currency, balance: Number(acc.balance), virtual: acc.account_type === "demo" });
          log("ws", `Trading connected · ${acc.account_id} (${acc.account_type}) ${acc.currency} ${acc.balance}`);
          ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        };
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.req_id && callbacks.current.has(m.req_id)) { const cb = callbacks.current.get(m.req_id)!; callbacks.current.delete(m.req_id); cb(m); return; }
          if (m.msg_type === "balance" && m.balance) setAccount((a) => (a ? { ...a, balance: Number(m.balance.balance) } : a));
          if (m.msg_type === "proposal_open_contract") handleContract(m.proposal_open_contract);
        };
        ws.onerror = () => { setTradeStatus("error"); log("error", "Trading socket error"); };
        ws.onclose = () => { if (!cancelled) { setTradeStatus("error"); setAccount(null); log("ws", "Trading socket closed — re-save config to reconnect"); } };
      } catch (err: any) {
        if (cancelled) return;
        setTradeStatus("error");
        setAccount(null);
        log("error", `Trading login failed: ${err?.message ?? err}`);
      }
    })();
    return () => { cancelled = true; if (tradeWs.current) { tradeWs.current.onclose = null; tradeWs.current.close(); tradeWs.current = null; } };
  }, [appId, token, accountId, log, handleContract]);

  // Swarm scan loop: every second, every agent re-analyses its market
  useEffect(() => {
    const iv = setInterval(() => {
      const all: Order[] = [];
      for (const i of INSTRUMENTS) {
        const ps = prices.current.get(i.symbol);
        if (!ps || ps.length < 60) continue;
        all.push(...scanSymbol(i.symbol, ps, digitMap.current.get(i.symbol) ?? [], pipMap.current.get(i.symbol) ?? 2, i));
      }
      all.sort((a, b) => b.confidence - a.confidence);
      setSignals(all);
      const { running, mode, settings } = st.current;
      if (!running || mode === "manual" || pending.current || Date.now() < cooldownUntil.current) return;
      setBotState("SCANNING");
      if (settings.strategy === "swarm") {
        const best = all.find((o) => o.confidence >= settings.minConfidence);
        if (best) { log("signal", `Swarm pick ${best.symbol} · ${best.reason} · ${best.confidence}%`); placeOrder(best); }
      } else {
        const sig = detectSignal(digitMap.current.get(st.current.target) ?? [], settings);
        if (sig) { log("signal", `Pattern: ${sig.reason}`); placeTrade(sig.type, sig.barrier ?? settings.barrier); }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [log, placeOrder, placeTrade]);

  return {
    status, tradeStatus, quotes, digits, signals, logs, account, accounts, accountId, setAccountId, demoBalance, stats, currentStake, running, botState, mode, settings,
    setMode, setSettings: (s: Settings) => { setSettings(s); if (!pending.current) setCurrentStake(s.stake); },
    start: () => { setRunning(true); setBotState("SCANNING"); log("info", `Bot STARTED · ${st.current.mode.toUpperCase()} · ${st.current.settings.strategy}`); },
    stop: () => { setRunning(false); setBotState("IDLE"); log("info", "Bot STOPPED"); },
    resetSession: () => { setStats({ pnl: 0, wins: 0, losses: 0, lossStreak: 0 }); setCurrentStake(st.current.settings.stake); log("info", "Session stats reset"); },
    clearLogs: () => setLogs([]),
    placeTrade, placeOrder, log,
  };
}
