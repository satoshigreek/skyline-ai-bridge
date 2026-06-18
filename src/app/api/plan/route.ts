import { NextResponse } from "next/server";
import { z } from "zod";
import { ChainKeyEnum } from "@/lib/intent";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { buildPlan } from "@/lib/engine";

export const runtime = "nodejs";

// Canonical routing entry point (docs/ROUTING_SPEC.md). Takes a normalized
// request, returns the review card + the signed-transaction plan that the
// client executor consumes. The engine picks the rail deterministically and
// builds the card from the SAME validated input as the plan (card ≡ calldata).
// Builders refuse to emit a plan against unconfigured contract addresses, so an
// unset ⟨VERIFY⟩ env surfaces here as a clear, safe error rather than bad calldata.

const PlanRequestSchema = z.object({
  asset: z.enum(["AP3X", "USDC"]),
  fromChain: ChainKeyEnum,
  toChain: ChainKeyEnum,
  amount: z.string().regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string"),
  recipient: z.string().min(1),
  account: z.string().min(1).optional(), // Hyperliquid: credited HyperCore account
  ethereumSender: z.string().min(1).optional(), // xReserve: Ethereum-side signer
  fast: z.boolean().optional(), // CCTP Fast Transfer
});

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "plan", 30).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const result = buildPlan(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ rail: result.rail, card: result.card, plan: result.plan });
}
