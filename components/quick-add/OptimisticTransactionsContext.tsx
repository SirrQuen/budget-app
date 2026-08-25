"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { TransactionType } from "@/lib/db/transactions";

// Lives only on the client -- a quick-add submission that never reaches the
// server (or fails) has no row id yet, so ghosts are keyed by a client-minted
// id instead of the real transaction id.
export type PendingTransaction = {
  clientId: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: TransactionType;
  categoryid: string;
  category_name: string | null;
  category_color: string | null;
  accountid: string;
  account_name: string | null;
  status: "pending" | "error";
};

type OptimisticTransactionsValue = {
  pending: PendingTransaction[];
  addPending: (tx: Omit<PendingTransaction, "clientId" | "status">) => string;
  settlePending: (clientId: string) => void;
  failPending: (clientId: string) => void;
};

const OptimisticTransactionsContext = createContext<OptimisticTransactionsValue | null>(null);

// How long a failed ghost stays visible in "error" styling before it's
// removed from the list -- long enough to register as a red flash, short
// enough not to look stuck. The recoverable error message itself lives in
// the quick-add bar, not the row, so this doesn't need to hold for reading.
const ERROR_LINGER_MS = 1200;

export function OptimisticTransactionsProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingTransaction[]>([]);
  const nextIdRef = useRef(0);

  const addPending = useCallback((tx: Omit<PendingTransaction, "clientId" | "status">) => {
    const clientId = `optimistic-${++nextIdRef.current}`;
    setPending((prev) => [{ ...tx, clientId, status: "pending" }, ...prev]);
    return clientId;
  }, []);

  const settlePending = useCallback((clientId: string) => {
    setPending((prev) => prev.filter((p) => p.clientId !== clientId));
  }, []);

  const failPending = useCallback((clientId: string) => {
    setPending((prev) => prev.map((p) => (p.clientId === clientId ? { ...p, status: "error" } : p)));
    setTimeout(() => {
      setPending((prev) => prev.filter((p) => p.clientId !== clientId));
    }, ERROR_LINGER_MS);
  }, []);

  return (
    <OptimisticTransactionsContext.Provider value={{ pending, addPending, settlePending, failPending }}>
      {children}
    </OptimisticTransactionsContext.Provider>
  );
}

export function useOptimisticTransactions() {
  const ctx = useContext(OptimisticTransactionsContext);
  if (!ctx) {
    throw new Error("useOptimisticTransactions must be used within OptimisticTransactionsProvider");
  }
  return ctx;
}
