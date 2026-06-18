import { getAddress, type Address } from "viem";
import { CHAINS, type ChainKey } from "./chains";
import { toSmallestUnits, fromSmallestUnits } from "./units";
import { planRoute, type PlanCard } from "./routes";
import { buildCctp, USDC_DECIMALS, DEFAULT_CCTP_CONFIG, type CctpConfig, type CctpBurnPlan } from "./cctp";

// ---------------------------------------------------------------------------
// xReserve rail builder (docs/ROUTING_SPEC.md §3) — USDC → USDCx on a non-CCTP
// chain (Cardano / Stacks / Canton) via Circle xReserve. Two legs:
//   1. CCTP burn  origin → Ethereum   (reserve sits on Ethereum; skipped if
//      origin already IS Ethereum)
//   2. depositToRemote on Ethereum    (locks USDC in the reserve, mints USDCx
//      to the recipient on the destination chain)
//
// USDCx is a Circle-backed representation, NOT native USDC — the card names
// that. Canton is permissioned/institutional and is flagged for the separate
// eligibility flow. Card + plan are built from one input (card ≡ calldata).
//
// SCOPE: CCTP-EVM origins (Ethereum / Base / Arbitrum). The xReserve gateway
// address, the per-destination remote domain, and the depositToRemote ABI are
// ⟨VERIFY⟩ — configured, never guessed, and gated before mainnet.
// ---------------------------------------------------------------------------

export const XRESERVE_CHAINS: ChainKey[] = ["cardano", "stacks", "canton"];
const SUPPORTED_ORIGINS: ChainKey[] = ["ethereum", "base", "arbitrum"];

export type XReserveConfig = {
  cctp: CctpConfig; // CCTP leg + the Ethereum USDC address
  // xReserve gateway contract on Ethereum (the reserve chain). ⟨VERIFY⟩.
  gateway?: Address;
  // Destination chain → Circle xReserve remote domain id. ⟨VERIFY⟩.
  remoteDomain: Partial<Record<ChainKey, number>>;
};

export const DEFAULT_XRESERVE_CONFIG: XReserveConfig = {
  cctp: DEFAULT_CCTP_CONFIG,
  gateway:
    process.env.XRESERVE_GATEWAY_ETHEREUM && /^0x[a-fA-F0-9]{40}$/.test(process.env.XRESERVE_GATEWAY_ETHEREUM)
      ? getAddress(process.env.XRESERVE_GATEWAY_ETHEREUM)
      : undefined,
  // No baked domains — populate once confirmed against Circle's deployment.
  remoteDomain: {},
};

export type XReserveDepositLeg = {
  kind: "xreserve-deposit";
  chainId: 1; // Ethereum (reserve chain)
  gateway: Address;
  usdc: Address;
  amount: string; // smallest units
  approval: { token: Address; spender: Address; amount: string };
  remoteDomain: number;
  destinationChain: ChainKey;
  // Recipient on the destination chain. Carried raw; its on-chain byte
  // encoding for depositToRemote is ⟨VERIFY⟩ per chain.
  destinationRecipient: string;
};

export type XReservePlan = {
  kind: "xreserve-mint";
  cctp: CctpBurnPlan | null; // CCTP leg to Ethereum; null when origin IS Ethereum
  deposit: XReserveDepositLeg;
  permissioned: boolean; // true for Canton — route through the eligibility flow
};

export type XReserveResult =
  | { ok: true; card: PlanCard; plan: XReservePlan }
  | { ok: false; error: string };

export type XReserveInput = {
  fromChain: ChainKey; // CCTP-EVM origin
  toChain: ChainKey; // cardano | stacks | canton
  amount: string; // human decimal USDC
  ethereumSender: string; // EVM address that holds the bridged USDC and signs
  destinationRecipient: string; // USDCx recipient on the destination chain
};

// Light, non-authoritative format check to catch gross address errors. Full
// validation per chain is ⟨VERIFY⟩ (Cardano bech32, Stacks c32, Canton party).
function recipientLooksValid(chain: ChainKey, r: string): boolean {
  const s = r.trim();
  if (!s) return false;
  if (chain === "cardano") return /^addr(_test)?1/.test(s);
  if (chain === "stacks") return /^S[A-Z0-9]/.test(s);
  return s.length >= 3; // canton party id — format varies
}

export function buildXReserve(
  input: XReserveInput,
  config: XReserveConfig = DEFAULT_XRESERVE_CONFIG,
): XReserveResult {
  const { fromChain, toChain } = input;

  const route = planRoute("USDC", fromChain, toChain);
  if (!route.ok) return { ok: false, error: route.error };
  if (route.rail !== "xreserve") {
    return { ok: false, error: `${fromChain}→${toChain} doesn't resolve to the xReserve rail (rail: ${route.rail}).` };
  }
  if (!SUPPORTED_ORIGINS.includes(fromChain)) {
    return { ok: false, error: `xReserve from ${fromChain} isn't supported yet — origin must be a CCTP-EVM chain (Ethereum / Base / Arbitrum).` };
  }
  if (!XRESERVE_CHAINS.includes(toChain)) {
    return { ok: false, error: `${toChain} isn't an xReserve destination.` };
  }

  let sender: Address;
  try {
    sender = getAddress(input.ethereumSender);
  } catch {
    return { ok: false, error: `"${input.ethereumSender}" isn't a valid EVM address for the Ethereum-side sender.` };
  }
  if (!recipientLooksValid(toChain, input.destinationRecipient)) {
    return { ok: false, error: `"${input.destinationRecipient}" doesn't look like a valid ${CHAINS[toChain].label} address.` };
  }

  const gateway = config.gateway;
  if (!gateway) return { ok: false, error: "xReserve gateway not configured — set XRESERVE_GATEWAY_ETHEREUM (⟨VERIFY⟩ against Circle's deployment)." };
  const remoteDomain = config.remoteDomain[toChain];
  if (remoteDomain == null) return { ok: false, error: `xReserve remote domain not configured for ${CHAINS[toChain].label} (⟨VERIFY⟩).` };
  const usdc = config.cctp.usdc.ethereum;
  if (!usdc) return { ok: false, error: "No Ethereum USDC address configured." };

  const amountSmallest = toSmallestUnits(input.amount, USDC_DECIMALS);
  if (amountSmallest <= 0n) return { ok: false, error: "Amount must be greater than zero." };
  const amountStr = amountSmallest.toString();

  // Leg 1 — CCTP to Ethereum (skipped when origin IS Ethereum).
  let cctp: CctpBurnPlan | null = null;
  if (fromChain !== "ethereum") {
    const burn = buildCctp({ fromChain, toChain: "ethereum", amount: input.amount, recipient: sender }, config.cctp);
    if (!burn.ok) return { ok: false, error: `CCTP leg to Ethereum failed: ${burn.error}` };
    cctp = burn.plan;
  }

  const deposit: XReserveDepositLeg = {
    kind: "xreserve-deposit",
    chainId: 1,
    gateway,
    usdc,
    amount: amountStr,
    approval: { token: usdc, spender: gateway, amount: amountStr },
    remoteDomain,
    destinationChain: toChain,
    destinationRecipient: input.destinationRecipient.trim(),
  };

  const permissioned = toChain === "canton";
  const human = fromSmallestUnits(amountSmallest, USDC_DECIMALS);
  const notes: string[] = [
    `Settles as USDCx on ${CHAINS[toChain].label} — a Circle-backed representation, not native USDC. Redeem back to USDC via xReserve.`,
  ];
  if (cctp) notes.unshift("Two-step: CCTP mints native USDC on Ethereum, then xReserve mints USDCx on the destination.");
  if (permissioned) notes.push("Canton is permissioned / institutional — route through the separate eligibility flow, not the retail wallet path.");

  const card: PlanCard = {
    rail: "xreserve",
    fromChain: route.hops[0].from,
    toChain: CHAINS[toChain].label,
    tokenIn: "USDC",
    tokenOut: "USDCx",
    amountIn: human,
    minOut: human, // 1:1 mint
    fees: [{ label: "xReserve mint", value: "reserve-backed (no swap)" }],
    etaSeconds: cctp ? 960 : 300,
    recipient: input.destinationRecipient.trim(),
    settledAsset: route.settledAsset, // "USDCx"
    trustModel: route.trustModel, // "backed"
    notes,
  };

  return { ok: true, card, plan: { kind: "xreserve-mint", cctp, deposit, permissioned } };
}
