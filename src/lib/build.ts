import { AP3X_MESH, CHAINS, EVM_CHAIN_IDS } from "./chains";
import { effectiveTokenOut, type Intent } from "./intent";
import { fromSmallestUnits } from "./units";
import type { RailAPlan } from "./oft";
import type { OneClickQuote, OneClickToken } from "./oneclick";

// SINGLE SOURCE OF TRUTH for what the user approves. The review card model and
// the transaction plan are built together, from the same validated inputs, by
// the same function — they cannot diverge (tests/equivalence.test.ts asserts it).

export type CardModel = {
  rail: "A" | "B" | "C";
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
  // EVM chain id the transfer is signed on (8453 Base, 56 BNB).
  chainId: number;
  // What the user actually signs: a plain transfer on the origin chain.
  transfer: {
    tokenAddress: `0x${string}` | null; // null => native coin send
    amountSmallest: string;
    decimals: number;
    symbol: string;
  };
};

// Rail C plans. UTXO origins (prime/vector/cardano) build a Cardano txRaw to
// be signed via CIP-30; the Nexus EVM origin builds an ethTx signed via the
// EVM wallet. The signed source tx is then registered for tracking.
export type RailCCardanoPlan = {
  kind: "railC-cardano";
  originChain: string; // apexId
  destinationChain: string;
  destinationAddress: string;
  senderAddress: string;
  amountSmallest: string;
  tokenID: number;
  bridgingFee: string;
  operationFee: string;
};
export type RailCEvmPlan = {
  kind: "railC-evm";
  chainId: number; // Nexus = 9069
  originChain: string;
  destinationChain: string;
  destinationAddress: string;
  senderAddress: string;
  amountSmallest: string;
  tokenID: number;
  approvalTx: { to: string; data: string; value: string | null } | null;
  bridgingTx: { to: string; data: string; value: string | null };
  bridgingFee: string;
  operationFee: string;
};
export type RailCPlan = RailCCardanoPlan | RailCEvmPlan;

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
    // Show the chain-local representation on each side of the mesh.
    tokenIn: AP3X_MESH[intent.fromChain!]?.label ?? plan.token,
    tokenOut: AP3X_MESH[intent.toChain!]?.label ?? plan.token,
    amountIn,
    estOut: amountIn, // OFT is 1:1; only slippage floor differs
    minOut,
    fees: [
      {
        label: "LayerZero fee",
        value: `${fromSmallestUnits(nativeFeeWei, 18, 8)} ${intent.fromChain === "bsc" ? "BNB" : "ETH"}`,
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
        chainId: EVM_CHAIN_IDS[intent.fromChain!] ?? 8453,
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

// ---------------------------------------------------------------------------
// Rail C: Apex Fusion internal (Skyline native bridge). Card + plan from the
// same fee/build response. Native bridge is 1:1 minus the bridging+operation
// fee deducted from the bridged amount (no slippage).
// ---------------------------------------------------------------------------

function railCFeeToken(originChain: import("./chains").ChainKey): string {
  return originChain === "cardano" ? "ADA" : "AP3X";
}

export function buildRailCCard(
  intent: Intent,
  plan: RailCPlan,
  decimals: number,
  sourceTxFee?: string, // Cardano source-chain tx fee, in origin smallest units
): CardModel {
  const from = intent.fromChain!;
  const to = intent.toChain!;
  const feeToken = railCFeeToken(from);
  const amount = BigInt(plan.amountSmallest);
  const bridgingFee = BigInt(plan.bridgingFee || "0");
  const operationFee = BigInt(plan.operationFee || "0");
  const received = amount - bridgingFee - operationFee;
  const minOut = received < 0n ? 0n : received;

  const fees: Array<{ label: string; value: string }> = [
    { label: "Bridging fee", value: `${fromSmallestUnits(bridgingFee, decimals)} ${feeToken}` },
  ];
  if (operationFee > 0n) {
    fees.push({ label: "Operation fee", value: `${fromSmallestUnits(operationFee, decimals)} ${feeToken}` });
  }
  if (sourceTxFee && BigInt(sourceTxFee) > 0n) {
    fees.push({ label: "Source tx fee", value: `${fromSmallestUnits(sourceTxFee, decimals)} ${feeToken}` });
  }

  const inLabel = from === "cardano" && intent.tokenIn === "AP3X" ? "cAP3X" : intent.tokenIn!;
  const outLabel = to === "cardano" && intent.tokenIn === "AP3X" ? "cAP3X" : intent.tokenIn!;

  return {
    rail: "C",
    railLabel: "Skyline (Apex Fusion)",
    fromChain: CHAINS[from].label,
    toChain: CHAINS[to].label,
    tokenIn: inLabel,
    tokenOut: outLabel,
    amountIn: fromSmallestUnits(amount, decimals),
    estOut: fromSmallestUnits(minOut, decimals),
    minOut: fromSmallestUnits(minOut, decimals),
    fees,
    etaSeconds: 600, // native bridge batches; minutes
    recipient: plan.destinationAddress,
    usdIn: null,
    notes: [
      from === "nexus" || to === "nexus"
        ? "Crosses Nexus (EVM) ↔ Cardano-VM inside Apex Fusion via the Skyline validators."
        : "Native Skyline transfer inside Apex Fusion.",
    ],
  };
}
