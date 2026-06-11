import { z } from "zod";
import { CHAINS, type ChainKey } from "./chains";

// Rail B — NEAR Intents 1-Click API client. Server-side only: the optional
// partner JWT must never reach the browser.

const BASE_URL = "https://1click.chaindefuser.com";

const TokenSchema = z
  .object({
    assetId: z.string(),
    decimals: z.number(),
    blockchain: z.string(),
    symbol: z.string(),
    price: z.number().optional(),
    contractAddress: z.string().optional(),
  })
  .passthrough();
export type OneClickToken = z.infer<typeof TokenSchema>;

// Quote response — typed loosely with passthrough so upstream additions don't
// break us; the fields below are the ones the app relies on.
const QuoteSchema = z
  .object({
    depositAddress: z.string().optional(),
    depositMemo: z.string().optional(),
    amountIn: z.string(),
    amountInFormatted: z.string().optional(),
    amountInUsd: z.string().optional(),
    amountOut: z.string(),
    amountOutFormatted: z.string().optional(),
    amountOutUsd: z.string().optional(),
    minAmountOut: z.string().optional(),
    deadline: z.string().optional(),
    timeEstimate: z.number().optional(),
  })
  .passthrough();
const QuoteResponseSchema = z
  .object({
    quote: QuoteSchema,
    quoteRequest: z.record(z.unknown()).optional(),
    signature: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();
export type OneClickQuote = z.infer<typeof QuoteSchema>;

const StatusSchema = z
  .object({
    status: z.enum([
      "PENDING_DEPOSIT",
      "KNOWN_DEPOSIT_TX",
      "PROCESSING",
      "SUCCESS",
      "INCOMPLETE_DEPOSIT",
      "REFUNDED",
      "FAILED",
    ]),
    updatedAt: z.string().optional(),
    swapDetails: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type OneClickStatus = z.infer<typeof StatusSchema>;

async function oneClickFetch(path: string, init?: RequestInit): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  const jwt = process.env.ONECLICK_JWT;
  if (jwt) headers["Authorization"] = `Bearer ${jwt}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`1-Click API ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

// ---------------------------------------------------------------------------
// Token list — cached 10 minutes in module scope.
// ---------------------------------------------------------------------------

let tokenCache: { at: number; tokens: OneClickToken[] } | null = null;
const TOKEN_TTL_MS = 10 * 60 * 1000;

export async function getTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) {
    return tokenCache.tokens;
  }
  const raw = await oneClickFetch("/v0/tokens");
  const tokens = z.array(TokenSchema).parse(raw);
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

// Symbol aliases: what users say -> what the token list calls it.
const SYMBOL_ALIASES: Record<string, string[]> = {
  NEAR: ["wNEAR", "NEAR"],
  BTC: ["BTC", "WBTC", "cbBTC"],
  ETH: ["ETH"],
  POL: ["POL", "MATIC"],
};

export function resolveAsset(
  tokens: OneClickToken[],
  chain: ChainKey,
  symbol: string,
): OneClickToken | null {
  const blockchainId = CHAINS[chain].oneClickId;
  if (!blockchainId) return null;
  const candidates = SYMBOL_ALIASES[symbol.toUpperCase()] ?? [symbol];
  for (const want of candidates) {
    const exact = tokens.filter(
      (t) =>
        t.blockchain === blockchainId &&
        t.symbol.toUpperCase() === want.toUpperCase(),
    );
    if (exact.length > 0) {
      // Prefer the priced entry — variants without a price are usually vault
      // wrappers (sUSDC, mwUSDC, …), not the canonical asset.
      return exact.find((t) => typeof t.price === "number") ?? exact[0];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Quote / deposit / status
// ---------------------------------------------------------------------------

export type OneClickQuoteParams = {
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  amount: string; // smallest units
  recipient: string;
  refundTo: string;
  slippageBps: number;
};

export async function requestQuote(p: OneClickQuoteParams): Promise<{
  quote: OneClickQuote;
  raw: unknown;
}> {
  const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const raw = await oneClickFetch("/v0/quote", {
    method: "POST",
    body: JSON.stringify({
      dry: p.dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: p.slippageBps,
      originAsset: p.originAsset,
      destinationAsset: p.destinationAsset,
      amount: p.amount,
      recipient: p.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: p.refundTo,
      refundType: "ORIGIN_CHAIN",
      deadline,
      depositType: "ORIGIN_CHAIN",
    }),
  });
  const parsed = QuoteResponseSchema.parse(raw);
  return { quote: parsed.quote, raw };
}

export async function submitDeposit(txHash: string, depositAddress: string): Promise<unknown> {
  return oneClickFetch("/v0/deposit/submit", {
    method: "POST",
    body: JSON.stringify({ txHash, depositAddress }),
  });
}

export async function getStatus(depositAddress: string): Promise<OneClickStatus> {
  const raw = await oneClickFetch(
    `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`,
  );
  return StatusSchema.parse(raw);
}
