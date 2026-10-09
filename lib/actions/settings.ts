"use server";

import { revalidatePath } from "next/cache";
import {
  updateTheme,
  updateSafeToSpendWindowPref,
  updateSafeToSpendCushion,
  updateTimeZone,
} from "@/lib/db/settings";
import { isTheme } from "@/lib/theme";
import { isSafeToSpendWindowPref } from "@/lib/safeToSpendWindow";
import { mustReachUserUnchanged } from "@/lib/db/errors";

export type ThemeActionState = { error?: string } | undefined;

// The control applies the theme locally before calling this, so a failure
// here doesn't undo what the user just saw -- it only means the choice
// didn't follow the account to their other devices. The message says that
// rather than claiming nothing happened -- except for an expired session or
// an outage, which the user needs to hear as they are.
export async function setThemeAction(theme: unknown): Promise<ThemeActionState> {
  if (!isTheme(theme)) {
    return { error: "That isn't a theme we recognise." };
  }

  const result = await updateTheme(theme);

  if (result.error) {
    return {
      error: mustReachUserUnchanged(result.error)
        ? result.error
        : "Your theme is set on this device, but we couldn't save it to your account.",
    };
  }

  // The layout renders the stored theme into ThemeProvider, so the cached
  // server output is now stale for every authenticated route.
  revalidatePath("/", "layout");

  return undefined;
}

// Reported by components/TodayProvider from the browser whenever it differs
// from settings.timezone. Silent on failure: the app keeps working on the
// stored zone (or UTC), and the next page load tries again.
export async function syncTimeZoneAction(timeZone: unknown): Promise<void> {
  if (typeof timeZone !== "string") {
    return;
  }

  const result = await updateTimeZone(timeZone);

  if (result.error) {
    return;
  }

  // Every server-side "today" (getToday) and every current_date in SQL
  // (apply_user_timezone) just moved to the new zone, so all of the cached
  // authenticated output is stale.
  revalidatePath("/", "layout");
}

export type SafeToSpendWindowActionState = { error?: string } | undefined;

// Same shape as setThemeAction -- the control applies the choice locally
// first, so a failure here only means it didn't follow the account to
// other devices.
export async function setSafeToSpendWindowAction(
  pref: unknown,
): Promise<SafeToSpendWindowActionState> {
  if (!isSafeToSpendWindowPref(pref)) {
    return { error: "That isn't a window we recognise." };
  }

  const result = await updateSafeToSpendWindowPref(pref);

  if (result.error) {
    return {
      error: mustReachUserUnchanged(result.error)
        ? result.error
        : "Your preference is set on this device, but we couldn't save it to your account.",
    };
  }

  // The dashboard's getSafeToSpend() reads this setting server-side.
  revalidatePath("/", "layout");

  return undefined;
}

export type SafeToSpendCushionActionState = { error?: string; saved?: boolean } | undefined;

// useActionState-shaped: `cushion` is the dollar amount typed into Settings,
// or `reset` set to go back to the suggestion. Zero is allowed. Validated
// as dollars-and-cents text before it's parsed, so at most two decimals
// ever reach numeric(12,2).
export async function setSafeToSpendCushionAction(
  _prev: SafeToSpendCushionActionState,
  formData: FormData,
): Promise<SafeToSpendCushionActionState> {
  if (formData.get("reset") === "1") {
    const result = await updateSafeToSpendCushion(null);
    if (result.error) {
      return { error: result.error };
    }
    revalidatePath("/", "layout");
    return { saved: true };
  }

  const raw = String(formData.get("cushion") ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: "Enter an amount in dollars, like 250 or 0." };
  }

  const amount = Number(raw);
  if (amount > 1_000_000) {
    return { error: "That's more than the cushion can hold. Try a smaller amount." };
  }

  const result = await updateSafeToSpendCushion(amount);
  if (result.error) {
    return { error: result.error };
  }

  // The dashboard's getSafeToSpend() subtracts this.
  revalidatePath("/", "layout");
  return { saved: true };
}
