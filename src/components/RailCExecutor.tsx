"use client";

import { useEffect, useRef, useState } from "react";
import { useSendTransaction, useSwitchChain, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { APEX_EXPLORERS, CHAINS, type ChainKey } from "@/lib/chains";
import type { CardModel, RailCPlan, RailCCardanoPlan, RailCEvmPlan } from "@/lib/build";
import { newId, rememberRecipient, upsertHistory, type HistoryEntry } from "@/lib/history";
import {
  enableCardano,
  getBech32ChangeAddress,
  listCardanoWallets,
  signAssembleSubmit,
  type CipWalletInfo,
} from "@/lib/cardano";

// Rail C executor — Apex Fusion internal (Skyline native bridge).
// Nexus (EVM) origin: sign approval+bridge txs with the EVM wallet on chain 9069.
// Prime/Vector/Cardano (UTXO) origin: build txRaw server-side, sign via CIP-30.

const STATUS_EXPLAIN: Record<string, string> = {
  Pending: "Submitted — waiting for the validators to discover it…",
  DiscoveredOnSource: "Seen on the source chain…",
  SubmittedToBridge: "Accepted by the bridge validators…",
  IncludedInBatch: "Batched for the destination chain…",
  SubmittedToDestination: "Submitting on the destination chain…",
  ExecutedOnDestination: "Done — funds delivered on the destination chain.",
  InvalidRequest: "The bridge rejected the request. If funds left, a refund follows.",
  FailedToExecuteOnDestination: "Failed on destination — a refund to your source wallet follows.",
};
const TERMINAL = ["ExecutedOnDestination", "InvalidRequest", "FailedToExecuteOnDestination"];

export function RailCExecutor({
  plan,
  card,
  originChainKey,
  evmWallet,
  onTerminal,
}: {
  plan: RailCPlan;
  card: CardModel;
  originChainKey: ChainKey;
  evmWallet: Address | undefined; // present when origin is Nexus
  onTerminal: (ok: boolean) => void;
}) {
  const [phase, setPhase] = useState<"ready" | "signing" | "tracking" | "done">("ready");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [srcTxHash, setSrcTxHash] = useState("");
  const [bridgeId, setBridgeId] = useState<number | null>(null);
  const [chainState, setChainState] = useState("");
  const [cipWallets, setCipWallets] = useState<CipWalletInfo[]>([]);
  const histId = useRef(newId());

  const { sendTransactionAsync } = useSendTransaction();
  const sendTx = sendTransactionAsync as (args: {
    chainId: number;
    to: Address;
    data?: `0x${string}`;
    value?: bigint;
  }) => Promise<`0x${string}`>;
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: 9069 });

  const isEvm = plan.kind === "railC-evm";

  useEffect(() => {
    if (!isEvm) setCipWallets(listCardanoWallets());
  }, [isEvm]);

  function persist(state: HistoryEntry["state"], extra?: Partial<HistoryEntry>) {
    upsertHistory({
      id: histId.current,
      wallet: (evmWallet || plan.senderAddress || "apex").toLowerCase(),
      createdAt: Date.now(),
      card,
      state,
      ...extra,
    });
  }

  async function registerAndTrack(originTxHash: string, txRaw: string) {
    setSrcTxHash(originTxHash);
    persist("submitted", { txHash: originTxHash });
    try {
      const res = await fetch("/api/apex/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originChain: plan.originChain,
          destinationChain: plan.destinationChain,
          originTxHash,
          senderAddress: plan.senderAddress,
          receiverAddrs: [plan.destinationAddress],
          amount: plan.amountSmallest,
          nativeTokenAmount: "0",
          tokenID: plan.tokenID,
          txRaw,
          isFallback: false,
        }),
      });
      const data = await res.json();
      if (res.ok && typeof data.id === "number") setBridgeId(data.id);
    } catch {
      /* validators also watch the source chain directly */
    }
    setPhase("tracking");
  }

  // ---- Nexus EVM origin ----
  async function runEvm() {
    const p = plan as RailCEvmPlan;
    if (!evmWallet) {
      setErr("Connect your Nexus (EVM) wallet first.");
      return;
    }
    setErr("");
    setPhase("signing");
    rememberRecipient(p.destinationAddress);
    persist("signing");
    try {
      await switchChainAsync({ chainId: 9069 });
      if (p.approvalTx) {
        setMsg("Approve the token in your wallet…");
        const ah = await sendTx({
          chainId: 9069,
          to: p.approvalTx.to as Address,
          data: p.approvalTx.data as `0x${string}`,
          value: p.approvalTx.value ? BigInt(p.approvalTx.value) : 0n,
        });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: ah });
      }
      setMsg("Confirm the bridge transaction in your wallet…");
      const hash = await sendTx({
        chainId: 9069,
        to: p.bridgingTx.to as Address,
        data: p.bridgingTx.data as `0x${string}`,
        value: p.bridgingTx.value ? BigInt(p.bridgingTx.value) : 0n,
      });
      await registerAndTrack(hash, p.bridgingTx.data);
    } catch (e) {
      setPhase("ready");
      setErr(errMsg(e, "AP3X"));
    }
  }

  // ---- UTXO origin (prime/vector/cardano) ----
  async function runCardano(walletKey: string) {
    const p = plan as RailCCardanoPlan;
    setErr("");
    setPhase("signing");
    rememberRecipient(p.destinationAddress);
    persist("signing");
    try {
      setMsg("Connecting your Cardano wallet…");
      const api = await enableCardano(walletKey);
      // Use the wallet's own change address as the real sender for UTXO selection.
      const sender = await getBech32ChangeAddress(api);
      setMsg("Building the bridge transaction…");
      const res = await fetch("/api/apex/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: { ...p, senderAddress: sender } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "create failed");
      const { txRaw, txHash } = data.tx as { txRaw: string; txHash: string };
      setMsg("Sign the transaction in your wallet…");
      const submittedHash = await signAssembleSubmit(api, txRaw).catch(() => txHash);
      await registerAndTrack(submittedHash || txHash, txRaw);
    } catch (e) {
      setPhase("ready");
      setErr(errMsg(e, card.tokenIn));
    }
  }

  // ---- status polling ----
  useEffect(() => {
    if (phase !== "tracking" || bridgeId == null) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/apex/status?id=${bridgeId}`);
        const d = (await r.json()) as { status?: string; isRefund?: boolean };
        if (stop || !d.status) return;
        setChainState(d.status);
        persist(d.status as HistoryEntry["state"], { txHash: srcTxHash });
        if (TERMINAL.includes(d.status)) {
          stop = true;
          setPhase("done");
          onTerminal(d.status === "ExecutedOnDestination");
        }
      } catch {
        /* transient */
      }
    };
    tick();
    const t = setInterval(tick, 6000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [phase, bridgeId, srcTxHash]);

  const explorer = APEX_EXPLORERS[originChainKey];

  return (
    <div className="panel">
      <h2>Execute — {card.railLabel}</h2>
      <p className="summary-line">
        Bridge <b>{card.amountIn} {card.tokenIn}</b> on {card.fromChain} → <b>≥ {card.minOut} {card.tokenOut}</b> on{" "}
        {card.toChain}. Validators relay it; failures refund to your source wallet.
      </p>

      {phase === "ready" && (
        <>
          {isEvm ? (
            <div className="actions">
              <button className="btn" onClick={runEvm}>Sign on Nexus</button>
            </div>
          ) : cipWallets.length > 0 ? (
            <>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Choose your Cardano wallet</div>
              <div className="actions" style={{ flexWrap: "wrap" }}>
                {cipWallets.map((w) => (
                  <button key={w.key} className="btn secondary" onClick={() => runCardano(w.key)}>
                    {w.icon ? <img src={w.icon} alt="" style={{ width: 16, height: 16, marginRight: 6, verticalAlign: "middle" }} /> : null}
                    {w.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="err">
              No Cardano wallet found. Install Eternl, Lace, or Vespr (they sign Prime &amp; Vector too),
              then reopen.
            </div>
          )}
          {err && <div className="err">⛔ {err}</div>}
        </>
      )}

      {phase === "signing" && (
        <div className="status-line"><span className="dot pending" /> {msg || "Working…"}</div>
      )}

      {(phase === "tracking" || phase === "done") && (
        <>
          <div className="status-line">
            <span className={`dot ${chainState === "ExecutedOnDestination" ? "done" : TERMINAL.includes(chainState) ? "bad" : "pending"}`} />
            <b>{chainState || "Submitted"}</b>
          </div>
          <p className="notes">
            {STATUS_EXPLAIN[chainState] ||
              (bridgeId == null
                ? "Submitted on the source chain — the Skyline validators watch it directly and relay to the destination (usually minutes)."
                : "Tracking…")}
            {srcTxHash && explorer && (
              <>
                {" "}
                · <a className="link" href={`${explorer}/tx/${srcTxHash}`} target="_blank" rel="noreferrer">source tx</a>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function errMsg(e: unknown, token: string): string {
  const m = e instanceof Error ? e.message : String(e);
  return `${m.slice(0, 180)} — your ${token} never left your wallet.`;
}
