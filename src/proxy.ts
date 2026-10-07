import type { NextRequest } from "next/server";
import {
  isAuthPath,
  isProtectedPath,
  redirectWithCookies,
  updateSession,
} from "@/lib/supabase/proxy";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DEMO_COOKIE_NAME } from "@/lib/demo/seed-data";

/**
 * Runs on every matched request. Next 16 renamed the `middleware` file
 * convention to `proxy` — same behaviour, new name.
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie (see `updateSession`).
 *   2. Redirect: signed-out users away from /dashboard, signed-in users away
 *      from /login and /signup.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { response, user } = await updateSession(request);

  const demoRole = request.cookies.get(DEMO_COOKIE_NAME)?.value;
  const isDemoAuthenticated =
    demoRole === "organizer" || demoRole === "volunteer";

  if (!isSupabaseConfigured && !isDemoAuthenticated) {
    return response;
  }

  const isAuthenticated = Boolean(user) || isDemoAuthenticated;

  if (!isAuthenticated && isProtectedPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(loginUrl, response);
  }

  if (isAuthenticated && isAuthPath(pathname)) {
    return redirectWithCookies(new URL("/dashboard", request.url), response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
