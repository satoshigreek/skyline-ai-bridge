import { describe, expect, it } from "vitest";
import { heuristicParse } from "../src/lib/heuristic";

describe("heuristic parser", () => {
  it("parses a Rail A bridge", () => {
    const i = heuristicParse("Move 250 USDC from Base to Apex Fusion");
    expect(i.action).toBe("bridge");
    expect(i.tokenIn).toBe("USDC");
    expect(i.amount).toBe("250");
    expect(i.fromChain).toBe("base");
    expect(i.toChain).toBe("ap3x");
    expect(i.clarifyingQuestion).toBeNull();
  });

  it("parses a swap with chain inference from the output token", () => {
    const i = heuristicParse("Swap 0.1 ETH on Base for NEAR");
    expect(i.action).toBe("swap");
    expect(i.tokenIn).toBe("ETH");
    expect(i.tokenOut).toBe("NEAR");
    expect(i.toChain).toBe("near");
    expect(i.fromChain).toBe("base");
  });

  it("never reads the 3 in AP3X as an amount", () => {
    const i = heuristicParse("bridge ap3x to apex fusion");
    expect(i.amount).toBeNull();
    expect(i.clarifyingQuestion).not.toBeNull();
  });

  it("extracts .near recipients and infers the destination chain", () => {
    const i = heuristicParse("Send 50 USDC to alice.near");
    expect(i.action).toBe("send");
    expect(i.recipient).toBe("alice.near");
    expect(i.toChain).toBe("near");
  });

  it("reads 'on X' as destination when there's a recipient", () => {
    const i = heuristicParse(
      "Send 100 bAP3X to 0x1111111111111111111111111111111111111111 on AP3X",
    );
    expect(i.toChain).toBe("ap3x");
    expect(i.fromChain).toBe("base");
    expect(i.recipient).toBe("0x1111111111111111111111111111111111111111");
  });

  it("asks instead of guessing when the amount is missing", () => {
    const i = heuristicParse("bridge my usdc");
    expect(i.clarifyingQuestion).toMatch(/how much/i);
  });

  it("skips non-chain 'to' phrases (cost to move X to apex)", () => {
    const i = heuristicParse("what would it cost to move 75 usdc to apex fusion");
    expect(i.action).toBe("quote_only");
    expect(i.toChain).toBe("ap3x");
    expect(i.amount).toBe("75");
  });

  it("treats receive-phrasing as amountSide=out and clarifies the pay token", () => {
    const i = heuristicParse("I want to receive 100 USDC on NEAR");
    expect(i.amountSide).toBe("out");
    expect(i.clarifyingQuestion).not.toBeNull();
  });
});
