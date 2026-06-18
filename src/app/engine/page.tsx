"use client";

import { useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { toWalletSteps, type WalletStep } from "@/lib/execute-plan";
import type { EngineResult } from "@/lib/engine";
import type { PlanCard } from "@/lib/routes";

// Surfaces the canonical Cross-Chain Engine in the UI: pick an asset + route,
// call /api/plan, and review the card + the ordered wallet steps. This is the
// review/preview surface (the AI never signs); per-rail signing is wired
// separately — AP3X executes via the existing OFT/Reactor executors, and the
// USDC rails light up once their ⟨VERIFY⟩ contract ABIs are configured.

const USDC_CHAINS = ["ethereum", "base", "arbitrum", "solana", "bsc", "hyperliquid", "cardano", "stacks", "canton"];
const AP3X_CHAINS = ["base", "bsc", "nexus", "prime", "vector", "cardano"];

type OkResult = Extract<EngineResult, { ok: true }>;

export default function EnginePage() {
  const [asset, setAsset] = useState<"USDC" | "AP3X">("USDC");
  const [fromChain, setFrom] = useState("base");
  const [toChain, setTo] = useState("arbitrum");
  const [amount, setAmount] = useState("100");
  const [recipient, setRecipient] = useState("");
  const [account, setAccount] = useState("");
  const [ethereumSender, setEthereumSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<OkResult | null>(null);

  const chains = asset === "AP3X" ? AP3X_CHAINS : USDC_CHAINS;

  const steps = useMemo<WalletStep[] | "delegated" | null>(() => {
    if (!result) return null;
    const w = toWalletSteps(result);
    return w.kind === "delegated" ? "delegated" : w.steps;
  }, [result]);

  async function plan() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset,
          fromChain,
          toChain,
          amount,
          recipient: recipient.trim(),
          account: account.trim() || undefined,
          ethereumSender: ethereumSender.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No route.");
      setResult({ ok: true, rail: data.rail, card: data.card, plan: data.plan } as OkResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No route.");
    } finally {
      setBusy(false);
    }
  }

  const card: PlanCard | null = result?.card ?? null;

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <div className="brand-mark">
            Skyline <span>Cross-Chain Engine</span>
          </div>
          <div className="brand-status">CCTP · Hyperliquid · xReserve · Stargate · OFT · Reactor</div>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" />
      </div>

      <div className="panel">
        <div className="prompt-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <select className="prompt" value={asset} onChange={(e) => { setAsset(e.target.value as "USDC" | "AP3X"); setResult(null); }}>
            <option value="USDC">USDC</option>
            <option value="AP3X">AP3X</option>
          </select>
          <select className="prompt" value={fromChain} onChange={(e) => setFrom(e.target.value)}>
            {chains.map((c) => <option key={c} value={c}>from: {c}</option>)}
          </select>
          <select className="prompt" value={toChain} onChange={(e) => setTo(e.target.value)}>
            {chains.map((c) => <option key={c} value={c}>to: {c}</option>)}
          </select>
          <input className="prompt" style={{ maxWidth: 120 }} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="amount" />
        </div>
        <div className="prompt-row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <input className="prompt" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="recipient address (destination chain)" />
        </div>
        <div className="prompt-row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <input className="prompt" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Hyperliquid account (optional)" />
          <input className="prompt" value={ethereumSender} onChange={(e) => setEthereumSender(e.target.value)} placeholder="Ethereum sender — xReserve (optional)" />
          <button className="btn" disabled={busy || !recipient.trim()} onClick={plan}>{busy ? "Routing…" : "Plan route"}</button>
        </div>
        {error && <div className="err" style={{ marginTop: 10 }}>⛔ {error}</div>}
      </div>

      {card && (
        <div className="panel">
          <h2>Review · rail {card.rail}</h2>
          <div className="status-line"><b>{card.fromChain} → {card.toChain}</b></div>
          <table className="card-table">
            <tbody>
              <tr><td>Send</td><td>{card.amountIn} {card.tokenIn}</td></tr>
              <tr><td>Receive (min)</td><td>{card.minOut} {card.tokenOut}</td></tr>
              <tr><td>Settled asset</td><td>{card.settledAsset} <span className="muted">({card.trustModel})</span></td></tr>
              <tr><td>Recipient</td><td className="mono">{card.recipient}</td></tr>
              {card.fees.map((f, i) => <tr key={i}><td>{f.label}</td><td>{f.value}</td></tr>)}
              {card.etaSeconds != null && <tr><td>ETA</td><td>~{Math.round(card.etaSeconds / 60)} min</td></tr>}
            </tbody>
          </table>
          {card.notes.map((n, i) => <p className="notes" key={i}>• {n}</p>)}
        </div>
      )}

      {steps && (
        <div className="panel">
          <h2>Wallet steps</h2>
          {steps === "delegated" ? (
            <p className="notes">AP3X executes via the existing OFT / Reactor executors (live LayerZero quote / Skyline native API).</p>
          ) : (
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={i}>
                  <b>{s.label}</b> <span className="muted">· chain {s.chainId}</span>
                  {s.kind === "contract-write" && <span className="tag"> ABI ⟨VERIFY⟩</span>}
                  {(s.kind === "erc20-approve" || s.kind === "erc20-transfer") && <span className="tag ok"> encoded ✓</span>}
                </li>
              ))}
            </ol>
          )}
          <p className="footnote" style={{ marginTop: 12 }}>
            Review only · the AI never signs. ERC-20 legs are real calldata; protocol calls are armed once their
            verified ABIs are configured.
          </p>
        </div>
      )}
    </div>
  );
}
