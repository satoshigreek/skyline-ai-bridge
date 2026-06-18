import { CHAINS, type ChainKey } from "./chains";

// ---------------------------------------------------------------------------
// Canonical routing table — Skyline AI Cross-Chain Engine (docs/ROUTING_SPEC.md)
//
// Pure decision logic. Given an asset and a (from, to) pair it returns the
// canonical rail and the ordered hops — the SHORTEST PATH over issuer-native
// rails only, so every route is "the best and canonical path" by construction.
// It does NOT execute: calldata/card builders consume a RoutePlan in a later
// increment, and each must satisfy the card ≡ calldata equivalence test.
//
// Two judgment calls are baked in (docs/ROUTING_SPEC.md §7):
//   - xReserve always stages through the Ethereum reserve (no multi-origin
//     assumption): a non-Ethereum origin CCTPs to Ethereum first, then mints.
//   - cAP3X rides Rail C (Reactor / Skyline native), not LayerZero OFT — the
//     OFT mesh is EVM-only (Base/BNB/Nexus); Cardano settles natively.
// ---------------------------------------------------------------------------

export type Asset = "AP3X" | "USDC";

export type Rail =
  | "cctp" // Circle CCTP v2 — native USDC burn/mint
  | "hyperliquid" // CCTP → Arbitrum → Hyperliquid native bridge
  | "xreserve" // CCTP → Ethereum reserve → xReserve depositToRemote (USDCx)
  | "stargate" // LayerZero Stargate — BNB USDC only (no CCTP on BNB)
  | "oft" // LayerZero OFT — AP3X EVM mesh
  | "reactor"; // Reactor / Skyline native — AP3X Apex-internal + Cardano

// What you actually hold after a hop: native USDC, a reserve-backed token
// (USDCx), a pool-wrapped bridge token (Stargate USDC on BNB), or an asset
// secured by an external validator set (HyperCore USDC, Apex Reactor AP3X).
export type TrustModel = "native" | "backed" | "pool-wrapped" | "validator";

export type Hop = {
  rail: Rail;
  from: ChainKey;
  to: ChainKey;
  settles: string; // representation held after arriving at `to`
  trust: TrustModel;
  note: string;
};

export type RoutePlan = {
  ok: true;
  asset: Asset;
  rail: Rail; // the destination-defining (final) rail
  hops: Hop[];
  settledAsset: string; // what lands at the destination
  trustModel: TrustModel; // trust of the asset finally held
  notes: string[];
};
export type RouteError = { ok: false; error: string };
export type RouteResult = RoutePlan | RouteError;

// --- edge model: a directed adjacency over issuer-native rails -------------

type Edge = { to: ChainKey; rail: Rail; settles: string; trust: TrustModel; note: string };
type Graph = Map<ChainKey, Edge[]>;

function add(g: Graph, from: ChainKey, e: Edge): void {
  const list = g.get(from);
  if (list) list.push(e);
  else g.set(from, [e]);
}

// Native-USDC CCTP domains in scope (Circle CCTP v2; NOT BNB — see spec §2).
const CCTP_NATIVE: ChainKey[] = ["ethereum", "base", "solana", "arbitrum"];

const USDC_GRAPH: Graph = (() => {
  const g: Graph = new Map();
  // CCTP — complete subgraph over the native domains (burn-and-mint, 1:1).
  for (const a of CCTP_NATIVE)
    for (const b of CCTP_NATIVE)
      if (a !== b) add(g, a, { to: b, rail: "cctp", settles: "USDC", trust: "native", note: "Circle CCTP v2 burn-and-mint" });
  // Stargate — the BNB exception (no CCTP on BNB). Sources from CCTP chains.
  for (const c of ["ethereum", "base", "arbitrum"] as ChainKey[]) {
    add(g, c, { to: "bsc", rail: "stargate", settles: "USDC (Stargate, bridged)", trust: "pool-wrapped", note: "LayerZero Stargate — BNB has no native CCTP" });
    add(g, "bsc", { to: c, rail: "stargate", settles: "USDC", trust: "native", note: "LayerZero Stargate from BNB" });
  }
  // Hyperliquid — native bridge, Arbitrum-only.
  add(g, "arbitrum", { to: "hyperliquid", rail: "hyperliquid", settles: "HyperCore USDC", trust: "validator", note: "Hyperliquid native bridge (Arbitrum-only; min 5 USDC)" });
  add(g, "hyperliquid", { to: "arbitrum", rail: "hyperliquid", settles: "USDC", trust: "native", note: "Hyperliquid withdrawal to Arbitrum (1 USDC fee)" });
  // xReserve — USDCx on Cardano / Stacks / Canton; reserve sits on Ethereum.
  for (const x of ["cardano", "stacks", "canton"] as ChainKey[]) {
    const permissioned = x === "canton";
    add(g, "ethereum", { to: x, rail: "xreserve", settles: "USDCx", trust: "backed", note: permissioned ? "Circle xReserve mint (permissioned / institutional)" : "Circle xReserve mint (USDC-backed)" });
    add(g, x, { to: "ethereum", rail: "xreserve", settles: "USDC", trust: "native", note: "Circle xReserve redemption" });
  }
  return g;
})();

// AP3X representation by chain.
function ap3xRep(chain: ChainKey): string {
  if (chain === "base") return "bAP3X";
  if (chain === "bsc") return "bnAP3X";
  if (chain === "cardano") return "cAP3X";
  return "AP3X";
}

const OFT_MESH: ChainKey[] = ["base", "bsc", "nexus"];
// Enabled Apex-internal pairs (Reactor / Skyline native), bidirectional.
const REACTOR_PAIRS: Array<[ChainKey, ChainKey]> = [
  ["nexus", "prime"],
  ["prime", "vector"],
  ["prime", "cardano"],
];

const AP3X_GRAPH: Graph = (() => {
  const g: Graph = new Map();
  for (const a of OFT_MESH)
    for (const b of OFT_MESH)
      if (a !== b) add(g, a, { to: b, rail: "oft", settles: ap3xRep(b), trust: "native", note: "LayerZero OFT burn/mint" });
  for (const [a, b] of REACTOR_PAIRS) {
    add(g, a, { to: b, rail: "reactor", settles: ap3xRep(b), trust: "validator", note: "Skyline / Reactor native bridge" });
    add(g, b, { to: a, rail: "reactor", settles: ap3xRep(a), trust: "validator", note: "Skyline / Reactor native bridge" });
  }
  return g;
})();

// Breadth-first shortest path; reconstructs the ordered hop list.
function shortestHops(g: Graph, from: ChainKey, to: ChainKey): Hop[] | null {
  if (from === to) return [];
  const prev = new Map<ChainKey, Hop>();
  const seen = new Set<ChainKey>([from]);
  const queue: ChainKey[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of g.get(cur) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, { rail: e.rail, from: cur, to: e.to, settles: e.settles, trust: e.trust, note: e.note });
      if (e.to === to) {
        const hops: Hop[] = [];
        let node = to;
        while (node !== from) {
          const h = prev.get(node)!;
          hops.unshift(h);
          node = h.from;
        }
        return hops;
      }
      queue.push(e.to);
    }
  }
  return null;
}

function scopeError(asset: Asset, from: ChainKey, to: ChainKey): string {
  const fl = CHAINS[from].label;
  const tl = CHAINS[to].label;
  if (asset === "AP3X")
    return `AP3X can't route ${fl} → ${tl}. AP3X moves across the EVM OFT mesh (Base / BNB / Nexus) and the Apex Fusion internal chains (Nexus↔Prime, Prime↔Vector, Prime↔Cardano).`;
  return `USDC can't route ${fl} → ${tl}. USDC reaches Ethereum / Base / Solana / Arbitrum (CCTP), BNB (Stargate), Hyperliquid (via Arbitrum), and Cardano / Stacks / Canton (xReserve USDCx).`;
}

// Resolve the canonical route for an asset between two chains.
export function planRoute(asset: Asset, from: ChainKey, to: ChainKey): RouteResult {
  if (!CHAINS[from] || !CHAINS[to]) return { ok: false, error: "Unknown chain." };

  // AP3X treats the legacy `ap3x` key as an alias of Nexus.
  let f = from;
  let t = to;
  if (asset === "AP3X") {
    if (f === "ap3x") f = "nexus";
    if (t === "ap3x") t = "nexus";
  }
  if (f === t) return { ok: false, error: `Source and destination are both ${CHAINS[from].label} — same-chain transfers aren't supported.` };

  const hops = shortestHops(asset === "AP3X" ? AP3X_GRAPH : USDC_GRAPH, f, t);
  if (!hops || hops.length === 0) return { ok: false, error: scopeError(asset, from, to) };

  const last = hops[hops.length - 1];
  const notes: string[] = [];
  if (hops.length > 1)
    notes.push(`${hops.length}-hop route: ${hops.map((h) => `${CHAINS[h.from].label}→${CHAINS[h.to].label} (${h.rail})`).join(", ")}.`);
  if (hops.some((h) => h.note.includes("permissioned")))
    notes.push("Includes a Canton leg — permissioned / institutional; route through the separate eligibility flow.");
  if (last.settles !== "USDC" && asset === "USDC")
    notes.push(`Destination holds ${last.settles}, not native USDC — name the issuer + trust model on the card.`);

  return { ok: true, asset, rail: last.rail, hops, settledAsset: last.settles, trustModel: last.trust, notes };
}

// ---------------------------------------------------------------------------
// Buy AP3X with USDC from any chain (docs/ROUTING_SPEC.md §5). Normalize the
// USDC origin to Base, swap once on Aerodrome, then OFT/Reactor the AP3X onward.
// ---------------------------------------------------------------------------

export type BuyPlan = {
  ok: true;
  usdcHops: Hop[]; // origin USDC → Base (empty if already on Base)
  swap: { chain: ChainKey; venue: string; from: "USDC"; to: "bAP3X"; atomicHook: boolean };
  ap3xHops: Hop[]; // Base bAP3X → destination AP3X (empty if dest is Base)
  settledAsset: string;
  notes: string[];
};

export function planBuyAp3x(usdcOrigin: ChainKey, ap3xDest: ChainKey): BuyPlan | RouteError {
  const usdcHops = usdcOrigin === "base" ? [] : shortestHops(USDC_GRAPH, usdcOrigin, "base");
  if (usdcHops === null) return { ok: false, error: `Can't bring USDC from ${CHAINS[usdcOrigin].label} to Base for the swap.` };

  const dest = ap3xDest === "ap3x" ? "nexus" : ap3xDest;
  const ap3xHops = dest === "base" ? [] : shortestHops(AP3X_GRAPH, "base", dest);
  if (ap3xHops === null) return { ok: false, error: `Can't route AP3X from Base to ${CHAINS[ap3xDest].label}.` };

  // A single-hop CCTP origin can mint-and-swap atomically via a CCTP v2 Hook.
  const atomicHook = usdcHops.length === 1 && usdcHops[0].rail === "cctp";
  const notes: string[] = [];
  if (atomicHook) notes.push("CCTP v2 Hook: USDC mint on Base + Aerodrome swap settle atomically (fallback: hold USDC on Base if the swap reverts on slippage).");
  if (usdcHops.length && !atomicHook) notes.push("USDC is normalized to Base, then swapped — funds rest as USDC on Base between hops.");
  if (ap3xHops.length) notes.push(`AP3X then routes onward: ${ap3xHops.map((h) => `${CHAINS[h.from].label}→${CHAINS[h.to].label} (${h.rail})`).join(", ")}.`);

  return {
    ok: true,
    usdcHops,
    swap: { chain: "base", venue: "Aerodrome", from: "USDC", to: "bAP3X", atomicHook },
    ap3xHops,
    settledAsset: ap3xRep(dest),
    notes,
  };
}
