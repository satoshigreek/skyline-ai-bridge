import { describe, expect, it } from "vitest";
import { buildAp3x } from "../src/lib/ap3x";

// docs/ROUTING_SPEC.md §4 — AP3X mesh (OFT) + Apex-internal (Reactor).

const EVM = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const CARDANO = "addr1qxy2k7h5e3v9q8w0n4r2t6m8l0p3s5d7f9g1h3j5k7m9n1q3r5t7v9w1x3y5z7";

describe("AP3X rail builder", () => {
  it("OFT single leg across the EVM mesh (Base → Nexus)", () => {
    const r = buildAp3x({ fromChain: "base", toChain: "nexus", amount: "25", recipient: EVM });
    if (!r.ok) throw new Error(r.error);
    expect(r.card.rail).toBe("oft");
    expect(r.plan.legs).toHaveLength(1);
    expect(r.plan.legs[0].rail).toBe("oft");
    expect(r.card.tokenIn).toBe("bAP3X");
    expect(r.card.tokenOut).toBe("AP3X");
    expect(r.card.minOut).toBe("25"); // 1:1
  });

  it("Reactor to Cardano lands cAP3X with a Cardano recipient", () => {
    const r = buildAp3x({ fromChain: "prime", toChain: "cardano", amount: "10", recipient: CARDANO });
    if (!r.ok) throw new Error(r.error);
    expect(r.card.rail).toBe("reactor");
    expect(r.card.tokenOut).toBe("cAP3X");
    expect(r.plan.recipient).toBe(CARDANO);
  });

  it("composes OFT + Reactor for Base → Vector (3 legs)", () => {
    // Vector is an Apex UTXO chain — recipient is Cardano-style, not EVM.
    const r = buildAp3x({ fromChain: "base", toChain: "vector", amount: "5", recipient: CARDANO });
    if (!r.ok) throw new Error(r.error);
    expect(r.plan.legs.map((l) => l.rail)).toEqual(["oft", "reactor", "reactor"]);
    expect(r.plan.legs.map((l) => l.to)).toEqual(["nexus", "prime", "vector"]);
  });

  it("rejects an EVM address for a Cardano destination, and AP3X to USDC chains", () => {
    expect(buildAp3x({ fromChain: "prime", toChain: "cardano", amount: "10", recipient: EVM }).ok).toBe(false);
    expect(buildAp3x({ fromChain: "base", toChain: "solana", amount: "10", recipient: EVM }).ok).toBe(false);
  });
});
