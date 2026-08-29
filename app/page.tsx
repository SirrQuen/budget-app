import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/dal";

// "/" is a public path in the proxy (lib/supabase/middleware.ts), so it has to
// resolve for signed-out visitors too. There's no marketing page yet, so it's
// purely a fork: straight to the dashboard if there's a session, otherwise to
// login. Replace this with the landing page when there is one.
export default async function Home() {
  redirect((await getUser()) ? "/dashboard" : "/login");
}
