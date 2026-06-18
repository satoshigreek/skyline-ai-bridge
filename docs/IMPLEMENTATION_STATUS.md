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
| Execution steps | `src/lib/execute-plan.ts` | `toWalletSteps(result)` → ordered wallet txs; ERC-20 legs are real calldata, protocol calls are resolved-arg descriptors (ABI `⟨VERIFY⟩`) |

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

2. **The last mile: ABI binding + UI signing (gated, not fabricated).**
   `toWalletSteps` produces the ordered transactions; the ERC-20 legs (approvals,
   the Hyperliquid deposit transfer) are **real, decodable calldata**. What remains
   is (a) binding the verified protocol ABIs to the `verify-required` descriptors
   (CCTP `depositForBurn`, xReserve `depositToRemote`, Stargate `send`) and (b)
   rendering the card + driving the wallet through the steps in the UI — both need
   a browser + funded wallet this environment doesn't have. AP3X execution already
   exists (`oft.ts` / `skyline.ts`). The protocol ABIs are intentionally NOT
   guessed — that is the one thing that must be confirmed on-chain first.

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
