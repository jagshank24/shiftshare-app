import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import { createDemoSupabaseClient, getDemoUser } from "@/lib/demo/client";
import { DEMO_COOKIE_NAME } from "@/lib/demo/seed-data";
import type { Database, UserRole } from "@/lib/supabase/database.types";

function parseDemoRole(raw: string | undefined): UserRole | null {
  if (raw === "organizer" || raw === "volunteer") return raw;
  return null;
}

/**
 * Returns the active judge Demo Mode role ("organizer" | "volunteer") if the
 * visitor clicked "Try the demo" on `/login`, or null otherwise.
 */
export async function getActiveDemoRole(): Promise<UserRole | null> {
  try {
    const cookieStore = await cookies();
    return parseDemoRole(cookieStore.get(DEMO_COOKIE_NAME)?.value);
  } catch {
    return null;
  }
}

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * When a judge activates Demo Mode via "Try the demo" (or when Supabase env
 * vars are not configured), returns a stateful in-memory Supabase-compatible
 * client seeded with the 1 organizer, 15 volunteers, 6-role / 33-shift
 * "Fall Carnival" event, and past completed events.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const demoRole = parseDemoRole(cookieStore.get(DEMO_COOKIE_NAME)?.value);

  if (demoRole || !isSupabaseConfigured) {
    return createDemoSupabaseClient(demoRole);
  }

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Safe to ignore — the proxy owns
          // session refresh.
        }
      },
    },
  });
}

/**
 * Current user, verified against Supabase (or the active judge Demo Mode
 * session when "Try the demo" was used).
 */
export async function getCurrentUser() {
  const demoRole = await getActiveDemoRole();
  if (demoRole) {
    return getDemoUser(demoRole);
  }
  if (!isSupabaseConfigured) {
    return null;
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
