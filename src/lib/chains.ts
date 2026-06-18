// Chain registry + environment wiring. The single place that knows which chains
// exist, how they map onto the two rails, and which contract addresses apply.

export type ChainKey =
  | "base"
  | "ap3x"
  | "prime"
  | "vector"
  | "nexus"
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
  "prime",
  "vector",
  "nexus",
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
  // Skyline native-API chain id (Rail C). Present for prime/vector/nexus/cardano.
  apexId?: string;
};

export const CHAINS: Record<ChainKey, ChainInfo> = {
  base: { key: "base", label: "Base", family: "evm", oneClickId: "base" },
  ap3x: { key: "ap3x", label: "Apex Fusion (AP3X)", family: "evm" },
  // Apex Fusion internal chains (Rail C, Skyline native bridge):
  prime: { key: "prime", label: "Prime", family: "utxo", apexId: "prime" },
  vector: { key: "vector", label: "Vector", family: "utxo", apexId: "vector" },
  nexus: { key: "nexus", label: "Nexus", family: "evm", apexId: "nexus" },
  near: { key: "near", label: "NEAR", family: "other", oneClickId: "near" },
  ethereum: { key: "ethereum", label: "Ethereum", family: "evm", oneClickId: "eth" },
  arbitrum: { key: "arbitrum", label: "Arbitrum", family: "evm", oneClickId: "arb" },
  solana: { key: "solana", label: "Solana", family: "other", oneClickId: "sol" },
  bitcoin: { key: "bitcoin", label: "Bitcoin", family: "utxo", oneClickId: "btc" },
  bsc: { key: "bsc", label: "BNB Chain", family: "evm", oneClickId: "bsc" },
  optimism: { key: "optimism", label: "Optimism", family: "evm", oneClickId: "op" },
  polygon: { key: "polygon", label: "Polygon", family: "evm", oneClickId: "pol" },
  avalanche: { key: "avalanche", label: "Avalanche", family: "evm", oneClickId: "avax" },
  // Cardano serves double duty: a NEAR-Intents destination (Rail B) AND an
  // Apex-internal endpoint for prime<->cardano (Rail C).
  cardano: { key: "cardano", label: "Cardano", family: "utxo", oneClickId: "cardano", apexId: "cardano" },
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
  // The LayerZero "AP3X" destination IS Nexus (eid 30384, confirmed by the
  // Skyline /settings layerZeroChains data). `ap3x` kept as a back-compat alias.
  nexus: { oft: BAP3X_OFT_BASE, eid: AP3X_LZ_EID, label: "AP3X" },
  ap3x: { oft: BAP3X_OFT_BASE, eid: AP3X_LZ_EID, label: "AP3X" },
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

export const SCOPE_CHAINS: ChainKey[] = [
  "base",
  "bsc",
  "nexus",
  "prime",
  "vector",
  "cardano",
];
// Chains the user can SEND FROM. base/bsc sign EVM (Rail A/B); nexus signs EVM
// (Rail C); prime/vector/cardano sign with a Cardano CIP-30 wallet (Rail C).
export const SCOPE_ORIGINS: ChainKey[] = [
  "base",
  "bsc",
  "nexus",
  "prime",
  "vector",
  "cardano",
];
// Asset scope is AP3X and USDC ONLY (see docs/ROUTING_SPEC.md §0). Their
// per-chain representations (bAP3X/bnAP3X/cAP3X, USDCx/HyperCore/bridged-USDC)
// are labels of these two families, not separate scope tokens. The asset-scope
// test (tests/asset-scope.test.ts) fails CI if anything else is reintroduced.
export const SCOPE_TOKENS = ["AP3X", "USDC"] as const;
export type ScopeToken = (typeof SCOPE_TOKENS)[number];

// The product's token×chain matrix. Per-chain AP3X representations: Base =
// bAP3X, BNB = bnAP3X, Cardano = cAP3X. Whether an entry is QUOTABLE today is
// decided live against the 1-Click token list (/api/tokens availability) —
// entries solvers don't carry yet render as "soon" in the UI instead of
// producing quotes that can't settle.
export const CHAIN_TOKENS: Record<string, ScopeToken[]> = {
  base: ["AP3X", "USDC"],
  bsc: ["AP3X", "USDC"],
  ap3x: ["AP3X"],
  // Apex Fusion internal chains (Rail C) — AP3X only.
  nexus: ["AP3X"],
  prime: ["AP3X"],
  vector: ["AP3X"],
  cardano: ["AP3X"],
};

// How a scope token is labeled on a given chain (wrapped representations).
export const TOKEN_DISPLAY: Partial<Record<ChainKey, Partial<Record<ScopeToken, string>>>> = {
  base: { AP3X: "bAP3X" },
  bsc: { AP3X: "bnAP3X" },
  nexus: { AP3X: "AP3X" },
  cardano: { AP3X: "cAP3X" }, // wrapped AP3X on Cardano (Rail C)
};

export function tokenLabel(chain: ChainKey, token: ScopeToken): string {
  return TOKEN_DISPLAY[chain]?.[token] ?? token;
}

// EVM chain ids for wallet transfers per origin.
export const EVM_CHAIN_IDS: Partial<Record<ChainKey, number>> = {
  base: 8453,
  bsc: 56,
  nexus: 9069, // Apex Fusion Nexus (verified via eth_chainId)
};

// ---------------------------------------------------------------------------
// Rail C — Apex Fusion internal (Skyline native bridge API)
//
// The official backend. CORS is allowlisted to skylinebridge.tech only, so
// browser-direct calls are impossible — every Rail C call is proxied through
// this app's /api/apex/* routes (server-side, no CORS). That's why Rail C is
// available in the Next.js app but not the static standalone build.
// ---------------------------------------------------------------------------

export const SKYLINE_API =
  process.env.SKYLINE_API || "https://web-api.mainnet.skylinebridge.tech";

// Ecosystem token ids, from /settings. AP3X is the native ecosystem token;
// cAP3X is its wrapped Cardano representation. Scope is AP3X only on Rail C.
export const APEX_TOKEN_IDS: Record<string, number> = {
  AP3X: 1,
  cAP3X: 3,
};

// Smallest-unit decimals by VM family: Cardano UTXO chains use 6 (lovelace),
// the Nexus EVM chain uses 18.
export function apexDecimals(chain: ChainKey): number {
  return CHAINS[chain].family === "evm" ? 18 : 6;
}

// Nexus EVM network params for wallet_addEthereumChain.
export const NEXUS_EVM = {
  chainIdHex: "0x236d", // 9069
  chainName: "Apex Fusion Nexus",
  nativeCurrency: { name: "AP3X", symbol: "AP3X", decimals: 18 },
  rpcUrls: ["https://rpc.nexus.mainnet.apexfusion.org/"],
  blockExplorerUrls: ["https://explorer.nexus.mainnet.apexfusion.org"],
};

// Explorers for Rail C status deep-links.
export const APEX_EXPLORERS: Partial<Record<ChainKey, string>> = {
  nexus: "https://explorer.nexus.mainnet.apexfusion.org",
  prime: "https://explorer.prime.mainnet.apexfusion.org",
  vector: "https://explorer.vector.mainnet.apexfusion.org",
  cardano: "https://cardanoscan.io",
};

// The internal routes this app exposes (the requested scope, bidirectional):
//   Nexus <-> Prime, Prime <-> Vector, Prime <-> Cardano.
// Other Skyline-supported internal pairs (e.g. Vector<->Nexus) are intentionally
// left out of scope; LayerZero (Rail A) and NEAR Intents (Rail B) are untouched.
export const APEX_ROUTES: ReadonlySet<string> = new Set([
  "nexus->prime",
  "prime->nexus",
  "prime->vector",
  "vector->prime",
  "prime->cardano",
  "cardano->prime",
]);

export function isApexRoute(from: ChainKey, to: ChainKey): boolean {
  return APEX_ROUTES.has(`${from}->${to}`);
}

// Chains a Rail C transfer can originate from, by signer family.
export const APEX_EVM_ORIGINS: ChainKey[] = ["nexus"];
export const APEX_UTXO_ORIGINS: ChainKey[] = ["prime", "vector", "cardano"];

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export const SPEND_CAP_USD = Number(process.env.NEXT_PUBLIC_SPEND_CAP_USD ?? 1000) || 1000;
