import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { CHAINS } from "@/lib/chains";
import { IntentSchema, isComplete, effectiveTokenOut, type Intent } from "@/lib/intent";
import { routeIntent } from "@/lib/router";
import { buildRailAPlan, mockRailAFee, OFT_ABI, serializeRailAPlan } from "@/lib/oft";
import { buildRailACard, buildRailBCard } from "@/lib/build";
import { getTokens, requestQuote, resolveAsset } from "@/lib/oneclick";
import { toSmallestUnits } from "@/lib/units";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

// Quote = the data behind the review card. Rail A reads quoteSend on Base (or
// simulates in mock mode); Rail B asks 1-Click for a DRY quote — no deposit
// address is created until the user confirms (see /api/execute).

const SLIPPAGE_BPS = 100; // 1% for Rail B quotes

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "quote", 30).allowed) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  let intent: Intent;
  let sender: string | undefined;
  try {
    const body = (await req.json()) as { intent?: unknown; sender?: unknown };
    intent = IntentSchema.parse(body.intent);
    sender = typeof body.sender === "string" ? body.sender : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid intent payload." }, { status: 400 });
  }

  if (!isComplete(intent)) {
    return NextResponse.json(
      { error: "Intent incomplete", clarifyingQuestion: intent.clarifyingQuestion },
      { status: 422 },
    );
  }

  const decision = routeIntent(intent);
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: 422 });
  }

  try {
    if (decision.rail === "A") {
      const built = buildRailAPlan(intent, sender as Address | undefined);
      if (!built.ok) return NextResponse.json({ error: built.error }, { status: 422 });

      let fee: bigint;
      if (built.plan.mocked) {
        fee = mockRailAFee(built.plan);
      } else {
        const client = createPublicClient({ chain: base, transport: http() });
        const msgFee = (await client.readContract({
          address: built.plan.oftAddress!,
          abi: OFT_ABI,
          functionName: "quoteSend",
          args: [built.plan.sendParam, false],
        })) as { nativeFee: bigint; lzTokenFee: bigint };
        fee = msgFee.nativeFee;
      }
      const card = buildRailACard(intent, built.plan, fee);
      return NextResponse.json({
        rail: "A",
        card,
        planA: serializeRailAPlan(built.plan, fee),
      });
    }

    // ---- Rail B (NEAR Intents) ----
    const to = intent.toChain!;
    // EVM destinations can default to the sender; other VMs need an explicit
    // address in that chain's format.
    let recipient = intent.recipient ?? null;
    if (!recipient) {
      if (CHAINS[to].family === "evm" && sender) recipient = sender;
      else {
        return NextResponse.json({
          rail: "B",
          needsRecipient: true,
          message: `${CHAINS[to].label} uses its own address format — what address should receive the funds?`,
        });
      }
    }
    if (!sender) {
      return NextResponse.json(
        { error: "Connect your Base wallet first — it's needed as the refund address." },
        { status: 422 },
      );
    }

    const tokens = await getTokens();
    const tokenInInfo = resolveAsset(tokens, "base", intent.tokenIn!);
    if (!tokenInInfo) {
      const available = [
        ...new Set(tokens.filter((t) => t.blockchain === "base").map((t) => t.symbol)),
      ]
        .slice(0, 10)
        .join(", ");
      return NextResponse.json(
        { error: `${intent.tokenIn} isn't available on Base via NEAR Intents. Available: ${available}.` },
        { status: 422 },
      );
    }
    const outSymbol = effectiveTokenOut(intent)!;
    const tokenOutInfo = resolveAsset(tokens, to, outSymbol);
    if (!tokenOutInfo) {
      const available = [
        ...new Set(
          tokens.filter((t) => t.blockchain === CHAINS[to].oneClickId).map((t) => t.symbol),
        ),
      ]
        .slice(0, 10)
        .join(", ");
      return NextResponse.json(
        { error: `${outSymbol} isn't available on ${CHAINS[to].label}. Available there: ${available}.` },
        { status: 422 },
      );
    }

    const amountSmallest = toSmallestUnits(intent.amount!, tokenInInfo.decimals).toString();
    const { quote } = await requestQuote({
      dry: true,
      originAsset: tokenInInfo.assetId,
      destinationAsset: tokenOutInfo.assetId,
      amount: amountSmallest,
      recipient,
      refundTo: sender,
      slippageBps: SLIPPAGE_BPS,
    });

    const { card } = buildRailBCard(intent, quote, tokenInInfo, tokenOutInfo, recipient);
    return NextResponse.json({ rail: "B", card });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Quote failed";
    return NextResponse.json(
      { error: `Couldn't get a quote: ${msg.slice(0, 300)}. Your funds never left your wallet.` },
      { status: 502 },
    );
  }
}
