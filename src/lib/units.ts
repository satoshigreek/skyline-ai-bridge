// Exact decimal <-> smallest-unit conversions using BigInt string math.
// Never goes through Number — NEAR has 24 decimals and floats would corrupt it.

export function toSmallestUnits(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error(`Invalid decimal amount: "${amount}"`);
  }
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) {
    // Truncate excess precision rather than reverting — the review card shows
    // the truncated value, so what the user approves is what executes.
    return BigInt(whole + frac.slice(0, decimals).padEnd(decimals, "0"));
  }
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

export function fromSmallestUnits(
  value: bigint | string,
  decimals: number,
  maxFractionDigits = 6,
): string {
  const v = typeof value === "bigint" ? value : BigInt(value);
  const negative = v < 0n;
  const abs = (negative ? -v : v).toString().padStart(decimals + 1, "0");
  const whole = abs.slice(0, abs.length - decimals) || "0";
  let frac = decimals > 0 ? abs.slice(abs.length - decimals) : "";
  frac = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

// Reduce an amount by `bps` basis points (e.g. 100 bps = 1% slippage floor).
export function applySlippage(amount: bigint, bps: number): bigint {
  return amount - (amount * BigInt(bps)) / 10_000n;
}

// Best-effort USD estimate; null when price is unknown (caller must handle).
export function estimateUsd(amount: string, price: number | null | undefined): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return n * price;
}
