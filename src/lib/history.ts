"use client";

import type { CardModel } from "./build";

// Reload-safe transfer history + recipient address book, keyed by wallet.
// localStorage only — nothing leaves the browser.

export type HistoryEntry = {
  id: string;
  wallet: string;
  createdAt: number;
  card: CardModel;
  state:
    | "signing"
    | "submitted"
    | "PENDING_DEPOSIT"
    | "KNOWN_DEPOSIT_TX"
    | "PROCESSING"
    | "SUCCESS"
    | "INCOMPLETE_DEPOSIT"
    | "REFUNDED"
    | "FAILED"
    | "MOCKED";
  txHash?: string;
  depositAddress?: string;
  deadline?: string | null;
};

const HISTORY_KEY = "skyline.history.v1";
const BOOK_KEY = "skyline.addressbook.v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full/blocked — history is best-effort
  }
}

export function listHistory(wallet: string | undefined): HistoryEntry[] {
  if (!wallet) return [];
  return read<HistoryEntry[]>(HISTORY_KEY, []).filter(
    (e) => e.wallet.toLowerCase() === wallet.toLowerCase(),
  );
}

export function upsertHistory(entry: HistoryEntry): void {
  const all = read<HistoryEntry[]>(HISTORY_KEY, []);
  const idx = all.findIndex((e) => e.id === entry.id);
  if (idx >= 0) all[idx] = entry;
  else all.unshift(entry);
  write(HISTORY_KEY, all.slice(0, 100));
}

export function pendingEntries(wallet: string | undefined): HistoryEntry[] {
  return listHistory(wallet).filter(
    (e) =>
      e.depositAddress &&
      !["SUCCESS", "REFUNDED", "FAILED", "MOCKED"].includes(e.state),
  );
}

// --- Address book: first-time recipients require an explicit confirm ---

type AddressBook = Record<string, { firstUsedAt: number; label?: string }>;

export function isKnownRecipient(address: string): boolean {
  const book = read<AddressBook>(BOOK_KEY, {});
  return Boolean(book[address.toLowerCase()]);
}

export function rememberRecipient(address: string, label?: string): void {
  const book = read<AddressBook>(BOOK_KEY, {});
  if (!book[address.toLowerCase()]) {
    book[address.toLowerCase()] = { firstUsedAt: Date.now(), ...(label ? { label } : {}) };
    write(BOOK_KEY, book);
  }
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
