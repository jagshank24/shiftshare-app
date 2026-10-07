"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  assertSupabaseConfigured,
} from "@/lib/supabase/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Supabase client for Client Components.
 *
 * Reads the session from cookies, so it agrees with whatever the server sees.
 * Create it inside the component that needs it — `createBrowserClient` is safe
 * to call repeatedly and returns a singleton internally.
 */
export function createClient() {
  assertSupabaseConfigured();
  return createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
}
