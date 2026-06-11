import { NextResponse } from "next/server";
import {
  CHAIN_TOKENS,
  SCOPE_CHAINS,
  type ChainKey,
  type ScopeToken,
} from "@/lib/chains";
import { getTokens, resolveAsset } from "@/lib/oneclick";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Live availability for the product's token×chain matrix: an entry is
// available when the 1-Click list can resolve it on that chain (Rail B), or
// when it rides the bAP3X OFT (Rail A). Entries solvers don't carry yet come
// back false and render as "soon" — they flip on automatically once listed.

export async function GET(req: Request) {
  if (!rateLimit(clientIp(req), "tokens", 30).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  try {
    const tokens = await getTokens();
    const availability: Record<string, Record<string, boolean>> = {};
    for (const chain of SCOPE_CHAINS) {
      availability[chain] = {};
      for (const tok of (CHAIN_TOKENS[chain] ?? []) as ScopeToken[]) {
        if (chain === "ap3x" || (tok === "AP3X" && chain === "base")) {
          availability[chain][tok] = true; // Rail A (bAP3X LayerZero OFT)
          continue;
        }
        availability[chain][tok] = resolveAsset(tokens, chain as ChainKey, tok) != null;
      }
    }
    return NextResponse.json({ availability });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "token list failed" },
      { status: 502 },
    );
  }
}
