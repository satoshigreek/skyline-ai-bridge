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
// Rail A (Skyline / LayerZero OFT) wiring
// ---------------------------------------------------------------------------

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

// Canonical Circle USDC on Base — fixed, well-known.
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;

// LayerZero v2 endpoint id for Base mainnet.
export const LZ_EID_BASE = 30184;

function envAddress(v: string | undefined): `0x${string}` | null {
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v) || v === ZERO_ADDRESS) return null;
  return v as `0x${string}`;
}

export const BAP3X_OFT_BASE = envAddress(process.env.NEXT_PUBLIC_BAP3X_OFT_BASE);
export const USDC_OFT_ADAPTER_BASE = envAddress(
  process.env.NEXT_PUBLIC_USDC_OFT_ADAPTER_BASE,
);
export const AP3X_LZ_EID = Number(process.env.NEXT_PUBLIC_AP3X_LZ_EID ?? 0) || null;

// Rail A runs in mock simulation unless every contract value is supplied and
// mock mode isn't forced on. Rail B is always live (no contracts needed).
export function railAMocked(): boolean {
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "true") return true;
  if (process.env.NEXT_PUBLIC_MOCK_MODE === "false") {
    // Explicit live request still requires real config.
    return !(BAP3X_OFT_BASE && AP3X_LZ_EID);
  }
  return !(BAP3X_OFT_BASE && AP3X_LZ_EID);
}

export type RailAToken = "AP3X" | "bAP3X" | "USDC";
export const RAIL_A_TOKENS: RailAToken[] = ["AP3X", "bAP3X", "USDC"];

export const RAIL_A_DECIMALS: Record<RailAToken, number> = {
  AP3X: 18,
  bAP3X: 18,
  USDC: 6,
};

// Per-token Base-side route: which contract send()/quoteSend() are called on,
// and which ERC-20 must be approved to it first (OFT Adapter pattern).
export function railARoute(token: RailAToken): {
  oftAddress: `0x${string}` | null;
  approveToken: `0x${string}` | null;
} {
  if (token === "USDC") {
    return { oftAddress: USDC_OFT_ADAPTER_BASE, approveToken: USDC_BASE };
  }
  return { oftAddress: BAP3X_OFT_BASE, approveToken: null };
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export const SPEND_CAP_USD = Number(process.env.NEXT_PUBLIC_SPEND_CAP_USD ?? 1000) || 1000;
