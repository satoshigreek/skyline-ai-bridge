# Skyline AI Bridge — Product Spec (v1.0)

**One-liner:** Connect your wallet, say what you want in plain English, review one card, sign once. The app figures out the route.

**Working title:** Skyline AI Bridge. **Status:** spec for the production build; a clickable prototype exists (`skyline-ai-bridge/` Next.js app + `skyline-ai-bridge.html` standalone mockup).

---

## 1. Why users would use this

Bridging today means: find the right bridge site, pick networks from dropdowns, find the token contract, guess at fees, sign blind hex. The user we serve wants to type:

> "move 250 USDC from Base to Apex Fusion"
> "swap 0.1 ETH on Base for NEAR"
> "send 50 USDC to alice.near"

…and get **one reviewable card** — route, amount in/out, fees, ETA, where funds land — then sign in their own wallet. Nothing executes without an explicit signature. The AI proposes; the human disposes.

## 2. Two execution rails, one prompt box

The LLM never picks the rail. It only extracts a typed intent; a **deterministic router** in code picks the rail. This keeps execution auditable and un-jailbreakable.

| | Rail A — Skyline (LayerZero OFT) | Rail B — NEAR Intents (1-Click API) |
|---|---|---|
| Routes | Base ↔ Apex Fusion (AP3X, bAP3X, USDC) | Base ↔ {NEAR, Ethereum, Arbitrum, Solana, BTC, BSC, …} any-to-any swaps |
| Mechanism | Direct contract calls: `approve` (adapter tokens) → `quoteSend` → `send` | REST: `POST /v0/quote` → user transfers to returned `depositAddress` → solvers settle → `GET /v0/status` |
| User signs | 1–2 contract txs | 1 plain transfer (simplest possible signature) |
| Tracking | LayerZero Scan | 1-Click status states (`PENDING_DEPOSIT → PROCESSING → SUCCESS / REFUNDED / FAILED`) |
| Failure story | Tx reverts atomically | `refundTo` address gets funds back automatically |

Router policy v1: destination or source is Apex Fusion → Rail A. Everything else cross-chain → Rail B. If **both** rails can serve a route (future), quote both and show the better one with a "via" label.

## 3. Core user flow

1. **Connect** — RainbowKit (Coinbase Wallet, MetaMask, WalletConnect), Base as home chain.
2. **Prompt** — one text box. Example chips. Also a **manual form fallback** (token/amount/from/to dropdowns) for users who don't want to type — both paths produce the same `Intent` object.
3. **Clarify** — if the intent is missing a required field, the AI asks exactly **one** short question inline (no modal, no restart). Max 2 rounds, then offer the manual form.
4. **Review card** — the contract between app and user. Shows: route (chain badges), token + amount in, **estimated amount out (min received after slippage)**, all fees itemized (LayerZero native fee / 1-Click solver spread), ETA, recipient, parser confidence, plain-English summary ("You send 250 USDC on Base. You receive ≥249.1 USDC on Apex Fusion in ~2 min").
5. **Sign** — wallet pops with exactly what the card said. For Rail B the signature is a plain transfer to the deposit address; for Rail A it's `approve` + `send` with a step indicator.
6. **Track** — live status card that survives page reload (history persisted in localStorage keyed by wallet). Links to LayerZero Scan / NEAR Intents explorer. Refund state surfaced loudly if it happens.

## 4. Safety model (non-negotiable)

- **No auto-sign, ever.** No session keys in v1. The LLM has no signing capability — it can only emit an `Intent` JSON validated by zod.
- **Dry quotes first.** Rail B quotes are requested with `dry: true` for the review card; the real quote (which creates a deposit address) is only made when the user clicks Confirm. Deposit addresses have deadlines — show countdown.
- **Spend cap** — configurable per-tx USD cap (default $1,000); above it, a typed confirmation ("type the amount to proceed").
- **Recipient address book** — first-time recipient triggers an extra confirm with checksummed address shown in full; known recipients get a label.
- **Server-side secrets only** — Anthropic key and 1-Click JWT never reach the browser; all third-party calls proxied through Next.js API routes with rate limiting.
- **Honest failure** — every error mapped to plain English + what happens to funds ("your USDC never left your wallet" / "refund in progress to 0x…").

## 5. AI layer

- **Model:** `claude-haiku-4-5` for parsing (fast/cheap), forced tool-use against an `Intent` JSON schema; escalate to `claude-sonnet-4-6` only when the first parse returns low confidence.
- **Intent schema v2:** `{ action: bridge|swap|send|quote_only, tokenIn, tokenOut?, amount, amountSide: in|out, fromChain, toChain, recipient?, confidence, clarifyingQuestion? }`. Token names resolve against the 1-Click `/v0/tokens` list (cached) + a local Skyline token map — users never see a contract address.
- **Guardrails:** parser output is advice, not authority. The router re-validates everything (token exists on chain, amount > 0 and ≤ balance, route supported). Unsupported asks return an explicit "can't do that, here's what I can do" — never a guess.

## 6. Architecture

```
Next.js (App Router, TS)
├─ UI: RainbowKit + wagmi/viem (Base), mobile-first (560px breakpoint, stacked cards)
├─ /api/parse    → Claude tool-use → Intent (zod-validated)
├─ /api/tokens   → cached 1-Click /v0/tokens + Skyline token map
├─ /api/quote    → router → Rail A quoteSend (viem readContract) | Rail B /v0/quote (dry)
├─ /api/execute  → Rail B real quote (deposit address creation) — Rail A executes client-side via wallet
├─ /api/status   → LayerZero Scan | 1-Click /v0/status (+ /v0/deposit/submit after user tx confirms)
└─ lib: intent schema, deterministic router, railA (OFT ABI + builders), railB (1-Click client), history store
```

Config (all server-side unless `NEXT_PUBLIC_`): `ANTHROPIC_API_KEY`, `ONECLICK_JWT` (removes the 0.2% no-auth fee — register as partner), `NEXT_PUBLIC_BAP3X_OFT_BASE`, `NEXT_PUBLIC_USDC_OFT_ADAPTER_BASE`, `NEXT_PUBLIC_AP3X_LZ_EID`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `SPEND_CAP_USD`.

## 7. v1 scope cuts (explicit)

- **In:** Base as the only *origin* chain users connect to; Rails A + B; prompt + manual form; tracking + history; mobile.
- **Out (v1.1+):** Cardano/UTXO leg of Skyline; multi-origin wallets (Solana/NEAR wallet connect); rail price comparison; portfolio view; session keys/automation; fiat on-ramp.

## 8. Success criteria

- A first-time user completes prompt → signed bridge in **< 60 seconds** without reading docs.
- Zero transactions ever submitted that differ from the review card (property-tested: card data and tx calldata derive from the same `Intent` object).
- Parse accuracy ≥ 95% on a 100-prompt eval set (maintained in repo, run in CI).
- Both rails demonstrated on mainnet with small real amounts before launch.

## 9. Open items

1. Real **bAP3X OFT** + **USDC adapter** addresses on Base and the **AP3X LayerZero EID** (Apex Fusion dev portal / GitHub).
2. 1-Click **partner JWT** (else 0.2% fee applies).
3. Whether Apex Fusion assets get listed on NEAR Intents later — would let Rail B serve them and turn the router into a true price-comparison engine.
