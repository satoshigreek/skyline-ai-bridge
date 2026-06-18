// Browser entry: bundles the pure engine for GitHub Pages (no backend). The
// routing + card logic runs entirely client-side; the ⟨VERIFY⟩ contract
// addresses are unset here, so USDC rails return their clear "not configured"
// errors while routing, the card, and AP3X all work. esbuild emits this as the
// global `SkylineEngine`.
import { encodeFunctionData, decodeFunctionResult, parseAbi } from "viem";
import { toSmallestUnits, fromSmallestUnits } from "./units";

export { buildPlan } from "./engine";
export { toWalletSteps } from "./execute-plan";
export { planRoute } from "./routes";

// --- Buy AP3X: USDC on Base → bAP3X ("Based Apex") on Base, via Uniswap ---
// One-way only. Quote comes from Uniswap's v3 QuoterV2 (read-only eth_call, no
// API key); execution opens the Uniswap app pre-filled. Addresses from the repo
// (bAP3X OFT verified on-chain); QuoterV2 is ⟨VERIFY⟩ and only affects the live
// estimate — the Uniswap link always works.
const USDC_BASE_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const BAP3X_BASE_ADDR = "0x9208d82f121806a34a39bb90733b4c5c54f3993e" as `0x${string}`;
const BASE_QUOTER_V2 = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as `0x${string}`;
const BASE_RPC = "https://mainnet.base.org";

const QUOTER_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

export async function quoteBuyAp3xOnBase(usdcHuman: string): Promise<{ amountOut: string; fee: number } | null> {
  if (!/^\d+(\.\d+)?$/.test(usdcHuman) || Number(usdcHuman) <= 0) return null;
  const amountIn = toSmallestUnits(usdcHuman, 6);
  for (const fee of [3000, 10000, 500]) {
    try {
      const data = encodeFunctionData({
        abi: QUOTER_ABI,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: USDC_BASE_ADDR, tokenOut: BAP3X_BASE_ADDR, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      const res = await fetch(BASE_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: BASE_QUOTER_V2, data }, "latest"] }),
      });
      const j = (await res.json()) as { result?: string };
      if (j.result && j.result !== "0x") {
        const decoded = decodeFunctionResult({ abi: QUOTER_ABI, functionName: "quoteExactInputSingle", data: j.result as `0x${string}` }) as readonly [bigint, bigint, number, bigint];
        return { amountOut: fromSmallestUnits(decoded[0], 18), fee };
      }
    } catch {
      /* try the next fee tier */
    }
  }
  return null;
}

export function uniswapBuyLink(usdcHuman: string): string {
  const amt = /^\d+(\.\d+)?$/.test(usdcHuman) ? usdcHuman : "";
  return (
    `https://app.uniswap.org/swap?chain=base&inputCurrency=${USDC_BASE_ADDR}&outputCurrency=${BAP3X_BASE_ADDR}` +
    (amt ? `&exactAmount=${amt}&exactField=input` : "")
  );
}
