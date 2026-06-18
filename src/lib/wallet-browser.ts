import { Wallet, NetworkType } from "@cardano-foundation/cardano-connect-with-wallet-core";

// Thin browser wrapper over the Cardano Foundation's official connect library
// (@cardano-foundation/cardano-connect-with-wallet-core). Used by the standalone
// engine page (docs/engine.html) via the bundled global `SkylineWallet`. The
// library handles wallet detection, CIP-30 enable, bech32 address conversion,
// and localStorage persistence — so the page doesn't hand-roll any of it.

export type CardanoState = {
  wallet: string | null;
  usedAddresses: string[]; // bech32 addr1… payment addresses
  stakeAddress: string | null; // bech32 stake1…
  connected: boolean;
  installed: string[];
};

const noop = () => {};

export function getInstalledCardanoWallets(): string[] {
  return Wallet.getInstalledWalletExtensions();
}

export function subscribeCardano(onChange: (s: CardanoState) => void): void {
  const state: CardanoState = {
    wallet: null,
    usedAddresses: [],
    stakeAddress: null,
    connected: false,
    installed: Wallet.getInstalledWalletExtensions(),
  };
  const emit = () => onChange({ ...state });
  Wallet.subscribeToObservables(
    noop, // setIsEnabled
    noop, // setIsConnecting
    (w) => { state.wallet = w; emit(); }, // setEnabledWallet
    (s) => { state.stakeAddress = s; emit(); }, // setStakeAddress
    (u) => { state.usedAddresses = u; emit(); }, // setUsedAddresses
    noop, // setUnusedAddresses
    (i) => { state.installed = i; emit(); }, // setInstalledExtensions
    noop, // setAccountBalance
    (c) => { state.connected = c; emit(); }, // setIsConnected
    noop, // setLastConnectedWallet
    noop, // setPeerConnectAddress
  );
}

export function connectCardano(walletName: string, onError?: (e: Error) => void): Promise<void> {
  return Wallet.connect(walletName, NetworkType.MAINNET, undefined, onError);
}

export function disconnectCardano(): void {
  Wallet.disconnect();
}
