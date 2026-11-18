"use server";

import { createRecurring, deleteRecurring } from "@/lib/db/recurring";
import { getAccount } from "@/lib/db/accounts";
import { getSafeToSpend, type SafeToSpend } from "@/lib/db/dashboard";
import { getToday } from "@/lib/db/settings";
import { isSpendableAccountType } from "@/lib/safeToSpend";
import { paycheckPlans, PAY_FREQUENCIES, type PayFrequency, type Payday } from "@/lib/onboarding";
import { parseAmountToCents } from "@/lib/whatIf";

// Onboarding step 2, a paycheck (docs/Decide-and-Grow.md, G). The schedule
// goes in through the EXISTING write path -- createRecurring(), the same
// insert the recurring form uses -- with the amount a person typed:
// amount_is_variable false, so its basis is "fixed" and it is never shown
// or counted as an estimate (migration 59). An Income schedule asks for
// confirmation like any other; this writes no transaction.
//
// Step 3 is this action's response: the first Safe to Spend figure, read
// with the hero's own function after the schedule exists. No
// revalidatePath("/dashboard"): the page would re-derive its step (a
// paycheck now exists, so no onboarding) and replace step 3 before it was
// seen. The client refreshes when the person moves on.

export type PaycheckState =
  | { error?: string; done?: undefined }
  | { error?: undefined; done: { safeToSpend: SafeToSpend } }
  | undefined;

const FREQUENCY_VALUES = new Set<string>(PAY_FREQUENCIES.map((f) => f.value));

function payday(formData: FormData, n: 1 | 2): Payday {
  return {
    date: String(formData.get(`payday_${n}`) ?? "").trim(),
    lastDay: formData.get(`last_day_${n}`) === "on",
  };
}

export async function createPaycheckAction(_prev: PaycheckState, formData: FormData): Promise<PaycheckState> {
  const accountid = String(formData.get("accountid") ?? "");
  const categoryid = String(formData.get("categoryid") ?? "");
  const frequency = String(formData.get("frequency") ?? "");
  const cents = parseAmountToCents(String(formData.get("amount") ?? ""));

  if (cents === null || cents === 0) return { error: "Enter your take-home pay, more than $0." };
  if (!accountid) return { error: "Choose the account your pay lands in." };
  if (!categoryid) return { error: "Choose a category for your pay." };
  if (!FREQUENCY_VALUES.has(frequency)) return { error: "Choose how often you're paid." };

  // Pay landing outside checking and cash wouldn't reach the figure step 3
  // shows. RLS scopes the read; this checks intent, not ownership.
  const account = await getAccount(accountid);
  if (account.error !== null) return { error: account.error };
  if (!account.data.is_active || !isSpendableAccountType(account.data.account_type)) {
    return { error: "Choose a checking or cash account for your pay." };
  }

  const today = await getToday();
  const plans = paycheckPlans(
    frequency as PayFrequency,
    frequency === "twice_a_month" ? [payday(formData, 1), payday(formData, 2)] : [payday(formData, 1)],
    today,
  );
  if ("error" in plans) return { error: plans.error };

  const created: string[] = [];
  for (const [i, plan] of plans.entries()) {
    const res = await createRecurring({
      description: plans.length > 1 ? `Paycheck ${i + 1}` : "Paycheck",
      amount: cents / 100,
      categoryid,
      accountid,
      to_accountid: null,
      frequency: plan.frequency,
      interval_count: plan.interval_count,
      next_run_date: plan.next_run_date,
      start_date: plan.start_date,
      occurrence_limit: null,
      end_date: null,
      amount_is_variable: false,
      statement_day: null,
      date_tolerance_days: 0,
      requires_confirmation: true,
      business_day_offset: 0,
      non_business_day_rule: "none",
    });
    if (res.error !== null) {
      // Twice a month is two schedules or none: take back the first.
      for (const id of created) await deleteRecurring(id);
      return { error: res.error };
    }
    created.push(res.data.id);
  }

  // No revalidatePath -- not even "/recurring": in Next 16 ANY revalidation
  // in an action re-renders the calling route in the same response
  // (node_modules/next/dist/docs/01-app/02-guides/server-actions.md), which
  // would swap step 3 for the dashboard. Both pages render dynamically;
  // the client's router.refresh() on "Continue" brings them up to date.
  const figure = await getSafeToSpend();
  if (figure.error !== null) {
    // The paycheck is saved; only the figure didn't load. The dashboard
    // shows it, so say so rather than offer a second save.
    return { error: `Your paycheck is saved, but the figure didn't load. ${figure.error}` };
  }
  return { done: { safeToSpend: figure.data } };
}

/**
 * Step 3 for someone who skipped the paycheck: the figure as it stands.
 * The skip itself is a cookie the browser sets (lib/paydaySkip.ts) -- this
 * only reads.
 */
export async function currentSafeToSpendAction(): Promise<{ safeToSpend: SafeToSpend } | { error: string }> {
  const figure = await getSafeToSpend();
  return figure.error !== null ? { error: figure.error } : { safeToSpend: figure.data };
}
