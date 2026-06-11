import {
  CHAINS,
  CHAIN_TOKENS,
  normalizeAp3x,
  RAIL_A_TOKENS,
  SCOPE_CHAINS,
  SCOPE_ORIGINS,
  type RailAToken,
} from "./chains";
import { effectiveTokenOut, isComplete, type Intent } from "./intent";

// Deterministic rail selection. Plain code — the LLM has no say here.
// Re-validates the parser's claims and enforces the product scope:
// chains Base / BNB / Apex Fusion / Cardano, tokens AP3X USDC USDT ADA ETH BTC.

export type RouteDecision =
  | { ok: true; rail: "A" | "B"; railLabel: string }
  | { ok: false; error: string };

const SCOPE_LABELS = SCOPE_CHAINS.map((c) => CHAINS[c].label).join(", ");

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
  if (!SCOPE_ORIGINS.includes(from)) {
    if (SCOPE_CHAINS.includes(from)) {
      return {
        ok: false,
        error: `Sending FROM ${CHAINS[from].label} needs a ${CHAINS[from].label} wallet — not wired yet. You can receive on ${CHAINS[from].label}; sources today: Base and BNB Chain.`,
      };
    }
    return {
      ok: false,
      error: `This app sends from Base or BNB Chain only (you asked to start from ${CHAINS[from]?.label ?? from}).`,
    };
  }

  if (from === to) {
    return {
      ok: false,
      error: `Source and destination are both ${CHAINS[from].label} — same-chain swaps aren't supported. Destinations: ${SCOPE_LABELS}.`,
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

  // Rail A: the AP3X OFT mesh — bAP3X (Base) ↔ bnAP3X (BNB) ↔ AP3X (Apex).
  const isFamilyA = RAIL_A_TOKENS.includes(tokenIn as RailAToken);
  if (isFamilyA || to === "ap3x") {
    if (!isFamilyA) {
      return {
        ok: false,
        error: `Only AP3X (bAP3X / bnAP3X) bridges to Apex Fusion today — ${tokenIn} isn't supported on that route.`,
      };
    }
    const MESH: typeof to[] = ["base", "bsc", "ap3x"];
    if (!MESH.includes(to)) {
      return {
        ok: false,
        error: "AP3X moves between Base, BNB Chain and Apex Fusion (LayerZero OFT mesh).",
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

  // Rail B: every other in-scope pair rides NEAR Intents.
  if (CHAINS[to].oneClickId) {
    return { ok: true, rail: "B", railLabel: "NEAR Intents (1-Click)" };
  }

  return { ok: false, error: `${CHAINS[to].label} isn't reachable. Destinations: ${SCOPE_LABELS}.` };
}
