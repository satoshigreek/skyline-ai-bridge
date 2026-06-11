"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSendTransaction, useWriteContract, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { ERC20_ABI } from "@/lib/oft";
import type { CardModel, RailBTransferPlan } from "@/lib/build";
import { newId, rememberRecipient, upsertHistory, type HistoryEntry } from "@/lib/history";
import { Countdown } from "./Countdown";

// Rail B executor — the user signs ONE plain transfer to the 1-Click deposit
// address (ERC-20 transfer or native send), then we notify 1-Click and poll
// status until a terminal state. Deposit addresses expire: countdown + block.

type TerminalState = "SUCCESS" | "REFUNDED" | "FAILED" | "INCOMPLETE_DEPOSIT";
const TERMINAL: string[] = ["SUCCESS", "REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"];

const STATE_EXPLAIN: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for your transfer to land on Base…",
  KNOWN_DEPOSIT_TX: "Transfer seen — waiting for confirmation…",
  PROCESSING: "Solvers are executing your swap…",
  SUCCESS: "Done — funds delivered to the recipient.",
  INCOMPLETE_DEPOSIT: "The deposit was less than quoted — it will be refunded to your wallet on Base.",
  REFUNDED: "Refunded to your wallet on Base — nothing was lost, the swap just didn't fill.",
  FAILED: "The swap failed. If your transfer landed, a refund to your Base wallet is in progress.",
};

export function RailBExecutor({
  plan,
  card,
  wallet,
  onTerminal,
}: {
  plan: RailBTransferPlan;
  card: CardModel;
  wallet: Address;
  onTerminal: (state: TerminalState) => void;
}) {
  const [phase, setPhase] = useState<"ready" | "signing" | "tracking" | "expired">("ready");
  const [chainState, setChainState] = useState<string>("PENDING_DEPOSIT");
  const [txHash, setTxHash] = useState<string>("");
  const [error, setError] = useState<string>("");
  const entryIdRef = useRef(newId());
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const persist = useCallback(
    (state: HistoryEntry["state"], extra?: Partial<HistoryEntry>) => {
      upsertHistory({
        id: entryIdRef.current,
        wallet,
        createdAt: Date.now(),
        card,
        state,
        depositAddress: plan.depositAddress,
        deadline: plan.deadline,
        ...extra,
      });
    },
    [wallet, card, plan],
  );

  async function sign() {
    setPhase("signing");
    setError("");
    rememberRecipient(card.recipient);
    persist("signing");
    try {
      let hash: `0x${string}`;
      if (plan.transfer.tokenAddress) {
        hash = await writeContractAsync({
          address: plan.transfer.tokenAddress,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [plan.depositAddress as Address, BigInt(plan.transfer.amountSmallest)],
        });
      } else {
        hash = await sendTransactionAsync({
          to: plan.depositAddress as Address,
          value: BigInt(plan.transfer.amountSmallest),
        });
      }
      setTxHash(hash);
      persist("submitted", { txHash: hash });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      // Best-effort heads-up to 1-Click; solvers also watch the chain.
      fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: hash, depositAddress: plan.depositAddress }),
      }).catch(() => {});
      setPhase("tracking");
    } catch (e) {
      setPhase("ready");
      setError(
        e instanceof Error
          ? `${e.message.slice(0, 180)} — your ${plan.transfer.symbol} never left your wallet.`
          : "Signature rejected — your funds never left your wallet.",
      );
    }
  }

  // Poll status while tracking.
  useEffect(() => {
    if (phase !== "tracking") return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/status?depositAddress=${encodeURIComponent(plan.depositAddress)}`,
        );
        const data = (await res.json()) as { status?: string };
        if (!stopped && data.status) {
          setChainState(data.status);
          persist(data.status as HistoryEntry["state"], { txHash });
          if (TERMINAL.includes(data.status)) {
            stopped = true;
            onTerminal(data.status as TerminalState);
          }
        }
      } catch {
        // transient — keep polling
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [phase, plan.depositAddress, txHash, persist, onTerminal]);

  const terminal = TERMINAL.includes(chainState);

  return (
    <div className="card">
      <h2>Execute — {card.railLabel}</h2>

      {phase === "ready" || phase === "signing" ? (
        <>
          <p className="summary-line">
            Sign one transfer of <b>{card.amountIn} {plan.transfer.symbol}</b> to the deposit
            address below. Solvers handle everything after that; failures refund automatically.
          </p>
          <div className="deposit-box">{plan.depositAddress}</div>
          {plan.deadline && (
            <div className="status-line">
              <span className="dot pending" />
              Quote expires in <Countdown deadline={plan.deadline} onExpire={() => setPhase("expired")} />
              &nbsp;— don&apos;t send after expiry.
            </div>
          )}
          <div className="actions">
            <button className="btn" onClick={sign} disabled={phase === "signing"}>
              {phase === "signing" ? "Check your wallet…" : `Sign transfer (${card.amountIn} ${plan.transfer.symbol})`}
            </button>
          </div>
          {error && <div className="err">⛔ {error}</div>}
        </>
      ) : phase === "expired" ? (
        <div className="err">
          ⛔ This quote expired before you signed — nothing was sent. Get a fresh quote to
          continue; never reuse an old deposit address.
        </div>
      ) : (
        <>
          <div className="status-line">
            <span className={`dot ${chainState === "SUCCESS" ? "done" : terminal ? "bad" : "pending"}`} />
            <b>{chainState}</b>
          </div>
          <p className="notes">{STATE_EXPLAIN[chainState] ?? "Working…"}</p>
          {txHash && (
            <p className="notes">
              Your Base transfer:{" "}
              <a className="link" href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noreferrer">
                {txHash.slice(0, 10)}…{txHash.slice(-8)}
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
