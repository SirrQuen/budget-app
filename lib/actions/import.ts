"use server";

import { revalidatePath } from "next/cache";
import {
  getImportContext,
  getUndoPreview,
  importTransactions,
  undoImport,
  type ImportContext,
  type ImportInput,
  type ImportOutcome,
  type UndoPreview,
} from "@/lib/db/imports";

// Import's server actions (docs/Import-CSV.md). The browser reads the file
// and keeps it; what comes here is an account and the file's DATES (the
// preview's question), then, after the person confirms, the rows they
// confirmed. Never the file, never an unconfirmed row.

export type ActionResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

const ok = <T,>(data: T): ActionResult<T> => ({ data });

/** The preview's context: the account's balance, how each date is treated, and what it already holds. */
export async function getImportContextAction(accountId: string, dates: string[]): Promise<ActionResult<ImportContext>> {
  const result = await getImportContext(accountId, dates);
  return result.error !== null ? { error: result.error } : ok(result.data);
}

/** The one write. Every balance, Safe to Spend and the queue read it afterwards. */
export async function importTransactionsAction(input: ImportInput): Promise<ActionResult<ImportOutcome>> {
  const result = await importTransactions(input);
  if (result.error !== null) return { error: result.error };
  revalidatePath("/", "layout");
  return ok(result.data);
}

export async function previewUndoImportAction(importId: string): Promise<ActionResult<UndoPreview>> {
  const result = await getUndoPreview(importId);
  return result.error !== null ? { error: result.error } : ok(result.data);
}

export async function undoImportAction(importId: string): Promise<ActionResult<{ deleted: number }>> {
  const result = await undoImport(importId);
  if (result.error !== null) return { error: result.error };
  revalidatePath("/", "layout");
  return ok(result.data);
}
