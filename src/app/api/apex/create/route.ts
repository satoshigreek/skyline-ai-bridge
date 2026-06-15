import { NextResponse } from "next/server";
import { createCardano, type CreateBody } from "@/lib/skyline";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Rail C — build the Cardano-family bridging tx (prime/vector/cardano origin).
// Returns the unsigned txRaw for CIP-30 signing on the client. Nexus (EVM)
// origins don't use this — their ethTx is already built at quote time.

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "apexCreate", 10).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  let plan: CreateBody;
  try {
    const body = (await req.json()) as { plan?: CreateBody };
    if (!body.plan) throw new Error("missing plan");
    plan = body.plan;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  try {
    const tx = await createCardano({
      senderAddress: plan.senderAddress,
      originChain: plan.originChain,
      destinationChain: plan.destinationChain,
      destinationAddress: plan.destinationAddress,
      amount: plan.amount,
      tokenID: plan.tokenID,
      bridgingFee: plan.bridgingFee,
      operationFee: plan.operationFee,
    });
    return NextResponse.json({ tx });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "create failed";
    return NextResponse.json(
      { error: `${msg.slice(0, 300)} — your funds never left your wallet.` },
      { status: 502 },
    );
  }
}
