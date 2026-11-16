"use server";

import { revalidatePath } from "next/cache";
import { markWhatsNewSeen } from "@/lib/whatsNewDismissed";

/** "Got it" on What's new -- writes a cookie, never the database. */
export async function dismissWhatsNewAction(): Promise<void> {
  await markWhatsNewSeen();
  revalidatePath("/dashboard");
}
