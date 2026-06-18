import { getAddress } from "viem";
import { CHAINS, type ChainKey } from "./chains";
import { planRoute, type PlanCard, type Rail } from "./routes";

// ---------------------------------------------------------------------------
// AP3X rail builder (docs/ROUTING_SPEC.md §4) — re-expresses the AP3X mesh on
// the canonical router. Produces the ordered legs (OFT across the EVM mesh,
// Reactor inside Apex Fusion + Cardano) and the review card from one input.
//
// AP3X bridges 1:1 (minus per-leg fees, resolved at execution). The concrete
// LayerZero quoteSend (OFT) and Skyline native API calls (Reactor) already
// live in oft.ts / skyline.ts; this builder owns the routing + card so the
// engine has a single AP3X entry point. Per-leg smallest-unit conversion is
// done at execution (OFT = 18 dp, Apex UTXO legs = 6 dp).
// ---------------------------------------------------------------------------

export type Ap3xLeg = {
  rail: Extract<Rail, "oft" | "reactor">;
  from: ChainKey;
  to: ChainKey;
  fromRep: string; // AP3X representation on the source of this leg
  toRep: string; // representation on the destination of this leg
};

export type Ap3xPlan = {
  kind: "ap3x";
  legs: Ap3xLeg[];
  amount: string; // human decimal (1:1 across legs)
  recipient: string; // final recipient on the destination chain
};

export type Ap3xResult = { ok: true; card: PlanCard; plan: Ap3xPlan } | { ok: false; error: string };

export type Ap3xInput = { fromChain: ChainKey; toChain: ChainKey; amount: string; recipient: string };

function ap3xRep(chain: ChainKey): string {
  if (chain === "base") return "bAP3X";
  if (chain === "bsc") return "bnAP3X";
  if (chain === "cardano") return "cAP3X";
  return "AP3X";
}

// Validate the final recipient against the destination chain's address family.
function recipientValid(chain: ChainKey, r: string): { ok: true; value: string } | { ok: false } {
  const s = r.trim();
  if (!s) return { ok: false };
  if (CHAINS[chain].family === "evm") {
    try {
      return { ok: true, value: getAddress(s) };
    } catch {
      return { ok: false };
    }
  }
  // Cardano / Apex UTXO chains — light bech32-ish check.
  if (/^addr(_test)?1|^[a-z]+1[0-9a-z]{8,}/.test(s)) return { ok: true, value: s };
  return { ok: false };
}

export function buildAp3x(input: Ap3xInput): Ap3xResult {
  const { fromChain, toChain } = input;

  const route = planRoute("AP3X", fromChain, toChain);
  if (!route.ok) return { ok: false, error: route.error };

  const rv = recipientValid(toChain, input.recipient);
  if (!rv.ok) return { ok: false, error: `"${input.recipient}" isn't a valid recipient for ${CHAINS[toChain].label}.` };

  if (!/^\d+(\.\d+)?$/.test(input.amount) || Number(input.amount) <= 0) {
    return { ok: false, error: "Amount must be a positive decimal." };
  }

  const legs: Ap3xLeg[] = route.hops.map((h) => ({
    rail: h.rail as Ap3xLeg["rail"],
    from: h.from,
    to: h.to,
    fromRep: ap3xRep(h.from),
    toRep: ap3xRep(h.to),
  }));

  const card: PlanCard = {
    rail: route.rail,
    fromChain: CHAINS[fromChain].label,
    toChain: CHAINS[toChain].label,
    tokenIn: ap3xRep(fromChain),
    tokenOut: ap3xRep(toChain),
    amountIn: input.amount,
    minOut: input.amount, // 1:1; per-leg fees deducted at execution
    fees: [{ label: legs.length > 1 ? "Per-leg bridge fees" : route.rail === "oft" ? "LayerZero fee" : "Skyline bridging fee", value: "quoted at execution" }],
    etaSeconds: route.rail === "oft" && legs.length === 1 ? 120 : 600,
    recipient: rv.value,
    settledAsset: route.settledAsset,
    trustModel: route.trustModel,
    notes: route.notes.length ? route.notes : ["AP3X bridges 1:1; the wallet shows exact calldata per leg."],
  };

  return { ok: true, card, plan: { kind: "ap3x", legs, amount: input.amount, recipient: rv.value } };
}
