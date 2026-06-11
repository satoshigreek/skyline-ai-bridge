# Security & Trust Model

## What the AI can and cannot do

The LLM (Claude) is used for exactly one thing: translating a natural-language
prompt into a typed `Intent` object (`src/lib/intent.ts`). It is invoked with
forced tool-use, its output is zod-validated, and a regex heuristic replaces it
entirely when unavailable. It **cannot**:

- choose the execution rail (deterministic code in `src/lib/router.ts` does),
- construct calldata or amounts (builders in `src/lib/oft.ts` / `src/lib/build.ts` do),
- sign or submit anything (only the user's wallet signs).

A malicious or hallucinating model output is bounded by: zod schema -> router
re-validation (token/chain/amount/route) -> the review card the user reads ->
the user's signature.

## Card/calldata equivalence (the core invariant)

The review card and the transaction plan are produced by the same builder from
the same validated Intent (`buildRailACard`, `buildRailBCard`). The UI renders
only the card; executors consume only the plan. `tests/equivalence.test.ts`
asserts amount, min-received, recipient, and deposit address match between the
two for both rails, including the USDC 6-vs-18 decimals trap.

## Spend cap

`/api/execute` (Rail B) enforces `SPEND_CAP_USD` **server-side** before any
deposit address is created: above the cap the request must carry
`confirmedAmount` identical to the intent amount, which the UI only sets after
the user retypes it. Rail A executes client-side (wallet -> contract directly),
so its cap check is UI-only — acceptable because Rail A also shows the full
review card and the wallet shows the exact calldata. Tokens without a USD price
bypass the cap (documented limitation; the review card flags price-less tokens).

## Rail B specifics (NEAR Intents)

- Dry quotes (`dry: true`) for the review card never create deposit addresses.
- Real quotes are created only on explicit user confirm; the deposit address is
  shown with a live deadline countdown and sending is blocked after expiry.
- `refundTo` is always the connected wallet on Base; failed or under-filled
  swaps refund there automatically.
- The optional `ONECLICK_JWT` lives server-side only and is attached in
  `src/lib/oneclick.ts`; the browser never sees it.

## Rail A specifics (Skyline / LayerZero OFT)

- bAP3X OFT address `0x9208d82f…3993e` was verified on-chain (name, symbol,
  decimals, `oftVersion()`, canonical LayerZero EndpointV2) — not taken from
  a web page alone.
- The AP3X endpoint id (30384) was discovered from the contract's own `PeerSet`
  events. **Confirm with Skyline before the first mainnet send** — a wrong EID
  reverts at quote time (funds safe), but don't rely on that.
- USDC rides an OFT **Adapter** (lock/unlock): the approve is scoped to the
  exact bridged amount, never unlimited.
- Rail A stays in visible mock simulation until all addresses are configured.

## Server hardening

- All third-party calls (Anthropic, 1-Click) are proxied through Next.js API
  routes with per-IP sliding-window rate limits (`src/lib/rateLimit.ts`).
  In-memory — swap for Redis when deploying multi-node.
- Prompt length capped (1000 chars), clarify exchanges capped (2), JSON bodies
  schema-validated on every route.
- No private keys, no custody, no database: history and the address book live
  in the user's localStorage only.

## Known limitations

- Rail A cap enforcement is client-side only (see above).
- The in-memory rate limiter resets on redeploy and doesn't share state across
  instances.
- `eth_getLogs`-style provenance for the EID is strong evidence, not a Skyline
  attestation.
- No session keys / automation by design in v1: every action is one explicit
  human signature.
