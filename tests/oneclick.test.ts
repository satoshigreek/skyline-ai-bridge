import { afterEach, describe, expect, it, vi } from "vitest";
import { getStatus, getTokens, requestQuote, resolveAsset } from "../src/lib/oneclick";
import type { OneClickToken } from "../src/lib/oneclick";

// Integration tests against a mocked 1-Click server — asserts our client sends
// the right request shape and survives the real response shape.

const TOKENS: OneClickToken[] = [
  { assetId: "nep141:base.omft.near", decimals: 18, blockchain: "base", symbol: "ETH", price: 1681 },
  {
    assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
    decimals: 6,
    blockchain: "base",
    symbol: "USDC",
    price: 0.9998,
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
  // Vault wrapper that must NOT win symbol resolution (no price).
  { assetId: "nep141:base-0xdead.omft.near", decimals: 6, blockchain: "base", symbol: "sUSDC" },
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 2.04 },
];

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = handler(String(url), init);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("1-Click client", () => {
  it("fetches and validates the token list", async () => {
    mockFetch(() => TOKENS);
    const tokens = await getTokens();
    expect(tokens.length).toBe(4);
  });

  it("resolves symbols: NEAR -> wNEAR alias, canonical over priceless wrappers", async () => {
    expect(resolveAsset(TOKENS, "near", "NEAR")?.assetId).toBe("nep141:wrap.near");
    const usdc = resolveAsset(TOKENS, "base", "USDC");
    expect(usdc?.assetId).toContain("0x833589");
    expect(resolveAsset(TOKENS, "base", "usdc")?.symbol).toBe("USDC"); // case-insensitive
    expect(resolveAsset(TOKENS, "ap3x", "AP3X")).toBeNull(); // not a 1-Click chain
  });

  it("sends the exact quote request contract the API expects", async () => {
    const fn = mockFetch(() => ({
      quote: {
        depositAddress: "0x9999999999999999999999999999999999999999",
        amountIn: "250000000",
        amountOut: "122000000000000000000000000",
        deadline: "2099-01-01T00:00:00.000Z",
        timeEstimate: 60,
      },
    }));
    const { quote } = await requestQuote({
      dry: false,
      originAsset: "nep141:base-0x8335…omft.near",
      destinationAsset: "nep141:wrap.near",
      amount: "250000000",
      recipient: "alice.near",
      refundTo: "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
      slippageBps: 100,
    });
    expect(quote.depositAddress).toBeDefined();

    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v0/quote");
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      dry: false,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      recipientType: "DESTINATION_CHAIN",
      refundType: "ORIGIN_CHAIN",
      depositType: "ORIGIN_CHAIN",
      recipient: "alice.near",
      amount: "250000000",
    });
    expect(typeof sent.deadline).toBe("string");
  });

  it("attaches the JWT only when configured", async () => {
    // getTokens caches module-scope, so use the uncached status endpoint here.
    process.env.ONECLICK_JWT = "test-jwt";
    const fn = mockFetch(() => ({ status: "PROCESSING" }));
    await getStatus("0x9999999999999999999999999999999999999999");
    const [, initWith] = fn.mock.calls[0] as [string, RequestInit];
    expect((initWith?.headers as Record<string, string>).Authorization).toBe("Bearer test-jwt");
    delete process.env.ONECLICK_JWT;

    vi.unstubAllGlobals();
    const fn2 = mockFetch(() => ({ status: "PROCESSING" }));
    await getStatus("0x9999999999999999999999999999999999999999");
    const [, initWithout] = fn2.mock.calls[0] as [string, RequestInit];
    expect((initWithout?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("parses every documented status state", async () => {
    for (const status of [
      "PENDING_DEPOSIT",
      "KNOWN_DEPOSIT_TX",
      "PROCESSING",
      "SUCCESS",
      "INCOMPLETE_DEPOSIT",
      "REFUNDED",
      "FAILED",
    ]) {
      mockFetch(() => ({ status }));
      const s = await getStatus("0x9999999999999999999999999999999999999999");
      expect(s.status).toBe(status);
      vi.unstubAllGlobals();
    }
  });
});
