"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteOwnAccount } from "@/lib/db/profile";

export type DeleteAccountState = { error?: string } | undefined;

// The typed confirmation the UI enforces. Checked again here: a Server
// Action is a public endpoint, so the client-side gate is UX, not security.
const CONFIRM_PHRASE = "DELETE";

export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const confirmation = String(formData.get("confirmation") ?? "").trim();

  if (confirmation !== CONFIRM_PHRASE) {
    return { error: `Type ${CONFIRM_PHRASE} to confirm.` };
  }

  const result = await deleteOwnAccount();

  if (result.error) {
    return {
      error:
        "We couldn't delete your account just now. Nothing was removed — please try again.",
    };
  }

  // The auth.users row (and its sessions) are gone; the JWT in the cookie is
  // now orphaned. Clear it locally rather than calling the server endpoint,
  // which would just 401.
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });

  // Every authenticated route's cached render assumed a signed-in user.
  revalidatePath("/", "layout");

  // redirect() throws NEXT_REDIRECT -- must be outside any try/catch.
  redirect("/account-deleted");
}
