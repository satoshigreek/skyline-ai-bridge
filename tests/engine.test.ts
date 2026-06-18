import { describe, expect, it } from "vitest";
import { buildPlan, type EngineConfig } from "../src/lib/engine";

// docs/ROUTING_SPEC.md — the dispatcher routes each request to the right rail.

const EVM = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const CARDANO = "addr1qxy2k7h5e3v9q8w0n4r2t6m8l0p3s5d7f9g1h3j5k7m9n1q3r5t7v9w1x3y5z7";

const CFG: EngineConfig = {
  cctp: {
    usdc: {
      base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    },
    tokenMessenger: {
      base: "0x1111111111111111111111111111111111111111",
      ethereum: "0x3333333333333333333333333333333333333333",
    },
  },
  xreserve: {
    cctp: {
      usdc: { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
      tokenMessenger: { base: "0x1111111111111111111111111111111111111111", ethereum: "0x3333333333333333333333333333333333333333" },
    },
    gateway: "0x4444444444444444444444444444444444444444",
    remoteDomain: { cardano: 10, canton: 12 },
  },
  stargate: {
    usdc: { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
    router: { base: "0x5555555555555555555555555555555555555555" },
    endpointId: { bsc: 30102 },
  },
};

describe("engine dispatcher", () => {
  it("dispatches USDC to the canonical rail per destination", () => {
    expect(buildPlan({ asset: "USDC", fromChain: "base", toChain: "arbitrum", amount: "100", recipient: EVM }, CFG)).toMatchObject({ ok: true, rail: "cctp" });
    expect(buildPlan({ asset: "USDC", fromChain: "base", toChain: "hyperliquid", amount: "100", recipient: EVM }, CFG)).toMatchObject({ ok: true, rail: "hyperliquid" });
    expect(buildPlan({ asset: "USDC", fromChain: "base", toChain: "bsc", amount: "100", recipient: EVM }, CFG)).toMatchObject({ ok: true, rail: "stargate" });
  });

  it("routes USDC → Cardano to xReserve when an Ethereum sender is supplied", () => {
    const r = buildPlan({ asset: "USDC", fromChain: "base", toChain: "cardano", amount: "100", recipient: CARDANO, ethereumSender: EVM }, CFG);
    expect(r).toMatchObject({ ok: true, rail: "xreserve" });
  });

  it("errors clearly when xReserve is missing its Ethereum sender", () => {
    const r = buildPlan({ asset: "USDC", fromChain: "base", toChain: "cardano", amount: "100", recipient: CARDANO }, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ethereumSender/);
  });

  it("dispatches AP3X to the OFT/Reactor builder", () => {
    expect(buildPlan({ asset: "AP3X", fromChain: "base", toChain: "nexus", amount: "25", recipient: EVM }, CFG)).toMatchObject({ ok: true, rail: "oft" });
    expect(buildPlan({ asset: "AP3X", fromChain: "prime", toChain: "cardano", amount: "10", recipient: CARDANO }, CFG)).toMatchObject({ ok: true, rail: "reactor" });
  });

  it("surfaces builder errors (out-of-scope destination)", () => {
    expect(buildPlan({ asset: "USDC", fromChain: "base", toChain: "nexus", amount: "10", recipient: EVM }, CFG).ok).toBe(false);
  });
});
