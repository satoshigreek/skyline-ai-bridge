import { CHAINS, RAIL_A_TOKENS, type RailAToken } from "./chains";
import { effectiveTokenOut, isComplete, type Intent } from "./intent";

// Deterministic rail selection. Plain code — the LLM has no say here.
// Re-validates the parser's claims before anything is quoted or built.

export type RouteDecision =
  | { ok: true; rail: "A" | "B"; railLabel: string }
  | { ok: false; error: string };

const SUPPORTED_DESTS = Object.values(CHAINS)
  .filter((c) => c.oneClickId || c.key === "ap3x")
  .map((c) => c.label)
  .join(", ");

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

  if (from !== "base") {
    return {
      ok: false,
      error: `This version initiates transfers from Base only (you asked to start from ${CHAINS[from].label}). Connect your Base wallet and move funds from Base.`,
    };
  }

  if (from === to) {
    return {
      ok: false,
      error: `Source and destination are both ${CHAINS[from].label} — same-chain swaps aren't supported yet. Supported destinations: ${SUPPORTED_DESTS}.`,
    };
  }

  // Rail A: anything touching Apex Fusion goes over the Skyline OFT.
  if (to === "ap3x") {
    if (!RAIL_A_TOKENS.includes(tokenIn as RailAToken)) {
      return {
        ok: false,
        error: `Only ${RAIL_A_TOKENS.join(", ")} can bridge to Apex Fusion today — ${tokenIn} isn't supported on that route.`,
      };
    }
    if (tokenOut !== tokenIn && !(tokenIn === "bAP3X" && tokenOut === "AP3X")) {
      return {
        ok: false,
        error: `The Apex Fusion route bridges a token to itself (${tokenIn} stays ${tokenIn}) — it can't swap ${tokenIn} into ${tokenOut}.`,
      };
    }
    return { ok: true, rail: "A", railLabel: "LayerZero OFT" };
  }

  // Rail B: every other cross-chain pair rides NEAR Intents.
  if (CHAINS[to].oneClickId) {
    return { ok: true, rail: "B", railLabel: "NEAR Intents (1-Click)" };
  }

  return {
    ok: false,
    error: `${CHAINS[to].label} isn't reachable yet. Supported destinations: ${SUPPORTED_DESTS}.`,
  };
}
