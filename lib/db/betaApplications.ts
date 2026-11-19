import "server-only";
import { createClient } from "@/lib/supabase/server";
import { describeBetaSubmitError } from "@/lib/db/betaApplicationErrors";
import type { BetaApplication } from "@/lib/betaApplication";

export type SubmitBetaApplicationResult = { ok: true } | { ok: false; error: string };

// submit_beta_application() (migration 75) is the only way into the table.
// A new email and one that has applied before both come back as { ok: true }
// -- the repeat replaces that application. Nothing here may branch on which
// it was: that difference, surfaced, is an email-enumeration oracle.
//
// `website` is the honeypot, passed through untouched: the function itself
// answers a filled one as a success and stores nothing, so there is one
// behaviour, the one docs/rls-isolation-test.sql section 2m checks.
//
// A failure is logged by its code only, never logDbError()'s whole error:
// a constraint error's detail repeats the submitted row, name and email
// included (lib/db/betaApplicationErrors.ts).
export async function submitBetaApplication(
  application: BetaApplication,
  website: string,
): Promise<SubmitBetaApplicationResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_beta_application", {
    p_email: application.email,
    p_full_name: application.full_name,
    p_age_range: application.age_range,
    p_describes: application.describes,
    p_experience: application.experience,
    p_money_methods: application.money_methods,
    p_challenge: application.challenge,
    p_want: application.want,
    p_availability: application.availability,
    p_comfortable: application.comfortable,
    p_frequency: application.frequency,
    p_reason: application.reason,
    p_consent: application.consent,
    p_website: website,
  });

  if (!error) return { ok: true };
  return { ok: false, error: describeBetaSubmitError(error) };
}
