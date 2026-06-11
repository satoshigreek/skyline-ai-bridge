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
    toChain: "near",
    recipient: null,
    confidence: 1,
    clarifyingQuestion: null,
    ...overrides,
  };
}

describe("deterministic router", () => {
  it("routes Apex Fusion destinations to Rail A", () => {
    const d = routeIntent(intent({ toChain: "ap3x", tokenIn: "AP3X" }));
    expect(d).toMatchObject({ ok: true, rail: "A" });
  });

  it("routes USDC to Apex Fusion over Rail A (adapter token)", () => {
    const d = routeIntent(intent({ toChain: "ap3x", tokenIn: "USDC" }));
    expect(d).toMatchObject({ ok: true, rail: "A" });
  });

  it("routes everything else cross-chain to Rail B", () => {
    expect(routeIntent(intent({ toChain: "near" }))).toMatchObject({ ok: true, rail: "B" });
    expect(routeIntent(intent({ toChain: "bitcoin", tokenOut: "BTC", action: "swap" }))).toMatchObject({
      ok: true,
      rail: "B",
    });
    expect(routeIntent(intent({ toChain: "cardano" }))).toMatchObject({ ok: true, rail: "B" });
  });

  it("rejects non-Base origins in v1", () => {
    const d = routeIntent(intent({ fromChain: "arbitrum" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Base only/i);
  });

  it("rejects same-chain transfers", () => {
    const d = routeIntent(intent({ toChain: "base" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/same-chain/i);
  });

  it("rejects unsupported tokens on the Apex Fusion route", () => {
    const d = routeIntent(intent({ toChain: "ap3x", tokenIn: "DOGE" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/isn't supported/i);
  });

  it("rejects swaps on Rail A (bridge-only route)", () => {
    const d = routeIntent(
      intent({ toChain: "ap3x", tokenIn: "USDC", tokenOut: "AP3X", action: "swap" }),
    );
    expect(d.ok).toBe(false);
  });

  it("rejects zero amounts", () => {
    const d = routeIntent(intent({ amount: "0" }));
    expect(d.ok).toBe(false);
  });

  it("refuses incomplete intents outright", () => {
    const d = routeIntent(intent({ amount: null }));
    expect(d.ok).toBe(false);
  });
});
