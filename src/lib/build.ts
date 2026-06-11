import { CHAINS } from "./chains";
import { effectiveTokenOut, type Intent } from "./intent";
import { fromSmallestUnits } from "./units";
import type { RailAPlan } from "./oft";
import type { OneClickQuote, OneClickToken } from "./oneclick";

// SINGLE SOURCE OF TRUTH for what the user approves. The review card model and
// the transaction plan are built together, from the same validated inputs, by
// the same function — they cannot diverge (tests/equivalence.test.ts asserts it).

export type CardModel = {
  rail: "A" | "B";
  railLabel: string;
  fromChain: string;
  toChain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // human decimal — exactly what leaves the wallet
  estOut: string; // human decimal — estimated received
  minOut: string; // human decimal — floor after slippage
  fees: Array<{ label: string; value: string }>;
  etaSeconds: number | null;
  recipient: string;
  usdIn: number | null;
  notes: string[];
};

export type RailBTransferPlan = {
  kind: "railB";
  depositAddress: string;
  deadline: string | null;
  // What the user actually signs: a plain transfer on Base.
  transfer: {
    tokenAddress: `0x${string}` | null; // null => native ETH send
    amountSmallest: string;
    decimals: number;
    symbol: string;
  };
};

// ---------------------------------------------------------------------------
// Rail A: card + plan from the same RailAPlan + fee
// ---------------------------------------------------------------------------

export function buildRailACard(
  intent: Intent,
  plan: RailAPlan,
  nativeFeeWei: bigint,
): CardModel {
  const amountIn = fromSmallestUnits(plan.sendParam.amountLD, plan.decimals);
  const minOut = fromSmallestUnits(plan.sendParam.minAmountLD, plan.decimals);
  return {
    rail: "A",
    railLabel: "LayerZero OFT",
    fromChain: CHAINS[intent.fromChain!].label,
    toChain: CHAINS[intent.toChain!].label,
    tokenIn: plan.token,
    tokenOut: plan.token === "bAP3X" ? "AP3X" : plan.token,
    amountIn,
    estOut: amountIn, // OFT is 1:1; only slippage floor differs
    minOut,
    fees: [
      {
        label: "LayerZero fee",
        value: `${fromSmallestUnits(nativeFeeWei, 18, 8)} ETH`,
      },
    ],
    etaSeconds: 120,
    recipient: plan.recipient,
    usdIn: null, // AP3X has no reliable USD oracle here; wallet shows exact calldata
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Rail B: card (+ transfer plan when not a dry quote) from the same quote
// ---------------------------------------------------------------------------

export function buildRailBCard(
  intent: Intent,
  quote: OneClickQuote,
  tokenIn: OneClickToken,
  tokenOut: OneClickToken,
  recipient: string,
): { card: CardModel; plan: RailBTransferPlan | null } {
  const amountIn = fromSmallestUnits(quote.amountIn, tokenIn.decimals);
  const estOut = fromSmallestUnits(quote.amountOut, tokenOut.decimals);
  const minOut = quote.minAmountOut
    ? fromSmallestUnits(quote.minAmountOut, tokenOut.decimals)
    : estOut;
  const usdIn = quote.amountInUsd ? Number(quote.amountInUsd) : null;
  const spreadUsd =
    quote.amountInUsd && quote.amountOutUsd
      ? Number(quote.amountInUsd) - Number(quote.amountOutUsd)
      : null;

  const card: CardModel = {
    rail: "B",
    railLabel: "NEAR Intents (1-Click)",
    fromChain: CHAINS[intent.fromChain!].label,
    toChain: CHAINS[intent.toChain!].label,
    tokenIn: tokenIn.symbol,
    tokenOut: tokenOut.symbol,
    amountIn,
    estOut,
    minOut,
    fees: [
      {
        label: "Solver spread (all-in)",
        value:
          spreadUsd != null
            ? `≈ $${Math.max(0, spreadUsd).toFixed(2)}`
            : "included in quote",
      },
      ...(process.env.ONECLICK_JWT ? [] : [{ label: "No-auth fee", value: "0.2%" }]),
    ],
    etaSeconds: quote.timeEstimate ?? null,
    recipient,
    usdIn,
    notes: ["Failed or under-filled swaps refund automatically to your wallet on Base."],
  };

  const plan: RailBTransferPlan | null = quote.depositAddress
    ? {
        kind: "railB",
        depositAddress: quote.depositAddress,
        deadline: quote.deadline ?? null,
        transfer: {
          tokenAddress: (tokenIn.contractAddress as `0x${string}` | undefined) ?? null,
          amountSmallest: quote.amountIn,
          decimals: tokenIn.decimals,
          symbol: tokenIn.symbol,
        },
      }
    : null;

  return { card, plan };
}
