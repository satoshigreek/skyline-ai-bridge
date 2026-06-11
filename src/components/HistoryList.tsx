"use client";

import { useEffect, useState } from "react";
import { listHistory, pendingEntries, upsertHistory, type HistoryEntry } from "@/lib/history";

// Transfer history (localStorage, per wallet). On mount, resumes status
// polling for any non-terminal Rail B entries so a page reload never loses
// track of an in-flight swap.

export function HistoryList({ wallet }: { wallet: string | undefined }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setEntries(listHistory(wallet));
  }, [wallet]);

  // Resume polling pending entries.
  useEffect(() => {
    if (!wallet) return;
    const pending = pendingEntries(wallet);
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      for (const entry of pendingEntries(wallet)) {
        try {
          const res = await fetch(
            `/api/status?depositAddress=${encodeURIComponent(entry.depositAddress!)}`,
          );
          const data = (await res.json()) as { status?: HistoryEntry["state"] };
          if (data.status && data.status !== entry.state) {
            upsertHistory({ ...entry, state: data.status });
            setEntries(listHistory(wallet));
          }
        } catch {
          // transient
        }
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [wallet]);

  if (!wallet || entries.length === 0) return null;

  return (
    <div className="card">
      <h2>Your transfers</h2>
      {entries.slice(0, 8).map((e) => (
        <div key={e.id} className="history-item">
          <span>
            {e.card.amountIn} {e.card.tokenIn} → {e.card.toChain}
            {e.txHash && !e.txHash.startsWith("0xMOCK") && (
              <>
                {" "}
                <a
                  className="link"
                  href={
                    e.card.rail === "A"
                      ? `https://layerzeroscan.com/tx/${e.txHash}`
                      : `https://basescan.org/tx/${e.txHash}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  tx
                </a>
              </>
            )}
          </span>
          <span className={`history-state ${e.state}`}>{e.state}</span>
        </div>
      ))}
    </div>
  );
}
