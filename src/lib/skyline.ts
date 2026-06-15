import { z } from "zod";
import { APEX_TOKEN_IDS, SKYLINE_API, type ChainKey } from "./chains";

// Rail C — server-side client for the Skyline native bridge API
// (web-api.mainnet.skylinebridge.tech). CORS-allowlisted to skylinebridge.tech,
// so this MUST run server-side; the browser reaches it through /api/apex/*.

// ---------------------------------------------------------------------------
// Settings (cached 10 min) — source of truth for routes, tokens, fees, limits.
// ---------------------------------------------------------------------------

let settingsCache: { at: number; data: SkylineSettings } | null = null;
const SETTINGS_TTL_MS = 10 * 60 * 1000;

export type SkylineSettings = {
  enabledChains: string[];
  settingsPerMode: Record<
    string,
    {
      enabledChains: string[];
      bridgingSettings: {
        minValueToBridge: number;
        maxAmountAllowedToBridge: string;
        minChainFeeForBridging: Record<string, string>;
        minOperationFee: Record<string, string>;
      };
    }
  >;
  directionConfig: Record<
    string,
    {
      destChain: Record<string, Array<{ srcTokenID: number; dstTokenID: number }>>;
      tokens: Record<string, { chainSpecific: string; lockUnlock: boolean; isWrappedCurrency: boolean }>;
    }
  >;
  ecosystemTokens: Array<{ id: number; name: string }>;
};

async function skyFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${SKYLINE_API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string>) },
  });
  const body = await res.text();
  if (!res.ok) {
    let msg = body.slice(0, 300);
    try {
      msg = (JSON.parse(body) as { message?: string }).message || msg;
    } catch {
      /* keep raw */
    }
    throw new Error(`Skyline ${res.status}: ${msg}`);
  }
  return body ? JSON.parse(body) : {};
}

export async function getSettings(): Promise<SkylineSettings> {
  if (settingsCache && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.data;
  const data = (await skyFetch("/settings")) as SkylineSettings;
  settingsCache = { at: Date.now(), data };
  return data;
}

export async function getBridgingAddresses(chainId: string): Promise<string[]> {
  const r = (await skyFetch(`/settings/getBridgingAddresses?chainId=${encodeURIComponent(chainId)}`)) as {
    addresses: string[];
  };
  return r.addresses ?? [];
}

// ---------------------------------------------------------------------------
// Token resolution for an internal route. Returns the SOURCE token id that
// CreateTransactionDto expects, validated against the live directionConfig.
// ---------------------------------------------------------------------------

export function srcTokenId(origin: ChainKey, scopeSymbol: string): number | null {
  if (origin === "cardano") {
    if (scopeSymbol === "ADA") return APEX_TOKEN_IDS.ADA; // 2
    if (scopeSymbol === "AP3X") return APEX_TOKEN_IDS.cAP3X; // 3 (wrapped AP3X on Cardano)
    return null;
  }
  // prime / vector / nexus
  if (scopeSymbol === "AP3X") return APEX_TOKEN_IDS.AP3X; // 1
  return null;
}

export async function routeAllowed(
  origin: ChainKey,
  dest: ChainKey,
  tokenId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await getSettings();
  const dc = s.directionConfig[origin];
  if (!dc) return { ok: false, error: `${origin} is not an Apex Fusion bridge chain.` };
  if (!(dest in dc.destChain)) {
    return { ok: false, error: `Skyline can't bridge ${origin} → ${dest}.` };
  }
  if (!(String(tokenId) in dc.tokens)) {
    return { ok: false, error: `Token ${tokenId} isn't available on ${origin}.` };
  }
  const pair = dc.destChain[dest].find((p) => p.srcTokenID === tokenId);
  if (!pair) return { ok: false, error: `Token ${tokenId} can't route ${origin} → ${dest}.` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Transaction building (build-only — signing/submission happen separately).
// ---------------------------------------------------------------------------

export type CreateBody = {
  senderAddress: string;
  originChain: string;
  destinationChain: string;
  destinationAddress: string;
  amount: string; // origin smallest units
  tokenID: number;
  bridgingFee?: string;
  operationFee?: string;
};

const CardanoFeeSchema = z.object({ fee: z.string(), bridgingFee: z.string(), operationFee: z.string() });
export type CardanoFee = z.infer<typeof CardanoFeeSchema>;

export async function getCardanoTxFee(body: CreateBody): Promise<CardanoFee> {
  return CardanoFeeSchema.parse(await skyFetch("/transaction/getCardanoTxFee", { method: "POST", body: JSON.stringify(body) }));
}

const CardanoTxSchema = z
  .object({
    txRaw: z.string(),
    txHash: z.string(),
    bridgingFee: z.string(),
    operationFee: z.string(),
    amount: z.string(),
    isFallback: z.boolean().optional(),
    nativeTokenAmount: z.array(z.object({ tokenID: z.number(), amount: z.string() })).nullable().optional(),
  })
  .passthrough();
export type CardanoTx = z.infer<typeof CardanoTxSchema>;

export async function createCardano(body: CreateBody): Promise<CardanoTx> {
  return CardanoTxSchema.parse(await skyFetch("/transaction/createCardano", { method: "POST", body: JSON.stringify(body) }));
}

const EthTxSchema = z.object({ from: z.string(), to: z.string(), value: z.string().nullable().optional(), data: z.string() });
const CreateEthSchema = z
  .object({
    approvalTx: EthTxSchema.nullable().optional(),
    bridgingTx: z.object({
      ethTx: EthTxSchema,
      bridgingFee: z.string(),
      operationFee: z.string(),
      tokenAmount: z.string(),
      tokenID: z.number(),
      isFallback: z.boolean().optional(),
    }),
  })
  .passthrough();
export type CreateEth = z.infer<typeof CreateEthSchema>;

export async function createEth(body: CreateBody): Promise<CreateEth> {
  return CreateEthSchema.parse(await skyFetch("/transaction/createEth", { method: "POST", body: JSON.stringify(body) }));
}

// ---------------------------------------------------------------------------
// Submit (register a signed+broadcast source tx) + status tracking.
// ---------------------------------------------------------------------------

export type SubmitBody = {
  originChain: string;
  destinationChain: string;
  originTxHash: string;
  senderAddress: string;
  receiverAddrs: string[];
  amount: string;
  nativeTokenAmount: string;
  tokenID: number;
  txRaw: string;
  isFallback: boolean;
  isLayerZero: boolean;
};

export async function submitActivated(body: SubmitBody): Promise<{ id: number; status: string }> {
  const r = (await skyFetch("/transaction/bridgingTransactionSubmittedActivated", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { id: number; status: string };
  return r;
}

export async function getBridgeTx(id: number): Promise<{ status: string; destinationTxHash?: string | null; isRefund?: boolean }> {
  return (await skyFetch(`/bridgeTransaction/${id}`)) as {
    status: string;
    destinationTxHash?: string | null;
    isRefund?: boolean;
  };
}
