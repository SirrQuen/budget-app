"use server";

import { joinWaitlist } from "@/lib/db/waitlist";
import { normaliseWaitlistEmail } from "@/lib/waitlistValidation";

export type WaitlistActionState =
  | { joined: string; error?: undefined; field?: undefined }
  | { joined?: undefined; error: string; field?: "email" }
  | undefined;

// The landing page's waitlist form. The address rule is enforced here; the
// browser's check is a convenience. `joined` echoes the normalised address
// back for the success line -- identical whether or not it was already on
// the list (see lib/db/waitlist.ts).
export async function joinWaitlistAction(
  _prev: WaitlistActionState,
  formData: FormData,
): Promise<WaitlistActionState> {
  const normalised = normaliseWaitlistEmail(formData.get("email"));
  if (normalised.error !== null) {
    return { error: normalised.error, field: "email" };
  }

  const result = await joinWaitlist(normalised.email);
  if (!result.ok) return { error: result.error };

  return { joined: normalised.email };
}
