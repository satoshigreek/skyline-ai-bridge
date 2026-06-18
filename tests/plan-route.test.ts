import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/plan/route";

// The /api/plan integration seam: validates input, dispatches via the engine,
// returns card + plan (or a clear error). AP3X needs no ⟨VERIFY⟩ config, so it
// exercises a full success path here.

const EVM = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

function post(body: unknown): Request {
  return new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/plan", () => {
  it("returns a card + plan for a valid AP3X request (no external config needed)", async () => {
    const res = await POST(post({ asset: "AP3X", fromChain: "base", toChain: "nexus", amount: "25", recipient: EVM }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rail).toBe("oft");
    expect(json.card.tokenIn).toBe("bAP3X");
    expect(json.plan.kind).toBe("ap3x");
  });

  it("400s an invalid request body (bad chain / amount)", async () => {
    expect((await POST(post({ asset: "AP3X", fromChain: "nowhere", toChain: "nexus", amount: "1", recipient: EVM }))).status).toBe(400);
    expect((await POST(post({ asset: "USDC", fromChain: "base", toChain: "arbitrum", amount: "-1", recipient: EVM }))).status).toBe(400);
  });

  it("surfaces a clear builder error as 400 (CCTP without a configured TokenMessenger)", async () => {
    const res = await POST(post({ asset: "USDC", fromChain: "base", toChain: "arbitrum", amount: "100", recipient: EVM }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/TokenMessenger not configured/);
  });
});
