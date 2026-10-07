import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Routes that require a signed-in user.
 *
 * Note what is *not* here: `/events/<slug>`, the public event page an organizer
 * shares with volunteers. That page has to be readable by anyone — being asked
 * to sign up before you can even see what the event is loses most people. The
 * page itself sends a signed-out visitor to /login (and back) when they try to
 * claim a shift.
 */
const PROTECTED_PREFIXES = ["/dashboard", "/events/new"];

/** Routes a signed-in user has no reason to see. */
const AUTH_ROUTES = ["/login", "/signup"];

export type SessionResult = {
  response: NextResponse;
  user: { id: string; email?: string } | null;
};

/**
 * Refreshes the Supabase session and returns the current user.
 *
 * Access tokens are short-lived. Without this, a Server Component reading
 * cookies could see an expired token and treat a signed-in user as anonymous.
 * The refreshed cookies must be copied onto whatever response we end up
 * returning — including redirects — or the browser keeps the stale token.
 */
export async function updateSession(request: NextRequest): Promise<SessionResult> {
  let response = NextResponse.next({ request });

  // Not configured: let everything through so the app stays browsable and the
  // auth screens can explain what's missing.
  if (!isSupabaseConfigured) {
    return { response, user: null };
  }

  const supabase = createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not remove: this call refreshes the token. Do not use getSession().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user: user ? { id: user.id, email: user.email } : null };
}

/** Copies refreshed auth cookies onto a redirect so the browser stores them. */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthPath(pathname: string) {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export { redirectWithCookies };
