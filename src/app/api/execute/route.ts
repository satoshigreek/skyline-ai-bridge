import { NextResponse } from "next/server";
import { CHAINS, SPEND_CAP_USD } from "@/lib/chains";
import { IntentSchema, isComplete, effectiveTokenOut, type Intent } from "@/lib/intent";
import { routeIntent } from "@/lib/router";
import { buildRailBCard } from "@/lib/build";
import { getTokens, requestQuote, resolveAsset } from "@/lib/oneclick";
import { toSmallestUnits } from "@/lib/units";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Rail B execution step: turns a user CONFIRMATION into a real 1-Click quote
// (which creates the deposit address). Rail A has no server leg — it executes
// client-side against the OFT contract with the user's wallet.
//
// The spend cap is enforced HERE for Rail B (server-side), not just in the UI:
// above the cap the request must carry confirmedAmount === intent.amount,
// which the UI only sets after the user retypes the amount.

const SLIPPAGE_BPS = 100;

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "execute", 10).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let intent: Intent;
  let sender: string;
  let confirmedAmount: string | undefined;
  try {
    const body = (await req.json()) as {
      intent?: unknown;
      sender?: unknown;
      confirmedAmount?: unknown;
    };
    intent = IntentSchema.parse(body.intent);
    if (typeof body.sender !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(body.sender)) {
      return NextResponse.json({ error: "A connected Base wallet is required." }, { status: 422 });
    }
    sender = body.sender;
    confirmedAmount =
      typeof body.confirmedAmount === "string" ? body.confirmedAmount : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!isComplete(intent)) {
    return NextResponse.json({ error: "Intent incomplete." }, { status: 422 });
  }
  const decision = routeIntent(intent);
  if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: 422 });
  if (decision.rail !== "A" && decision.rail !== "B") {
    return NextResponse.json({ error: "Unroutable intent." }, { status: 422 });
  }
  if (decision.rail === "A") {
    return NextResponse.json(
      { error: "Rail A executes in your wallet — no server step." },
      { status: 422 },
    );
  }

  const to = intent.toChain!;
  const recipient =
    intent.recipient ?? (CHAINS[to].family === "evm" ? sender : null);
  if (!recipient) {
    return NextResponse.json(
      { error: `A ${CHAINS[to].label} recipient address is required.` },
      { status: 422 },
    );
  }

  try {
    const from = intent.fromChain!;
    const tokens = await getTokens();
    const tokenInInfo = resolveAsset(tokens, from, intent.tokenIn!);
    const tokenOutInfo = resolveAsset(tokens, to, effectiveTokenOut(intent)!);
    if (!tokenInInfo || !tokenOutInfo) {
      return NextResponse.json({ error: "Token route no longer available." }, { status: 422 });
    }
    // A signable transfer needs either the chain's native coin or an ERC-20
    // contract address — refuse anything else before quoting for real.
    const NATIVE: Record<string, string> = { base: "ETH", bsc: "BNB" };
    if (tokenInInfo.symbol !== NATIVE[from] && !tokenInInfo.contractAddress) {
      return NextResponse.json(
        { error: `Can't build a wallet transfer for ${tokenInInfo.symbol} on ${CHAINS[from].label} — no token contract published. Nothing was sent.` },
        { status: 422 },
      );
    }

    const amountSmallest = toSmallestUnits(intent.amount!, tokenInInfo.decimals).toString();

    // Server-side spend cap: price the input before committing.
    const usdIn =
      typeof tokenInInfo.price === "number"
        ? Number(intent.amount) * tokenInInfo.price
        : null;
    if (usdIn != null && usdIn > SPEND_CAP_USD && confirmedAmount !== intent.amount) {
      return NextResponse.json(
        {
          capExceeded: true,
          usdIn,
          cap: SPEND_CAP_USD,
          message: `This is ≈ $${usdIn.toFixed(0)}, above the $${SPEND_CAP_USD} cap — retype the amount to proceed.`,
        },
        { status: 403 },
      );
    }

    const { quote } = await requestQuote({
      dry: false, // the real thing: creates the deposit address
      originAsset: tokenInInfo.assetId,
      destinationAsset: tokenOutInfo.assetId,
      amount: amountSmallest,
      recipient,
      refundTo: sender,
      slippageBps: SLIPPAGE_BPS,
    });

    const { card, plan } = buildRailBCard(intent, quote, tokenInInfo, tokenOutInfo, recipient);
    if (!plan) {
      return NextResponse.json(
        { error: "1-Click did not return a deposit address. Nothing was sent." },
        { status: 502 },
      );
    }
    return NextResponse.json({ rail: "B", card, plan });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Execution setup failed";
    return NextResponse.json(
      { error: `${msg.slice(0, 300)} — your funds never left your wallet.` },
      { status: 502 },
    );
  }
}
