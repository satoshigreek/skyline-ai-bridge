import Anthropic from "@anthropic-ai/sdk";
import { IntentSchema, type Intent } from "./intent";

// Claude parsing internals — shared by /api/parse and the eval harness.
// Forced tool-use + zod validation; the model has no other output channel.

export const PARSE_SYSTEM = `You translate a user's plain-English request into a structured cross-chain intent for a bridge app whose home chain is Base.

Chains: base, ap3x (Apex Fusion), near, ethereum, arbitrum, solana, bitcoin, bsc, optimism, polygon, avalanche, cardano.
Common tokens: USDC, USDT, DAI, ETH, WETH, BTC, NEAR, SOL, ADA, AP3X, bAP3X.

Rules:
- Never invent an amount, token, or chain the user didn't express. Use null for anything missing.
- amount is a positive decimal STRING. amountSide is "out" when the user states what they want to RECEIVE ("I want 100 USDC on near"), else "in".
- tokenOut: only when different from tokenIn (swaps). For bridges/sends of the same token, use null.
- fromChain: default "base" when unstated (this app's wallet lives on Base).
- toChain: infer from an unambiguous output token (NEAR->near, BTC->bitcoin, SOL->solana, ADA->cardano, AP3X->ap3x) or a .near recipient; otherwise null.
- recipient: an explicit address (0x… or name.near) if given, else null (means: the connected wallet).
- action: "swap" when tokenOut differs; "send" when there's an explicit recipient and no token change; "quote_only" when they only ask the cost/price; else "bridge".
- If a REQUIRED field (tokenIn or the output token, amount, toChain) is missing or ambiguous, set clarifyingQuestion to ONE short question and leave the unknown fields null. Otherwise clarifyingQuestion must be null.
- confidence 0..1.
- Respond ONLY by calling record_intent.`;

export const PARSE_TOOL: Anthropic.Tool = {
  name: "record_intent",
  description: "Record the structured intent parsed from the user's request.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["bridge", "swap", "send", "quote_only"] },
      tokenIn: { type: ["string", "null"] },
      tokenOut: { type: ["string", "null"] },
      amount: { type: ["string", "null"], description: "positive decimal string" },
      amountSide: { type: "string", enum: ["in", "out"] },
      fromChain: { type: ["string", "null"] },
      toChain: { type: ["string", "null"] },
      recipient: { type: ["string", "null"] },
      confidence: { type: "number" },
      clarifyingQuestion: { type: ["string", "null"] },
    },
    required: [
      "action",
      "tokenIn",
      "tokenOut",
      "amount",
      "amountSide",
      "fromChain",
      "toChain",
      "recipient",
      "confidence",
      "clarifyingQuestion",
    ],
  },
};

export type Exchange = { question: string; answer: string };

export function composeUserText(prompt: string, exchanges: Exchange[]): string {
  if (exchanges.length === 0) return prompt;
  return [
    `Original request: ${prompt}`,
    ...exchanges.map((e) => `You asked: "${e.question}" — user answered: "${e.answer}"`),
  ].join("\n");
}

export async function parseWithClaude(
  client: Anthropic,
  model: string,
  userText: string,
  validationHint?: string,
): Promise<Intent> {
  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    system: PARSE_SYSTEM,
    tools: [PARSE_TOOL],
    tool_choice: { type: "tool", name: "record_intent" },
    messages: [
      {
        role: "user",
        content: validationHint
          ? `${userText}\n\n(Your previous output failed validation: ${validationHint}. Emit a corrected intent.)`
          : userText,
      },
    ],
  });
  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Model did not return a tool call.");
  }
  return IntentSchema.parse(toolUse.input);
}
