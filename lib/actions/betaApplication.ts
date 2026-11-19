"use server";

import { submitBetaApplication } from "@/lib/db/betaApplications";
import {
  betaAnswersFromFormData,
  betaFirstName,
  validateBetaApplication,
  type BetaErrors,
} from "@/lib/betaApplication";

export type BetaActionState =
  | { submitted: { firstName: string }; error?: undefined; errors?: undefined }
  | { submitted?: undefined; error?: string; errors?: BetaErrors }
  | undefined;

// /beta's form. The rule is enforced here; the form's own check is a
// convenience. The thank-you is identical whether the email was new or had
// applied before -- the server can't tell this action which, by design
// (lib/db/betaApplications.ts). Only the form's own fields are read.
export async function submitBetaApplicationAction(
  _prev: BetaActionState,
  formData: FormData,
): Promise<BetaActionState> {
  const result = validateBetaApplication(betaAnswersFromFormData(formData));
  if (!result.ok) return { errors: result.errors };

  const honeypot = formData.get("website");
  const saved = await submitBetaApplication(
    result.application,
    typeof honeypot === "string" ? honeypot : "",
  );
  if (!saved.ok) return { error: saved.error };

  return { submitted: { firstName: betaFirstName(result.application.full_name) } };
}
