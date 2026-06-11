"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base } from "wagmi/chains";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "skyline_bridge_local_dev";

export const wagmiConfig = getDefaultConfig({
  appName: "Skyline AI Bridge",
  projectId,
  chains: [base],
  ssr: true,
});
