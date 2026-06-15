"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, bsc } from "wagmi/chains";
import { defineChain } from "viem";

// Apex Fusion Nexus — EVM L1, chainId 9069 (verified via eth_chainId).
export const nexus = defineChain({
  id: 9069,
  name: "Apex Fusion Nexus",
  nativeCurrency: { name: "AP3X", symbol: "AP3X", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.nexus.mainnet.apexfusion.org/"] } },
  blockExplorers: {
    default: { name: "Nexus Explorer", url: "https://explorer.nexus.mainnet.apexfusion.org" },
  },
});

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "skyline_bridge_local_dev";

export const wagmiConfig = getDefaultConfig({
  appName: "Skyline AI Bridge",
  projectId,
  chains: [base, bsc, nexus],
  ssr: true,
});
