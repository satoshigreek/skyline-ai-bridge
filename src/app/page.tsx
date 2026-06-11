"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { railAMocked } from "@/lib/chains";
import type { Intent } from "@/lib/intent";
import type { CardModel, RailBTransferPlan } from "@/lib/build";
import type { SerializedRailAPlan } from "@/lib/oft";
import { ManualForm } from "@/components/ManualForm";
import { ReviewCard } from "@/components/ReviewCard";
import { RailAExecutor } from "@/components/RailAExecutor";
import { RailBExecutor } from "@/components/RailBExecutor";
import { HistoryList } from "@/components/HistoryList";

type Exchange = { question: string; answer: string };

type Stage =
  | { k: "input" }
  | { k: "parsing" }
  | { k: "clarify"; prompt: string; intent: Intent; exchanges: Exchange[] }
  | { k: "quoting" }
  | { k: "needRecipient"; intent: Intent; engine: string | null; message: string }
  | {
      k: "review";
      intent: Intent;
      rail: "A" | "B";
      card: CardModel;
      planA: SerializedRailAPlan | null;
      engine: string | null;
      busy: boolean;
    }
  | { k: "executeA"; card: CardModel; planA: SerializedRailAPlan }
  | { k: "executeB"; card: CardModel; planB: RailBTransferPlan }
  | { k: "doneB"; state: string; card: CardModel }
  | { k: "error"; message: string };

const EXAMPLES = [
  "Move 250 USDC from Base to Apex Fusion",
  "Swap 0.1 ETH on Base for NEAR",
  "Send 50 USDC to alice.near",
  "Bridge 25 AP3X to Apex Fusion",
];

export default function Home() {
  const { address } = useAccount();
  const [mode, setMode] = useState<"prompt" | "manual">("prompt");
  const [prompt, setPrompt] = useState("");
  const [clarifyAnswer, setClarifyAnswer] = useState("");
  const [recipientInput, setRecipientInput] = useState("");
  const [stage, setStage] = useState<Stage>({ k: "input" });

  const reset = () => {
    setStage({ k: "input" });
    setClarifyAnswer("");
    setRecipientInput("");
  };

  async function parsePrompt(text: string, exchanges: Exchange[]) {
    setStage({ k: "parsing" });
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, exchanges }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that.");
      const intent: Intent = data.intent;
      const engine: string = data.engine;
      if (intent.clarifyingQuestion) {
        if (exchanges.length >= 2) {
          setStage({
            k: "error",
            message:
              "I still couldn't pin that down after two questions — try the manual form below, it always works.",
          });
          setMode("manual");
          return;
        }
        setStage({ k: "clarify", prompt: text, intent, exchanges });
        return;
      }
      await quoteIntent(intent, engine);
    } catch (e) {
      setStage({ k: "error", message: e instanceof Error ? e.message : "Parse failed." });
    }
  }

  async function quoteIntent(intent: Intent, engine: string | null) {
    setStage({ k: "quoting" });
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent, sender: address }),
      });
      const data = await res.json();
      if (data.needsRecipient) {
        setStage({ k: "needRecipient", intent, engine, message: data.message });
        return;
      }
      if (!res.ok) throw new Error(data.error || "Quote failed.");
      setStage({
        k: "review",
        intent,
        rail: data.rail,
        card: data.card,
        planA: data.planA ?? null,
        engine,
        busy: false,
      });
    } catch (e) {
      setStage({ k: "error", message: e instanceof Error ? e.message : "Quote failed." });
    }
  }

  async function confirmReview(confirmedAmount?: string) {
    if (stage.k !== "review" || !address) return;
    if (stage.rail === "A" && stage.planA) {
      setStage({ k: "executeA", card: stage.card, planA: stage.planA });
      return;
    }
    // Rail B: the real quote (deposit address) is created only now.
    setStage({ ...stage, busy: true });
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: stage.intent, sender: address, confirmedAmount }),
      });
      const data = await res.json();
      if (res.status === 403 && data.capExceeded) {
        setStage({ ...stage, busy: false });
        setStage({ k: "error", message: data.message });
        return;
      }
      if (!res.ok) throw new Error(data.error || "Couldn't prepare the transfer.");
      setStage({ k: "executeB", card: data.card, planB: data.plan });
    } catch (e) {
      setStage({
        k: "error",
        message: e instanceof Error ? e.message : "Couldn't prepare the transfer.",
      });
    }
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <div className="logo">SB</div>
          <div>
            <h1>Skyline AI Bridge</h1>
            <p>Plain-English bridging on Base — Skyline OFT + NEAR Intents</p>
          </div>
        </div>
        <ConnectButton showBalance={false} chainStatus="icon" />
      </div>

      {railAMocked() && (
        <div className="banner warn">
          <span>⚠️</span>
          <span>
            <b>Apex Fusion route is simulated</b> until Skyline contract addresses are configured.
            All other destinations (NEAR Intents) are live.
          </span>
        </div>
      )}

      <div className="card">
        <h2>What do you want to do?</h2>
        <div className="mode-toggle">
          <button className={mode === "prompt" ? "active" : ""} onClick={() => setMode("prompt")}>
            Plain English
          </button>
          <button className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>
            Manual form
          </button>
        </div>

        {mode === "prompt" ? (
          <>
            <div className="prompt-row">
              <textarea
                className="prompt"
                placeholder="e.g. Move 250 USDC from Base to Apex Fusion"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                    parsePrompt(prompt.trim(), []);
                  }
                }}
              />
              <button
                className="btn"
                disabled={stage.k === "parsing" || stage.k === "quoting" || !prompt.trim()}
                onClick={() => parsePrompt(prompt.trim(), [])}
              >
                {stage.k === "parsing" ? "Reading…" : stage.k === "quoting" ? "Quoting…" : "Go"}
              </button>
            </div>
            <div className="examples">
              {EXAMPLES.map((ex) => (
                <span key={ex} className="chip" onClick={() => setPrompt(ex)}>
                  {ex}
                </span>
              ))}
            </div>
          </>
        ) : (
          <ManualForm onSubmit={(intent) => quoteIntent(intent, null)} />
        )}

        {stage.k === "clarify" && (
          <div className="clarify-thread">
            <div className="bubble user">{stage.prompt}</div>
            {stage.exchanges.map((e, i) => (
              <ClarifyPair key={i} q={e.question} a={e.answer} />
            ))}
            <div className="bubble ai">{stage.intent.clarifyingQuestion}</div>
            <div className="clarify-input">
              <input
                className="field"
                autoFocus
                placeholder="Your answer…"
                value={clarifyAnswer}
                onChange={(e) => setClarifyAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && clarifyAnswer.trim()) {
                    const next = [
                      ...stage.exchanges,
                      { question: stage.intent.clarifyingQuestion!, answer: clarifyAnswer.trim() },
                    ];
                    setClarifyAnswer("");
                    parsePrompt(stage.prompt, next);
                  }
                }}
              />
              <button
                className="btn small"
                disabled={!clarifyAnswer.trim()}
                onClick={() => {
                  const next = [
                    ...stage.exchanges,
                    { question: stage.intent.clarifyingQuestion!, answer: clarifyAnswer.trim() },
                  ];
                  setClarifyAnswer("");
                  parsePrompt(stage.prompt, next);
                }}
              >
                Answer
              </button>
            </div>
          </div>
        )}
      </div>

      {stage.k === "quoting" && (
        <div className="card">
          <h2>Getting your quote</h2>
          <div className="skeleton" style={{ width: "60%" }} />
          <div className="skeleton" style={{ width: "85%" }} />
          <div className="skeleton" style={{ width: "40%" }} />
        </div>
      )}

      {stage.k === "needRecipient" && (
        <div className="card">
          <h2>One more thing</h2>
          <p className="summary-line">{stage.message}</p>
          <div className="clarify-input">
            <input
              className="field"
              autoFocus
              placeholder="Destination address"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
            />
            <button
              className="btn small"
              disabled={!recipientInput.trim()}
              onClick={() =>
                quoteIntent({ ...stage.intent, recipient: recipientInput.trim() }, stage.engine)
              }
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {stage.k === "review" && (
        <ReviewCard
          card={stage.card}
          confidence={stage.engine ? stage.intent.confidence : null}
          engine={stage.engine}
          connectedAddress={address}
          busy={stage.busy}
          onConfirm={confirmReview}
          onDiscard={reset}
        />
      )}

      {stage.k === "executeA" && address && (
        <RailAExecutor
          plan={stage.planA}
          card={stage.card}
          wallet={address as Address}
          onDone={() => {}}
          onError={(message) => setStage({ k: "error", message })}
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

      {stage.k === "doneB" && (
        <div className="card">
          <h2>Result</h2>
          <div className="status-line">
            <span className={`dot ${stage.state === "SUCCESS" ? "done" : "bad"}`} />
            <b>{stage.state}</b>
          </div>
          <p className="notes">
            {stage.state === "SUCCESS"
              ? `Delivered: ${stage.card.estOut} ${stage.card.tokenOut} (est.) to ${stage.card.recipient} on ${stage.card.toChain}.`
              : "The swap didn't complete — refunds go automatically to your wallet on Base."}
          </p>
          <div className="actions">
            <button className="btn secondary" onClick={() => { reset(); setPrompt(""); }}>
              New transfer
            </button>
          </div>
        </div>
      )}

      {stage.k === "error" && (
        <div className="card">
          <div className="err">⛔ {stage.message}</div>
          <div className="actions">
            <button className="btn secondary" onClick={reset}>
              Start over
            </button>
          </div>
        </div>
      )}

      {(stage.k === "executeA" || stage.k === "doneB") && (
        <div className="actions" style={{ marginTop: 0, marginBottom: 18 }}>
          <button className="btn secondary" onClick={() => { reset(); setPrompt(""); }}>
            New transfer
          </button>
        </div>
      )}

      <HistoryList wallet={address} />

      <p className="footnote">
        The AI only <i>proposes</i> — you review one card and sign in your own wallet.
        <br />
        Apex Fusion rides Skyline (LayerZero OFT) · everything else rides NEAR Intents · failures
        refund automatically.
      </p>
    </div>
  );
}

function ClarifyPair({ q, a }: { q: string; a: string }) {
  return (
    <>
      <div className="bubble ai">{q}</div>
      <div className="bubble user">{a}</div>
    </>
  );
}
