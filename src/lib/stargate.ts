import { getAddress, pad, type Address, type Hex } from "viem";
import { USDC_BASE, type ChainKey } from "./chains";
import { toSmallestUnits, fromSmallestUnits, applySlippage } from "./units";
import { planRoute, type PlanCard } from "./routes";
import { USDC_ADDRESS, USDC_DECIMALS } from "./cctp";

// ---------------------------------------------------------------------------
// Stargate rail builder (docs/ROUTING_SPEC.md §3) — the lone BNB USDC leg.
// BNB has no native CCTP, so USDC to/from BNB rides LayerZero Stargate and is
// pool-wrapped (bridged), not native — the card says so. One LayerZero send;
// card + plan from one input (card ≡ calldata).
//
// SCOPE: direct Stargate adjacency between BNB and {Ethereum, Base, Arbitrum}
// (the Stargate USDC pools). Solana ↔ BNB (which would compose a Solana CCTP
// leg) is a later increment. Router/endpoint ids are ⟨VERIFY⟩ config.
// ---------------------------------------------------------------------------

const STARGATE_EVM: ChainKey[] = ["ethereum", "base", "arbitrum"];
const EVM_CHAIN_ID: Partial<Record<ChainKey, number>> = { ethereum: 1, base: 8453, arbitrum: 42161, bsc: 56 };
const SLIPPAGE_BPS = 100;

export type StargateConfig = {
  // USDC token per chain (includes BNB, whose USDC is bridged — ⟨VERIFY⟩).
  usdc: Partial<Record<ChainKey, Address>>;
  router: Partial<Record<ChainKey, Address>>; // Stargate pool/router per chain ⟨VERIFY⟩
  endpointId: Partial<Record<ChainKey, number>>; // LayerZero endpoint id per chain ⟨VERIFY⟩
};

export const DEFAULT_STARGATE_CONFIG: StargateConfig = {
  usdc: { ethereum: USDC_ADDRESS.ethereum, base: USDC_BASE, arbitrum: USDC_ADDRESS.arbitrum },
  router: {},
  endpointId: {},
};

export type StargateSendLeg = {
  kind: "stargate-send";
  chainId: number;
  router: Address;
  token: Address; // USDC on the origin
  amount: string; // smallest units
  minAmount: string; // slippage floor
  dstEndpointId: number;
  mintRecipient: Hex; // bytes32 EVM recipient on the destination
};

export type StargatePlan = { kind: "stargate-bridge"; send: StargateSendLeg };

export type StargateResult =
  | { ok: true; card: PlanCard; plan: StargatePlan }
  | { ok: false; error: string };

export type StargateInput = {
  fromChain: ChainKey;
  toChain: ChainKey;
  amount: string;
  recipient: string; // EVM address on the destination
};

export function buildStargate(input: StargateInput, config: StargateConfig = DEFAULT_STARGATE_CONFIG): StargateResult {
  const { fromChain, toChain } = input;

  const route = planRoute("USDC", fromChain, toChain);
  if (!route.ok) return { ok: false, error: route.error };
  if (route.rail !== "stargate") return { ok: false, error: `${fromChain}→${toChain} doesn't resolve to Stargate (rail: ${route.rail}).` };
  if (route.hops.length !== 1) return { ok: false, error: `${fromChain}→${toChain} needs a CCTP leg before Stargate (Solana ↔ BNB is a later increment).` };

  // Exactly one side is BNB; the other must be a Stargate EVM pool chain.
  const evmSide = fromChain === "bsc" ? toChain : fromChain;
  if (fromChain !== "bsc" && toChain !== "bsc") return { ok: false, error: "Stargate here only bridges to/from BNB Chain." };
  if (!STARGATE_EVM.includes(evmSide)) return { ok: false, error: `Stargate USDC pool not available on ${evmSide} in scope.` };

  let recipient: Address;
  try {
    recipient = getAddress(input.recipient);
  } catch {
    return { ok: false, error: `"${input.recipient}" isn't a valid EVM address for the Stargate recipient.` };
  }

  const router = config.router[fromChain];
  const dstEndpointId = config.endpointId[toChain];
  const token = config.usdc[fromChain];
  if (!router) return { ok: false, error: `Stargate router not configured for ${fromChain} (⟨VERIFY⟩).` };
  if (dstEndpointId == null) return { ok: false, error: `Stargate endpoint id not configured for ${toChain} (⟨VERIFY⟩).` };
  if (!token) return { ok: false, error: `No USDC address configured for ${fromChain} (BNB USDC is ⟨VERIFY⟩).` };
  const chainId = EVM_CHAIN_ID[fromChain];
  if (chainId == null) return { ok: false, error: `No chain id for ${fromChain}.` };

  const amountSmallest = toSmallestUnits(input.amount, USDC_DECIMALS);
  if (amountSmallest <= 0n) return { ok: false, error: "Amount must be greater than zero." };
  const minAmount = applySlippage(amountSmallest, SLIPPAGE_BPS);

  const send: StargateSendLeg = {
    kind: "stargate-send",
    chainId,
    router,
    token,
    amount: amountSmallest.toString(),
    minAmount: minAmount.toString(),
    dstEndpointId,
    mintRecipient: pad(recipient, { size: 32 }),
  };

  const human = fromSmallestUnits(amountSmallest, USDC_DECIMALS);
  const card: PlanCard = {
    rail: "stargate",
    fromChain: route.hops[0].from,
    toChain: route.hops[0].to,
    tokenIn: "USDC",
    tokenOut: toChain === "bsc" ? "USDC (bridged)" : "USDC",
    amountIn: human,
    minOut: fromSmallestUnits(minAmount, USDC_DECIMALS),
    fees: [{ label: "Stargate (LayerZero) fee", value: "pool fee + LZ gas (quoted at execution)" }],
    etaSeconds: 180,
    recipient,
    settledAsset: route.settledAsset,
    trustModel: route.trustModel, // pool-wrapped into BNB; native out of BNB
    notes: [
      toChain === "bsc"
        ? "BNB has no native CCTP — USDC arrives pool-wrapped (bridged) via Stargate, not Circle-native."
        : "Leaving BNB via Stargate; settles as native USDC on the destination.",
    ],
  };

  return { ok: true, card, plan: { kind: "stargate-bridge", send } };
}
