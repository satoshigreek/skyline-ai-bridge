"use client";

import { useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { ERC20_ABI, OFT_ABI } from "@/lib/oft";
import type { SerializedRailAPlan } from "@/lib/oft";
import type { CardModel } from "@/lib/build";
import { newId, rememberRecipient, upsertHistory, type HistoryEntry } from "@/lib/history";

// Rail A executor — approve (when the token rides an OFT Adapter) then send,
// entirely in the user's wallet. Mock mode simulates both steps visibly.

type Step = "idle" | "approving" | "sending" | "done" | "error";

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
  const publicClient = usePublicClient();

  async function run() {
    rememberRecipient(card.recipient);
    const entryId = newId();
    const baseEntry: HistoryEntry = {
      id: entryId,
      wallet,
      createdAt: Date.now(),
      card,
      state: "signing",
    };
    upsertHistory(baseEntry);

    try {
      if (plan.mocked) {
        if (plan.approval) {
          setStep("approving");
          await new Promise((r) => setTimeout(r, 1100));
        }
        setStep("sending");
        await new Promise((r) => setTimeout(r, 1400));
        setTxHash("0xMOCK_SIMULATED_NO_FUNDS_MOVED");
        upsertHistory({ ...baseEntry, state: "MOCKED", txHash: "0xMOCK" });
        setStep("done");
        onDone();
        return;
      }

      const sendParam = {
        dstEid: plan.sendParam.dstEid,
        to: plan.sendParam.to as `0x${string}`,
        amountLD: BigInt(plan.sendParam.amountLD),
        minAmountLD: BigInt(plan.sendParam.minAmountLD),
        extraOptions: plan.sendParam.extraOptions as `0x${string}`,
        composeMsg: plan.sendParam.composeMsg as `0x${string}`,
        oftCmd: plan.sendParam.oftCmd as `0x${string}`,
      };

      if (plan.approval) {
        setStep("approving");
        const approveHash = await writeContractAsync({
          address: plan.approval.token as Address,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [plan.approval.spender as Address, BigInt(plan.approval.amountLD)],
        });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      setStep("sending");
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
      {plan.approval && (
        <div className="status-line">
          <span className={`dot ${step === "approving" ? "pending" : step === "idle" ? "idle" : "done"}`} />
          Step 1 — approve {card.tokenIn} spend{plan.mocked ? " (simulated)" : ""}
        </div>
      )}
      <div className="status-line">
        <span className={`dot ${step === "sending" ? "pending" : step === "done" ? "done" : "idle"}`} />
        Step {plan.approval ? 2 : 1} — bridge {card.amountIn} {card.tokenIn} to {card.toChain}
        {plan.mocked ? " (simulated)" : ""}
      </div>

      {step === "done" && (
        <>
          <div className="status-line">
            <span className="dot done" /> {plan.mocked ? "Simulation complete." : "Submitted."}
          </div>
          {txHash && !plan.mocked && (
            <p className="notes">
              Track delivery on{" "}
              <a className="link" href={`https://layerzeroscan.com/tx/${txHash}`} target="_blank" rel="noreferrer">
                LayerZero Scan
              </a>
              .
            </p>
          )}
          {plan.mocked && <div className="deposit-box">{txHash}</div>}
        </>
      )}

      {step === "idle" && (
        <div className="actions">
          <button className="btn" onClick={run}>
            {plan.mocked ? "Run simulation" : "Open wallet to sign"}
          </button>
        </div>
      )}
    </div>
  );
}
