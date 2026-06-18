# Architecture — Skyline AI Bridge

Documented with the [C4 model](https://c4model.com) (Context + Container levels),
rendered in Mermaid so it displays inline on GitHub. C4 is the pragmatic industry
default for showing UI, backend, and infrastructure together at increasing zoom.

---

## Level 1 — System Context

The big picture: who uses the system and which external systems it depends on.

```mermaid
flowchart TB
    user(["👤 User<br/>holds EVM wallet (Base/BNB/Nexus)<br/>+ CIP-30 Cardano wallet (Prime/Vector/Cardano)"])

    subgraph sys["🟦 Skyline AI Bridge"]
        app["Plain-English cross-chain bridging.<br/>AI extracts intent; deterministic router<br/>picks the rail; the user signs every tx."]
    end

    claude["🤖 Anthropic Claude API<br/>haiku → sonnet escalation<br/>(intent parsing only)"]
    lz["⛓️ LayerZero / bAP3X OFT<br/>on-chain contracts (Rail A)"]
    near["🌐 NEAR Intents 1-Click API<br/>deposit address + solvers (Rail B)"]
    skyline["🌉 Skyline Native Bridge API<br/>web-api.mainnet.skylinebridge.tech (Rail C)"]
    scan["🔎 LayerZero Scan<br/>tx tracking"]

    user -->|"types intent, reviews card, signs"| sys
    sys -->|"parse NL → Intent"| claude
    sys -->|"quoteSend / send"| lz
    sys -->|"quote / status / refund"| near
    sys -->|"create / submit / status"| skyline
    sys -->|"track delivery"| scan
```

---

## Level 2 — Container Diagram

The runnable/deployable units (frontend, API routes, shared logic) plus the
three deployment flavors. This is the main view: it shows the **UI**,
**software components**, and **infrastructure / external integrations** together.

```mermaid
flowchart TB
    user(["👤 User + Wallets<br/>RainbowKit / wagmi · CIP-30"])

    subgraph deploy["Deployment flavors (same product, 3 ways to run)"]
        hosted["GitHub Pages<br/>docs/index.html<br/>(Rails A & B, browser-direct)"]
        standalone["Standalone<br/>standalone/index.html + .bat launcher<br/>(127.0.0.1:8123, no backend)"]
    end

    subgraph next["▲ Next.js 15 App (full deploy — e.g. Vercel)"]
        direction TB

        subgraph fe["Frontend — React 19 (Client Components)"]
            page["page.tsx<br/>prompt box + review card"]
            tcard["TransferCard"]
            exA["RailAExecutor"]
            exB["RailBExecutor"]
            exC["RailCExecutor"]
            misc["Countdown · HistoryList"]
        end

        mw["middleware.ts<br/>security headers"]

        subgraph api["API Routes (server, runtime=nodejs)"]
            rparse["/api/parse"]
            rexec["/api/execute"]
            rquote["/api/quote"]
            rstatus["/api/status"]
            rtokens["/api/tokens"]
            rapex["/api/apex/{create,submit,status}<br/>(CORS proxy for Rail C)"]
        end

        subgraph lib["src/lib — shared logic (the brains)"]
            router["router.ts<br/>⚖️ deterministic rail selection<br/>(LLM has NO say)"]
            intent["intent.ts (zod Intent)"]
            heur["heuristic.ts (regex fallback)"]
            cparse["claudeParse.ts"]
            build["build.ts<br/>card + calldata (single source)"]
            oft["oft.ts (LayerZero)"]
            oneclick["oneclick.ts (NEAR)"]
            skylib["skyline.ts · cardano.ts"]
            chains["chains.ts · units.ts · intent scope"]
            rl["rateLimit.ts · history.ts · wagmi.ts"]
        end
    end

    claude["🤖 Claude API"]
    lz["⛓️ bAP3X OFT contracts"]
    near["🌐 NEAR 1-Click API"]
    skyapi["🌉 Skyline Bridge API"]

    user --> page
    page --> tcard --> exA & exB & exC

    page -->|prompt| rparse
    exB -->|confirm| rexec
    exA -->|client-side signs OFT| lz
    exC --> rapex
    page --> rquote & rstatus & rtokens

    rparse --> cparse --> claude
    rparse --> heur
    rparse --> intent
    rexec --> router --> build
    rexec --> oneclick --> near
    rquote --> oft --> lz
    rapex --> skylib --> skyapi
    router --> chains

    hosted -. "subset" .-> lib
    standalone -. "subset" .-> lib
```

---

## The core safety property

Parsing and routing are deliberately separated, and the model is fenced out of
both money decisions:

```mermaid
flowchart LR
    nl["English prompt"] --> parse["/api/parse<br/>Claude (forced tool-use)<br/>→ retry → regex fallback"]
    form["Manual form"] --> intent
    parse --> intent["Intent (zod-typed)"]
    intent --> router{"Deterministic router<br/>plain code"}
    router -->|"AP3X ↔ Nexus"| A["Rail A · LayerZero OFT<br/>quoteSend → user signs"]
    router -->|"other cross-chain"| B["Rail B · NEAR Intents<br/>quote → user signs 1 transfer"]
    router -->|"Apex Fusion internal"| C["Rail C · Skyline native<br/>create → user signs → submit"]

    intent --> build["build.ts"]
    build --> card["Review card"]
    build --> calldata["Transaction calldata"]
    card -. "tests/equivalence.test.ts<br/>asserts these cannot diverge" .-> calldata
```

> The review card and the signed calldata are built **by the same function from
> the same validated Intent**. `tests/equivalence.test.ts` enforces that they can
> never diverge — that is the central trust guarantee. The AI emits JSON only; it
> never picks the rail and never signs.

---

### Legend / mapping to your question

| You asked about | Where it lives in the diagrams |
| --- | --- |
| **UI** | `Frontend — React 19` box: `page.tsx`, `TransferCard`, the three `Rail*Executor`s, `Countdown`, `HistoryList` |
| **Software components** | `src/lib` box — `router`, `intent`, `build`, parsers, and per-rail adapters |
| **Infrastructure** | API routes (server runtime), `middleware`, the 3 deployment flavors, and external systems (Claude, LayerZero, NEAR, Skyline) |
| **Data / control flow** | Arrows; the safety diagram shows the parse → route → execute pipeline |
