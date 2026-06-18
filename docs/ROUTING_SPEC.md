# Skyline AI Cross-Chain Engine — Canonical Routing Specification

> Hardened from `REDESIGN_PROMPT.md` against primary sources (Circle, Hyperliquid, Canton, Stacks, Cardano Foundation docs), verified June 2026. Assets in scope: **AP3X** and **USDC** only. Principle: never re-invent a bridge — route every leg over the issuer's own canonical rail, fall back to a canonical aggregator only where no native rail exists.

---

## 0. Asset scope — decommission everything else first

Before any routing work, **remove every asset currently on the bridge except AP3X and USDC.** This is a deletion pass, not a "don't add" rule — the following must be ripped out of `chains.ts`, the router table, the `Intent` types, the card/calldata builders, and the UI selectors:

- **wBTC** — remove all routes, token configs, and selectors.
- **ETH** — remove as a *transferable asset*. **Exception:** ETH is still required as gas on EVM origins (Arbitrum deposit approval, Base swaps, etc.), so keep gas-handling logic; only the "bridge ETH as an asset" paths go.
- **cbADA** — remove all routes, token configs, and selectors.
- Any other non-AP3X / non-USDC token still wired in (wrapped, bridged, or native) — remove.

After this pass the only assets the router, the `Intent` union, and the UI may reference are **AP3X** (and its representations bAP3X / bnAP3X / cAP3X) and **USDC** (and its representations USDCx / HyperCore USDC / bridged-BNB USDC). Add a test that asserts the asset enum contains exactly these two families, so a stray re-introduction fails CI.

---

## 1. Preserved invariants (unchanged)

1. AI emits a typed `Intent` only — it never picks the rail and never signs.
2. The **deterministic router** maps `(asset, fromChain, toChain)` → rail in plain code.
3. **Card ≡ calldata**: one function builds both from the same `Intent`; an equivalence test gates every rail before ship.
4. The card always names the **real settled asset + issuer + trust model** (native vs. backed vs. pool-wrapped).
5. Spend cap (UI + server); first-time recipients confirm full address; secrets server-side.

---

## 2. The single hard constraint that shapes everything

**Circle CCTP does not support BNB Smart Chain.** Per Circle's own supported-chains doc, USDC is available on every CCTP domain *except* BNB. There is no native burn-and-mint route to BNB and no Circle-native USDC there — only Binance-peg and pool-wrapped variants. Every other USDC leg in scope rides a native issuer rail; BNB is the lone exception and must be flagged in the card as **bridged, non-native USDC**.

---

## 3. USDC routing matrix

| From → To | Rail | Settled asset | Trust model | Notes |
|---|---|---|---|---|
| Ethereum ↔ Base ↔ Solana ↔ Arbitrum (any pair) | **Circle CCTP v2** (burn-and-mint) | Native USDC | Circle attestation | Standard = free; Fast Transfer = small Circle fee. Solana on CCTP v2 since Oct 2025. |
| any CCTP chain → **Hyperliquid** | **CCTP → Arbitrum, then Hyperliquid native bridge** | HyperCore USDC (1:1) | Circle + HL validator set | Two-hop, unavoidable: HL's bridge is Arbitrum-only and rejects USDC.e. Min deposit 5 USDC; withdrawal fee 1 USDC. Deposit contract `0x2df1c51e09aecf9cacb7bc98cb1742757f163df7`. |
| any CCTP chain → **BNB** | **Stargate (LayerZero)** — *no CCTP on BNB* | Bridged/pool USDC | LayerZero + pool liquidity | The exception. Aligns with the AP3X LayerZero stack. Card must name it as bridged, not native. |
| any chain → **Cardano** | **CCTP/Gateway USDC → Ethereum → xReserve `depositToRemote`** | **USDCx** (USDC-backed) | Circle xReserve reserve | Live on mainnet 27 Feb 2026. USDCx is a distinct token, 1:1 USDC-backed, *not* native USDC. Cardano mainnet asset id `asset1e7eewpjw8ua3f2gpfx7y34ww9vjl63hayn80kl`. |
| any chain → **Stacks** | same xReserve pattern | **USDCx** | Circle xReserve reserve | Live 18 Dec 2025. ("StaX" in the draft = Stacks, the BTC L2.) |
| any chain → **Canton** | same xReserve pattern | **USDCx** | Circle xReserve reserve | First xReserve chain (Dec 2025); institutional/permissioned surface — gate separately from retail. |

**xReserve mechanism:** deposit USDC into the Circle xReserve contract (reserve sits on Ethereum) → an equal USDCx mints on the destination via that chain's protocol; redemption burns USDCx and releases the reserve USDC. CCTP/Gateway feed USDC to the Ethereum reserve side, so a Base/Solana origin = CCTP to Ethereum first, then deposit. Direct fiat redemption of USDCx is institution-only; retail round-trips back to USDC via xReserve or exits on a DEX.

---

## 4. AP3X routing matrix

| From → To | Rail | Notes |
|---|---|---|
| AP3X EVM mesh: Base (bAP3X) ↔ BNB (bnAP3X) ↔ Nexus (EVM) | **LayerZero OFT** (Rail A) | Canonical OFT burn/mint across EVM domains; the existing bAP3X deployment. |
| Apex-internal: Nexus ↔ Prime ↔ Vector, and Cardano (cAP3X) | **Reactor / Skyline native** (Rail C) | Native settlement inside the tri-chain + the Cardano leg; no third-party bridge. |

`⟨CONFIRM⟩` cAP3X provenance — Reactor-minted vs. an OFT endpoint on Cardano. Your call; it decides whether the Cardano AP3X leg is Rail A or Rail C.

---

## 5. New feature — buy AP3X with USDC from any chain

Canonical buy venue is **Base**, where bAP3X has live Aerodrome + Uniswap liquidity. The flow normalizes every origin to "USDC on Base," swaps once, then optionally OFT/Reactor-routes the AP3X onward.

| USDC origin | Path to bAP3X |
|---|---|
| Base | direct swap USDC → bAP3X on Aerodrome |
| Ethereum / Solana / Arbitrum | **CCTP v2 with Hook** → mint USDC on Base **+ atomic swap to bAP3X** in one settlement |
| Hyperliquid | withdraw USDC → Arbitrum → CCTP → Base → swap |
| BNB | Stargate USDC → Base → swap (BNB has no CCTP) |

The CCTP v2 **Hook** is the unifier: it attaches the Aerodrome swap to the destination-side mint, so "buy from any CCTP chain" is a single attested settlement rather than bridge-then-swap with idle funds in between. The buy emits one `Intent` (origin, USDC amount, min AP3X out, destination chain for the AP3X); the router expands it into the CCTP+Hook calldata and the card shows USDC in / min AP3X out / venue / fees.

---

## 6. Rail summary

- **CCTP v2** — native USDC across Ethereum, Base, Solana, Arbitrum (and the Hyperliquid feeder + the buy-on-Base Hook).
- **Hyperliquid native bridge** — Arbitrum → HyperCore, second hop only.
- **Stargate (LayerZero)** — BNB USDC only, because CCTP can't reach BNB.
- **xReserve** — USDCx on Cardano, Stacks, Canton.
- **LayerZero OFT** — AP3X across the EVM mesh.
- **Reactor / Skyline native** — AP3X inside Apex Fusion + Cardano.

Each rail ships only after its card-builder and calldata-builder pass the equivalence test.

---

## 7. Remaining open items

1. **BNB USDC** — standardize on Stargate (recommended) vs. Binance-peg; either way it is bridged, not native. `⟨CONFIRM⟩`
2. **xReserve multi-origin** — whether `depositToRemote` accepts non-Ethereum origins directly, or USDC must always CCTP to the Ethereum reserve first. `⟨VERIFY⟩`
3. **Canton access model** — Canton is permissioned/institutional; route it through a separate flow from the retail "sign the card" path. `⟨CONFIRM⟩`
4. **cAP3X provenance** — Rail A (OFT) or Rail C (Reactor). `⟨CONFIRM⟩`

---

## 8. Engineering review notes (appended — see commit discussion)

These are caveats to resolve *before* the spec drives mainnet code; they do not change the routing decisions above.

- **CCTP v2 Hook is not a free atomic swap.** The Hook enables a destination-side call after mint, but executing the Aerodrome swap atomically requires a deployed hook/executor contract (receives minted USDC, swaps with slippage protection) plus a hooks-capable relayer. Provide a fallback: if the swap reverts on slippage, the user is left holding native USDC on Base — acceptable, but the card must say so up front.
- **The matrix is inbound-only.** Add explicit reverse rows: USDCx (Cardano/Stacks/Canton) → native USDC; HyperCore USDC → Arbitrum → CCTP out; bridged-BNB USDC → out. The USDCx redemption asymmetry (retail can't redeem to fiat; only xReserve round-trip or DEX exit) needs its own card language.
- **Open item #2 is load-bearing, not a footnote.** If every USDCx mint must stage through the Ethereum reserve, then Base/Solana → Cardano is CCTP-to-Ethereum + xReserve deposit = two hops with ETH gas on every institutional transfer. Resolve before quoting fees/ETA. Prioritize above the other open items.
- **USDCx ≠ USDC.e on Cardano.** Two distinct, non-fungible tokens can co-exist on Cardano (xReserve USDCx vs. the ecosystem's existing Stargate USDC.e). Confirm USDCx DEX liquidity on Cardano for the "exit on a DEX" claim (a Feb-2026 asset may be thin), and decide whether USDC.e is also supported or deprecated.
- **Hard-verify two identifiers on-chain before mainnet:** the Hyperliquid deposit contract address and the Cardano USDCx asset id. Copy-from-docs is exactly where a typo loses funds.
