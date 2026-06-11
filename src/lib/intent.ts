import { z } from "zod";
import { CHAIN_KEYS } from "./chains";

// The typed intent the AI layer (or heuristic fallback, or the manual form)
// produces. This object is the ONLY thing that flows from natural language
// into execution — everything downstream re-validates it.

export const ChainKeyEnum = z.enum(CHAIN_KEYS);

export const IntentSchema = z.object({
  action: z.enum(["bridge", "swap", "send", "quote_only"]),
  // Token the user pays with. Null only when the parser couldn't tell —
  // in that case clarifyingQuestion must be set.
  tokenIn: z.string().min(1).nullable(),
  // Token the user receives. Null => same as tokenIn (bridge/send).
  tokenOut: z.string().min(1).nullable(),
  // Positive decimal string ("250", "0.1"). Never a float — precision matters.
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "amount must be a positive decimal string")
    .nullable(),
  // Whether `amount` is what the user sends ("in") or wants to receive ("out").
  amountSide: z.enum(["in", "out"]),
  fromChain: ChainKeyEnum.nullable(),
  toChain: ChainKeyEnum.nullable(),
  // Explicit destination address (0x…, alice.near, …). Null => connected wallet.
  recipient: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  // Set when required fields are missing or ambiguous; rendered inline as a
  // single short question. Null when the intent is complete.
  clarifyingQuestion: z.string().min(1).nullable(),
});

export type Intent = z.infer<typeof IntentSchema>;

// Fields that must be present before routing/quoting.
export function missingFields(i: Intent): string[] {
  const missing: string[] = [];
  if (!i.tokenIn) missing.push("tokenIn");
  if (!i.amount) missing.push("amount");
  if (!i.fromChain) missing.push("fromChain");
  if (!i.toChain) missing.push("toChain");
  return missing;
}

export function isComplete(i: Intent): boolean {
  return missingFields(i).length === 0 && !i.clarifyingQuestion;
}

// Effective output token (bridge/send keep the same token).
export function effectiveTokenOut(i: Intent): string | null {
  return i.tokenOut ?? i.tokenIn;
}
