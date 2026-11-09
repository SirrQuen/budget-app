// A budget amount from a form. $0 is a real budget -- "I'm not spending on
// this this month" -- so zero is accepted; blank, negative or more than two
// decimal places is not. Returned as dollars for the numeric(12,2) column.
export function parseBudgetAmount(raw: FormDataEntryValue | null): { value: number } | { error: string } {
  const text = String(raw ?? "").trim();
  if (text === "" || !/^\d+(\.\d{1,2})?$/.test(text)) {
    return { error: "Enter a budget amount. $0 is fine." };
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value > 9_999_999_999.99) {
    return { error: "Enter a budget amount. $0 is fine." };
  }
  return { value };
}
