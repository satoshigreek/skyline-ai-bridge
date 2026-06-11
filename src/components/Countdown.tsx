"use client";

import { useEffect, useState } from "react";

// Live deadline countdown for Rail B deposit addresses. Calls onExpire once.
export function Countdown({
  deadline,
  onExpire,
}: {
  deadline: string;
  onExpire?: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(deadline).getTime() - Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(deadline).getTime() - Date.now();
      setRemainingMs(ms);
      if (ms <= 0) {
        clearInterval(t);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [deadline, onExpire]);

  if (remainingMs <= 0) return <span className="countdown urgent">expired</span>;
  const totalSec = Math.floor(remainingMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return (
    <span className={`countdown${totalSec < 60 ? " urgent" : ""}`}>
      {mm}:{ss}
    </span>
  );
}
