import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

// Paths reachable without a session. Everything else (including every route
// under app/(app)/) requires auth. /auth/confirm is the email-link callback;
// /reset-password requires auth but via a recovery token, not a normal
// session, so it's excluded from AUTH_REDIRECT_PATHS below, not from here.
const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  // The post-deletion confirmation. Reached right after the account (and its
  // session) is gone, so it has to be public.
  "/account-deleted",
]);

// Paths an authenticated user should be bounced away from. /account-deleted
// is here too: a signed-in user hitting it directly hasn't deleted anything,
// and the page would wrongly tell them they had.
const AUTH_REDIRECT_PATHS = new Set(["/login", "/signup", "/account-deleted"]);

function redirectTo(request: NextRequest, pathname: string, supabaseResponse: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const response = NextResponse.redirect(url);
  // Carry over any refreshed auth cookies so the redirect doesn't drop them.
  supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and supabase.auth.getClaims().
  // A stray `await` here can make it very hard to debug users being
  // randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = data?.claims != null;

  const { pathname } = request.nextUrl;

  if (!isAuthenticated && !PUBLIC_PATHS.has(pathname) && !pathname.startsWith("/auth/")) {
    return redirectTo(request, "/login", supabaseResponse);
  }

  if (isAuthenticated && AUTH_REDIRECT_PATHS.has(pathname)) {
    return redirectTo(request, "/dashboard", supabaseResponse);
  }

  // Must return supabaseResponse as-is so refreshed cookies reach the client.
  return supabaseResponse;
}
