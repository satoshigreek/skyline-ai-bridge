import { describe, expect, it } from "vitest";
import { planRoute, planBuyAp3x, type RoutePlan } from "../src/lib/routes";

// docs/ROUTING_SPEC.md §3-§5 — the canonical routing table. Shortest path over
// issuer-native rails: CCTP (native USDC), Hyperliquid (two-hop), xReserve
// (USDCx), Stargate (BNB only), OFT (AP3X mesh), Reactor (AP3X Apex-internal).

function ok(r: ReturnType<typeof planRoute>): RoutePlan {
  if (!r.ok) throw new Error(`expected ok route, got: ${r.error}`);
  return r;
}

describe("USDC routing", () => {
  it("native CCTP domains move 1:1 over CCTP", () => {
    const r = ok(planRoute("USDC", "base", "solana"));
    expect(r.rail).toBe("cctp");
    expect(r.hops).toHaveLength(1);
    expect(r.settledAsset).toBe("USDC");
    expect(r.trustModel).toBe("native");
  });

  it("Hyperliquid is a two-hop via Arbitrum, landing HyperCore USDC", () => {
    const r = ok(planRoute("USDC", "base", "hyperliquid"));
    expect(r.rail).toBe("hyperliquid");
    expect(r.hops.map((h) => h.rail)).toEqual(["cctp", "hyperliquid"]);
    expect(r.hops.at(-1)!.to).toBe("hyperliquid");
    expect(r.settledAsset).toBe("HyperCore USDC");
  });

  it("Arbitrum reaches Hyperliquid directly (single native-bridge hop)", () => {
    const r = ok(planRoute("USDC", "arbitrum", "hyperliquid"));
    expect(r.hops).toHaveLength(1);
    expect(r.rail).toBe("hyperliquid");
  });

  it("Cardano is reached via xReserve staged through Ethereum, landing USDCx", () => {
    const r = ok(planRoute("USDC", "base", "cardano"));
    expect(r.rail).toBe("xreserve");
    expect(r.hops.map((h) => h.rail)).toEqual(["cctp", "xreserve"]);
    expect(r.hops.map((h) => h.to)).toEqual(["ethereum", "cardano"]);
    expect(r.settledAsset).toBe("USDCx");
    expect(r.trustModel).toBe("backed");
  });

  it("Canton routes flag the permissioned/institutional leg", () => {
    const r = ok(planRoute("USDC", "ethereum", "canton"));
    expect(r.rail).toBe("xreserve");
    expect(r.notes.some((n) => /permissioned|institutional/i.test(n))).toBe(true);
  });

  it("BNB is the lone exception — Stargate, bridged (not native)", () => {
    const r = ok(planRoute("USDC", "base", "bsc"));
    expect(r.rail).toBe("stargate");
    expect(r.trustModel).toBe("pool-wrapped");
    expect(r.settledAsset).toMatch(/Stargate/);
  });

  it("composes exotic pairs (Canton → Cardano via the Ethereum reserve)", () => {
    const r = ok(planRoute("USDC", "canton", "cardano"));
    expect(r.hops.map((h) => h.to)).toEqual(["ethereum", "cardano"]);
    expect(r.settledAsset).toBe("USDCx");
  });

  it("rejects USDC to Apex-internal chains (no USDC there) and same-chain", () => {
    expect(planRoute("USDC", "base", "nexus").ok).toBe(false);
    expect(planRoute("USDC", "base", "base").ok).toBe(false);
  });
});

describe("AP3X routing", () => {
  it("moves across the EVM OFT mesh", () => {
    const r = ok(planRoute("AP3X", "base", "nexus"));
    expect(r.rail).toBe("oft");
    expect(r.settledAsset).toBe("AP3X");
    expect(ok(planRoute("AP3X", "base", "bsc")).settledAsset).toBe("bnAP3X");
  });

  it("uses Reactor for enabled Apex-internal pairs, cAP3X on Cardano", () => {
    expect(ok(planRoute("AP3X", "nexus", "prime")).rail).toBe("reactor");
    const c = ok(planRoute("AP3X", "prime", "cardano"));
    expect(c.rail).toBe("reactor");
    expect(c.settledAsset).toBe("cAP3X");
    expect(c.trustModel).toBe("validator");
  });

  it("composes OFT + Reactor for mesh→internal (Base → Vector)", () => {
    const r = ok(planRoute("AP3X", "base", "vector"));
    expect(r.hops.map((h) => h.rail)).toEqual(["oft", "reactor", "reactor"]);
    expect(r.hops.map((h) => h.to)).toEqual(["nexus", "prime", "vector"]);
  });

  it("reaches Cardano AP3X from Base as cAP3X via Reactor (canonical, not OFT)", () => {
    const r = ok(planRoute("AP3X", "base", "cardano"));
    expect(r.settledAsset).toBe("cAP3X");
    expect(r.hops.at(-1)!.rail).toBe("reactor");
  });

  it("treats the legacy `ap3x` key as Nexus", () => {
    expect(ok(planRoute("AP3X", "base", "ap3x")).hops.at(-1)!.to).toBe("nexus");
  });

  it("rejects AP3X on USDC-only chains", () => {
    expect(planRoute("AP3X", "base", "solana").ok).toBe(false);
    expect(planRoute("AP3X", "base", "hyperliquid").ok).toBe(false);
  });
});

describe("buy AP3X with USDC", () => {
  it("from Base: direct swap, no bridging", () => {
    const p = planBuyAp3x("base", "base");
    if (!p.ok) throw new Error(p.error);
    expect(p.usdcHops).toHaveLength(0);
    expect(p.ap3xHops).toHaveLength(0);
    expect(p.swap.venue).toBe("Aerodrome");
  });

  it("from a CCTP chain: atomic CCTP-Hook mint+swap", () => {
    const p = planBuyAp3x("solana", "base");
    if (!p.ok) throw new Error(p.error);
    expect(p.usdcHops.map((h) => h.rail)).toEqual(["cctp"]);
    expect(p.swap.atomicHook).toBe(true);
  });

  it("from BNB to Nexus: Stargate in, swap, OFT onward", () => {
    const p = planBuyAp3x("bsc", "nexus");
    if (!p.ok) throw new Error(p.error);
    expect(p.usdcHops.at(-1)!.rail).toBe("stargate");
    expect(p.swap.atomicHook).toBe(false);
    expect(p.ap3xHops.map((h) => h.rail)).toEqual(["oft"]);
    expect(p.settledAsset).toBe("AP3X");
  });
});
