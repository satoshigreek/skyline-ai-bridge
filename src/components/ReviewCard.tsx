"use client";

import { useState } from "react";
import { SPEND_CAP_USD } from "@/lib/chains";
import type { CardModel } from "@/lib/build";
import { isKnownRecipient } from "@/lib/history";

// THE review card — the contract between app and user. Renders only CardModel
// data (which is built by the same function that builds the tx plan), plus the
// two safety gates: spend-cap retype and first-time-recipient confirm.

function eta(seconds: number | null): string {
  if (seconds == null) return "a few minutes";
  if (seconds < 90) return `~${seconds}s`;
  return `~${Math.round(seconds / 60)} min`;
}

export function ReviewCard({
  card,
  confidence,
  engine,
  connectedAddress,
  onConfirm,
  onDiscard,
  busy,
}: {
  card: CardModel;
  confidence: number | null;
  engine: string | null;
  connectedAddress: string | undefined;
  onConfirm: (confirmedAmount?: string) => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const [typedAmount, setTypedAmount] = useState("");
  const [recipientAccepted, setRecipientAccepted] = useState(false);

  const capNeeded = card.usdIn != null && card.usdIn > SPEND_CAP_USD;
  const capSatisfied = !capNeeded || typedAmount.trim() === card.amountIn;

  const recipientIsSelf =
    connectedAddress && card.recipient.toLowerCase() === connectedAddress.toLowerCase();
  const recipientNeedsConfirm = !recipientIsSelf && !isKnownRecipient(card.recipient);
  const recipientSatisfied = !recipientNeedsConfirm || recipientAccepted;

  const confCls = confidence == null ? "high" : confidence >= 0.75 ? "high" : confidence >= 0.45 ? "mid" : "low";

  return (
    <div className="card">
      <h2>Review — nothing moves until you sign</h2>

      <div className="route-line">
        <span>{card.fromChain}</span>
        <span className="arrow">→</span>
        <span>{card.toChain}</span>
        <span className={`rail-tag ${card.rail}`}>{card.railLabel}</span>
      </div>

      <p className="summary-line">
        You send <b>{card.amountIn} {card.tokenIn}</b> on {card.fromChain}. You receive{" "}
        <b>≥ {card.minOut} {card.tokenOut}</b> on {card.toChain} in {eta(card.etaSeconds)}
        {card.usdIn != null && <> (≈ ${card.usdIn.toFixed(2)})</>}.
      </p>

      <div className="kv">
        <div className="k">Estimated received</div>
        <div className="v">{card.estOut} {card.tokenOut}</div>
        <div className="k">Minimum received</div>
        <div className="v">{card.minOut} {card.tokenOut}</div>
        {card.fees.map((f) => (
          <FeeRow key={f.label} label={f.label} value={f.value} />
        ))}
        <div className="k">Recipient</div>
        <div className="v mono">{card.recipient}{recipientIsSelf ? " (you)" : ""}</div>
      </div>

      {card.notes.map((n) => (
        <div key={n} className="notes">{n}</div>
      ))}

      {confidence != null && (
        <p style={{ marginTop: 10 }}>
          <span className="confidence">
            parser confidence <b className={confCls}>{Math.round(confidence * 100)}%</b>
            {engine ? <> · engine: {engine}</> : null}
          </span>
        </p>
      )}

      {capNeeded && (
        <div className="notes" style={{ borderLeftColor: "var(--warn)" }}>
          This transfer is ≈ ${card.usdIn!.toFixed(0)} — above the ${SPEND_CAP_USD} safety cap.
          Retype the amount (<span className="mono">{card.amountIn}</span>) to unlock:
          <div style={{ marginTop: 8 }}>
            <input
              className="field"
              placeholder={card.amountIn}
              value={typedAmount}
              onChange={(e) => setTypedAmount(e.target.value.trim())}
            />
          </div>
        </div>
      )}

      {recipientNeedsConfirm && (
        <div className="notes" style={{ borderLeftColor: "var(--warn)" }}>
          First time sending to this recipient. Check every character:
          <div className="deposit-box">{card.recipient}</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={recipientAccepted}
              onChange={(e) => setRecipientAccepted(e.target.checked)}
            />
            <span>This address is correct</span>
          </label>
        </div>
      )}

      <div className="actions">
        <button
          className="btn"
          disabled={busy || !capSatisfied || !recipientSatisfied || !connectedAddress}
          onClick={() => onConfirm(capNeeded ? typedAmount : undefined)}
        >
          {!connectedAddress
            ? "Connect wallet to continue"
            : busy
              ? "Preparing…"
              : card.rail === "A"
                ? "Confirm & sign"
                : "Confirm — get deposit address"}
        </button>
        <button className="btn secondary" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="k">{label}</div>
      <div className="v mono">{value}</div>
    </>
  );
}
