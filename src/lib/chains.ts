// Chain registry + environment wiring. The single place that knows which chains
// exist, how they map onto the two rails, and which contract addresses apply.

export type ChainKey =
  | "base"
  | "ap3x"
  | "near"
  | "ethereum"
  | "arbitrum"
  | "solana"
  | "bitcoin"
  | "bsc"
  | "optimism"
  | "polygon"
  | "avalanche"
  | "cardano";

export const CHAIN_KEYS = [
  "base",
  "ap3x",
  "near",
  "ethereum",
  "arbitrum",
  "solana",
  "bitcoin",
  "bsc",
  "optimism",
  "polygon",
  "avalanche",
  "cardano",
] as const;

export type ChainInfo = {
  key: ChainKey;
  label: string;
  family: "evm" | "utxo" | "other";
  // Blockchain id used by the 1-Click API token list. Absent => not reachable
  // via Rail B (only ap3x, which is Rail A territory).
  oneClickId?: string;
};

export const CHAINS: Record<ChainKey, ChainInfo> = {
  base: { key: "base", label: "Base", family: "evm", oneClickId: "base" },
  ap3x: { key: "ap3x", label: "Apex Fusion (AP3X)", family: "evm" },
  near: { key: "near", label: "NEAR", family: "other", oneClickId: "near" },
  ethereum: { key: "ethereum", label: "Ethereum", family: "evm", oneClickId: "eth" },
  arbitrum: { key: "arbitrum", label: "Arbitrum", family: "evm", oneClickId: "arb" },
  solana: { key: "solana", label: "Solana", family: "other", oneClickId: "sol" },
  bitcoin: { key: "bitcoin", label: "Bitcoin", family: "utxo", oneClickId: "btc" },
  bsc: { key: "bsc", label: "BNB Chain", family: "evm", oneClickId: "bsc" },
  optimism: { key: "optimism", label: "Optimism", family: "evm", oneClickId: "op" },
  polygon: { key: "polygon", label: "Polygon", family: "evm", oneClickId: "pol" },
  avalanche: { key: "avalanche", label: "Avalanche", family: "evm", oneClickId: "avax" },
  cardano: { key: "cardano", label: "Cardano", family: "utxo", oneClickId: "cardano" },
};

// ---------------------------------------------------------------------------
// Rail A (LayerZero OFT) wiring — live by default with on-chain-verified values
// ---------------------------------------------------------------------------

// Canonical Circle USDC on Base (Rail B transfers) — fixed, well-known.
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;

// LayerZero v2 endpoint id for Base mainnet.
export const LZ_EID_BASE = 30184;

// bAP3X native OFT on Base. Verified on-chain 2026-06-11: name/symbol bAP3X,
// 18 decimals, oftVersion() = OFT v2, canonical LayerZero EndpointV2.
// https://basescan.org/token/0x9208d82f121806a34a39bb90733b4c5c54f3993e
const DEFAULT_BAP3X_OFT = "0x9208d82f121806a34a39bb90733b4c5c54f3993e";
// Apex Fusion endpoint id, read from the OFT's own PeerSet events (the other
// peer, 30102, is BNB Chain). quoteSend() against it returns live fees.
const DEFAULT_AP3X_EID = 30384;

function envAddress(v: string | undefined, fallback: string): `0x${string}` {
  if (v && /^0x[a-fA-F0-9]{40}$/.test(v)) return v as `0x${string}`;
  return fallback as `0x${string}`;
}

export const BAP3X_OFT_BASE = envAddress(
  process.env.NEXT_PUBLIC_BAP3X_OFT_BASE,
  DEFAULT_BAP3X_OFT,
);
export const AP3X_LZ_EID =
  Number(process.env.NEXT_PUBLIC_AP3X_LZ_EID ?? 0) || DEFAULT_AP3X_EID;

// The AP3X OFT MESH — one token family across three chains, all verified
// on-chain (2026-06-11): bAP3X on Base and bnAP3X on BNB live at the SAME
// address, each peered to the other two legs; quoteSend returns live fees on
// every leg. AP3X is the native representation on Apex Fusion.
export const AP3X_MESH: Partial<
  Record<ChainKey, { oft: `0x${string}`; eid: number; label: string }>
> = {
  base: { oft: BAP3X_OFT_BASE, eid: LZ_EID_BASE, label: "bAP3X" },
  bsc: {
    oft: envAddress(process.env.NEXT_PUBLIC_BNAP3X_OFT_BSC, DEFAULT_BAP3X_OFT),
    eid: 30102,
    label: "bnAP3X",
  },
  ap3x: { oft: BAP3X_OFT_BASE, eid: AP3X_LZ_EID, label: "AP3X" }, // dest-only
};

// USDC has no OFT route to Apex Fusion (no adapter deployed) — it bridges
// everywhere else via Rail B. Rail A is the AP3X OFT mesh only.
export type RailAToken = "AP3X" | "bAP3X" | "bnAP3X";
export const RAIL_A_TOKENS: RailAToken[] = ["AP3X", "bAP3X", "bnAP3X"];

export const RAIL_A_DECIMALS: Record<RailAToken, number> = {
  AP3X: 18,
  bAP3X: 18,
  bnAP3X: 18,
};

// Normalize any family representation to the canonical scope token.
export function normalizeAp3x(token: string): string {
  return token === "bAP3X" || token === "bnAP3X" ? "AP3X" : token;
}

// ---------------------------------------------------------------------------
// Product scope — the chains and tokens this app exposes. The parser still
// understands the wider world; the router and UI enforce this scope.
// ---------------------------------------------------------------------------

export const SCOPE_CHAINS: ChainKey[] = ["base", "bsc", "ap3x", "cardano"];
// Chains the user can SEND FROM (EVM, signable with the connected wallet).
export const SCOPE_ORIGINS: ChainKey[] = ["base", "bsc"];
export const SCOPE_TOKENS = [
  "AP3X",
  "USDC",
  "USDT",
  "ADA",
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
] as const;
export type ScopeToken = (typeof SCOPE_TOKENS)[number];

// The product's token×chain matrix. Per-chain representations: BTC on Base =
// cbBTC, ADA on Base = cbADA, ADA on BNB = BEP-20 ADA, AP3X on Base = bAP3X.
// Whether an entry is QUOTABLE today is decided live against the 1-Click token
// list (/api/tokens availability) — entries solvers don't carry yet render as
// "soon" in the UI instead of producing quotes that can't settle.
export const CHAIN_TOKENS: Record<string, ScopeToken[]> = {
  base: ["AP3X", "USDC", "ETH", "WETH", "BTC", "WBTC", "ADA"],
  bsc: ["AP3X", "USDC", "USDT", "ADA", "WETH", "WBTC"],
  ap3x: ["AP3X"],
  cardano: ["ADA"],
};

// How a scope token is labeled on a given chain (wrapped representations).
export const TOKEN_DISPLAY: Partial<Record<ChainKey, Partial<Record<ScopeToken, string>>>> = {
  base: { BTC: "cbBTC", ADA: "cbADA", AP3X: "bAP3X" },
  bsc: { ADA: "ADA (BEP-20)", AP3X: "bnAP3X" },
};

export function tokenLabel(chain: ChainKey, token: ScopeToken): string {
  return TOKEN_DISPLAY[chain]?.[token] ?? token;
}

// EVM chain ids for wallet transfers per origin.
export const EVM_CHAIN_IDS: Partial<Record<ChainKey, number>> = {
  base: 8453,
  bsc: 56,
};

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export const SPEND_CAP_USD = Number(process.env.NEXT_PUBLIC_SPEND_CAP_USD ?? 1000) || 1000;
