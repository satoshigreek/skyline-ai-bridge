import { encodeFunctionData, decodeFunctionResult, parseAbi } from "viem";
import { toSmallestUnits, fromSmallestUnits } from "./units";

export { buildPlan } from "./engine";
export { toWalletSteps } from "./execute-plan";
export { planRoute } from "./routes";

// ===========================================================================
// Buy AP3X in-page: USDC -> bAP3X on Base, best of Aerodrome + Uniswap v3.
// Quotes via each DEX's on-chain quoter (read-only eth_call to a public Base
// RPC); execution is built as approve + swap calldata that the user signs in
// their own wallet (no backend, no key custody). Addresses verified on
// BaseScan / the protocols' docs (2026-06).
// ===========================================================================
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
const BAP3X = "0x9208d82f121806a34a39bb90733b4c5c54f3993e" as `0x${string}`;
const BASE_RPC = "https://mainnet.base.org";

const AERO_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43" as `0x${string}`;
const AERO_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as `0x${string}`;
const UNI_QUOTER = "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a" as `0x${string}`; // QuoterV2
const UNI_ROUTER02 = "0x2626664c2603336E57B271c5C0b26F421741e481" as `0x${string}`; // SwapRouter02

const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const AERO = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
]);
const UNIQ = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 a, uint32 b, uint256 c)",
]);
const UNIR = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(BASE_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    const j = (await res.json()) as { result?: string };
    return j.result && j.result !== "0x" ? j.result : null;
  } catch {
    return null;
  }
}

export type BuyQuote = {
  venue: string;
  kind: "aerodrome" | "univ3";
  router: `0x${string}`;
  amountOut: string; // human bAP3X
  amountOutRaw: string; // smallest units
  fee?: number; // univ3 fee tier
  stable?: boolean; // aerodrome pool type
};

// Quote across both venues; return the best (most bAP3X out). Pools that don't
// exist simply fail their eth_call and are skipped.
export async function quoteBuyBest(usdcHuman: string): Promise<BuyQuote | null> {
  if (!/^\d+(\.\d+)?$/.test(usdcHuman) || Number(usdcHuman) <= 0) return null;
  const amountIn = toSmallestUnits(usdcHuman, 6);
  const found: BuyQuote[] = [];

  for (const stable of [false, true]) {
    const data = encodeFunctionData({ abi: AERO, functionName: "getAmountsOut", args: [amountIn, [{ from: USDC, to: BAP3X, stable, factory: AERO_FACTORY }]] });
    const r = await ethCall(AERO_ROUTER, data);
    if (r) {
      try {
        const amounts = decodeFunctionResult({ abi: AERO, functionName: "getAmountsOut", data: r as `0x${string}` }) as readonly bigint[];
        const a = amounts[amounts.length - 1];
        if (a > 0n) found.push({ venue: "Aerodrome", kind: "aerodrome", router: AERO_ROUTER, amountOut: fromSmallestUnits(a, 18), amountOutRaw: a.toString(), stable });
      } catch { /* no pool */ }
    }
  }
  for (const fee of [3000, 500, 10000]) {
    const data = encodeFunctionData({ abi: UNIQ, functionName: "quoteExactInputSingle", args: [{ tokenIn: USDC, tokenOut: BAP3X, amountIn, fee, sqrtPriceLimitX96: 0n }] });
    const r = await ethCall(UNI_QUOTER, data);
    if (r) {
      try {
        const dec = decodeFunctionResult({ abi: UNIQ, functionName: "quoteExactInputSingle", data: r as `0x${string}` }) as readonly [bigint, bigint, number, bigint];
        if (dec[0] > 0n) found.push({ venue: "Uniswap v3", kind: "univ3", router: UNI_ROUTER02, amountOut: fromSmallestUnits(dec[0], 18), amountOutRaw: dec[0].toString(), fee });
      } catch { /* no pool at this tier */ }
    }
  }
  if (!found.length) return null;
  found.sort((x, y) => (BigInt(x.amountOutRaw) < BigInt(y.amountOutRaw) ? 1 : -1));
  return found[0];
}

export function usdcToSmallest(usdcHuman: string): string {
  return toSmallestUnits(usdcHuman, 6).toString();
}

export async function usdcAllowance(owner: string, spender: string): Promise<string> {
  const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [owner as `0x${string}`, spender as `0x${string}`] });
  const r = await ethCall(USDC, data);
  return r ? BigInt(r).toString() : "0";
}

export function buildApproveTx(spender: string, usdcHuman: string): { to: string; data: string } {
  const amt = toSmallestUnits(usdcHuman, 6);
  return { to: USDC, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [spender as `0x${string}`, amt] }) };
}

export function buildSwapTx(q: BuyQuote, taker: string, usdcHuman: string, slippageBps = 100): { to: string; data: string } {
  const amountIn = toSmallestUnits(usdcHuman, 6);
  const out = BigInt(q.amountOutRaw);
  const minOut = out - (out * BigInt(slippageBps)) / 10000n;
  if (q.kind === "aerodrome") {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const data = encodeFunctionData({
      abi: AERO,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, minOut, [{ from: USDC, to: BAP3X, stable: !!q.stable, factory: AERO_FACTORY }], taker as `0x${string}`, deadline],
    });
    return { to: q.router, data };
  }
  const data = encodeFunctionData({
    abi: UNIR,
    functionName: "exactInputSingle",
    args: [{ tokenIn: USDC, tokenOut: BAP3X, fee: q.fee ?? 3000, recipient: taker as `0x${string}`, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
  });
  return { to: q.router, data };
}
