"use client";

import { useEffect, useState } from "react";
import { CHAINS, type ChainKey } from "@/lib/chains";
import type { Intent } from "@/lib/intent";

// Dropdown fallback that produces the exact same Intent object as the AI path.
// Works with zero AI and zero chain calls — the floor of the UX.

const DEST_CHAINS = Object.values(CHAINS).filter((c) => c.key !== "base");

export function ManualForm({ onSubmit }: { onSubmit: (intent: Intent) => void }) {
  const [toChain, setToChain] = useState<ChainKey>("ap3x");
  const [tokenIn, setTokenIn] = useState("USDC");
  const [tokenOut, setTokenOut] = useState("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [tokensByChain, setTokensByChain] = useState<Record<string, string[]>>({
    ap3x: ["AP3X", "bAP3X", "USDC"],
  });

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((d) => {
        if (d.byChain) setTokensByChain(d.byChain);
      })
      .catch(() => {
        // static defaults remain
      });
  }, []);

  const baseTokens = tokensByChain["base"] ?? ["USDC", "ETH", "cbBTC", "WETH"];
  const destTokens = tokensByChain[toChain] ?? [];
  const amountOk = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;

  function submit() {
    if (!amountOk) return;
    const out = tokenOut && tokenOut !== tokenIn ? tokenOut : null;
    onSubmit({
      action: out ? "swap" : recipient ? "send" : "bridge",
      tokenIn,
      tokenOut: out,
      amount,
      amountSide: "in",
      fromChain: "base",
      toChain,
      recipient: recipient.trim() || null,
      confidence: 1, // user-entered, nothing to parse
      clarifyingQuestion: null,
    });
  }

  return (
    <div>
      <div className="form-grid">
        <div>
          <label className="flabel">You send (on Base)</label>
          <select className="field" value={tokenIn} onChange={(e) => setTokenIn(e.target.value)}>
            {[...new Set(["USDC", "ETH", ...baseTokens, "AP3X", "bAP3X"])].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flabel">Amount</label>
          <input
            className="field"
            inputMode="decimal"
            placeholder="250"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/,/g, ""))}
          />
        </div>
        <div>
          <label className="flabel">Destination chain</label>
          <select
            className="field"
            value={toChain}
            onChange={(e) => {
              setToChain(e.target.value as ChainKey);
              setTokenOut("");
            }}
          >
            {DEST_CHAINS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flabel">Receive token (blank = same)</label>
          <select className="field" value={tokenOut} onChange={(e) => setTokenOut(e.target.value)}>
            <option value="">— same as sent —</option>
            {destTokens.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="full">
          <label className="flabel">Recipient (blank = your connected wallet)</label>
          <input
            className="field"
            placeholder="0x… or name.near"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>
      </div>
      <div className="actions">
        <button className="btn" onClick={submit} disabled={!amountOk}>
          Review transfer
        </button>
      </div>
    </div>
  );
}
