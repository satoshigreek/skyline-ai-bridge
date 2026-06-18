import { describe, expect, it } from "vitest";
import { buildHyperliquidFund, HL_BRIDGE_ARBITRUM, HL_MIN_DEPOSIT_USDC } from "../src/lib/hyperliquid";
import { USDC_DECIMALS, type CctpConfig } from "../src/lib/cctp";
import { fromSmallestUnits } from "../src/lib/units";

// docs/ROUTING_SPEC.md §3 — Hyperliquid funding. Two legs (CCTP → Arbitrum,
// then deposit), card ≡ calldata, min-deposit guard.

const ACCOUNT = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

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

describe("Hyperliquid funding builder", () => {
  it("Base origin: two legs (CCTP → Arbitrum, then deposit)", () => {
    const r = buildHyperliquidFund({ fromChain: "base", amount: "100", account: ACCOUNT }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.cctp).not.toBeNull();
    expect(r.plan.cctp!.burn.destinationDomain).toBe(3); // Arbitrum
    expect(r.plan.deposit.kind).toBe("hl-deposit");
    expect(r.plan.deposit.bridge).toBe(HL_BRIDGE_ARBITRUM);
    expect(r.card.settledAsset).toBe("HyperCore USDC");
    expect(r.card.trustModel).toBe("validator");
  });

  it("card ≡ calldata: same amount flows through both legs and the card", () => {
    const r = buildHyperliquidFund({ fromChain: "base", amount: "100", account: ACCOUNT }, CFG);
    if (!r.ok) throw new Error(r.error);
    const dep = r.plan.deposit.amount;
    expect(r.plan.cctp!.burn.amount).toBe(dep); // burn amount == deposit amount
    expect(r.card.amountIn).toBe(fromSmallestUnits(BigInt(dep), USDC_DECIMALS));
    expect(r.card.amountIn).toBe("100");
    expect(r.card.minOut).toBe(r.card.amountIn); // 1:1 deposit
    expect(r.card.recipient).toBe(r.plan.account); // credited account == recipient
  });

  it("Arbitrum origin: deposit only, no CCTP leg", () => {
    const r = buildHyperliquidFund({ fromChain: "arbitrum", amount: "50", account: ACCOUNT }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.cctp).toBeNull();
    expect(r.plan.deposit.amount).toBe((50n * 10n ** BigInt(USDC_DECIMALS)).toString());
    expect(r.card.etaSeconds).toBe(60);
  });

  it("rejects deposits below the 5 USDC minimum (funds would be lost)", () => {
    const r = buildHyperliquidFund({ fromChain: "base", amount: "3", account: ACCOUNT }, CFG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/below .* USDC are lost/);
    // exactly the minimum is allowed
    expect(buildHyperliquidFund({ fromChain: "base", amount: fromSmallestUnits(HL_MIN_DEPOSIT_USDC, USDC_DECIMALS), account: ACCOUNT }, CFG).ok).toBe(true);
  });

  it("rejects non-CCTP-EVM origins and invalid accounts", () => {
    expect(buildHyperliquidFund({ fromChain: "bsc", amount: "100", account: ACCOUNT }, CFG).ok).toBe(false);
    expect(buildHyperliquidFund({ fromChain: "solana", amount: "100", account: ACCOUNT }, CFG).ok).toBe(false);
    expect(buildHyperliquidFund({ fromChain: "base", amount: "100", account: "nope" }, CFG).ok).toBe(false);
  });
});
