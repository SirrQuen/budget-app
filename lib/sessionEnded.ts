// Where a save goes when it finds the session gone, and what the login page
// says when it gets there (queue item 22, ruled 2026-11-18).
//
// The server can't tell WHY a session is gone -- the idle sign-out, Log out
// in another tab or on another device, or Supabase's own expiry -- so this
// landing names none of them. The idle sign-out keeps its own landing,
// /login?reason=timeout, whose sentence ("after 15 minutes of inactivity")
// is true only for it (lib/idleTimeout.ts).

export const SESSION_ENDED_HREF = "/login?reason=expired";

/** What /login?reason=expired says. True whatever ended the session. */
export const SESSION_ENDED_NOTICE = "Your session ended. Sign in to carry on.";

/**
 * Is this request a Server Action call? Next's client sends every one as a
 * POST carrying the `next-action` header (the action's id). A plain form
 * POST without JavaScript doesn't carry it -- and these forms need
 * JavaScript anyway (components/useActionForm.ts).
 */
export function isServerActionRequest(method: string, headers: Headers): boolean {
  return method === "POST" && headers.has("next-action");
}

/**
 * The response a Server Action call gets from the proxy when there's no
 * session. A redirect (307) would be followed by the browser's fetch as a
 * POST to /login, whose page isn't an action response, and Next's client
 * would throw "An unexpected response was received from the server" --
 * which the forms show as the generic error. Instead: no body, and the
 * `x-action-redirect` header Next's client reads on any action response
 * (next/dist/client/components/router-reducer/reducers/server-action-reducer.js,
 * Next 16.3.0). With no Flight data it does a full page load to that URL,
 * replacing this history entry, so no client state outlives the session.
 * 401: the request wasn't served, and nothing caches it.
 */
export function sessionEndedActionResponse(): Response {
  return new Response(null, {
    status: 401,
    headers: {
      "x-action-redirect": `${SESSION_ENDED_HREF};replace`,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
