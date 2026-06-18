import { describe, expect, it } from "vitest";
import { getAddress, pad } from "viem";
import { buildCctp, CCTP_DOMAINS, USDC_DECIMALS, type CctpConfig } from "../src/lib/cctp";
import { fromSmallestUnits } from "../src/lib/units";

// docs/ROUTING_SPEC.md §3 — CCTP rail builder. The central assertion is the
// card ≡ calldata invariant: the review card and the burn plan are built from
// one input and agree on every money-critical field.

const RECIPIENT = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

// Test config with a known TokenMessenger (no real address is baked into the
// module — it must be configured, which this provides).
const CFG: CctpConfig = {
  usdc: {
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  tokenMessenger: {
    base: "0x1111111111111111111111111111111111111111",
    arbitrum: "0x2222222222222222222222222222222222222222",
    ethereum: "0x3333333333333333333333333333333333333333",
  },
};

describe("CCTP rail builder", () => {
  it("builds a card and burn plan from one input (Base → Arbitrum)", () => {
    const r = buildCctp({ fromChain: "base", toChain: "arbitrum", amount: "250.5", recipient: RECIPIENT }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.card.rail).toBe("cctp");
    expect(r.card.settledAsset).toBe("USDC");
    expect(r.card.trustModel).toBe("native");
    expect(r.plan.kind).toBe("cctp-burn");
    expect(r.plan.chainId).toBe(8453); // Base
  });

  it("card ≡ calldata: card and plan agree on every money-critical field", () => {
    const r = buildCctp({ fromChain: "base", toChain: "arbitrum", amount: "250.5", recipient: RECIPIENT }, CFG);
    if (!r.ok) throw new Error(r.error);
    // amount
    expect(r.card.amountIn).toBe(fromSmallestUnits(BigInt(r.plan.burn.amount), USDC_DECIMALS));
    expect(r.card.amountIn).toBe("250.5");
    // 1:1 floor
    expect(r.card.minOut).toBe(r.card.amountIn);
    // destination domain matches the route target
    expect(r.plan.burn.destinationDomain).toBe(CCTP_DOMAINS.arbitrum);
    // mint recipient is the bytes32-padded card recipient
    expect(r.plan.burn.mintRecipient).toBe(pad(getAddress(RECIPIENT), { size: 32 }));
    expect(r.card.recipient).toBe(getAddress(RECIPIENT));
    // approval targets the same messenger and amount as the burn
    expect(r.plan.approval.spender).toBe(r.plan.burn.tokenMessenger);
    expect(r.plan.approval.amount).toBe(r.plan.burn.amount);
    expect(r.plan.approval.token).toBe(r.plan.burn.burnToken);
  });

  it("truncates excess USDC precision so the card matches what executes", () => {
    const r = buildCctp({ fromChain: "ethereum", toChain: "base", amount: "1.1234567", recipient: RECIPIENT }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.burn.amount).toBe("1123456"); // 6 dp, truncated
    expect(r.card.amountIn).toBe(fromSmallestUnits(BigInt(r.plan.burn.amount), USDC_DECIMALS));
  });

  it("refuses when the TokenMessenger isn't configured (the ⟨VERIFY⟩ gate)", () => {
    const r = buildCctp({ fromChain: "base", toChain: "arbitrum", amount: "10", recipient: RECIPIENT }, { usdc: CFG.usdc, tokenMessenger: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/TokenMessenger not configured/);
  });

  it("rejects non-direct-CCTP routes (Base → Hyperliquid is multi-hop)", () => {
    const r = buildCctp({ fromChain: "base", toChain: "hyperliquid", amount: "10", recipient: RECIPIENT }, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/isn't a direct CCTP hop/);
  });

  it("rejects Solana origin in the EVM builder, and invalid recipients", () => {
    expect(buildCctp({ fromChain: "solana", toChain: "base", amount: "10", recipient: RECIPIENT }, CFG).ok).toBe(false);
    expect(buildCctp({ fromChain: "base", toChain: "arbitrum", amount: "10", recipient: "not-an-address" }, CFG).ok).toBe(false);
  });
});
