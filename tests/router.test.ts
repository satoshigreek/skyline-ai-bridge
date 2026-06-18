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

describe("deterministic router — three rails", () => {
  // ---- Rail A: LayerZero OFT mesh ----
  it("routes the AP3X OFT mesh over Rail A (Base/BNB <-> Nexus)", () => {
    expect(routeIntent(intent({ toChain: "nexus", tokenIn: "AP3X" }))).toMatchObject({ ok: true, rail: "A" });
    expect(routeIntent(intent({ toChain: "nexus", tokenIn: "bAP3X" }))).toMatchObject({ ok: true, rail: "A" });
    expect(routeIntent(intent({ fromChain: "bsc", toChain: "nexus", tokenIn: "bnAP3X" }))).toMatchObject({ ok: true, rail: "A" });
    expect(routeIntent(intent({ toChain: "bsc", tokenIn: "AP3X" }))).toMatchObject({ ok: true, rail: "A" });
    expect(routeIntent(intent({ fromChain: "bsc", toChain: "base", tokenIn: "AP3X" }))).toMatchObject({ ok: true, rail: "A" });
  });

  it("rejects USDC to Nexus (no OFT route)", () => {
    const d = routeIntent(intent({ toChain: "nexus", tokenIn: "USDC" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/AP3X/);
  });

  // ---- Rail C: Apex Fusion internal (Skyline) ----
  it("routes the requested internal pairs over Rail C", () => {
    const C = (from: Intent["fromChain"], to: Intent["toChain"], tok = "AP3X") =>
      routeIntent(intent({ fromChain: from, toChain: to, tokenIn: tok }));
    expect(C("nexus", "prime")).toMatchObject({ ok: true, rail: "C" });
    expect(C("prime", "nexus")).toMatchObject({ ok: true, rail: "C" });
    expect(C("prime", "vector")).toMatchObject({ ok: true, rail: "C" });
    expect(C("vector", "prime")).toMatchObject({ ok: true, rail: "C" });
    expect(C("prime", "cardano")).toMatchObject({ ok: true, rail: "C" });
    expect(C("cardano", "prime", "AP3X")).toMatchObject({ ok: true, rail: "C" });
  });

  it("rejects internal pairs that aren't enabled (e.g. Vector<->Nexus)", () => {
    const d = routeIntent(intent({ fromChain: "vector", toChain: "nexus", tokenIn: "AP3X" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/isn't enabled|internal/i);
  });

  it("rejects non-AP3X tokens on internal routes (ADA and USDC are out of scope here)", () => {
    expect(routeIntent(intent({ fromChain: "nexus", toChain: "prime", tokenIn: "USDC" })).ok).toBe(false);
    expect(routeIntent(intent({ fromChain: "cardano", toChain: "prime", tokenIn: "ADA" })).ok).toBe(false);
  });

  // ---- Rail B: NEAR Intents (USDC only, in scope) ----
  it("routes in-scope USDC cross-chain pairs to Rail B", () => {
    expect(routeIntent(intent({ toChain: "bsc" }))).toMatchObject({ ok: true, rail: "B" });
    expect(routeIntent(intent({ toChain: "cardano" }))).toMatchObject({ ok: true, rail: "B" });
  });

  it("Rail C takes precedence over Rail B for prime<->cardano", () => {
    // cardano is a Rail B destination generally, but prime<->cardano is Rail C.
    expect(routeIntent(intent({ fromChain: "prime", toChain: "cardano", tokenIn: "AP3X" }))).toMatchObject({
      ok: true,
      rail: "C",
    });
  });

  // ---- Rejections ----
  it("rejects out-of-scope destinations (NEAR, Solana, …)", () => {
    for (const to of ["near", "solana", "arbitrum", "bitcoin"] as const) {
      expect(routeIntent(intent({ toChain: to })).ok).toBe(false);
    }
  });

  it("rejects out-of-scope origins", () => {
    expect(routeIntent(intent({ fromChain: "arbitrum" })).ok).toBe(false);
  });

  it("keeps the AP3X mesh off the Cardano leg (Base->Cardano AP3X)", () => {
    const d = routeIntent(intent({ tokenIn: "AP3X", toChain: "cardano" }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Nexus/);
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
