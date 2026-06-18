// Minimal, standard ABIs that are NOT chain-specific and need no verification.
// The protocol-specific ABIs (CCTP depositForBurn, xReserve depositToRemote,
// Stargate send, LayerZero OFT send) are deliberately NOT here — they are the
// ⟨VERIFY⟩ surface and are supplied only once confirmed against live contracts.

export const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;
