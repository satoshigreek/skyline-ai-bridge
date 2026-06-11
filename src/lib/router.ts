import {
  CHAINS,
  CHAIN_TOKENS,
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
  const tokenInNorm = tokenIn === "bAP3X" ? "AP3X" : tokenIn;
  if (!fromTokens.includes(tokenInNorm as (typeof fromTokens)[number])) {
    return {
      ok: false,
      error: `${tokenIn} isn't available on ${CHAINS[from].label}. There: ${fromTokens.join(", ")}.`,
    };
  }

  // Rail A: anything touching Apex Fusion goes over the bAP3X LayerZero OFT.
  if (to === "ap3x") {
    if (from !== "base") {
      return {
        ok: false,
        error: "Apex Fusion is reached from Base (the bAP3X OFT lives there). Bridge to Base first.",
      };
    }
    if (!RAIL_A_TOKENS.includes(tokenIn as RailAToken)) {
      return {
        ok: false,
        error: `Only AP3X (bAP3X) bridges to Apex Fusion today — ${tokenIn} isn't supported on that route.`,
      };
    }
    if (tokenOut !== tokenIn && !(tokenIn === "bAP3X" && tokenOut === "AP3X") && !(tokenIn === "AP3X" && tokenOut === "AP3X")) {
      return {
        ok: false,
        error: `The Apex Fusion route bridges AP3X to itself — it can't swap ${tokenIn} into ${tokenOut}.`,
      };
    }
    return { ok: true, rail: "A", railLabel: "LayerZero OFT" };
  }

  if (tokenIn === "AP3X" || tokenIn === "bAP3X") {
    return {
      ok: false,
      error: "AP3X only bridges Base ↔ Apex Fusion (LayerZero OFT) for now.",
    };
  }

  // Rail B: every other in-scope pair rides NEAR Intents.
  if (CHAINS[to].oneClickId) {
    return { ok: true, rail: "B", railLabel: "NEAR Intents (1-Click)" };
  }

  return { ok: false, error: `${CHAINS[to].label} isn't reachable. Destinations: ${SCOPE_LABELS}.` };
}
