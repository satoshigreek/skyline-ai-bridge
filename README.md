# Skyline AI Bridge

Connect a wallet on **Base**, type what you want in plain English, review **one card**
— route, amount in, min received, itemized fees, ETA, recipient — and sign in your
own wallet. The AI never signs anything and never picks the execution path; it only
extracts a typed intent.

```
"Move 250 USDC from Base to Apex Fusion"      -> Rail A (Skyline / LayerZero OFT)
"Swap 0.1 ETH on Base for NEAR"               -> Rail B (NEAR Intents 1-Click)
"Send 50 USDC to alice.near"                  -> Rail B
```

## Quick start

```bash
npm install
npm run dev          # http://localhost:3001
npm test             # 34 unit/equivalence/integration tests
npm run eval:parser  # 100-prompt parse eval (100% on the heuristic engine)
```

Runs with zero configuration: parsing falls back to a built-in heuristic, the
Apex Fusion route is simulated, and **NEAR Intents quotes are live** (with the
0.2% no-auth fee). Copy `.env.local.example` to `.env.local` to upgrade pieces.

## Architecture

```
English prompt ──> /api/parse ──> Intent (zod-typed)          <── Manual form
                   Claude haiku, forced tool-use,                  (same Intent)
                   retry -> sonnet escalation -> regex fallback
                                  │
                        deterministic router (plain code — LLM has no say)
                          │                          │
            to/from Apex Fusion              everything else cross-chain
                          │                          │
              Rail A: Skyline OFT            Rail B: NEAR Intents 1-Click
              approve? -> quoteSend          dry quote -> review -> real quote
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
| `NEXT_PUBLIC_BAP3X_OFT_BASE` | bAP3X OFT on Base — **verified on-chain:** `0x9208d82f121806a34a39bb90733b4c5c54f3993e` |
| `NEXT_PUBLIC_AP3X_LZ_EID` | Apex Fusion LayerZero EID — discovered from on-chain `PeerSet` events: `30384` (confirm with Skyline before first mainnet send) |
| `NEXT_PUBLIC_USDC_OFT_ADAPTER_BASE` | USDC→Apex adapter (not yet published by Skyline; that route stays simulated) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect QR pairing |
| `NEXT_PUBLIC_SPEND_CAP_USD` | Per-tx safety cap (default 1000) |

Rail A goes live by filling env vars only — no code changes.

## Status / done-ness

- ✅ Rail B (NEAR Intents): live dry quotes verified against the real API
  (0.05 ETH → wNEAR, real solver pricing). Tokens cache, deposit-address flow,
  status polling, reload-safe history all wired.
- ✅ Rail A (Skyline OFT): builders + 2-step USDC approve flow + mock simulation;
  bAP3X address verified on-chain (name/symbol/decimals/oftVersion/endpoint).
- ✅ Parser: 100/100 eval (heuristic engine); Claude engine ready behind a key
  (`npm run eval:parser -- --engine=claude`).
- ⬜ Final mainnet smoke test (a ~$2 USDC→NEAR swap) — needs a funded wallet;
  everything up to the signature is verified.
- ⬜ Confirm EID 30384 with the Skyline team before the first live Rail A send.
