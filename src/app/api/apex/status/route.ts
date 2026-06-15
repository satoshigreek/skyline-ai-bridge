import { NextResponse } from "next/server";
import { getBridgeTx } from "@/lib/skyline";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Rail C — poll a Skyline bridge transaction by id.

export async function GET(req: Request) {
  if (!rateLimit(clientIp(req), "apexStatus", 120).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "valid id required." }, { status: 400 });
  }
  try {
    const tx = await getBridgeTx(id);
    return NextResponse.json(tx);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "status failed" },
      { status: 502 },
    );
  }
}
