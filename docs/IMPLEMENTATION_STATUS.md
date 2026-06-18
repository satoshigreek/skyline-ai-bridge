# Skyline AI Cross-Chain Engine — Implementation Status

Tracks the redesign in `docs/ROUTING_SPEC.md` against what is built and verified.
Verified here means: `tsc --noEmit` clean, `vitest` green (88 tests), `next build` exit 0.

## Done — the routing + builder layer (pure, fully tested)

| Component | File | What it does |
|---|---|---|
| Asset scope | `src/lib/chains.ts` | AP3X + USDC only, CI-guarded (`tests/asset-scope.test.ts`) |
| Canonical router | `src/lib/routes.ts` | Shortest-path over issuer-native rails → `(asset, from, to)` ⇒ ordered hops |
| CCTP builder | `src/lib/cctp.ts` | Native USDC `depositForBurn` plan + card |
| Hyperliquid builder | `src/lib/hyperliquid.ts` | CCTP → Arbitrum → deposit; HyperCore USDC; 5-USDC min |
| xReserve builder | `src/lib/xreserve.ts` | CCTP → Ethereum → `depositToRemote`; USDCx; Canton permissioned |
| Stargate builder | `src/lib/stargate.ts` | BNB USDC (pool-wrapped) — the lone non-CCTP leg |
| AP3X builder | `src/lib/ap3x.ts` | OFT mesh + Reactor internal, multi-leg compositions |
| Dispatcher | `src/lib/engine.ts` | `buildPlan(request)` → routes to the right builder, tagged `{ card, plan }` |
| API seam | `src/app/api/plan/route.ts` | `POST /api/plan` — zod-validated, rate-limited, returns `{ rail, card, plan }` |

Every rail builds the **review card and the signed plan from one validated input**
(the card ≡ calldata invariant), each gated by an equivalence test. Builders
**refuse to produce a plan against unconfigured contract addresses** — no guessed
values ship.

## Not done — and why

1. **On-chain `⟨VERIFY⟩` constants (BLOCKED in this environment).** The contract
   addresses, domain/endpoint ids, and exact ABIs are config-only and must be
   confirmed against live deployments before mainnet:
   - CCTP v2 **TokenMessenger** addresses + `depositForBurn` ABI
   - **xReserve** gateway address, per-destination remote domains, recipient byte encoding
   - **Stargate** router/pool addresses + LayerZero endpoint ids
   - **Hyperliquid** Bridge2 address (spec-provided `0x2Df1…3dF7`)
   - BNB USDC address
   This sandbox has no outbound network/RPC access, so none of these could be
   verified here. They are the single gate before execution.

2. **UI / executor wiring (not verifiable here).** The engine is reachable
   server-side via `POST /api/plan`, but surfacing its card in the UI and *signing*
   the returned plans needs a running browser + wallet, which can't be exercised in
   this environment. The legacy `src/lib/build.ts` (Rail A/B/C) and the
   `Rail*Executor` components still drive the current app; migrating them onto
   `/api/plan` → `engine.ts` is the next behavioral increment. (Client executors
   that call contracts are intentionally NOT written yet — they'd encode the
   unverified `⟨VERIFY⟩` ABIs, and shipping unconfirmed fund-moving calldata is
   exactly what this layer avoids.)

3. **Deferred rail edges:** Solana-side CCTP (non-EVM instructions), Hyperliquid
   withdrawal (reverse), and BNB/Solana origins for Hyperliquid/xReserve. The
   router already plans these; the builders flag them as out of scope with clear
   errors rather than faking them.

## Suggested next steps

1. Populate the `⟨VERIFY⟩` config from Circle / Hyperliquid / Stargate docs (env
   vars already wired); the equivalence tests then cover real addresses.
2. Migrate one `Rail*Executor` (start with CCTP) onto `buildPlan`, behind the
   existing review-card UI, and smoke-test with a funded wallet.
3. Add the Solana CCTP instruction builder to unlock Solana origins/destinations.
