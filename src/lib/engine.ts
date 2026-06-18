import { type ChainKey } from "./chains";
import { planRoute, type Asset, type PlanCard } from "./routes";
import { buildCctp, DEFAULT_CCTP_CONFIG, type CctpBurnPlan, type CctpConfig } from "./cctp";
import { buildHyperliquidFund, type HyperliquidPlan } from "./hyperliquid";
import { buildXReserve, DEFAULT_XRESERVE_CONFIG, type XReservePlan, type XReserveConfig } from "./xreserve";
import { buildStargate, DEFAULT_STARGATE_CONFIG, type StargatePlan, type StargateConfig } from "./stargate";
import { buildAp3x, type Ap3xPlan } from "./ap3x";

// ---------------------------------------------------------------------------
// Engine dispatcher (docs/ROUTING_SPEC.md) — the single entry point. Resolves
// the canonical rail for a request and dispatches to the matching builder,
// returning a tagged { card, plan } the executors/UI consume. The card is
// always built from the same validated input as the plan (the card ≡ calldata
// invariant holds per rail).
// ---------------------------------------------------------------------------

export type EngineConfig = {
  cctp: CctpConfig;
  xreserve: XReserveConfig;
  stargate: StargateConfig;
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  cctp: DEFAULT_CCTP_CONFIG,
  xreserve: DEFAULT_XRESERVE_CONFIG,
  stargate: DEFAULT_STARGATE_CONFIG,
};

export type EngineRequest = {
  asset: Asset;
  fromChain: ChainKey;
  toChain: ChainKey;
  amount: string;
  recipient: string; // destination recipient (EVM / Cardano / Stacks / Canton)
  // Hyperliquid: the EVM account credited on HyperCore (defaults to recipient).
  account?: string;
  // xReserve: the Ethereum-side EVM address that holds bridged USDC and signs.
  ethereumSender?: string;
  fast?: boolean; // CCTP Fast Transfer
};

export type EngineResult =
  | { ok: true; rail: "cctp"; card: PlanCard; plan: CctpBurnPlan }
  | { ok: true; rail: "hyperliquid"; card: PlanCard; plan: HyperliquidPlan }
  | { ok: true; rail: "xreserve"; card: PlanCard; plan: XReservePlan }
  | { ok: true; rail: "stargate"; card: PlanCard; plan: StargatePlan }
  | { ok: true; rail: "oft" | "reactor"; card: PlanCard; plan: Ap3xPlan }
  | { ok: false; error: string };

export function buildPlan(req: EngineRequest, config: EngineConfig = DEFAULT_ENGINE_CONFIG): EngineResult {
  const { fromChain, toChain, amount, recipient } = req;

  if (req.asset === "AP3X") {
    const r = buildAp3x({ fromChain, toChain, amount, recipient });
    if (!r.ok) return r;
    return { ok: true, rail: r.card.rail as "oft" | "reactor", card: r.card, plan: r.plan };
  }

  // USDC — let the canonical router pick the rail, then dispatch.
  const route = planRoute("USDC", fromChain, toChain);
  if (!route.ok) return route;

  switch (route.rail) {
    case "cctp": {
      const r = buildCctp({ fromChain, toChain, amount, recipient, fast: req.fast }, config.cctp);
      return r.ok ? { ok: true, rail: "cctp", card: r.card, plan: r.plan } : r;
    }
    case "hyperliquid": {
      const r = buildHyperliquidFund({ fromChain, amount, account: req.account ?? recipient }, config.cctp);
      return r.ok ? { ok: true, rail: "hyperliquid", card: r.card, plan: r.plan } : r;
    }
    case "xreserve": {
      if (!req.ethereumSender) return { ok: false, error: "xReserve transfers need an Ethereum-side sender address (ethereumSender)." };
      const r = buildXReserve({ fromChain, toChain, amount, ethereumSender: req.ethereumSender, destinationRecipient: recipient }, config.xreserve);
      return r.ok ? { ok: true, rail: "xreserve", card: r.card, plan: r.plan } : r;
    }
    case "stargate": {
      const r = buildStargate({ fromChain, toChain, amount, recipient }, config.stargate);
      return r.ok ? { ok: true, rail: "stargate", card: r.card, plan: r.plan } : r;
    }
    default:
      return { ok: false, error: `No USDC builder for rail "${route.rail}".` };
  }
}
