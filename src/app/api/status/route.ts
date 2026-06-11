import { NextResponse } from "next/server";
import { getStatus, submitDeposit } from "@/lib/oneclick";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// GET  ?depositAddress=…       -> 1-Click swap status
// POST { txHash, depositAddress } -> notify 1-Click of the user's deposit tx

export async function GET(req: Request) {
  if (!rateLimit(clientIp(req), "status", 120).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const depositAddress = new URL(req.url).searchParams.get("depositAddress");
  if (!depositAddress) {
    return NextResponse.json({ error: "depositAddress required." }, { status: 400 });
  }
  try {
    const status = await getStatus(depositAddress);
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "status failed" },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "status", 30).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  try {
    const { txHash, depositAddress } = (await req.json()) as {
      txHash?: string;
      depositAddress?: string;
    };
    if (!txHash || !depositAddress) {
      return NextResponse.json({ error: "txHash and depositAddress required." }, { status: 400 });
    }
    const result = await submitDeposit(txHash, depositAddress);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    // Submission is best-effort — solvers also watch the chain directly.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "submit failed" },
      { status: 200 },
    );
  }
}
