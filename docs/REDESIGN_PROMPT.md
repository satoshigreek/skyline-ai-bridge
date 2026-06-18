# Skyline AI Cross-Chain Engine — Redesign Prompt

> A self-contained build/redesign brief. Hand this to an AI coding agent, or iterate on it
> directly. Sections marked **`⟨VERIFY⟩`** contain assumptions that must be confirmed before
> they drive code. Fill the **`⟨ANSWER: …⟩`** slots as you lock facts down.
>
> Working name: **Skyline AI Cross-Chain Engine** (a.k.a. "Skyline AI X-Chain Engine").
> Evolves the existing `skyline-ai-bridge` Next.js app.

---

## 1. Role & objective

You are redesigning a plain-English, AI-driven cross-chain engine. A user types what they want
("Send 500 USDC to my Hyperliquid account", "Bridge 25 AP3X to Nexus"); an AI extracts a **typed
intent**; a **deterministic router** (plain code — the AI has no say) selects a rail; the user
reviews **one card** and **signs in their own wallet**. The redesign narrows scope, adds new
chains/rails, and preserves the safety model exactly.

## 2. Preserved DNA — non-negotiable invariants

Carry these over unchanged from `skyline-ai-bridge`:

1. **The AI never signs and never picks the rail.** It only emits a zod-typed `Intent`. Rail
   selection is deterministic code; every execution is a wallet signature.
2. **One reviewable card** per action: route, amount in, min received, itemized fees, ETA,
   recipient. Built from the validated `Intent`.
3. **Card ≡ calldata.** The review card and the signed transaction are built by the **same
   function from the same `Intent`** — enforced by an equivalence test (`tests/equivalence.test.ts`).
   This must remain the core safety property for every new rail.
4. **Spend cap** enforced in the UI *and* server-side; above it the user retypes the amount.
5. **First-time recipients** require explicit full-address confirmation.
6. **Secrets stay server-side** behind rate-limited API routes; failed transfers explain where
   the funds are.

## 3. New scope

**Assets (only these):** `AP3X`, `bAP3X` (Base), `bnAP3X` (BNB), `cAP3X` (Cardano), and `USDC`.
Drop all other tokens from the previous build.
- **`⟨VERIFY⟩ cAP3X`** = the Cardano representation of AP3X. **`⟨ANSWER: how is cAP3X minted/bridged — Reactor, LayerZero OFT, or native? ⟩`**

**Chains:** Base, BNB Chain, Solana *(new)*, Hyperliquid *(new, via Arbitrum)*, Cardano, and the
Apex Fusion internal chains (Nexus, Prime, Vector).

**Router:** keep **NEAR Intents** as a **USDC router / universal fallback** — not the canonical
USDC primitive.

## 4. Canonical routing model (USDC + AP3X)

The engine is **hybrid**: a canonical primitive per leg, with NEAR Intents as fallback.

| Leg | Transport | Confidence |
|---|---|---|
| USDC: Base ↔ Solana ↔ Arbitrum (native USDC) | **Circle CCTP** (burn-and-mint, 1:1, no wrapper) | High |
| USDC → **Hyperliquid** | **CCTP → Arbitrum → Hyperliquid deposit bridge** (HL L1 funds from USDC on Arbitrum; USDC is HL's core collateral) | High |
| USDC → **Cardano (USDC.x)** | **Circle xReserve** (issues USDC.x; linked to **Canton Network** + **StaX**) — institutional/regulated rail, **distinct** from Stargate's `USDC.e` | **`⟨VERIFY⟩`** |
| USDC → Cardano / Vector (USDC.e) | **Stargate (LayerZero)** — third-party bridged wrapper | Medium |
| USDC: BNB Chain leg | **`⟨VERIFY⟩`** CCTP support on BSC — confirm or fall back to a bridge | **`⟨VERIFY⟩`** |
| AP3X mesh: bAP3X/bnAP3X/AP3X across Base/BNB/Nexus | **LayerZero OFT** (existing Rail A) | High |
| Apex Fusion internal: Nexus↔Prime↔Vector↔Cardano | **Reactor / Skyline native bridge** (existing Rail C) | High |
| Anything else / one-shot | **NEAR Intents** (router / fallback) | High |

**Key distinctions the router and card must encode:**
- **CCTP USDC is canonical/native; USDC.x and USDC.e are *bridged representations*** with different
  trust models. The card must name the real on-chain asset and its issuer.
- **USDC.x (xReserve) ≠ USDC.e (Stargate).** Do not treat them as fungible.
- **Hyperliquid is always a two-hop** (CCTP to Arbitrum, then deposit). Consider CCTP v2 *hooks*
  to chain mint→deposit atomically.

## 5. The DeFi ↔ institutional boundary (strategic)

xReserve/USDC.x sits on **institutional, regulated rails** (Canton Network — privacy-enabled,
permissioned, TradFi settlement). This makes the engine span two worlds:

- **Permissionless/DeFi rails:** CCTP, LayerZero OFT, Stargate, NEAR Intents — "connect wallet, sign."
- **Institutional rail:** xReserve → USDC.x on/via Canton (+ StaX) — likely permissioned.

**`⟨VERIFY⟩ Access model`** is the pivotal unknown: if USDC.x minting/redeeming is **permissioned/KYC'd**,
the institutional rail needs a *separate flow* (eligibility, whitelisting) rather than the retail
"sign the card" path. **`⟨ANSWER: is USDC.x open to any wallet, or permissioned? ⟩`**

## 6. Hyperliquid integration (phased)

Value thesis: funding a Hyperliquid account *is* a USDC bridging problem — the engine becomes the
plain-English on-ramp to one of the deepest venues in crypto.

- **Phase 1 — read-only oracle:** use HL's order book (`POST /info`) to sharpen quotes / min-received
  on the card. No keys, no custody. Lowest risk.
- **Phase 2 — "Rail D" fund/withdraw:** "Move USDC to/from my Hyperliquid account." CCTP→Arbitrum→deposit.
  Highest value-to-effort.
- **Phase 3 — AI trading intents:** "open a 3× long on ETH with 200 USDC." Reframes the product into an
  AI trading copilot. Use **agent/API wallets** (trade-only, cannot withdraw) — never the main key.
- **Advanced:** hedged bridging (offsetting perp during transit), yield/treasury routing (HLP vault),
  and `apex-conductor` treasury hedging.

**Safety:** anything that *trades* uses an agent wallet with no withdrawal rights, preserving the
"you sign, AI never signs" guarantee. Crossing from transfers into leverage/derivatives changes the
regulatory profile — gate it explicitly.

## 7. Open questions to resolve (fill these in to harden the design)

1. **BSC CCTP** — native CCTP on BNB Chain? `⟨ANSWER: … ⟩`
2. **USDC.x token** — exact ticker (`USDC.x` vs `USDC.e`), chain it lives on (Cardano vs Canton vs both),
   and policy ID. `⟨ANSWER: … ⟩`
3. **xReserve mechanism** — lock-and-mint 1:1? redeemable to native USDC? which source chains hold the reserve? `⟨ANSWER: … ⟩`
4. **xReserve access** — open vs permissioned/KYC. `⟨ANSWER: … ⟩` *(decides one engine vs two surfaces)*
5. **StaX** — what it is and its role vs xReserve/Canton (issuance? settlement? custody?). `⟨ANSWER: … ⟩`
6. **Cardano USDC route shape** — Stargate-direct, or Stargate→Vector→Reactor (two hops)? `⟨ANSWER: … ⟩`
7. **cAP3X** — provenance and bridge. `⟨ANSWER: … ⟩`

## 8. Deliverables expected from the redesign

1. **Routing table** in code: a deterministic map `(fromChain, toChain, asset) → rail`, covering the
   table in §4, with explicit, friendly errors for unsupported pairs.
2. **`chains.ts` / `router.ts` updates** for: Solana, Hyperliquid (two-hop), Arbitrum (transit), the
   xReserve/USDC.x leg, narrowed asset set, and `cAP3X`.
3. **New `Intent` types** for: USDC transfer (CCTP), Hyperliquid fund/withdraw, USDC.x (xReserve), and
   (later) Hyperliquid trade — all zod-typed.
4. **Per-rail builders** that produce card + calldata from one `Intent`, each covered by an
   equivalence test.
5. **Card UX** that names the real asset + issuer + trust model (native CCTP vs bridged USDC.x/USDC.e),
   shows the two-hop for Hyperliquid, and surfaces any permissioned-rail requirements.
6. **Updated architecture + deployment diagrams** reflecting the new rails.

## 9. Constraints

- Next.js 15 / React 19 / TypeScript; secrets server-side; rate-limited API routes.
- No new asset outside §3. No rail where the AI chooses or signs.
- Every rail must satisfy the **card ≡ calldata** equivalence test before it ships.
- Mark anything unverified (`⟨VERIFY⟩`) in code comments until confirmed on-chain / against docs.

---

### How to iterate with this prompt
1. Answer the `⟨ANSWER: …⟩` slots in §7 as you confirm facts.
2. Promote each `⟨VERIFY⟩` row in §4 to "High" confidence once checked on-chain or in official docs.
3. Re-run the agent with the hardened prompt to generate the routing table and code changes.
