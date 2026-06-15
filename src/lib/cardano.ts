"use client";

import * as CSL from "@emurgo/cardano-serialization-lib-asmjs";

// CIP-30 Cardano wallet helpers for Rail C UTXO origins (prime/vector/cardano).
// Apex Fusion's Prime & Vector are Cardano-VM chains, so the same CIP-30
// wallets (Eternl, Lace, Nami, Vespr, …) sign their transactions.

export type CipWalletInfo = { key: string; name: string; icon: string | null };

type Cip30Full = {
  getChangeAddress: () => Promise<string>;
  getUsedAddresses: () => Promise<string[]>;
  signTx: (txHex: string, partialSign?: boolean) => Promise<string>;
  submitTx: (txHex: string) => Promise<string>;
};

// Discover installed CIP-30 wallets from window.cardano.
export function listCardanoWallets(): CipWalletInfo[] {
  if (typeof window === "undefined") return [];
  const c = (window as unknown as { cardano?: Record<string, { name?: string; icon?: string; apiVersion?: string; enable?: unknown }> }).cardano;
  if (!c) return [];
  const out: CipWalletInfo[] = [];
  for (const key of Object.keys(c)) {
    const w = c[key];
    // Real wallets expose enable() + apiVersion; skip helper keys.
    if (w && typeof w.enable === "function") {
      out.push({ key, name: w.name || key, icon: w.icon || null });
    }
  }
  return out;
}

export async function enableCardano(key: string): Promise<Cip30Full> {
  const c = (window as unknown as { cardano?: Record<string, { enable: () => Promise<Cip30Full> }> }).cardano;
  if (!c || !c[key]) throw new Error("Wallet not found.");
  return c[key].enable();
}

// CIP-30 returns addresses as hex (CBOR bytes); the Skyline API expects bech32.
export function hexAddrToBech32(hex: string): string {
  return CSL.Address.from_hex(hex).to_bech32();
}

export async function getBech32ChangeAddress(api: Cip30Full): Promise<string> {
  const hex = await api.getChangeAddress();
  return hexAddrToBech32(hex);
}

// Sign an unsigned txRaw (hex) via the wallet, merge the returned witnesses
// into the transaction, and return the fully-signed tx hex ready to submit.
export async function signAndAssemble(api: Cip30Full, txRawHex: string): Promise<string> {
  const tx = CSL.Transaction.from_hex(txRawHex);
  const witnessHex = await api.signTx(txRawHex, true);
  const newWits = CSL.TransactionWitnessSet.from_hex(witnessHex);

  const witSet = tx.witness_set();
  const merged = CSL.Vkeywitnesses.new();
  const existing = witSet.vkeys();
  if (existing) for (let i = 0; i < existing.len(); i++) merged.add(existing.get(i));
  const added = newWits.vkeys();
  if (added) for (let i = 0; i < added.len(); i++) merged.add(added.get(i));
  witSet.set_vkeys(merged);

  const aux = tx.auxiliary_data();
  const signed = aux
    ? CSL.Transaction.new(tx.body(), witSet, aux)
    : CSL.Transaction.new(tx.body(), witSet);
  return signed.to_hex();
}

export async function signAssembleSubmit(api: Cip30Full, txRawHex: string): Promise<string> {
  const signedHex = await signAndAssemble(api, txRawHex);
  return api.submitTx(signedHex); // returns the source-chain tx hash
}
