import { encodeFunctionData, type Address, type Hex } from "viem";
import { ERC20_ABI } from "./abi";
import type { EngineResult } from "./engine";
import type { CctpBurnPlan } from "./cctp";

// ---------------------------------------------------------------------------
// Plan → wallet steps. Turns an engine plan into the ordered transactions the
// user signs. Standard ERC-20 legs (approve, the Hyperliquid deposit transfer)
// are encoded to REAL calldata here — fully verifiable. Protocol-specific calls
// (CCTP depositForBurn, xReserve depositToRemote, Stargate send) are emitted as
// resolved-argument descriptors whose ABI is the ⟨VERIFY⟩ piece, so no
// unconfirmed contract calldata is ever fabricated.
//
// AP3X (OFT / Reactor) is delegated to the existing executors (oft.ts /
// skyline.ts), which already build live-quoted calldata per leg.
// ---------------------------------------------------------------------------

export type WalletStep =
  | { kind: "erc20-approve"; chainId: number; label: string; to: Address; data: Hex }
  | { kind: "erc20-transfer"; chainId: number; label: string; to: Address; data: Hex }
  | {
      kind: "contract-write";
      chainId: number;
      label: string;
      to: Address;
      functionName: string;
      args: readonly unknown[];
      abiStatus: "verify-required"; // ⟨VERIFY⟩ — supply the confirmed ABI to execute
      note: string;
    };

export type WalletStepsResult =
  | { kind: "steps"; steps: WalletStep[] }
  | { kind: "delegated"; via: "oft.ts | skyline.ts"; note: string };

function approve(chainId: number, token: Address, spender: Address, amount: string, label: string): WalletStep {
  return {
    kind: "erc20-approve",
    chainId,
    label,
    to: token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, BigInt(amount)] }),
  };
}

function transfer(chainId: number, token: Address, to: Address, amount: string, label: string): WalletStep {
  return {
    kind: "erc20-transfer",
    chainId,
    label,
    to: token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, BigInt(amount)] }),
  };
}

function cctpSteps(p: CctpBurnPlan): WalletStep[] {
  return [
    approve(p.chainId, p.approval.token, p.approval.spender, p.approval.amount, "Approve USDC for CCTP"),
    {
      kind: "contract-write",
      chainId: p.chainId,
      label: "CCTP depositForBurn",
      to: p.burn.tokenMessenger,
      functionName: "depositForBurn",
      args: [BigInt(p.burn.amount), p.burn.destinationDomain, p.burn.mintRecipient, p.burn.burnToken],
      abiStatus: "verify-required",
      note: "Requires the verified CCTP v2 depositForBurn ABI.",
    },
  ];
}

export function toWalletSteps(result: Extract<EngineResult, { ok: true }>): WalletStepsResult {
  switch (result.rail) {
    case "cctp":
      return { kind: "steps", steps: cctpSteps(result.plan) };

    case "hyperliquid": {
      const steps: WalletStep[] = [];
      if (result.plan.cctp) steps.push(...cctpSteps(result.plan.cctp));
      const d = result.plan.deposit;
      steps.push(transfer(d.chainId, d.usdc, d.bridge, d.amount, "Deposit USDC to the Hyperliquid bridge"));
      return { kind: "steps", steps };
    }

    case "xreserve": {
      const steps: WalletStep[] = [];
      if (result.plan.cctp) steps.push(...cctpSteps(result.plan.cctp));
      const d = result.plan.deposit;
      steps.push(approve(d.chainId, d.usdc, d.gateway, d.amount, "Approve USDC for xReserve"));
      steps.push({
        kind: "contract-write",
        chainId: d.chainId,
        label: "xReserve depositToRemote",
        to: d.gateway,
        functionName: "depositToRemote",
        args: [BigInt(d.amount), d.remoteDomain, d.destinationRecipient],
        abiStatus: "verify-required",
        note: "Requires the verified xReserve depositToRemote ABI + destination recipient byte encoding.",
      });
      return { kind: "steps", steps };
    }

    case "stargate": {
      const s = result.plan.send;
      return {
        kind: "steps",
        steps: [
          approve(s.chainId, s.token, s.router, s.amount, "Approve USDC for Stargate"),
          {
            kind: "contract-write",
            chainId: s.chainId,
            label: "Stargate send",
            to: s.router,
            functionName: "send",
            args: [s.dstEndpointId, BigInt(s.amount), BigInt(s.minAmount), s.mintRecipient],
            abiStatus: "verify-required",
            note: "Requires the verified Stargate router ABI.",
          },
        ],
      };
    }

    case "oft":
    case "reactor":
      return {
        kind: "delegated",
        via: "oft.ts | skyline.ts",
        note: "AP3X legs execute via the existing OFT (oft.ts) and Reactor (skyline.ts) builders, which produce live-quoted calldata.",
      };
  }
}
