# Skyline AI Bridge

Connect a wallet on **Base**, type what you want in plain English, review **one card**
— route, amount in, min received, itemized fees, ETA, recipient — and sign in your
own wallet. The AI never signs anything and never picks the execution path; it only
extracts a typed intent.

```
"Bridge 25 AP3X to Apex Fusion"               -> Rail A (bAP3X LayerZero OFT)
"Swap 0.1 ETH on Base for NEAR"               -> Rail B (NEAR Intents 1-Click)
"Send 50 USDC to alice.near"                  -> Rail B
```

There is no Skyline API anywhere in the loop — the Apex Fusion route talks
directly to the **bAP3X LayerZero OFT contract** on Base (verified on-chain),
and every other destination rides **NEAR Intents**.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3001
npm test             # unit/equivalence/integration tests
npm run eval:parser  # 100-prompt parse eval (100% on the heuristic engine)
```

Runs live with zero configuration: parsing falls back to a built-in heuristic,
**Rail A quotes live LayerZero fees** from the bAP3X OFT, and **NEAR Intents
quotes are live** (with the 0.2% no-auth fee). Copy `.env.local.example` to
`.env.local` to add Claude parsing or the 1-Click partner JWT.

## Architecture

```
English prompt ──> /api/parse ──> Intent (zod-typed)          <── Manual form
                   Claude haiku, forced tool-use,                  (same Intent)
                   retry -> sonnet escalation -> regex fallback
                                  │
                        deterministic router (plain code — LLM has no say)
                          │                          │
            to/from Apex Fusion              everything else cross-chain
              (AP3X / bAP3X only)                    │
                          │                          │
              Rail A: LayerZero OFT          Rail B: NEAR Intents 1-Click
              quoteSend (live fee)           dry quote -> review -> real quote
              -> send (user signs)           -> user signs ONE transfer to the
              track: LayerZero Scan            deposit address -> solvers settle
                                               track: /v0/status (auto-refunds)
```

The review card and the transaction calldata are built **by the same function
from the same validated Intent** — `tests/equivalence.test.ts` asserts they
cannot diverge. That is the core safety property.

## Safety model

- **No auto-signing.** The model emits JSON; every execution is a wallet signature.
- **Spend cap** (`NEXT_PUBLIC_SPEND_CAP_USD`, default $1000) enforced in the UI
  *and* server-side in `/api/execute` — above it you retype the amount.
- **First-time recipients** require a full-address checkbox confirm (address book
  in localStorage).
- **Rail B deposit addresses expire** — live countdown, sending blocked after
  expiry, addresses never reused. Failed swaps auto-refund (`refundTo` = your wallet).
- Errors always say where the funds are ("never left your wallet" / "refund in progress").
- Secrets (`ANTHROPIC_API_KEY`, `ONECLICK_JWT`) stay server-side behind rate-limited routes.

See [SECURITY.md](SECURITY.md) for the full trust model.

## Configuration

| Var | Effect when set |
| --- | --- |
| `ANTHROPIC_API_KEY` | Claude parsing (haiku, sonnet escalation) instead of the regex heuristic |
| `ONECLICK_JWT` | Removes the 0.2% 1-Click no-auth fee (partner registration: docs.near-intents.org) |
| `NEXT_PUBLIC_BAP3X_OFT_BASE` | Override the built-in bAP3X OFT default (`0x9208d82f…3993e`, verified on-chain) |
| `NEXT_PUBLIC_AP3X_LZ_EID` | Override the built-in AP3X endpoint id default (`30384`, read from on-chain `PeerSet` events) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect QR pairing |
| `NEXT_PUBLIC_SPEND_CAP_USD` | Per-tx safety cap (default 1000) |

USDC has no OFT route to Apex Fusion (no adapter contract exists) — the router
explains that and offers the supported tokens; USDC bridges everywhere else
via NEAR Intents.

## Status / done-ness

- ✅ Rail A (LayerZero OFT): **live by default.** `quoteSend` verified against
  the real bAP3X contract (returned ~0.0000124 ETH for a 1-token send to EID
  30384); address + EID verified on-chain, not from docs.
- ✅ Rail B (NEAR Intents): live dry quotes verified against the real API
  (0.05 ETH → wNEAR, real solver pricing). Tokens cache, deposit-address flow,
  status polling, reload-safe history all wired.
- ✅ Parser: 100/100 eval (heuristic engine); Claude engine ready behind a key
  (`npm run eval:parser -- --engine=claude`).
- ⬜ Final mainnet smoke tests (a ~$2 USDC→NEAR swap; a small bAP3X→Apex send)
  — need a funded wallet; everything up to the signature is verified.
