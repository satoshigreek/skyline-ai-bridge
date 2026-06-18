import { describe, expect, it } from "vitest";
import { buildXReserve, type XReserveConfig } from "../src/lib/xreserve";
import { USDC_DECIMALS } from "../src/lib/cctp";
import { fromSmallestUnits } from "../src/lib/units";

// docs/ROUTING_SPEC.md §3 — xReserve. Two legs (CCTP → Ethereum, then
// depositToRemote), USDCx settlement, Canton permissioned branch, card ≡ calldata.

const SENDER = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const CARDANO = "addr1qxy2k7h5e3v9q8w0n4r2t6m8l0p3s5d7f9g1h3j5k7m9n1q3r5t7v9w1x3y5z7";
const CANTON = "party::operator::123";

const CFG: XReserveConfig = {
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
  gateway: "0x4444444444444444444444444444444444444444",
  remoteDomain: { cardano: 10, stacks: 11, canton: 12 },
};

describe("xReserve rail builder", () => {
  it("Base → Cardano: CCTP to Ethereum, then depositToRemote, lands USDCx", () => {
    const r = buildXReserve({ fromChain: "base", toChain: "cardano", amount: "500", ethereumSender: SENDER, destinationRecipient: CARDANO }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.cctp).not.toBeNull();
    expect(r.plan.cctp!.burn.destinationDomain).toBe(0); // Ethereum
    expect(r.plan.deposit.remoteDomain).toBe(10);
    expect(r.card.tokenOut).toBe("USDCx");
    expect(r.card.settledAsset).toBe("USDCx");
    expect(r.card.trustModel).toBe("backed");
    expect(r.plan.permissioned).toBe(false);
  });

  it("card ≡ calldata: amount flows through both legs and the card", () => {
    const r = buildXReserve({ fromChain: "base", toChain: "cardano", amount: "500", ethereumSender: SENDER, destinationRecipient: CARDANO }, CFG);
    if (!r.ok) throw new Error(r.error);
    const dep = r.plan.deposit.amount;
    expect(r.plan.cctp!.burn.amount).toBe(dep);
    expect(r.card.amountIn).toBe(fromSmallestUnits(BigInt(dep), USDC_DECIMALS));
    expect(r.card.amountIn).toBe("500");
    expect(r.card.minOut).toBe(r.card.amountIn);
    expect(r.plan.deposit.destinationRecipient).toBe(CARDANO);
    expect(r.card.recipient).toBe(CARDANO);
    expect(r.plan.deposit.approval.spender).toBe(r.plan.deposit.gateway);
    expect(r.plan.deposit.approval.amount).toBe(dep);
  });

  it("Ethereum origin: no CCTP leg, deposit only", () => {
    const r = buildXReserve({ fromChain: "ethereum", toChain: "cardano", amount: "10", ethereumSender: SENDER, destinationRecipient: CARDANO }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.cctp).toBeNull();
  });

  it("Canton is flagged permissioned / institutional", () => {
    const r = buildXReserve({ fromChain: "ethereum", toChain: "canton", amount: "10", ethereumSender: SENDER, destinationRecipient: CANTON }, CFG);
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.permissioned).toBe(true);
    expect(r.card.notes.some((n) => /permissioned|institutional/i.test(n))).toBe(true);
  });

  it("refuses when gateway or remote domain isn't configured (⟨VERIFY⟩ gates)", () => {
    expect(buildXReserve({ fromChain: "ethereum", toChain: "cardano", amount: "10", ethereumSender: SENDER, destinationRecipient: CARDANO }, { ...CFG, gateway: undefined }).ok).toBe(false);
    expect(buildXReserve({ fromChain: "ethereum", toChain: "cardano", amount: "10", ethereumSender: SENDER, destinationRecipient: CARDANO }, { ...CFG, remoteDomain: {} }).ok).toBe(false);
  });

  it("rejects bad destination addresses and unsupported origins", () => {
    expect(buildXReserve({ fromChain: "ethereum", toChain: "cardano", amount: "10", ethereumSender: SENDER, destinationRecipient: "0xnotcardano" }, CFG).ok).toBe(false);
    expect(buildXReserve({ fromChain: "bsc", toChain: "cardano", amount: "10", ethereumSender: SENDER, destinationRecipient: CARDANO }, CFG).ok).toBe(false);
  });
});
