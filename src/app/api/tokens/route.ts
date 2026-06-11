import { NextResponse } from "next/server";
import { CHAINS } from "@/lib/chains";
import { getTokens } from "@/lib/oneclick";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Trimmed token list for the manual form: which symbols exist per chain key.

export async function GET(req: Request) {
  if (!rateLimit(clientIp(req), "tokens", 30).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  try {
    const tokens = await getTokens();
    const byChain: Record<string, string[]> = {};
    for (const [key, info] of Object.entries(CHAINS)) {
      if (!info.oneClickId) continue;
      byChain[key] = [
        ...new Set(
          tokens
            .filter((t) => t.blockchain === info.oneClickId && typeof t.price === "number")
            .map((t) => t.symbol),
        ),
      ].sort();
    }
    // Rail A destination tokens.
    byChain["ap3x"] = ["AP3X", "bAP3X", "USDC"];
    return NextResponse.json({ byChain });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "token list failed" },
      { status: 502 },
    );
  }
}
