import { NextResponse } from "next/server";
import { createPublicClient, http, type Address } from "viem";
import { base, bsc } from "viem/chains";
import { apexDecimals, CHAINS } from "@/lib/chains";
import { IntentSchema, isComplete, effectiveTokenOut, type Intent } from "@/lib/intent";
import { routeIntent } from "@/lib/router";
import { buildRailAPlan, OFT_ABI, serializeRailAPlan } from "@/lib/oft";
import { buildRailACard, buildRailBCard, buildRailCCard, type RailCEvmPlan, type RailCCardanoPlan } from "@/lib/build";
import { getTokens, requestQuote, resolveAsset } from "@/lib/oneclick";
import { createEth, getBridgingAddresses, getCardanoTxFee, routeAllowed, srcTokenId } from "@/lib/skyline";
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

      // Live LayerZero fee from the AP3X OFT on the origin chain.
      const client = createPublicClient({
        chain: intent.fromChain === "bsc" ? bsc : base,
        transport: http(),
      });
      const msgFee = (await client.readContract({
        address: built.plan.oftAddress,
        abi: OFT_ABI,
        functionName: "quoteSend",
        args: [built.plan.sendParam, false],
      })) as { nativeFee: bigint; lzTokenFee: bigint };
      const fee = msgFee.nativeFee;
      const card = buildRailACard(intent, built.plan, fee);
      return NextResponse.json({
        rail: "A",
        card,
        planA: serializeRailAPlan(built.plan, fee),
      });
    }

    // ---- Rail C (Apex Fusion internal — Skyline native bridge) ----
    if (decision.rail === "C") {
      const from = intent.fromChain!;
      const to = intent.toChain!;
      const tokenID = srcTokenId(from, intent.tokenIn!);
      if (tokenID == null) {
        return NextResponse.json(
          { error: `${intent.tokenIn} can't be sent from ${CHAINS[from].label}.` },
          { status: 422 },
        );
      }
      const allowed = await routeAllowed(from, to, tokenID);
      if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: 422 });

      const recipient = intent.recipient ?? null;
      if (!recipient) {
        return NextResponse.json({
          rail: "C",
          needsRecipient: true,
          message: `${CHAINS[to].label} uses its own address format — what address should receive the funds?`,
        });
      }
      // Nexus (EVM) origin needs the connected EVM wallet as sender. UTXO
      // origins (prime/vector/cardano) can fee-quote with a bridging address as
      // a stand-in sender — the real Cardano address is supplied by the CIP-30
      // wallet at execute time.
      const evmOrigin = CHAINS[from].family === "evm";
      if (evmOrigin && !sender) {
        return NextResponse.json(
          { error: `Connect your ${CHAINS[from].label} (EVM) wallet first — it signs on the source chain.` },
          { status: 422 },
        );
      }

      const decimals = apexDecimals(from);
      const amountSmallest = toSmallestUnits(intent.amount!, decimals).toString();
      const apexFrom = CHAINS[from].apexId!;
      const apexTo = CHAINS[to].apexId!;

      if (CHAINS[from].family === "evm") {
        // Nexus EVM origin — createEth builds the tx + fees in one call.
        // sender is guaranteed by the evmOrigin guard above.
        const evmSender = sender as string;
        const eth = await createEth({
          senderAddress: evmSender,
          originChain: apexFrom,
          destinationChain: apexTo,
          destinationAddress: recipient,
          amount: amountSmallest,
          tokenID,
        });
        const plan: RailCEvmPlan = {
          kind: "railC-evm",
          chainId: 9069,
          originChain: apexFrom,
          destinationChain: apexTo,
          destinationAddress: recipient,
          senderAddress: evmSender,
          amountSmallest,
          tokenID,
          approvalTx: eth.approvalTx
            ? { to: eth.approvalTx.to, data: eth.approvalTx.data, value: eth.approvalTx.value ?? null }
            : null,
          bridgingTx: {
            to: eth.bridgingTx.ethTx.to,
            data: eth.bridgingTx.ethTx.data,
            value: eth.bridgingTx.ethTx.value ?? null,
          },
          bridgingFee: eth.bridgingTx.bridgingFee,
          operationFee: eth.bridgingTx.operationFee,
        };
        const card = buildRailCCard(intent, plan, decimals);
        return NextResponse.json({ rail: "C", card, planC: plan });
      }

      // UTXO origin (prime / vector / cardano) — fee now, build tx at execute.
      const feeSender =
        sender && /^(addr1|addr_test1|stake)/.test(sender)
          ? sender
          : (await getBridgingAddresses(apexFrom))[0];
      if (!feeSender) {
        return NextResponse.json({ error: `No ${CHAINS[from].label} address available for the fee quote.` }, { status: 502 });
      }
      const fee = await getCardanoTxFee({
        senderAddress: feeSender,
        originChain: apexFrom,
        destinationChain: apexTo,
        destinationAddress: recipient,
        amount: amountSmallest,
        tokenID,
      });
      const plan: RailCCardanoPlan = {
        kind: "railC-cardano",
        originChain: apexFrom,
        destinationChain: apexTo,
        destinationAddress: recipient,
        senderAddress: feeSender, // real Cardano sender substituted at execute
        amountSmallest,
        tokenID,
        bridgingFee: fee.bridgingFee,
        operationFee: fee.operationFee,
      };
      const card = buildRailCCard(intent, plan, decimals, fee.fee);
      return NextResponse.json({ rail: "C", card, planC: plan });
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

    const from = intent.fromChain!;
    const tokens = await getTokens();
    const tokenInInfo = resolveAsset(tokens, from, intent.tokenIn!);
    if (!tokenInInfo) {
      return NextResponse.json(
        { error: `${intent.tokenIn} isn't available on ${CHAINS[from].label} via NEAR Intents.` },
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
