import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { type Intent } from "@/lib/intent";
import { heuristicParse } from "@/lib/heuristic";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { composeUserText, parseWithClaude, type Exchange } from "@/lib/claudeParse";

export const runtime = "nodejs";

// Natural language -> typed Intent. Forced tool-use, zod-validated; one retry
// with the validation error, then the regex heuristic takes over. The model
// NEVER decides the rail or builds transactions.

export async function POST(req: Request) {
  if (!rateLimit(clientIp(req), "parse", 20).allowed) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }

  let prompt = "";
  let exchanges: Exchange[] = [];
  try {
    const body = (await req.json()) as { prompt?: unknown; exchanges?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1000) : "";
    if (Array.isArray(body.exchanges)) {
      exchanges = body.exchanges
        .filter(
          (e): e is Exchange =>
            typeof (e as Exchange)?.question === "string" &&
            typeof (e as Exchange)?.answer === "string",
        )
        .slice(0, 2);
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ error: "Empty prompt." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const heuristicText =
    exchanges.length > 0 ? `${prompt} ${exchanges.map((e) => e.answer).join(" ")}` : prompt;

  if (!apiKey) {
    return NextResponse.json({ intent: heuristicParse(heuristicText), engine: "heuristic" });
  }

  const client = new Anthropic({ apiKey });
  const haiku = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const userText = composeUserText(prompt, exchanges);

  try {
    let intent: Intent;
    try {
      intent = await parseWithClaude(client, haiku, userText);
    } catch (firstErr) {
      intent = await parseWithClaude(
        client,
        haiku,
        userText,
        firstErr instanceof Error ? firstErr.message.slice(0, 300) : "invalid output",
      );
    }
    // Low confidence -> one escalation to the stronger model.
    if (intent.confidence < 0.5) {
      try {
        const better = await parseWithClaude(client, "claude-sonnet-4-6", userText);
        if (better.confidence > intent.confidence) intent = better;
      } catch {
        // keep the haiku result
      }
    }
    return NextResponse.json({ intent, engine: "claude" });
  } catch (err) {
    return NextResponse.json({
      intent: heuristicParse(heuristicText),
      engine: "heuristic-fallback",
      warning: err instanceof Error ? err.message.slice(0, 200) : "LLM parse failed",
    });
  }
}
