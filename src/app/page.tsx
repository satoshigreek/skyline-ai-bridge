"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import type { CardModel, RailBTransferPlan, RailCPlan } from "@/lib/build";
import type { SerializedRailAPlan } from "@/lib/oft";
import type { ChainKey } from "@/lib/chains";
import { TransferCard, type Prefill } from "@/components/TransferCard";
import { RailAExecutor } from "@/components/RailAExecutor";
import { RailBExecutor } from "@/components/RailBExecutor";
import { RailCExecutor } from "@/components/RailCExecutor";
import { HistoryList } from "@/components/HistoryList";

type Stage =
  | { k: "card" }
  | { k: "executeA"; card: CardModel; planA: SerializedRailAPlan }
  | { k: "executeB"; card: CardModel; planB: RailBTransferPlan }
  | { k: "executeC"; card: CardModel; planC: RailCPlan; originChain: ChainKey }
  | { k: "doneB"; state: string; card: CardModel }
  | { k: "doneC"; ok: boolean; card: CardModel };

const EXAMPLE = "e.g. bridge 25 AP3X to Apex Fusion · swap 50 USDC for ADA";

export default function Home() {
  const { address } = useAccount();
  const [prompt, setPrompt] = useState("");
  const [parsing, setParsing] = useState(false);
  const [hint, setHint] = useState("");
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [stage, setStage] = useState<Stage>({ k: "card" });
  const [error, setError] = useState("");

  async function parsePrompt() {
    if (!prompt.trim()) return;
    setParsing(true);
    setHint("");
    setError("");
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that.");
      const i = data.intent;
      if (i.clarifyingQuestion) setHint(i.clarifyingQuestion);
      setPrefill({
        fromChain: i.fromChain ?? undefined,
        toChain: i.toChain ?? undefined,
        tokenIn: i.tokenIn ?? undefined,
        tokenOut: i.tokenOut ?? undefined,
        amount: i.amount ?? undefined,
        recipient: i.recipient ?? undefined,
      });
      setStage({ k: "card" });
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Couldn't read that.");
    } finally {
      setParsing(false);
    }
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <div className="brand-mark">
            Skyline <span>AI Bridge</span>
          </div>
          <div className="brand-status">LayerZero · NEAR Intents · Skyline · Live</div>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" />
      </div>

      <div className="prompt-bar">
        <span className="eyebrow">Or just say it</span>
        <div className="prompt-row">
          <input
            className="prompt"
            placeholder={EXAMPLE}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && prompt.trim()) void parsePrompt();
            }}
          />
          <button className="btn" disabled={parsing || !prompt.trim()} onClick={parsePrompt}>
            {parsing ? "Reading…" : "Fill"}
          </button>
        </div>
        {hint && <div className="prompt-hint">{hint}</div>}
      </div>

      <TransferCard
        wallet={address as Address | undefined}
        prefill={prefill}
        onExecuteA={(card, planA) => { setError(""); setStage({ k: "executeA", card, planA }); }}
        onExecuteB={(card, planB) => { setError(""); setStage({ k: "executeB", card, planB }); }}
        onExecuteC={(card, planC, originChain) => { setError(""); setStage({ k: "executeC", card, planC, originChain }); }}
        onBusyError={(msg) => setError(msg)}
      />

      {error && (
        <div className="panel">
          <div className="err">⛔ {error}</div>
        </div>
      )}

      {stage.k === "executeA" && address && (
        <RailAExecutor
          plan={stage.planA}
          card={stage.card}
          wallet={address as Address}
          onDone={() => {}}
          onError={(message) => { setError(message); setStage({ k: "card" }); }}
        />
      )}

      {stage.k === "executeB" && address && (
        <RailBExecutor
          plan={stage.planB}
          card={stage.card}
          wallet={address as Address}
          onTerminal={(state) => setStage({ k: "doneB", state, card: stage.card })}
        />
      )}

      {stage.k === "executeC" && (
        <RailCExecutor
          plan={stage.planC}
          card={stage.card}
          originChainKey={stage.originChain}
          evmWallet={address as Address | undefined}
          onTerminal={(ok) => setStage({ k: "doneC", ok, card: stage.card })}
        />
      )}

      {stage.k === "doneB" && (
        <div className="panel">
          <h2>Result</h2>
          <div className="status-line">
            <span className={`dot ${stage.state === "SUCCESS" ? "done" : "bad"}`} />
            <b>{stage.state}</b>
          </div>
          <p className="notes">
            {stage.state === "SUCCESS"
              ? `Delivered: ${stage.card.estOut} ${stage.card.tokenOut} (est.) to ${stage.card.recipient} on ${stage.card.toChain}.`
              : "The swap didn't complete — refunds go automatically to your wallet."}
          </p>
          <div className="actions">
            <button className="btn secondary" onClick={() => setStage({ k: "card" })}>
              New transfer
            </button>
          </div>
        </div>
      )}

      {stage.k === "doneC" && (
        <div className="panel">
          <h2>Result</h2>
          <div className="status-line">
            <span className={`dot ${stage.ok ? "done" : "bad"}`} />
            <b>{stage.ok ? "Delivered" : "Did not complete"}</b>
          </div>
          <p className="notes">
            {stage.ok
              ? `Delivered ${stage.card.minOut} ${stage.card.tokenOut} to ${stage.card.recipient} on ${stage.card.toChain}.`
              : "The transfer didn't complete — refunds go automatically to your source wallet."}
          </p>
          <div className="actions">
            <button className="btn secondary" onClick={() => setStage({ k: "card" })}>New transfer</button>
          </div>
        </div>
      )}

      {(stage.k === "executeA" || stage.k === "executeB" || stage.k === "executeC") && (
        <div className="actions">
          <button className="btn secondary small" onClick={() => setStage({ k: "card" })}>
            Back to transfer
          </button>
        </div>
      )}

      <HistoryList wallet={address} />

      <p className="footnote">
        Base · BNB · Nexus · Prime · Vector · Cardano — LayerZero mesh · NEAR Intents · Skyline internal
        <br />
        The AI only proposes · you sign in your own wallet · failures refund automatically
      </p>
    </div>
  );
}
