"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  CHAINS,
  CHAIN_TOKENS,
  SCOPE_CHAINS,
  SCOPE_ORIGINS,
  SPEND_CAP_USD,
  tokenLabel,
  type ChainKey,
  type ScopeToken,
} from "@/lib/chains";
import type { Intent } from "@/lib/intent";
import type { CardModel, RailBTransferPlan, RailCPlan } from "@/lib/build";
import type { SerializedRailAPlan } from "@/lib/oft";
import { isKnownRecipient } from "@/lib/history";

// Stargate-style transfer card: FROM (chain · token · amount) → TO (chain ·
// token · estimated receive), quote details inline, one CTA. The AI prompt
// fills this card; the card is the single source the user confirms from.

export type Prefill = Partial<{
  fromChain: ChainKey;
  toChain: ChainKey;
  tokenIn: string;
  tokenOut: string;
  amount: string;
  recipient: string;
}>;

type QuoteState =
  | { k: "idle" }
  | { k: "loading" }
  | { k: "ready"; rail: "A" | "B" | "C"; card: CardModel; planA: SerializedRailAPlan | null; planC: RailCPlan | null }
  | { k: "needRecipient"; message: string }
  | { k: "error"; message: string };

function eta(seconds: number | null): string {
  if (seconds == null) return "~ minutes";
  if (seconds < 90) return `~${seconds}s`;
  return `~${Math.round(seconds / 60)} min`;
}

type Availability = Record<string, Record<string, boolean>> | null;

function avail(a: Availability, chain: ChainKey, tok: ScopeToken): boolean {
  // Until the live list answers (or if it fails), assume available — the
  // server re-validates at quote time anyway.
  return a?.[chain]?.[tok] ?? true;
}

function defaultTokenOut(tokenIn: ScopeToken, to: ChainKey, a: Availability): ScopeToken {
  const dest = (CHAIN_TOKENS[to] ?? []) as ScopeToken[];
  if (dest.includes(tokenIn) && avail(a, to, tokenIn)) return tokenIn;
  return dest.find((t) => avail(a, to, t)) ?? (dest[0] as ScopeToken);
}

export function TransferCard({
  wallet,
  prefill,
  onExecuteA,
  onExecuteB,
  onExecuteC,
  onBusyError,
}: {
  wallet: Address | undefined;
  prefill: Prefill | null;
  onExecuteA: (card: CardModel, planA: SerializedRailAPlan) => void;
  onExecuteB: (card: CardModel, planB: RailBTransferPlan) => void;
  onExecuteC: (card: CardModel, planC: RailCPlan, originChain: ChainKey) => void;
  onBusyError: (msg: string) => void;
}) {
  const [fromChain, setFromChain] = useState<ChainKey>("base");
  const [tokenIn, setTokenIn] = useState<ScopeToken>("AP3X");
  const [amount, setAmount] = useState("");
  const [toChain, setToChain] = useState<ChainKey>("nexus");
  const [tokenOut, setTokenOut] = useState<ScopeToken>("AP3X");
  const [recipient, setRecipient] = useState("");
  const [quote, setQuote] = useState<QuoteState>({ k: "idle" });
  const [executing, setExecuting] = useState(false);
  const [typedAmount, setTypedAmount] = useState("");
  const [recipientAccepted, setRecipientAccepted] = useState(false);
  const [availability, setAvailability] = useState<Availability>(null);

  // Live token availability (what 1-Click solvers actually carry right now).
  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((d) => { if (d.availability) setAvailability(d.availability); })
      .catch(() => {});
  }, []);

  const fromTokens = (CHAIN_TOKENS[fromChain] ?? []) as ScopeToken[];
  const destChains = SCOPE_CHAINS.filter((c) => c !== fromChain);
  const destTokens = (CHAIN_TOKENS[toChain] ?? []) as ScopeToken[];
  const destNonEvm = CHAINS[toChain].family !== "evm";
  const amountOk = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;

  const buildIntent = useCallback((): Intent => {
    // The card always speaks in canonical scope tokens; the router and the
    // builders handle the chain-local representations (bAP3X / bnAP3X).
    const effTokenIn = tokenIn;
    return {
      action: tokenOut !== tokenIn ? "swap" : "bridge",
      tokenIn: effTokenIn,
      tokenOut:
        tokenOut !== tokenIn && !(tokenIn === "AP3X" && tokenOut === "AP3X") ? tokenOut : null,
      amount: amountOk ? amount : null,
      amountSide: "in",
      fromChain,
      toChain,
      // EVM destinations default to the connected EVM wallet; non-EVM dests
      // (prime/vector/cardano) require an explicit address.
      recipient:
        recipient.trim() ||
        (CHAINS[toChain].family === "evm" && wallet ? wallet : null),
      confidence: 1,
      clarifyingQuestion: null,
    };
  }, [fromChain, tokenIn, tokenOut, amount, amountOk, toChain, recipient, wallet]);

  // base/bsc/nexus sign with the EVM wallet; prime/vector/cardano sign with a
  // CIP-30 Cardano wallet (handled inside the Rail C executor).
  const originIsUtxo = CHAINS[fromChain].family === "utxo";

  // Keep tokenOut coherent when chain/token selections change.
  useEffect(() => {
    setTokenOut(defaultTokenOut(tokenIn, toChain, availability));
  }, [tokenIn, toChain, availability]);
  useEffect(() => {
    if (!fromTokens.includes(tokenIn) || !avail(availability, fromChain, tokenIn)) {
      setTokenIn(fromTokens.find((t) => avail(availability, fromChain, t)) ?? fromTokens[0]);
    }
    if (!destChains.includes(toChain)) setToChain(destChains[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChain, availability]);

  // AI prompt prefill -> set fields, then auto-quote when complete.
  useEffect(() => {
    if (!prefill) return;
    if (prefill.fromChain && SCOPE_ORIGINS.includes(prefill.fromChain)) setFromChain(prefill.fromChain);
    if (prefill.tokenIn) {
      const t = (prefill.tokenIn === "bAP3X" ? "AP3X" : prefill.tokenIn) as ScopeToken;
      setTokenIn(t);
    }
    if (prefill.amount) setAmount(prefill.amount);
    if (prefill.toChain && SCOPE_CHAINS.includes(prefill.toChain)) setToChain(prefill.toChain);
    if (prefill.tokenOut) {
      const t = (prefill.tokenOut === "bAP3X" ? "AP3X" : prefill.tokenOut) as ScopeToken;
      setTokenOut(t);
    }
    if (prefill.recipient) setRecipient(prefill.recipient);
    setQuote({ k: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  async function getQuote() {
    setQuote({ k: "loading" });
    setTypedAmount("");
    setRecipientAccepted(false);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: buildIntent(), sender: wallet }),
      });
      const data = await res.json();
      if (data.needsRecipient) {
        setQuote({ k: "needRecipient", message: data.message });
        return;
      }
      if (!res.ok) throw new Error(data.error || "Quote failed.");
      setQuote({ k: "ready", rail: data.rail, card: data.card, planA: data.planA ?? null, planC: data.planC ?? null });
    } catch (e) {
      setQuote({ k: "error", message: e instanceof Error ? e.message : "Quote failed." });
    }
  }

  async function confirm() {
    if (quote.k !== "ready") return;
    const { card } = quote;
    if (quote.rail === "A" && quote.planA) {
      if (!wallet) return;
      onExecuteA(card, quote.planA);
      return;
    }
    if (quote.rail === "C" && quote.planC) {
      // Rail C executor connects the right wallet (EVM for Nexus, CIP-30 for
      // prime/vector/cardano) — no EVM wallet required up front for UTXO origins.
      onExecuteC(card, quote.planC, fromChain);
      return;
    }
    if (!wallet) return;
    setExecuting(true);
    try {
      const capNeeded = card.usdIn != null && card.usdIn > SPEND_CAP_USD;
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: buildIntent(),
          sender: wallet,
          confirmedAmount: capNeeded ? typedAmount : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Couldn't prepare the transfer.");
      onExecuteB(data.card, data.plan);
    } catch (e) {
      onBusyError(e instanceof Error ? e.message : "Couldn't prepare the transfer.");
    } finally {
      setExecuting(false);
    }
  }

  // Gates (mirror the server's rules so the CTA is honest).
  const q = quote.k === "ready" ? quote : null;
  const capNeeded = q != null && q.card.usdIn != null && q.card.usdIn > SPEND_CAP_USD;
  const capSatisfied = !capNeeded || typedAmount.trim() === q!.card.amountIn;
  const recipientIsSelf =
    q != null && wallet && q.card.recipient.toLowerCase() === wallet.toLowerCase();
  const recipientNeedsConfirm = q != null && !recipientIsSelf && !isKnownRecipient(q.card.recipient);
  const recipientSatisfied = !recipientNeedsConfirm || recipientAccepted;

  // UTXO origins don't need the EVM wallet to quote/confirm (Cardano wallet is
  // connected inside the executor). EVM origins do.
  const needEvmWallet = !originIsUtxo;
  const ctaLabel =
    needEvmWallet && !wallet
      ? "Connect wallet"
      : quote.k !== "ready"
        ? "Get quote"
        : executing
          ? "Preparing…"
          : q!.rail === "A"
            ? "Confirm & sign"
            : q!.rail === "C"
              ? "Confirm & sign"
              : "Confirm — get deposit address";

  function ctaClick() {
    if (needEvmWallet && !wallet) return;
    if (quote.k !== "ready") void getQuote();
    else void confirm();
  }

  return (
    <div className="xfer-card">
      {/* FROM */}
      <div className="xfer-box">
        <div className="boxhead">
          <span className="eyebrow">From</span>
          <span className="eyebrow">{CHAINS[fromChain].label}</span>
        </div>
        <div className="xfer-row">
          <select
            className="sel"
            value={fromChain}
            onChange={(e) => { setFromChain(e.target.value as ChainKey); setQuote({ k: "idle" }); }}
            aria-label="Source chain"
          >
            {SCOPE_ORIGINS.map((c) => (
              <option key={c} value={c}>{CHAINS[c].label}</option>
            ))}
          </select>
          <select
            className="sel tok"
            value={tokenIn}
            onChange={(e) => { setTokenIn(e.target.value as ScopeToken); setQuote({ k: "idle" }); }}
            aria-label="Token to send"
          >
            {fromTokens.map((t) => {
              const ok = avail(availability, fromChain, t);
              return (
                <option key={t} value={t} disabled={!ok}>
                  {tokenLabel(fromChain, t)}{ok ? "" : " · soon"}
                </option>
              );
            })}
          </select>
          <input
            className="amt"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => { setAmount(e.target.value.replace(/,/g, "")); setQuote({ k: "idle" }); }}
            aria-label="Amount"
          />
        </div>
      </div>

      <div className="xfer-divider"><span className="down">↓</span></div>

      {/* TO */}
      <div className="xfer-box">
        <div className="boxhead">
          <span className="eyebrow">To</span>
          <span className="eyebrow">{CHAINS[toChain].label}</span>
        </div>
        <div className="xfer-row">
          <select
            className="sel"
            value={toChain}
            onChange={(e) => { setToChain(e.target.value as ChainKey); setQuote({ k: "idle" }); }}
            aria-label="Destination chain"
          >
            {destChains.map((c) => (
              <option key={c} value={c}>{CHAINS[c].label}</option>
            ))}
          </select>
          <select
            className="sel tok"
            value={tokenOut}
            onChange={(e) => { setTokenOut(e.target.value as ScopeToken); setQuote({ k: "idle" }); }}
            aria-label="Token to receive"
          >
            {destTokens.map((t) => {
              const ok = avail(availability, toChain, t);
              return (
                <option key={t} value={t} disabled={!ok}>
                  {tokenLabel(toChain, t)}{ok ? "" : " · soon"}
                </option>
              );
            })}
          </select>
          <div className="est-line" style={{ flex: 1, justifyContent: "flex-end" }}>
            <span className={`amount ${q ? "" : "dim"}`}>
              {q ? q.card.estOut : "0.0"}
            </span>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <input
            className={`rcpt ${destNonEvm && !recipient.trim() ? "required" : ""}`}
            placeholder={
              destNonEvm
                ? `${CHAINS[toChain].label} address (required)`
                : "Recipient (blank = your wallet)"
            }
            value={recipient}
            onChange={(e) => { setRecipient(e.target.value); setQuote({ k: "idle" }); }}
            aria-label="Recipient"
          />
        </div>
      </div>

      {/* Quote details */}
      {quote.k === "loading" && (
        <div className="quote-rows">
          <div className="skeleton" style={{ width: "70%" }} />
          <div className="skeleton" style={{ width: "45%" }} />
        </div>
      )}
      {quote.k === "needRecipient" && <div className="prompt-hint">{quote.message}</div>}
      {quote.k === "error" && <div className="err">⛔ {quote.message}</div>}
      {q && (
        <div className="quote-rows">
          <div className="qrow">
            <span className="k">Route</span>
            <span className="v"><span className={`rail-tag ${q.rail}`}>{q.card.railLabel}</span></span>
          </div>
          <div className="qrow">
            <span className="k">Est. received</span>
            <span className="v good">{q.card.estOut} {q.card.tokenOut}</span>
          </div>
          <div className="qrow">
            <span className="k">Min received</span>
            <span className="v">{q.card.minOut} {q.card.tokenOut}</span>
          </div>
          {q.card.fees.map((f) => (
            <div className="qrow" key={f.label}>
              <span className="k">{f.label}</span>
              <span className="v">{f.value}</span>
            </div>
          ))}
          <div className="qrow">
            <span className="k">ETA</span>
            <span className="v">{eta(q.card.etaSeconds)}</span>
          </div>
          <div className="qrow">
            <span className="k">Recipient</span>
            <span className="v">{q.card.recipient}{recipientIsSelf ? " (you)" : ""}</span>
          </div>
          {q.card.usdIn != null && (
            <div className="qrow">
              <span className="k">Value</span>
              <span className="v">≈ ${q.card.usdIn.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* Safety gates */}
      {q && capNeeded && (
        <div className="gate">
          ≈ ${q.card.usdIn!.toFixed(0)} is above the ${SPEND_CAP_USD} safety cap. Retype the
          amount (<span className="mono">{q.card.amountIn}</span>) to unlock:
          <input
            type="text"
            placeholder={q.card.amountIn}
            value={typedAmount}
            onChange={(e) => setTypedAmount(e.target.value.trim())}
          />
        </div>
      )}
      {q && recipientNeedsConfirm && (
        <div className="gate">
          First time sending to this recipient — check every character:
          <div className="addr">{q.card.recipient}</div>
          <label>
            <input
              type="checkbox"
              checked={recipientAccepted}
              onChange={(e) => setRecipientAccepted(e.target.checked)}
            />
            <span>This address is correct</span>
          </label>
        </div>
      )}

      <div className="xfer-cta">
        <button
          className="btn cta"
          disabled={
            (needEvmWallet && !wallet) ||
            !amountOk ||
            !avail(availability, fromChain, tokenIn) ||
            !avail(availability, toChain, tokenOut) ||
            (destNonEvm && !recipient.trim()) ||
            quote.k === "loading" ||
            executing ||
            (q != null && (!capSatisfied || !recipientSatisfied))
          }
          onClick={ctaClick}
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}
