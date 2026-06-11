import { pad, getAddress, type Address } from "viem";
import {
  AP3X_LZ_EID,
  BAP3X_OFT_BASE,
  RAIL_A_DECIMALS,
  type RailAToken,
} from "./chains";
import { applySlippage, toSmallestUnits } from "./units";
import type { Intent } from "./intent";

// Rail A — the bAP3X LayerZero OFT v2 on Base (live contract, verified
// on-chain). Builders are pure functions; contract reads/writes happen via
// wagmi/viem with the user's wallet.

export const OFT_ABI = [
  {
    type: "function",
    name: "quoteSend",
    stateMutability: "view",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      { name: "_payInLzToken", type: "bool" },
    ],
    outputs: [
      {
        name: "msgFee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "send",
    stateMutability: "payable",
    inputs: [
      {
        name: "_sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      {
        name: "_fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
      { name: "_refundAddress", type: "address" },
    ],
    outputs: [
      {
        name: "msgReceipt",
        type: "tuple",
        components: [
          { name: "guid", type: "bytes32" },
          { name: "nonce", type: "uint64" },
          {
            name: "fee",
            type: "tuple",
            components: [
              { name: "nativeFee", type: "uint256" },
              { name: "lzTokenFee", type: "uint256" },
            ],
          },
        ],
      },
      {
        name: "oftReceipt",
        type: "tuple",
        components: [
          { name: "amountSentLD", type: "uint256" },
          { name: "amountReceivedLD", type: "uint256" },
        ],
      },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type SendParam = {
  dstEid: number;
  to: `0x${string}`;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: `0x${string}`;
  composeMsg: `0x${string}`;
  oftCmd: `0x${string}`;
};

export type RailAPlan = {
  kind: "railA";
  token: RailAToken;
  decimals: number;
  oftAddress: Address;
  sendParam: SendParam;
  recipient: Address;
};

const SLIPPAGE_BPS = 50; // 0.5% min-received floor

export function buildRailAPlan(
  intent: Intent,
  connectedWallet: Address | undefined,
): { ok: true; plan: RailAPlan } | { ok: false; error: string } {
  const token = intent.tokenIn as RailAToken;

  const recipientRaw = intent.recipient ?? connectedWallet;
  if (!recipientRaw) {
    return { ok: false, error: "Connect a wallet or specify a recipient address." };
  }
  let recipient: Address;
  try {
    recipient = getAddress(recipientRaw);
  } catch {
    return {
      ok: false,
      error: `"${recipientRaw}" isn't a valid EVM address — Apex Fusion recipients must be 0x… addresses.`,
    };
  }

  const decimals = RAIL_A_DECIMALS[token];
  const amountLD = toSmallestUnits(intent.amount!, decimals);

  return {
    ok: true,
    plan: {
      kind: "railA",
      token,
      decimals,
      oftAddress: BAP3X_OFT_BASE,
      sendParam: {
        dstEid: AP3X_LZ_EID,
        to: pad(recipient, { size: 32 }),
        amountLD,
        minAmountLD: applySlippage(amountLD, SLIPPAGE_BPS),
        extraOptions: "0x",
        composeMsg: "0x",
        oftCmd: "0x",
      },
      recipient,
    },
  };
}

// Wire format: RailAPlan with bigints stringified, plus the quoted fee. The
// client reconstructs the exact same values to execute — no re-derivation.
export type SerializedRailAPlan = Omit<RailAPlan, "sendParam"> & {
  sendParam: {
    dstEid: number;
    to: string;
    amountLD: string;
    minAmountLD: string;
    extraOptions: string;
    composeMsg: string;
    oftCmd: string;
  };
  nativeFeeWei: string;
};

export function serializeRailAPlan(plan: RailAPlan, fee: bigint): SerializedRailAPlan {
  return {
    ...plan,
    sendParam: {
      ...plan.sendParam,
      amountLD: plan.sendParam.amountLD.toString(),
      minAmountLD: plan.sendParam.minAmountLD.toString(),
    },
    nativeFeeWei: fee.toString(),
  };
}
