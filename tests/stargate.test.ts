import { describe, expect, it } from "vitest";
import { getAddress, pad } from "viem";
import { buildStargate, type StargateConfig } from "../src/lib/stargate";
import { USDC_DECIMALS } from "../src/lib/cctp";
import { fromSmallestUnits } from "../src/lib/units";

// docs/ROUTING_SPEC.md §3 — Stargate (BNB USDC only, pool-wrapped).

const RECIP = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

const CFG: StargateConfig = {
  usdc: {
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  },
  router: { base: "0x5555555555555555555555555555555555555555", bsc: "0x6666666666666666666666666666666666666666" },
  endpointId: { bsc: 30102, base: 30184 },
};

describe("Stargate rail builder", () => {
  it("Base → BNB: bridged USDC, pool-wrapped, card ≡ calldata", () => {
    const r = buildStargate({ fromChain: "base", toChain: "bsc", amount: "100", recipient: RECIP }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.card.rail).toBe("stargate");
    expect(r.card.tokenOut).toBe("USDC (bridged)");
    expect(r.card.trustModel).toBe("pool-wrapped");
    expect(r.plan.send.dstEndpointId).toBe(30102);
    expect(r.plan.send.mintRecipient).toBe(pad(getAddress(RECIP), { size: 32 }));
    expect(r.card.amountIn).toBe(fromSmallestUnits(BigInt(r.plan.send.amount), USDC_DECIMALS));
    expect(BigInt(r.plan.send.minAmount)).toBeLessThan(BigInt(r.plan.send.amount)); // slippage floor
  });

  it("BNB → Base: native USDC out", () => {
    const r = buildStargate({ fromChain: "bsc", toChain: "base", amount: "100", recipient: RECIP }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.card.tokenOut).toBe("USDC");
    expect(r.plan.send.router).toBe(getAddress("0x6666666666666666666666666666666666666666"));
  });

  it("rejects non-BNB pairs and unconfigured router/endpoint", () => {
    expect(buildStargate({ fromChain: "base", toChain: "arbitrum", amount: "10", recipient: RECIP }, CFG).ok).toBe(false); // that's CCTP
    expect(buildStargate({ fromChain: "ethereum", toChain: "bsc", amount: "10", recipient: RECIP }, CFG).ok).toBe(false); // no ethereum router configured
  });
});
