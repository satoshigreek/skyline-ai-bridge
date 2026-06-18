import { getAddress, isAddress, pad, type Address, type Hex } from "viem";
import { USDC_BASE, type ChainKey } from "./chains";
import { toSmallestUnits, fromSmallestUnits } from "./units";
import { planRoute, type PlanCard } from "./routes";

// ---------------------------------------------------------------------------
// CCTP rail builder (docs/ROUTING_SPEC.md §3) — native USDC burn-and-mint.
//
// Produces the review card AND the signed transaction plan from ONE validated
// input, so they cannot diverge (tests/cctp.test.ts asserts it — the card ≡
// calldata invariant). Following the repo convention (see oft.ts), the plan
// carries RESOLVED, structured params; the client builds the contract write
// from them — no re-derivation, no hand-encoded hex.
//
// SCOPE: direct EVM↔EVM native CCTP (Ethereum / Base / Arbitrum). Solana
// (domain 5) is a CCTP domain but non-EVM — its instruction builder is a
// separate, later increment. Multi-hop USDC routes (→ Hyperliquid, → xReserve)
// reuse this burn for their CCTP leg via their own rail builders.
// ---------------------------------------------------------------------------

export const USDC_DECIMALS = 6;

// CCTP domain ids — protocol constants, stable across deployments.
export const CCTP_DOMAINS: Partial<Record<ChainKey, number>> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  solana: 5,
  base: 6,
  polygon: 7,
};

// EVM chain ids for the wallet to sign on.
const EVM_CHAIN_ID: Partial<Record<ChainKey, number>> = {
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
};

// Native Circle USDC per EVM chain. Base is the address already verified in the
// repo; Ethereum and Arbitrum are the canonical, well-known deployments.
// ⟨VERIFY⟩ reconfirm on-chain before mainnet execution.
export const USDC_ADDRESS: Partial<Record<ChainKey, Address>> = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: USDC_BASE,
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

export type CctpConfig = {
  usdc: Partial<Record<ChainKey, Address>>;
  // CCTP v2 TokenMessenger per chain. NO address is baked in — populate from
  // env/config once confirmed against Circle's current CCTP v2 deployment.
  // ⟨VERIFY⟩ this is the gate before any mainnet CCTP execution.
  tokenMessenger: Partial<Record<ChainKey, Address>>;
};

function envAddr(v: string | undefined): Address | undefined {
  return v && isAddress(v) ? getAddress(v) : undefined;
}

export const DEFAULT_CCTP_CONFIG: CctpConfig = {
  usdc: USDC_ADDRESS,
  tokenMessenger: {
    ethereum: envAddr(process.env.CCTP_MESSENGER_ETHEREUM),
    base: envAddr(process.env.CCTP_MESSENGER_BASE),
    arbitrum: envAddr(process.env.CCTP_MESSENGER_ARBITRUM),
  },
};

export type CctpBurnPlan = {
  kind: "cctp-burn";
  chainId: number;
  // approve(spender = tokenMessenger, amount) on the USDC token, then burn.
  approval: { token: Address; spender: Address; amount: string };
  // depositForBurn(amount, destinationDomain, mintRecipient, burnToken).
  burn: {
    tokenMessenger: Address;
    amount: string;
    destinationDomain: number;
    mintRecipient: Hex; // bytes32, left-padded recipient
    burnToken: Address;
  };
};

export type CctpResult =
  | { ok: true; card: PlanCard; plan: CctpBurnPlan }
  | { ok: false; error: string };

export type CctpInput = {
  fromChain: ChainKey;
  toChain: ChainKey;
  amount: string; // human decimal USDC
  recipient: string; // destination EVM address
  // Fast Transfer charges a small Circle fee; Standard is free but slower.
  fast?: boolean;
};

export function buildCctp(input: CctpInput, config: CctpConfig = DEFAULT_CCTP_CONFIG): CctpResult {
  const { fromChain, toChain } = input;

  // The route must resolve to a single native-CCTP hop (EVM↔EVM here).
  const route = planRoute("USDC", fromChain, toChain);
  if (!route.ok) return { ok: false, error: route.error };
  if (route.rail !== "cctp" || route.hops.length !== 1) {
    return {
      ok: false,
      error: `${fromChain}→${toChain} isn't a direct CCTP hop (rail: ${route.rail}, ${route.hops.length} hops). Use the matching rail builder.`,
    };
  }
  if (CCTP_DOMAINS[fromChain] == null || EVM_CHAIN_ID[fromChain] == null) {
    return { ok: false, error: `CCTP burn from ${fromChain} isn't supported by the EVM builder (Solana uses a separate instruction builder).` };
  }
  if (CCTP_DOMAINS[toChain] == null || EVM_CHAIN_ID[toChain] == null) {
    return { ok: false, error: `CCTP mint to ${toChain} isn't supported by the EVM builder yet.` };
  }

  let recipient: Address;
  try {
    recipient = getAddress(input.recipient);
  } catch {
    return { ok: false, error: `"${input.recipient}" isn't a valid EVM address for the CCTP mint recipient.` };
  }

  const burnToken = config.usdc[fromChain];
  const tokenMessenger = config.tokenMessenger[fromChain];
  if (!burnToken) return { ok: false, error: `No USDC address configured for ${fromChain}.` };
  if (!tokenMessenger) {
    return { ok: false, error: `CCTP TokenMessenger not configured for ${fromChain} — set CCTP_MESSENGER_${fromChain.toUpperCase()} (⟨VERIFY⟩ against Circle's CCTP v2 deployment).` };
  }

  const amountSmallest = toSmallestUnits(input.amount, USDC_DECIMALS);
  if (amountSmallest <= 0n) return { ok: false, error: "Amount must be greater than zero." };

  const destinationDomain = CCTP_DOMAINS[toChain]!;
  const mintRecipient = pad(recipient, { size: 32 });
  const amountStr = amountSmallest.toString();

  const plan: CctpBurnPlan = {
    kind: "cctp-burn",
    chainId: EVM_CHAIN_ID[fromChain]!,
    approval: { token: burnToken, spender: tokenMessenger, amount: amountStr },
    burn: { tokenMessenger, amount: amountStr, destinationDomain, mintRecipient, burnToken },
  };

  const card: PlanCard = {
    rail: "cctp",
    fromChain: route.hops[0].from,
    toChain: route.hops[0].to,
    tokenIn: "USDC",
    tokenOut: "USDC",
    amountIn: fromSmallestUnits(amountSmallest, USDC_DECIMALS),
    minOut: fromSmallestUnits(amountSmallest, USDC_DECIMALS), // CCTP is 1:1
    fees: [{ label: input.fast ? "Circle Fast Transfer fee" : "CCTP fee", value: input.fast ? "small (Fast Transfer)" : "free (Standard)" }],
    etaSeconds: input.fast ? 60 : 900,
    recipient,
    settledAsset: route.settledAsset, // native USDC
    trustModel: route.trustModel, // "native"
    notes: ["Native USDC, minted 1:1 by Circle — no wrapped token, no liquidity pool."],
  };

  return { ok: true, card, plan };
}
