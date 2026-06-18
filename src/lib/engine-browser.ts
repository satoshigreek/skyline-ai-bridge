// Browser entry: bundles the pure engine for GitHub Pages (no backend). The
// routing + card logic runs entirely client-side; the ⟨VERIFY⟩ contract
// addresses are unset here, so USDC rails return their clear "not configured"
// errors while routing, the card, and AP3X all work. esbuild emits this as the
// global `SkylineEngine`.
export { buildPlan } from "./engine";
export { toWalletSteps } from "./execute-plan";
export { planRoute } from "./routes";
