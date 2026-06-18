import { getAddress, isAddress, type Address } from "viem";
import { type ChainKey } from "./chains";
import { toSmallestUnits, fromSmallestUnits } from "./units";
import { planRoute, type PlanCard } from "./routes";
import { buildCctp, USDC_DECIMALS, DEFAULT_CCTP_CONFIG, type CctpConfig, type CctpBurnPlan } from "./cctp";

// ---------------------------------------------------------------------------
// Hyperliquid rail builder (docs/ROUTING_SPEC.md §3) — fund a Hyperliquid
// account with USDC from any CCTP chain. Two legs, unavoidable:
//   1. CCTP burn  origin → Arbitrum   (native USDC; skipped if already on Arb)
//   2. Deposit    Arbitrum → HyperCore (USDC ERC-20 transfer to the bridge)
//
// HyperCore credits the DEPOSITING address, so the HL account == the Arbitrum
// address that holds the bridged USDC (the CCTP mintRecipient). Card and plan
// are built from one input; tests/hyperliquid.test.ts asserts they agree.
//
// SCOPE: CCTP-EVM origins (Ethereum / Base / Arbitrum). BNB (Stargate) and
// Solana origins compose with their own builders in a later increment.
// Withdrawal (HyperCore → Arbitrum, 1 USDC fee) is also a later increment.
// ---------------------------------------------------------------------------

// Hyperliquid Bridge2 on Arbitrum. User-provided + spec-verified; ⟨VERIFY⟩ the
// address on-chain before mainnet execution. Env-overridable like the OFT.
export const HL_BRIDGE_ARBITRUM: Address =
  (process.env.HL_BRIDGE_ARBITRUM && isAddress(process.env.HL_BRIDGE_ARBITRUM)
    ? getAddress(process.env.HL_BRIDGE_ARBITRUM)
    : "0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7");

// Deposits below this are LOST by the bridge — enforced before signing.
export const HL_MIN_DEPOSIT_USDC = 5n * 10n ** BigInt(USDC_DECIMALS);
export const HL_WITHDRAWAL_FEE_USDC = "1"; // informational (charged on exit)

// CCTP-EVM origins this builder can source native USDC from.
const SUPPORTED_ORIGINS: ChainKey[] = ["ethereum", "base", "arbitrum"];

export type HlDepositLeg = {
  kind: "hl-deposit";
  chainId: 42161;
  usdc: Address; // Arbitrum USDC
  bridge: Address; // Hyperliquid Bridge2
  amount: string; // smallest units — USDC transfer(bridge, amount)
};

export type HyperliquidPlan = {
  kind: "hyperliquid-fund";
  // CCTP leg to get native USDC onto Arbitrum; null when origin IS Arbitrum.
  cctp: CctpBurnPlan | null;
  deposit: HlDepositLeg;
  account: Address; // credited HyperCore account (= the Arbitrum holder)
};

export type HyperliquidResult =
  | { ok: true; card: PlanCard; plan: HyperliquidPlan }
  | { ok: false; error: string };

export type HyperliquidInput = {
  fromChain: ChainKey;
  amount: string; // human decimal USDC
  account: string; // EVM address; holds bridged USDC and is credited on HL
};

export function buildHyperliquidFund(
  input: HyperliquidInput,
  config: CctpConfig = DEFAULT_CCTP_CONFIG,
): HyperliquidResult {
  const { fromChain } = input;

  const route = planRoute("USDC", fromChain, "hyperliquid");
  if (!route.ok) return { ok: false, error: route.error };
  if (!SUPPORTED_ORIGINS.includes(fromChain)) {
    return { ok: false, error: `Funding Hyperliquid from ${fromChain} isn't supported yet — origin must be a CCTP-EVM chain (Ethereum / Base / Arbitrum). BNB and Solana compose via their own builders.` };
  }

  let account: Address;
  try {
    account = getAddress(input.account);
  } catch {
    return { ok: false, error: `"${input.account}" isn't a valid EVM address for the Hyperliquid account.` };
  }

  const arbitrumUsdc = config.usdc.arbitrum;
  if (!arbitrumUsdc) return { ok: false, error: "No Arbitrum USDC address configured." };

  const amountSmallest = toSmallestUnits(input.amount, USDC_DECIMALS);
  if (amountSmallest < HL_MIN_DEPOSIT_USDC) {
    return { ok: false, error: `Hyperliquid deposits below ${fromSmallestUnits(HL_MIN_DEPOSIT_USDC, USDC_DECIMALS)} USDC are lost by the bridge — increase the amount.` };
  }
  const amountStr = amountSmallest.toString();

  // Leg 1 — CCTP to Arbitrum (skipped when already on Arbitrum). The mint
  // recipient is `account`, which then signs the deposit.
  let cctp: CctpBurnPlan | null = null;
  if (fromChain !== "arbitrum") {
    const burn = buildCctp({ fromChain, toChain: "arbitrum", amount: input.amount, recipient: account }, config);
    if (!burn.ok) return { ok: false, error: `CCTP leg to Arbitrum failed: ${burn.error}` };
    cctp = burn.plan;
  }

  // Leg 2 — deposit on Arbitrum: USDC transfer(bridge, amount).
  const deposit: HlDepositLeg = {
    kind: "hl-deposit",
    chainId: 42161,
    usdc: arbitrumUsdc,
    bridge: HL_BRIDGE_ARBITRUM,
    amount: amountStr,
  };

  const human = fromSmallestUnits(amountSmallest, USDC_DECIMALS);
  const notes: string[] = [
    `Credited to ${account} on Hyperliquid — the address that signs the Arbitrum deposit IS the HyperCore account.`,
    `Minimum ${fromSmallestUnits(HL_MIN_DEPOSIT_USDC, USDC_DECIMALS)} USDC; smaller deposits are lost by the bridge.`,
    `Withdrawing back out later costs ${HL_WITHDRAWAL_FEE_USDC} USDC.`,
  ];
  if (cctp) notes.unshift("Two-step: CCTP mints native USDC on Arbitrum, then the deposit credits Hyperliquid.");

  const card: PlanCard = {
    rail: "hyperliquid",
    fromChain: route.hops[0].from,
    toChain: "Hyperliquid",
    tokenIn: "USDC",
    tokenOut: "HyperCore USDC",
    amountIn: human,
    minOut: human, // deposit is 1:1
    fees: [{ label: "Hyperliquid deposit", value: "free (1 USDC on later withdrawal)" }],
    etaSeconds: cctp ? 960 : 60,
    recipient: account,
    settledAsset: route.settledAsset, // "HyperCore USDC"
    trustModel: route.trustModel, // "validator"
    notes,
  };

  return { ok: true, card, plan: { kind: "hyperliquid-fund", cctp, deposit, account } };
}
