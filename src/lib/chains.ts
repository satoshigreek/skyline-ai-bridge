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

// USDC has no OFT route to Apex Fusion (no adapter deployed) — it bridges
// everywhere else via Rail B. Rail A is the bAP3X/AP3X LayerZero OFT only.
export type RailAToken = "AP3X" | "bAP3X";
export const RAIL_A_TOKENS: RailAToken[] = ["AP3X", "bAP3X"];

export const RAIL_A_DECIMALS: Record<RailAToken, number> = {
  AP3X: 18,
  bAP3X: 18,
};

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

export const SPEND_CAP_USD = Number(process.env.NEXT_PUBLIC_SPEND_CAP_USD ?? 1000) || 1000;
