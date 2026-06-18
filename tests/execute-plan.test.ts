import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { buildPlan, type EngineConfig } from "../src/lib/engine";
import { toWalletSteps, type WalletStep } from "../src/lib/execute-plan";
import { ERC20_ABI } from "../src/lib/abi";

// Plan → wallet steps. The ERC-20 legs are REAL calldata (decoded + asserted);
// protocol calls are resolved-arg descriptors flagged verify-required.

const EVM = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const CARDANO = "addr1qxy2k7h5e3v9q8w0n4r2t6m8l0p3s5d7f9g1h3j5k7m9n1q3r5t7v9w1x3y5z7";

const CFG: EngineConfig = {
  cctp: {
    usdc: { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    tokenMessenger: { base: "0x1111111111111111111111111111111111111111", ethereum: "0x3333333333333333333333333333333333333333" },
  },
  xreserve: {
    cctp: { usdc: { ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }, tokenMessenger: { ethereum: "0x3333333333333333333333333333333333333333" } },
    gateway: "0x4444444444444444444444444444444444444444",
    remoteDomain: { cardano: 10 },
  },
  stargate: {
    usdc: { base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", bsc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
    router: { base: "0x5555555555555555555555555555555555555555" },
    endpointId: { bsc: 30102 },
  },
};

function steps(r: ReturnType<typeof buildPlan>): WalletStep[] {
  if (!r.ok) throw new Error(r.error);
  const w = toWalletSteps(r);
  if (w.kind !== "steps") throw new Error("expected steps");
  return w.steps;
}

describe("toWalletSteps", () => {
  it("CCTP: approve (real calldata) then depositForBurn (verify-required)", () => {
    const s = steps(buildPlan({ asset: "USDC", fromChain: "base", toChain: "arbitrum", amount: "100", recipient: EVM }, CFG));
    expect(s.map((x) => x.kind)).toEqual(["erc20-approve", "contract-write"]);
    // the approve is decodable, real calldata
    const dec = decodeFunctionData({ abi: ERC20_ABI, data: (s[0] as Extract<WalletStep, { kind: "erc20-approve" }>).data });
    expect(dec.functionName).toBe("approve");
    expect(getAddress(dec.args[0] as string)).toBe(getAddress("0x1111111111111111111111111111111111111111")); // TokenMessenger
    expect(dec.args[1]).toBe(100_000000n); // 100 USDC, 6 dp
    const burn = s[1];
    if (burn.kind !== "contract-write") throw new Error("expected write");
    expect(burn.functionName).toBe("depositForBurn");
    expect(burn.abiStatus).toBe("verify-required");
  });

  it("Hyperliquid: CCTP legs then a REAL ERC-20 transfer to the bridge", () => {
    const s = steps(buildPlan({ asset: "USDC", fromChain: "base", toChain: "hyperliquid", amount: "50", recipient: EVM }, CFG));
    expect(s.map((x) => x.kind)).toEqual(["erc20-approve", "contract-write", "erc20-transfer"]);
    const dec = decodeFunctionData({ abi: ERC20_ABI, data: (s[2] as Extract<WalletStep, { kind: "erc20-transfer" }>).data });
    expect(dec.functionName).toBe("transfer");
    expect(dec.args[1]).toBe(50_000000n);
    expect(s[2].chainId).toBe(42161); // Arbitrum
  });

  it("xReserve: approve + depositToRemote (verify-required)", () => {
    const s = steps(buildPlan({ asset: "USDC", fromChain: "ethereum", toChain: "cardano", amount: "10", recipient: CARDANO, ethereumSender: EVM }, CFG));
    expect(s.map((x) => x.kind)).toEqual(["erc20-approve", "contract-write"]);
    const dep = s[1];
    if (dep.kind !== "contract-write") throw new Error("expected write");
    expect(dep.functionName).toBe("depositToRemote");
    expect(dep.args).toContain(CARDANO);
  });

  it("Stargate: approve + send (verify-required)", () => {
    const s = steps(buildPlan({ asset: "USDC", fromChain: "base", toChain: "bsc", amount: "10", recipient: EVM }, CFG));
    expect(s.map((x) => x.kind)).toEqual(["erc20-approve", "contract-write"]);
    expect((s[1] as Extract<WalletStep, { kind: "contract-write" }>).functionName).toBe("send");
  });

  it("AP3X is delegated to the existing OFT/Reactor executors", () => {
    const r = buildPlan({ asset: "AP3X", fromChain: "base", toChain: "nexus", amount: "25", recipient: EVM }, CFG);
    if (!r.ok) throw new Error(r.error);
    const w = toWalletSteps(r);
    expect(w.kind).toBe("delegated");
  });
});
