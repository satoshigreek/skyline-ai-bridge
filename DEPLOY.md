# Deploying Skyline AI Bridge (all three rails)

The static GitHub Pages build (`docs/`) serves Rails A & B only. **Rail C
(Apex Fusion internal — Nexus↔Prime, Prime↔Vector, Prime↔Cardano) needs the
server-side proxy in this Next.js app**, because the Skyline API is
CORS-allowlisted and can't be called from a browser. Deploy the Next.js app to
get all three rails on one public URL.

## Vercel — dashboard connect (recommended)

Auto-deploys on every `git push` to `main`. Zero config — Next.js is
auto-detected.

1. Go to **https://vercel.com/new**
2. **Import** the GitHub repo `satoshigreek/skyline-ai-bridge`
   (authorize Vercel for GitHub if prompted).
3. Leave every setting at its default:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: **`./`**
   - Build Command: `next build` · Output: `.next` · Install: `npm install`
4. **Environment Variables — none are required.** The app boots live with
   built-in defaults (Skyline API, bAP3X address, Nexus EID; heuristic parser).
   Optionally add (Production scope):
   | Key | Effect |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | Claude prompt parsing instead of the regex heuristic |
   | `ONECLICK_JWT` | Removes NEAR Intents' 0.2% no-auth fee |
   | `SKYLINE_API` | Override the Skyline base URL (defaults to mainnet) |
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect QR pairing |
5. **Deploy.** You'll get `https://skyline-ai-bridge-<hash>.vercel.app` (rename
   the project for a cleaner subdomain, or add a custom domain under
   Settings → Domains, e.g. `bridge.odyssey-works.io`).

## Vercel — CLI (one-off)

```bash
npm i -g vercel        # or: npx vercel@latest
vercel login           # interactive
vercel --prod          # from the repo root; accept the auto-detected settings
```

## Notes

- API routes (`/api/parse`, `/api/quote`, `/api/execute`, `/api/apex/*`,
  `/api/status`, `/api/tokens`) deploy as serverless functions on Node — this
  is what lets Rail C proxy the CORS-locked Skyline API.
- The in-memory rate limiter resets per cold start / instance. For production
  scale, back it with Vercel KV / Upstash Redis (swap `src/lib/rateLimit.ts`).
- Production build verified locally: 12 pages, 8 API functions, types valid.
