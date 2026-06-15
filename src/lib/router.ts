import {
  APEX_UTXO_ORIGINS,
  CHAINS,
  CHAIN_TOKENS,
  isApexRoute,
  normalizeAp3x,
  RAIL_A_TOKENS,
  SCOPE_CHAINS,
  SCOPE_ORIGINS,
  type ChainKey,
  type RailAToken,
} from "./chains";
import { effectiveTokenOut, isComplete, type Intent } from "./intent";

// Deterministic rail selection. Plain code — the LLM has no say here.
// Re-validates the parser's claims and enforces the product scope:
//   Rail A  LayerZero OFT mesh   Base / BNB <-> Nexus (AP3X)
//   Rail B  NEAR Intents 1-Click everything else cross-chain (USDC/USDT/ADA/ETH/BTC)
//   Rail C  Skyline native API   Apex Fusion internal: Nexus<->Prime, Prime<->Vector, Prime<->Cardano

export type RouteDecision =
  | { ok: true; rail: "A" | "B" | "C"; railLabel: string }
  | { ok: false; error: string };

const SCOPE_LABELS = SCOPE_CHAINS.map((c) => CHAINS[c].label).join(", ");
const APEX_LABELS = "Nexus↔Prime, Prime↔Vector, Prime↔Cardano";

export function routeIntent(intent: Intent): RouteDecision {
  if (!isComplete(intent)) {
    return { ok: false, error: "Intent is incomplete — answer the clarifying question first." };
  }
  const from = intent.fromChain!;
  const to = intent.toChain!;
  const tokenIn = intent.tokenIn!;
  const tokenOut = effectiveTokenOut(intent)!;

  if (Number(intent.amount) <= 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  if (!SCOPE_CHAINS.includes(to)) {
    return {
      ok: false,
      error: `${CHAINS[to]?.label ?? to} isn't supported here. Destinations: ${SCOPE_LABELS}.`,
    };
  }

  // ---- Rail C: Apex Fusion internal (Skyline native bridge) ----
  // Checked FIRST so the internal pairs never fall through to A/B. The token
  // pair is validated against live /settings in the quote step.
  if (isApexRoute(from, to)) {
    if (normalizeAp3x(tokenIn) !== "AP3X" && tokenIn !== "ADA") {
      return {
        ok: false,
        error: `Apex Fusion internal transfers move AP3X (or ADA on the Cardano leg) — not ${tokenIn}.`,
      };
    }
    return { ok: true, rail: "C", railLabel: "Skyline (Apex Fusion)" };
  }
  // An Apex internal chain involved, but not one of the supported pairs.
  if ((APEX_UTXO_ORIGINS.includes(from) || from === "nexus") && CHAINS[to].apexId) {
    return {
      ok: false,
      error: `That internal route isn't enabled. Apex Fusion internal transfers: ${APEX_LABELS}.`,
    };
  }

  if (!SCOPE_ORIGINS.includes(from)) {
    return {
      ok: false,
      error: `This app can't send from ${CHAINS[from]?.label ?? from}.`,
    };
  }

  if (from === to) {
    return {
      ok: false,
      error: `Source and destination are both ${CHAINS[from].label} — same-chain swaps aren't supported. Destinations: ${SCOPE_LABELS}.`,
    };
  }

  // Origins for Rail A/B are the EVM externals (Base/BNB). Apex chains only
  // originate Rail C (handled above).
  if (from !== "base" && from !== "bsc") {
    return {
      ok: false,
      error: `${CHAINS[from].label} can only send over Apex Fusion internal routes (${APEX_LABELS}).`,
    };
  }

  // Token must exist on the source chain in this scope.
  const fromTokens = CHAIN_TOKENS[from] ?? [];
  const tokenInNorm = normalizeAp3x(tokenIn);
  if (!fromTokens.includes(tokenInNorm as (typeof fromTokens)[number])) {
    return {
      ok: false,
      error: `${tokenIn} isn't available on ${CHAINS[from].label}. There: ${fromTokens.join(", ")}.`,
    };
  }

  // ---- Rail A: the AP3X OFT mesh — bAP3X (Base) ↔ bnAP3X (BNB) ↔ Nexus (AP3X) ----
  const isFamilyA = RAIL_A_TOKENS.includes(tokenIn as RailAToken);
  if (isFamilyA || to === "ap3x" || to === "nexus") {
    if (!isFamilyA) {
      return {
        ok: false,
        error: `Only AP3X (bAP3X / bnAP3X) bridges to Nexus today — ${tokenIn} isn't supported on that route.`,
      };
    }
    const MESH: ChainKey[] = ["base", "bsc", "ap3x", "nexus"];
    if (!MESH.includes(to)) {
      return {
        ok: false,
        error: "AP3X moves between Base, BNB Chain and Nexus (LayerZero OFT mesh).",
      };
    }
    if (normalizeAp3x(tokenOut) !== "AP3X") {
      return {
        ok: false,
        error: `The AP3X mesh bridges AP3X to itself — it can't swap ${tokenIn} into ${tokenOut}.`,
      };
    }
    return { ok: true, rail: "A", railLabel: "LayerZero OFT" };
  }

  // ---- Rail B: every other in-scope pair rides NEAR Intents ----
  if (CHAINS[to].oneClickId) {
    return { ok: true, rail: "B", railLabel: "NEAR Intents (1-Click)" };
  }

  return { ok: false, error: `${CHAINS[to].label} isn't reachable. Destinations: ${SCOPE_LABELS}.` };
}
