import { describe, expect, it } from "vitest";
import { buildRailAPlan } from "../src/lib/oft";
import { buildRailACard, buildRailBCard } from "../src/lib/build";
import { fromSmallestUnits } from "../src/lib/units";
import type { Intent } from "../src/lib/intent";
import type { OneClickQuote, OneClickToken } from "../src/lib/oneclick";

// ACCEPTANCE CRITERION: the review card and the transaction plan derive from
// the same validated Intent via the same builder — these tests assert the card
// the user reads and the calldata they sign cannot diverge.

const WALLET = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B" as const;

function intent(overrides: Partial<Intent>): Intent {
  return {
    action: "bridge",
    tokenIn: "USDC",
    tokenOut: null,
    amount: "250",
    amountSide: "in",
    fromChain: "base",
    toChain: "ap3x",
    recipient: null,
    confidence: 1,
    clarifyingQuestion: null,
    ...overrides,
  };
}

describe("Rail A: card === calldata", () => {
  it("amount, min-received, and recipient in the card match the SendParam exactly", () => {
    const i = intent({ tokenIn: "USDC", amount: "250.5" });
    const built = buildRailAPlan(i, WALLET);
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const card = buildRailACard(i, built.plan, 123_456_789n);

    // What the card says the user sends == amountLD the contract receives.
    expect(card.amountIn).toBe(fromSmallestUnits(built.plan.sendParam.amountLD, built.plan.decimals));
    // Min received on the card == minAmountLD in calldata.
    expect(card.minOut).toBe(fromSmallestUnits(built.plan.sendParam.minAmountLD, built.plan.decimals));
    // Card recipient == plan recipient == bytes32 `to` in the SendParam.
    expect(card.recipient).toBe(built.plan.recipient);
    expect(built.plan.sendParam.to.toLowerCase().endsWith(built.plan.recipient.slice(2).toLowerCase())).toBe(
      true,
    );
  });

  it("USDC uses 6 decimals end to end (the classic 10^12 bug)", () => {
    const built = buildRailAPlan(intent({ tokenIn: "USDC", amount: "250" }), WALLET);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.sendParam.amountLD).toBe(250_000_000n); // NOT 250e18
    expect(built.plan.approval).not.toBeNull(); // adapter token needs approve
  });

  it("AP3X uses 18 decimals and no approval (native OFT)", () => {
    const built = buildRailAPlan(intent({ tokenIn: "AP3X", amount: "25" }), WALLET);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.sendParam.amountLD).toBe(25n * 10n ** 18n);
    expect(built.plan.approval).toBeNull();
  });
});

describe("Rail B: card === transfer plan", () => {
  const tokenIn: OneClickToken = {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    blockchain: "base",
    symbol: "USDC",
    price: 1,
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  };
  const tokenOut: OneClickToken = {
    assetId: "nep141:wrap.near",
    decimals: 24,
    blockchain: "near",
    symbol: "wNEAR",
    price: 2,
  };
  const quote: OneClickQuote = {
    depositAddress: "0x9999999999999999999999999999999999999999",
    amountIn: "250000000",
    amountInUsd: "250.00",
    amountOut: "122500000000000000000000000",
    amountOutUsd: "245.00",
    minAmountOut: "121275000000000000000000000",
    deadline: "2099-01-01T00:00:00.000Z",
    timeEstimate: 120,
  };

  it("the transfer the user signs is exactly the quoted amountIn, to the quoted deposit address", () => {
    const i = intent({ toChain: "near", action: "swap", tokenOut: "NEAR" });
    const { card, plan } = buildRailBCard(i, quote, tokenIn, tokenOut, "alice.near");
    expect(plan).not.toBeNull();
    if (!plan) return;

    // Card amount == transfer amount (same source field, same decimals).
    expect(card.amountIn).toBe(fromSmallestUnits(plan.transfer.amountSmallest, plan.transfer.decimals));
    expect(plan.transfer.amountSmallest).toBe(quote.amountIn);
    // Deposit address passes through unchanged.
    expect(plan.depositAddress).toBe(quote.depositAddress);
    // Card min-received comes from the quote's own floor.
    expect(card.minOut).toBe(fromSmallestUnits(quote.minAmountOut!, tokenOut.decimals));
    // The recipient on the card is the final recipient, not the deposit address.
    expect(card.recipient).toBe("alice.near");
    expect(card.recipient).not.toBe(plan.depositAddress);
  });

  it("dry quotes (no deposit address) yield a card but no signable plan", () => {
    const dryQuote = { ...quote };
    delete (dryQuote as Record<string, unknown>).depositAddress;
    const i = intent({ toChain: "near" });
    const { card, plan } = buildRailBCard(i, dryQuote, tokenIn, tokenOut, WALLET);
    expect(card.amountIn).toBe("250");
    expect(plan).toBeNull();
  });
});
