import { NextResponse } from "next/server";
import { submitActivated, type SubmitBody } from "@/lib/skyline";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Rail C — register a signed+broadcast source tx so the Skyline validators
// pick it up and we can track it to the destination.

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "apexSubmit", 20).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  let body: SubmitBody;
  try {
    body = (await req.json()) as SubmitBody;
    if (!body.originTxHash || !body.originChain) throw new Error("missing fields");
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  try {
    const result = await submitActivated({ ...body, isLayerZero: false });
    return NextResponse.json(result);
  } catch (err) {
    // The source tx is already on-chain; validators also watch directly. Report
    // the failure but make clear funds aren't lost.
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message.slice(0, 220) : "submit failed",
        note: "Your source transaction is on-chain; the bridge watches the source directly.",
      },
      { status: 502 },
    );
  }
}
