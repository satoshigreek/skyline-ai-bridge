# Build Prompt — Skyline AI Bridge (production)

Copy everything below the line into a fresh Claude Code session at the root of a new repo.
If the repo contains `docs/SPEC.md`, read it first — it is the authority; this prompt is the condensed work order.

---

Build a production web app called **Skyline AI Bridge**: users connect a wallet on **Base**, type what they want in plain English (e.g. "move 250 USDC from Base to Apex Fusion", "swap 0.1 ETH on Base for NEAR"), and get ONE reviewable card — route, amount in, min received, itemized fees, ETA, recipient — which they approve by signing in their own wallet. **The AI never signs anything and never picks the execution path; it only extracts a typed intent.**

## Architecture (fixed decisions — don't relitigate)

- **Stack:** Next.js (App Router) + TypeScript strict + wagmi v2 + viem + RainbowKit + zod + @anthropic-ai/sdk. Mobile-first CSS (stack all side-by-side rows below 560px; test at 375px).
- **Two execution rails behind one deterministic router** (plain code, not LLM):
  - **Rail A — Skyline / LayerZero OFT** (Base ↔ Apex Fusion): direct contract calls on Base. AP3X/bAP3X = native OFT (18 decimals, single `send`). USDC = OFT **Adapter** over canonical Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals, `approve` then `send`, show 2-step progress). Use the standard LayerZero OFT v2 interface: `quoteSend(SendParam,bool) → MessagingFee` and `send(SendParam,MessagingFee,refundAddress)` with `SendParam{dstEid,to(bytes32),amountLD,minAmountLD,extraOptions,composeMsg,oftCmd}`. Track via LayerZero Scan (`https://layerzeroscan.com/tx/{hash}`).
  - **Rail B — NEAR Intents 1-Click API** (Base ↔ NEAR/Ethereum/Arbitrum/Solana/BTC/…): base URL `https://1click.chaindefuser.com`. `GET /v0/tokens` (cache 10 min; resolve user token names → assetIds). `POST /v0/quote` with `{dry, swapType: EXACT_INPUT, slippageTolerance(bps), originAsset, destinationAsset, amount(smallest units), recipient, recipientType: DESTINATION_CHAIN, refundTo: <user wallet>, refundType: ORIGIN_CHAIN, deadline(ISO), depositType: ORIGIN_CHAIN}`. Dry quote for the review card; real quote (returns `depositAddress` + deadline) only on user Confirm. User signs a **plain transfer** to `depositAddress` (ERC-20 `transfer` or native send via wagmi). After confirmation, `POST /v0/deposit/submit {txHash, depositAddress}` then poll `GET /v0/status?depositAddress=…` through `PENDING_DEPOSIT → KNOWN_DEPOSIT_TX → PROCESSING → SUCCESS | INCOMPLETE_DEPOSIT | REFUNDED | FAILED`. Auth header `Authorization: Bearer ${ONECLICK_JWT}` (server-side only; without it a 0.2% fee applies — still works).
- **Router policy:** source or destination is Apex Fusion → Rail A; any other cross-chain pair → Rail B; same-chain or unsupported → explicit "can't do that" with what IS supported. Re-validate everything the parser said (token exists on chain, amount > 0, route supported, balance sufficient).
- **AI layer:** `/api/parse` server route → Claude `claude-haiku-4-5`, forced tool-use (`tool_choice`) emitting `Intent = {action: bridge|swap|send|quote_only, tokenIn, tokenOut?, amount, amountSide: in|out, fromChain, toChain, recipient?, confidence, clarifyingQuestion?}` — zod-validate the tool output; on validation failure retry once with the error, then fall back to a regex heuristic parser (ship one). If required fields are missing, return `clarifyingQuestion` and render it inline in chat-style (max 2 rounds, then offer the manual form). Escalate to `claude-sonnet-4-6` when confidence < 0.5.
- **Secrets:** `ANTHROPIC_API_KEY`, `ONECLICK_JWT` server-side only, proxied through API routes with basic rate limiting. Client env: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_BAP3X_OFT_BASE`, `NEXT_PUBLIC_USDC_OFT_ADAPTER_BASE`, `NEXT_PUBLIC_AP3X_LZ_EID`, `NEXT_PUBLIC_MOCK_MODE`. Rail A contract addresses are **placeholders until supplied** — gate Rail A behind mock mode if unset, but build Rail B fully live from day one (it needs no custom contracts).

## Safety requirements (treat as acceptance criteria)

1. The review card and the transaction calldata must derive from the **same** validated `Intent` object — write a test asserting a card snapshot and the built tx for the same intent can't diverge.
2. Per-tx spend cap (`SPEND_CAP_USD`, default 1000): above it, require the user to retype the amount.
3. First-time recipient → full checksummed address confirm; store an address book in localStorage.
4. Rail B deposit addresses expire — show a live deadline countdown; block sending after expiry; never reuse an old deposit address.
5. Every failure mapped to plain English including where the funds are ("never left your wallet" / "refund in progress to 0x…").

## Build order (verify each phase before the next; keep the app runnable at every step)

1. **Scaffold + wallet + manual form.** Repo, lint, strict TS, RainbowKit on Base, and a dropdown-based manual form that produces an `Intent` and renders the review card with mocked quotes. The whole UI works before any AI or chain integration. Mobile layout verified at 375px.
2. **AI parse.** `/api/parse` with forced tool-use, zod validation, heuristic fallback, clarifying-question loop. Ship a 100-prompt eval set (`evals/prompts.jsonl` with expected intents) and a script `npm run eval:parser` — require ≥95% before moving on.
3. **Rail B live (NEAR Intents).** Tokens cache, dry quote on review, real quote on confirm, transfer signing, deposit submit, status polling with reload-safe history (localStorage keyed by wallet). Verify on Base mainnet with a tiny swap (e.g. $2 USDC → NEAR) end to end.
4. **Rail A (Skyline OFT).** Builders + ABI + 2-step USDC approve flow behind config; full mock-mode simulation when addresses are placeholders; goes live by filling env vars only — no code change.
5. **Tracking + history + polish.** Status cards, explorer links, history view, empty/error states, loading skeletons, example chips.
6. **Hardening.** Unit tests (parser fallback, router, unit conversions — especially USDC 6 decimals vs 18), mocked 1-Click server for integration tests, rate limiting, the card/calldata-equivalence test, a `SECURITY.md` documenting the trust model.

Definition of done: a first-time user goes prompt → signed transaction in under 60 seconds; both rails demonstrated (Rail B on mainnet small-amount, Rail A in mock until addresses arrive); `npm run eval:parser` ≥95%; all tests green; works at 375px.

## Known unknowns (resolve, don't guess)

- Real bAP3X OFT + USDC adapter addresses on Base and the AP3X LayerZero EID → Apex Fusion dev portal (`developers.apexfusion.org`) / GitHub (`github.com/Apex-Fusion`); ask the user if not findable.
- 1-Click JWT → https://docs.near-intents.org (partner registration); app must run without it (0.2% fee) — make it optional.
- Exact 1-Click request fields may have evolved — fetch current docs (`https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart.md`) and the TypeScript SDK (`@defuse-protocol/one-click-sdk-typescript`) before coding Rail B; prefer the SDK if it's maintained, otherwise a thin typed fetch client.
