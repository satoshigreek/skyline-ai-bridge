import { describe, expect, it } from "vitest";
import {
  SCOPE_TOKENS,
  CHAIN_TOKENS,
  TOKEN_DISPLAY,
  APEX_TOKEN_IDS,
  type ScopeToken,
} from "../src/lib/chains";

// docs/ROUTING_SPEC.md §0 — the engine's asset scope is AP3X and USDC ONLY.
// This test is the CI guard: it fails if any other transferable asset is
// reintroduced into the scope enum, the chain matrix, the display map, or the
// Rail C token-id table. (ADA/ETH remain only as gas/fee currencies, which are
// not in any of these scope structures.)

const ALLOWED: ScopeToken[] = ["AP3X", "USDC"];
// AP3X per-chain representations and USDC are the only labels the matrices may
// reference. These are representations of the two families, not new assets.
const ALLOWED_LABELS = new Set(["AP3X", "bAP3X", "bnAP3X", "cAP3X", "USDC"]);

describe("asset scope — AP3X and USDC only", () => {
  it("the scope token enum is exactly {AP3X, USDC}", () => {
    expect([...SCOPE_TOKENS].sort()).toEqual([...ALLOWED].sort());
  });

  it("every chain's token matrix lists only scope tokens", () => {
    for (const [chain, tokens] of Object.entries(CHAIN_TOKENS)) {
      for (const t of tokens) {
        expect(ALLOWED, `${chain} lists out-of-scope token ${t}`).toContain(t);
      }
    }
  });

  it("display labels resolve only to AP3X/USDC representations", () => {
    for (const perChain of Object.values(TOKEN_DISPLAY)) {
      for (const label of Object.values(perChain ?? {})) {
        expect(ALLOWED_LABELS, `unexpected display label ${label}`).toContain(label);
      }
    }
  });

  it("Rail C token-id table carries only AP3X (and its cAP3X wrap)", () => {
    expect(Object.keys(APEX_TOKEN_IDS).sort()).toEqual(["AP3X", "cAP3X"]);
  });
});
