import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";
import { classifyDbError, logDbError, UNREACHABLE } from "@/lib/db/errors";

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

// A complete response, not a rewrite to a page: a rewritten page answers
// 200 and renders the app layout, which calls Supabase itself. Static
// markup, no user input. Colours are the dark surface tokens from
// globals.css, inlined because no stylesheet loads here.
function serviceUnavailable(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sorrel is unreachable</title>
<style>
  body { margin: 0; min-height: 100dvh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 24px; padding: 64px 24px;
    box-sizing: border-box; text-align: center; background: #131322; color: #ffffff;
    font-family: system-ui, sans-serif; }
  h1 { margin: 0; font-size: 1.5rem; font-weight: 600; }
  p { margin: 8px 0 0; max-width: 24rem; font-size: 0.875rem; color: #c3c2b7; }
  a { border-radius: 9999px; padding: 8px 16px; font-size: 0.875rem; font-weight: 600;
    text-decoration: none; background: #E9B949; color: #0B0B0B; }
</style>
</head>
<body>
<div><h1>This page didn&rsquo;t load</h1><p>${UNREACHABLE}</p></div>
<a href="">Try again</a>
</body>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": "60",
    },
  });
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
  const { data, error } = await supabase.auth.getClaims();

  // Can't reach the auth server: the session is unverified, which is neither
  // "signed in" nor "signed out". Passing the request through would serve a
  // protected page on an unverified session; redirecting to /login would sign
  // a real user out over our own outage. So it's a third outcome, a 503, on
  // every path. Never fold this into either branch below.
  if (error && classifyDbError(error) === "network-unreachable") {
    logDbError(`[proxy] auth unreachable for ${request.nextUrl.pathname}:`, error);
    return serviceUnavailable();
  }

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
