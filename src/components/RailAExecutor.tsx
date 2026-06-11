"use client";

import { useState } from "react";
import { useWriteContract } from "wagmi";
import type { Address } from "viem";
import { OFT_ABI } from "@/lib/oft";
import type { SerializedRailAPlan } from "@/lib/oft";
import type { CardModel } from "@/lib/build";
import { newId, rememberRecipient, upsertHistory, type HistoryEntry } from "@/lib/history";

// Rail A executor — one wallet signature calling send() on the live bAP3X
// LayerZero OFT. The SendParam is reconstructed verbatim from the quoted plan.

type Step = "idle" | "sending" | "done" | "error";

export function RailAExecutor({
  plan,
  card,
  wallet,
  onDone,
  onError,
}: {
  plan: SerializedRailAPlan;
  card: CardModel;
  wallet: Address;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [txHash, setTxHash] = useState<string>("");
  const { writeContractAsync } = useWriteContract();

  async function run() {
    rememberRecipient(card.recipient);
    const baseEntry: HistoryEntry = {
      id: newId(),
      wallet,
      createdAt: Date.now(),
      card,
      state: "signing",
    };
    upsertHistory(baseEntry);
    setStep("sending");

    try {
      const sendParam = {
        dstEid: plan.sendParam.dstEid,
        to: plan.sendParam.to as `0x${string}`,
        amountLD: BigInt(plan.sendParam.amountLD),
        minAmountLD: BigInt(plan.sendParam.minAmountLD),
        extraOptions: plan.sendParam.extraOptions as `0x${string}`,
        composeMsg: plan.sendParam.composeMsg as `0x${string}`,
        oftCmd: plan.sendParam.oftCmd as `0x${string}`,
      };
      const hash = await writeContractAsync({
        address: plan.oftAddress as Address,
        abi: OFT_ABI,
        functionName: "send",
        args: [sendParam, { nativeFee: BigInt(plan.nativeFeeWei), lzTokenFee: 0n }, wallet],
        value: BigInt(plan.nativeFeeWei),
      });
      setTxHash(hash);
      upsertHistory({ ...baseEntry, state: "submitted", txHash: hash });
      setStep("done");
      onDone();
    } catch (e) {
      setStep("error");
      upsertHistory({ ...baseEntry, state: "FAILED" });
      onError(
        e instanceof Error
          ? `${e.message.slice(0, 200)} — your ${card.tokenIn} never left your wallet.`
          : "Transaction rejected — your funds never left your wallet.",
      );
    }
  }

  return (
    <div className="card">
      <h2>Sign &amp; bridge — {card.railLabel}</h2>
      <div className="status-line">
        <span className={`dot ${step === "sending" ? "pending" : step === "done" ? "done" : "idle"}`} />
        Bridge {card.amountIn} {card.tokenIn} to {card.toChain}
      </div>

      {step === "done" && (
        <>
          <div className="status-line">
            <span className="dot done" /> Submitted.
          </div>
          {txHash && (
            <p className="notes">
              Track delivery on{" "}
              <a className="link" href={`https://layerzeroscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">
                LayerZero Scan
              </a>
              .
            </p>
          )}
        </>
      )}

      {step === "idle" && (
        <div className="actions">
          <button className="btn" onClick={run}>
            Open wallet to sign
          </button>
        </div>
      )}
      {step === "sending" && (
        <div className="status-line">
          <span className="dot pending" /> Check your wallet…
        </div>
      )}
    </div>
  );
}
