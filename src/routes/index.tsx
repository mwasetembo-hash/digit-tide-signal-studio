import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  INSTRUMENTS, useDerivEngine, detectSignal, payoutRatio, clampDigitBarrier, DEFAULT_APP_ID,
  type MarketCat, type Mode, type Settings, type LogLevel,
} from "@/lib/deriv-engine";
import { FAMILY_LABEL } from "@/lib/scanner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mwase Hacking Bot — Deriv Signal & Automation Engine" },
      { name: "description", content: "Live Deriv tick analysis, digit signals, paper trading and automated digit contract bot." },
      { property: "og:title", content: "Mwase Hacking Bot — Deriv Signal Engine" },
      { property: "og:description", content: "Live digit histograms, signals, and an automated Deriv trading bot." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const FILTERS: { id: "all" | MarketCat; label: string }[] = [
  { id: "all", label: "All Markets" }, { id: "synthetic", label: "Synthetic Indices" },
  { id: "forex", label: "Forex" }, { id: "commodities", label: "Commodities" }, { id: "crypto", label: "Cryptocurrencies" },
];
const CT_LABEL: Record<string, string> = { DIGITEVEN: "EVEN", DIGITODD: "ODD", DIGITOVER: "OVER", DIGITUNDER: "UNDER", DIGITMATCH: "MATCHES", DIGITDIFF: "DIFFERS" };
const LS = "mwase-config";

function Index() {
  const [cfg, setCfg] = useState({ appId: DEFAULT_APP_ID, tokens: [] as string[], active: 0 });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try { const s = localStorage.getItem(LS); if (s) { const c = JSON.parse(s); if (!c.appId || c.appId === "1089") c.appId = DEFAULT_APP_ID; setCfg(c); } } catch { /* ignore */ }
    setLoaded(true);
  }, []);
  const saveCfg = (c: typeof cfg) => { setCfg(c); localStorage.setItem(LS, JSON.stringify(c)); };

  const [target, setTarget] = useState("R_100");
  const [filter, setFilter] = useState<"all" | MarketCat>("all");
  const [showCfg, setShowCfg] = useState(false);
  const [showExec, setShowExec] = useState(false);
  const token = loaded ? cfg.tokens[cfg.active] ?? "" : "";
  const e = useDerivEngine(loaded ? cfg.appId : DEFAULT_APP_ID, token, target);

  const balance = e.mode === "demo" || !e.account ? e.demoBalance : e.account.balance;
  const total = e.stats.wins + e.stats.losses;
  const winRate = total ? (e.stats.wins / total) * 100 : 0;

  return (
    <div className="min-h-screen pb-10">
      <Ticker quotes={e.quotes} />
      <header className="border-b border-border/60 bg-panel backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto max-w-[1600px] px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="font-mono font-bold text-lg sm:text-xl tracking-tight">
              <span className="text-cyan">MWASE</span> HACKING BOT
            </h1>
            <p className="text-[11px] text-muted-foreground uppercase tracking-widest">Universal Deriv Signal & Automation Engine</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill s={e.status} />
            <button onClick={() => setShowCfg(true)} className="rounded-md border border-border px-3 py-1.5 text-xs font-mono hover:border-cyan hover:text-cyan">⚙ API CONFIG</button>
            <button onClick={() => setShowExec(true)} className="rounded-md bg-cyan px-4 py-1.5 text-xs font-bold font-mono text-primary-foreground glow-cyan hover:opacity-90">EXECUTE TRADE</button>
          </div>
        </div>
        <div className="mx-auto max-w-[1600px] px-4 pb-3 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className={`whitespace-nowrap rounded-md px-3 py-1 text-xs ${filter === f.id ? "bg-cyan/15 text-cyan border border-cyan/40" : "text-muted-foreground border border-transparent hover:text-foreground"}`}>{f.label}</button>
            ))}
          </div>
          <div className="flex rounded-md border border-border overflow-hidden text-[11px] font-mono">
            {([["demo", "DEMO · Paper"], ["manual", "MANUAL · 1-Click"], ["auto", "AUTO BOT · Live"]] as [Mode, string][]).map(([m, l]) => (
              <button key={m} onClick={() => { e.setMode(m); e.log("info", `Mode → ${m.toUpperCase()}`); }} className={`px-3 py-1.5 ${e.mode === m ? (m === "auto" ? "bg-crimson text-destructive-foreground" : m === "manual" ? "bg-amber text-primary-foreground" : "bg-emerald text-primary-foreground") : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="border-t border-border/60 bg-panel-2">
          <div className="mx-auto max-w-[1600px] px-4 py-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono text-xs">
            <Tel k={e.mode === "demo" || !e.account ? "Virtual Balance" : `Balance · ${e.account.loginid}`} v={`$${balance.toFixed(2)}`} c="text-cyan" />
            <Tel k="Session P&L" v={`${e.stats.pnl >= 0 ? "+" : ""}${e.stats.pnl.toFixed(2)}`} c={e.stats.pnl >= 0 ? "text-emerald" : "text-crimson"} />
            <Tel k="Win Rate" v={`${winRate.toFixed(1)}% (${e.stats.wins}/${total})`} c="text-amber" />
            <Tel k="Current Stake" v={`$${e.currentStake.toFixed(2)}`} c="text-foreground" />
            <Tel k="Loss Streak" v={String(e.stats.lossStreak)} c="text-crimson" />
            <Tel k="Bot State" v={e.botState} c={e.running ? "text-emerald" : "text-muted-foreground"} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 mt-4 grid gap-4 lg:grid-cols-12">
        <section className="lg:col-span-8 space-y-4">
          <DigitPanel digits={e.digits} target={target} setTarget={setTarget} quote={e.quotes[target]} />
          <SignalsGrid e={e} filter={filter} onPick={setTarget} target={target} />
          <LogTerminal logs={e.logs} clear={e.clearLogs} />
        </section>
        <aside className="lg:col-span-4 space-y-4">
          <StrategyDeck e={e} />
          <Community />
        </aside>
      </main>

      {showCfg && <ConfigModal cfg={cfg} save={saveCfg} close={() => setShowCfg(false)} account={e.account} />}
      {showExec && <ExecDrawer e={e} target={target} close={() => setShowExec(false)} />}
    </div>
  );
}

function Tel({ k, v, c }: { k: string; v: string; c: string }) {
  return <div className="rounded-md border border-border/50 bg-background/40 px-2 py-1"><div className="text-[9px] uppercase text-muted-foreground tracking-wider truncate">{k}</div><div className={`font-semibold truncate ${c}`}>{v}</div></div>;
}

function StatusPill({ s }: { s: string }) {
  const map: Record<string, [string, string]> = {
    connected: ["Connected", "text-emerald border-emerald/40 bg-emerald/10"],
    connecting: ["Connecting", "text-amber border-amber/40 bg-amber/10"],
    reconnecting: ["Reconnecting", "text-amber border-amber/40 bg-amber/10"],
    error: ["Error", "text-crimson border-crimson/40 bg-crimson/10"],
  };
  const [l, c] = map[s] ?? map['error']!;
  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono ${c}`}><span className="h-2 w-2 rounded-full bg-current animate-pulse" />Deriv · {l}</span>;
}

function Ticker({ quotes }: { quotes: Record<string, any> }) {
  const items = INSTRUMENTS.map((i) => {
    const q = quotes[i.symbol];
    const ch = q ? ((q.price - q.open) / q.open) * 100 : 0;
    return { ...i, q, ch };
  });
  return (
    <div className="overflow-hidden border-b border-border/60 bg-background/80 py-1.5">
      <div className="flex w-max animate-marquee gap-8 font-mono text-xs">
        {[...items, ...items].map((i, idx) => (
          <span key={idx} className="whitespace-nowrap">
            <span className="text-muted-foreground">{i.name}</span>{" "}
            <span>{i.q ? i.q.price.toFixed(i.q.pip) : "—"}</span>{" "}
            <span className={i.ch >= 0 ? "text-emerald" : "text-crimson"}>{i.ch >= 0 ? "▲" : "▼"} {Math.abs(i.ch).toFixed(3)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DigitPanel({ digits, target, setTarget, quote }: { digits: number[]; target: string; setTarget: (s: string) => void; quote?: any }) {
  const last100 = digits.slice(-100);
  const freq = Array.from({ length: 10 }, (_, d) => last100.filter((x) => x === d).length / Math.max(1, last100.length) * 100);
  const max = Math.max(...freq), min = Math.min(...freq);
  const last10 = digits.slice(-10);
  return (
    <div className="glass p-4">
      <div className="flex flex-wrap justify-between gap-2 items-center mb-4">
        <div>
          <h2 className="font-semibold">Digit Analysis</h2>
          <p className="text-xs text-muted-foreground font-mono">Rolling {last100.length} ticks · {quote ? quote.price.toFixed(quote.pip) : "awaiting tick…"}</p>
        </div>
        <select value={target} onChange={(ev) => setTarget(ev.target.value)} className="rounded-md bg-background border border-border px-2 py-1 text-sm font-mono">
          {INSTRUMENTS.map((i) => <option key={i.symbol} value={i.symbol}>{i.name} ({i.symbol})</option>)}
        </select>
      </div>
      <div className="mb-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Live Tick Digit Vector</div>
        <div className="flex gap-1.5 sm:gap-2">
          {last10.map((d, i) => (
            <div key={`${digits.length}-${i}`} className={`flex-1 aspect-square max-w-14 grid place-items-center rounded-md border font-mono text-lg sm:text-2xl font-bold ${i === last10.length - 1 ? "animate-pop border-cyan text-cyan glow-cyan" : d % 2 ? "border-crimson/40 text-crimson" : "border-emerald/40 text-emerald"}`}>{d}</div>
          ))}
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Digit Frequency Histogram</div>
      <div className="grid grid-cols-10 gap-1.5 sm:gap-2 items-end h-40">
        {freq.map((f, d) => {
          const hot = f === max && max > 0, cold = f === min;
          return (
            <div key={d} className="flex flex-col items-center gap-1 h-full justify-end">
              <span className={`text-[10px] font-mono ${hot ? "text-crimson" : cold ? "text-cyan" : "text-muted-foreground"}`}>{f.toFixed(0)}%</span>
              <div className={`w-full rounded-t transition-all duration-500 ${hot ? "bg-crimson glow-crimson" : cold ? "bg-cyan glow-cyan" : "bg-muted-foreground/30"}`} style={{ height: `${Math.max(4, (f / Math.max(max, 1)) * 100)}%` }} />
              <span className="font-mono text-sm font-bold">{d}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex gap-4 text-xs font-mono"><span className="text-crimson">■ HOT {freq.indexOf(max)}</span><span className="text-cyan">■ COLD {freq.indexOf(min)}</span>
        <span className="text-muted-foreground ml-auto">EVEN {last100.filter((x) => x % 2 === 0).length} · ODD {last100.filter((x) => x % 2).length}</span></div>
    </div>
  );
}

function SignalsGrid({ e, filter, onPick, target }: { e: ReturnType<typeof useDerivEngine>; filter: string; onPick: (s: string) => void; target: string }) {
  const cats = new Map(INSTRUMENTS.map((i) => [i.symbol, i]));
  const list = e.signals.filter((o) => filter === "all" || cats.get(o.symbol)?.cat === filter).slice(0, 30);
  return (
    <div className="glass p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">AI Swarm Signals · all instruments & contract types</h2>
        <span className="text-[10px] font-mono text-muted-foreground">{e.signals.length} live signals</span>
      </div>
      {list.length === 0 && <p className="text-xs text-muted-foreground font-mono">Agents collecting ticks…</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((o) => {
          const q = e.quotes[o.symbol];
          const up = o.type === "CALL" || o.type === "DIGITOVER" || o.type === "DIGITEVEN";
          const name = cats.get(o.symbol)?.name ?? o.symbol;
          return (
            <div key={`${o.symbol}-${o.family}`} className={`rounded-lg border bg-background/40 p-3 ${target === o.symbol ? "border-cyan/70" : "border-border"}`}>
              <button onClick={() => onPick(o.symbol)} className="w-full text-left">
                <div className="flex justify-between items-center gap-2">
                  <span className="text-sm font-medium truncate">{name}</span>
                  <span className={`text-[10px] font-mono font-bold rounded px-2 py-0.5 ${up ? "bg-emerald/15 text-emerald" : "bg-crimson/15 text-crimson"}`}>{o.type.replace("DIGIT", "")}{o.barrier ? ` ${o.barrier}` : ""}</span>
                </div>
                <div className="font-mono text-lg font-bold mt-1">{q ? q.price.toFixed(q.pip) : "—"}</div>
                <div className="text-[11px] text-amber">{FAMILY_LABEL[o.family]} · {o.duration}{o.unit === "t" ? " ticks" : " min"}</div>
                <div className="text-[11px] text-muted-foreground truncate">{o.reason}</div>
                <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-cyan transition-all" style={{ width: `${o.confidence}%` }} /></div>
              </button>
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] font-mono text-cyan">CONFIDENCE {o.confidence}%</span>
                <button onClick={() => e.placeOrder(o)} className="text-[10px] font-mono font-bold rounded bg-cyan/15 text-cyan border border-cyan/40 px-2 py-0.5 hover:bg-cyan/25">EXECUTE</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LVL: Record<LogLevel, string> = { info: "text-muted-foreground", ws: "text-cyan", signal: "text-amber", trade: "text-foreground", win: "text-emerald", loss: "text-crimson", error: "text-crimson" };
function LogTerminal({ logs, clear }: { logs: any[]; clear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [logs]);
  return (
    <div className="glass p-4">
      <div className="flex justify-between mb-2"><h2 className="font-semibold">Engine Execution Log</h2><button onClick={clear} className="text-xs font-mono text-muted-foreground hover:text-crimson">CLEAR</button></div>
      <div ref={ref} className="h-64 overflow-y-auto rounded-md bg-background/70 border border-border p-3 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 && <div className="text-muted-foreground">&gt; awaiting events_</div>}
        {logs.map((l) => <div key={l.id}><span className="text-muted-foreground">[{l.t}]</span> <span className={`uppercase ${LVL[l.level as LogLevel]}`}>{l.level.padEnd(6)}</span> <span className={LVL[l.level as LogLevel]}>{l.msg}</span></div>)}
      </div>
    </div>
  );
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return <label className="block"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    <input type="number" step={step} value={value} onChange={(ev) => onChange(Number(ev.target.value))} className="mt-1 w-full rounded-md bg-background border border-border px-2 py-1.5 font-mono text-sm focus:border-cyan outline-none" /></label>;
}

function StrategyDeck({ e }: { e: ReturnType<typeof useDerivEngine> }) {
  const s = e.settings;
  const up = (p: Partial<Settings>) => e.setSettings({ ...s, ...p });
  const live = e.mode === "auto" && !e.account;
  return (
    <div className="glass p-4 space-y-3">
      <h2 className="font-semibold">Strategy Deck</h2>
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        {([["swarm", "AI Swarm · All Markets"], ["meanrev", "Mean Reversion"], ["overunder", "Over / Under"], ["matchdiff", "Match / Differ"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => up({ strategy: k })} className={`rounded-md border px-2 py-2 ${s.strategy === k ? "border-cyan text-cyan bg-cyan/10" : "border-border text-muted-foreground"}`}>{l}</button>
        ))}
      </div>
      {s.strategy === "swarm" && <><p className="text-xs text-muted-foreground">One agent per instrument × contract type (Even/Odd, Over/Under, Differs, Rise/Fall, Higher/Lower) scans every second; the bot auto-executes the strongest signal above your confidence floor.</p><Num label="Min confidence %" value={s.minConfidence} onChange={(n) => up({ minConfidence: Math.min(99, Math.max(50, Math.round(n))) })} /></>}
      {s.strategy === "meanrev" && <p className="text-xs text-muted-foreground">Detects 3 consecutive EVEN or ODD digits, then trades the opposite parity.</p>}
      {(s.strategy === "overunder" || s.strategy === "matchdiff") && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Direction</span>
            <select value={s.strategy === "overunder" ? s.ouDirection : s.mdDirection} onChange={(ev) => s.strategy === "overunder" ? up({ ouDirection: ev.target.value as any }) : up({ mdDirection: ev.target.value as any })} className="mt-1 w-full rounded-md bg-background border border-border px-2 py-1.5 font-mono text-sm">
              {s.strategy === "overunder" ? <><option value="DIGITOVER">OVER</option><option value="DIGITUNDER">UNDER</option></> : <><option value="DIGITDIFF">DIFFERS</option><option value="DIGITMATCH">MATCHES</option></>}
            </select></label>
          <Num label="Barrier (0-9)" value={s.barrier} onChange={(n) => up({ barrier: clampDigitBarrier(s.strategy === "overunder" ? s.ouDirection : s.mdDirection, n) })} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Num label="Initial stake $" value={s.stake} step={0.35} onChange={(n) => up({ stake: Math.max(0.35, n) })} />
        <Num label="Martingale ×" value={s.martingale} step={0.1} onChange={(n) => up({ martingale: Math.max(1, n) })} />
        <Num label="Max losses → reset" value={s.maxLosses} onChange={(n) => up({ maxLosses: Math.max(1, Math.round(n)) })} />
        <Num label="Cooldown (s)" value={s.cooldown} onChange={(n) => up({ cooldown: Math.max(0, n) })} />
        <Num label="Stop loss $" value={s.stopLoss} onChange={(n) => up({ stopLoss: Math.max(1, n) })} />
        <Num label="Take profit $" value={s.takeProfit} onChange={(n) => up({ takeProfit: Math.max(1, n) })} />
      </div>
      {live && <p className="text-xs text-amber">AUTO mode needs an authorized token — trades will be simulated until one is added.</p>}
      {e.mode === "manual" && <p className="text-xs text-amber">MANUAL mode: the bot won't trade itself. Use EXECUTE TRADE.</p>}
      <div className="flex gap-2">
        {e.running
          ? <button onClick={e.stop} className="flex-1 rounded-md bg-crimson py-2.5 font-mono font-bold text-destructive-foreground glow-crimson">■ STOP BOT</button>
          : <button disabled={e.mode === "manual"} onClick={e.start} className="flex-1 rounded-md bg-emerald py-2.5 font-mono font-bold text-primary-foreground glow-emerald disabled:opacity-40">▶ START {e.mode === "auto" ? "AUTO" : "PAPER"} BOT</button>}
        <button onClick={e.resetSession} className="rounded-md border border-border px-3 text-xs font-mono">RESET</button>
      </div>
    </div>
  );
}

function ExecDrawer({ e, target, close }: { e: ReturnType<typeof useDerivEngine>; target: string; close: () => void }) {
  const sig = useMemo(() => detectSignal(e.digits, e.settings), [e.digits, e.settings]);
  const [type, setType] = useState(sig?.type ?? "DIGITEVEN");
  const [barrier, setBarrier] = useState(e.settings.barrier);
  const [stake, setStake] = useState(e.currentStake);
  const needsB = !["DIGITEVEN", "DIGITODD"].includes(type);
  const live = e.mode !== "demo" && !!e.account;
  const profit = stake * payoutRatio(type, barrier);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm" onClick={close}>
      <div className="w-full max-w-md h-full bg-card border-l border-border p-5 space-y-4 overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex justify-between"><h2 className="font-mono font-bold text-cyan">CONFIRM CONTRACT</h2><button onClick={close} className="text-muted-foreground">✕</button></div>
        <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-xs">{sig ? <>Engine suggests <b className="text-amber">{CT_LABEL[sig.type]}</b> — {sig.reason}</> : "No strong pattern right now."}</div>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(CT_LABEL).map(([k, l]) => <button key={k} onClick={() => setType(k)} className={`rounded-md border py-2 text-xs font-mono ${type === k ? "border-cyan text-cyan bg-cyan/10" : "border-border"}`}>{l}</button>)}
        </div>
        {needsB && <Num label="Barrier digit" value={barrier} onChange={(n) => setBarrier(clampDigitBarrier(type, n))} />}
        <Num label="Stake $" value={stake} step={0.35} onChange={(n) => setStake(Math.max(0.35, n))} />
        <div className="font-mono text-xs space-y-1 rounded-md bg-background/60 p-3 border border-border">
          <div className="flex justify-between"><span className="text-muted-foreground">Symbol</span><span>{target}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span>1 tick</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Est. profit</span><span className="text-emerald">+${profit.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Execution</span><span className={live ? "text-crimson" : "text-emerald"}>{live ? "LIVE ACCOUNT" : "PAPER"}</span></div>
        </div>
        <button onClick={() => { e.placeTrade(type, clampDigitBarrier(type, barrier), stake); close(); }} className={`w-full rounded-md py-3 font-mono font-bold ${live ? "bg-crimson text-destructive-foreground glow-crimson" : "bg-cyan text-primary-foreground glow-cyan"}`}>BUY {CT_LABEL[type]}{needsB ? ` ${barrier}` : ""} · ${stake.toFixed(2)}</button>
      </div>
    </div>
  );
}

function ConfigModal({ cfg, save, close, account }: { cfg: { appId: string; tokens: string[]; active: number }; save: (c: any) => void; close: () => void; account: any }) {
  const [appId, setAppId] = useState(cfg.appId);
  const [tokens, setTokens] = useState(cfg.tokens);
  const [active, setActive] = useState(cfg.active);
  const [draft, setDraft] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm p-4" onClick={close}>
      <div className="glass bg-card w-full max-w-lg p-5 space-y-4" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex justify-between"><h2 className="font-mono font-bold text-cyan">DERIV API CONFIG</h2><button onClick={close}>✕</button></div>
        <label className="block"><span className="text-[10px] uppercase tracking-wider text-muted-foreground">App ID (new Deriv API ID or legacy numeric)</span>
          <input value={appId} onChange={(ev) => setAppId(ev.target.value)} className="mt-1 w-full rounded-md bg-background border border-border px-2 py-2 font-mono text-sm" /></label>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">API tokens (pick active)</span>
          <div className="space-y-1 mt-1">
            <button onClick={() => setActive(-1)} className={`w-full text-left rounded-md border px-2 py-1.5 font-mono text-xs ${active < 0 || !tokens[active] ? "border-cyan text-cyan" : "border-border"}`}>No token · paper mode only</button>
            {tokens.map((t, i) => (
              <div key={i} className="flex gap-1">
                <button onClick={() => setActive(i)} className={`flex-1 text-left rounded-md border px-2 py-1.5 font-mono text-xs ${active === i ? "border-cyan text-cyan" : "border-border"}`}>{t.slice(0, 6)}••••{t.slice(-4)}</button>
                <button onClick={() => { setTokens(tokens.filter((_, j) => j !== i)); if (active === i) setActive(-1); }} className="px-2 text-crimson text-xs">✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-1 mt-2">
            <input type="password" placeholder="Paste Deriv API token" value={draft} onChange={(ev) => setDraft(ev.target.value)} className="flex-1 rounded-md bg-background border border-border px-2 py-2 font-mono text-sm" />
            <button onClick={() => { if (draft.trim()) { setTokens([...tokens, draft.trim()]); setActive(tokens.length); setDraft(""); } }} className="rounded-md border border-cyan text-cyan px-3 text-xs font-mono">ADD</button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Tokens are stored only in this browser. Use a Personal Access Token (pat_…) with Trade scope from developers.deriv.com. Demo account is used first.</p>
        </div>
        {account && <p className="text-xs font-mono text-emerald">Authorized: {account.loginid} ({account.virtual ? "virtual" : "real"})</p>}
        <button onClick={() => { save({ appId: appId.trim() || DEFAULT_APP_ID, tokens, active }); close(); }} className="w-full rounded-md bg-cyan py-2.5 font-mono font-bold text-primary-foreground">SAVE & RECONNECT</button>
      </div>
    </div>
  );
}

const SEED = [
  { u: "ZedTrader", m: "R_100 showing 4 odd in a row, watching EVEN reversion 👀" },
  { u: "LusakaPips", m: "Digit 7 cold for 40 ticks — DIFFERS 7 printing nicely" },
  { u: "VolKing", m: "Over 3 hit rate 68% last 25 ticks on V75" },
];
const BOTS = ["Hydra", "QuantMwila", "TickSniper", "NdolaFX", "DigitWitch"];
const MSGS = ["Even/Odd bias flipping on R_50", "Took UNDER 6 on R_25, +$0.87", "Martingale reset after 3 losses, stay disciplined", "BTC momentum fading, PUT bias", "Digit 0 hot at 16% on V100", "Session +$12 so far, stopping at TP"];
function Community() {
  const [posts, setPosts] = useState(SEED.map((p, i) => ({ ...p, id: i, t: "now" })));
  const [txt, setTxt] = useState("");
  useEffect(() => {
    const iv = setInterval(() => {
      const u = BOTS[Math.floor(Math.random() * BOTS.length)]!, m = MSGS[Math.floor(Math.random() * MSGS.length)]!;
      setPosts((p) => [...p.slice(-30), { u, m, id: Date.now(), t: new Date().toLocaleTimeString("en-GB", { hour12: false }) }]);
    }, 12000);
    return () => clearInterval(iv);
  }, []);
  const post = () => { if (!txt.trim()) return; setPosts((p) => [...p, { u: "You", m: txt.trim(), id: Date.now(), t: new Date().toLocaleTimeString("en-GB", { hour12: false }) }]); setTxt(""); };
  return (
    <div className="glass p-4">
      <h2 className="font-semibold mb-2">Trader Community Feed</h2>
      <div className="h-72 overflow-y-auto space-y-2 flex flex-col-reverse">
        <div className="space-y-2">{posts.map((p) => (
          <div key={p.id} className={`rounded-md border p-2 text-sm ${p.u === "You" ? "border-cyan/40 bg-cyan/5" : "border-border bg-background/40"}`}>
            <div className="flex justify-between text-[11px] font-mono"><span className={p.u === "You" ? "text-cyan" : "text-amber"}>@{p.u}</span><span className="text-muted-foreground">{p.t}</span></div>
            <p>{p.m}</p>
          </div>
        ))}</div>
      </div>
      <div className="flex gap-1 mt-2">
        <input value={txt} onChange={(ev) => setTxt(ev.target.value)} onKeyDown={(ev) => ev.key === "Enter" && post()} placeholder="Broadcast your trade read…" className="flex-1 rounded-md bg-background border border-border px-2 py-2 text-sm" />
        <button onClick={post} className="rounded-md bg-cyan px-3 text-xs font-mono font-bold text-primary-foreground">POST</button>
      </div>
    </div>
  );
}
