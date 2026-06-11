import { describe, expect, it } from "vitest";
import { routeIntent } from "../src/lib/router";
import type { Intent } from "../src/lib/intent";

function intent(overrides: Partial<Intent>): Intent {
  return {
    action: "bridge",
    tokenIn: "USDC",
    tokenOut: null,
    amount: "100",
    amountSide: "in",
    fromChain: "base",
    toChain: "bsc",
    recipient: null,
    confidence: 1,
    clarifyingQuestion: null,
    ...overrides,
  };
}

describe("deterministic router (scope: Base/BNB/Apex Fusion/Cardano)", () => {
  it("routes AP3X to Apex Fusion over Rail A", () => {
    expect(routeIntent(intent({ toChain: "ap3x", tokenIn: "AP3X" }))).toMatchObject({
      ok: true,
      rail: "A",
    });
    expect(routeIntent(intent({ toChain: "ap3x", tokenIn: "bAP3X" }))).toMatchObject({
      ok: true,
      rail: "A",
    });
  });

  it("rejects USDC to Apex Fusion (no OFT route)", () => {
    const d = routeIntent(intent({ toChain: "ap3x", tokenIn: "USDC" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/AP3X/);
  });

  it("routes in-scope cross-chain pairs to Rail B", () => {
    expect(routeIntent(intent({ toChain: "bsc" }))).toMatchObject({ ok: true, rail: "B" });
    expect(
      routeIntent(intent({ toChain: "cardano", tokenOut: "ADA", action: "swap" })),
    ).toMatchObject({ ok: true, rail: "B" });
    expect(
      routeIntent(intent({ fromChain: "bsc", tokenIn: "USDT", toChain: "base", tokenOut: "USDC", action: "swap" })),
    ).toMatchObject({ ok: true, rail: "B" });
  });

  it("rejects out-of-scope destinations (NEAR, Solana, …)", () => {
    for (const to of ["near", "solana", "arbitrum", "bitcoin"] as const) {
      const d = routeIntent(intent({ toChain: to }));
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.error).toMatch(/Base, BNB Chain, Apex Fusion|isn't supported/);
    }
  });

  it("rejects Cardano as a source (no Cardano wallet wired)", () => {
    const d = routeIntent(intent({ fromChain: "cardano", tokenIn: "ADA", toChain: "base", tokenOut: "USDC", action: "swap" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Cardano wallet/i);
  });

  it("rejects out-of-scope origins", () => {
    const d = routeIntent(intent({ fromChain: "arbitrum" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Base or BNB/i);
  });

  it("rejects tokens not present on the source chain", () => {
    const d = routeIntent(intent({ fromChain: "bsc", tokenIn: "ETH", toChain: "base" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/isn't available on BNB Chain/);
  });

  it("keeps AP3X off Rail B routes", () => {
    const d = routeIntent(intent({ tokenIn: "AP3X", toChain: "bsc" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Base ↔ Apex Fusion/);
  });

  it("rejects same-chain transfers", () => {
    const d = routeIntent(intent({ fromChain: "base", toChain: "base" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/same-chain/i);
  });

  it("rejects zero amounts and incomplete intents", () => {
    expect(routeIntent(intent({ amount: "0" })).ok).toBe(false);
    expect(routeIntent(intent({ amount: null })).ok).toBe(false);
  });
});
