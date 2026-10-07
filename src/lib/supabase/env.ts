/**
 * Supabase configuration, read once and validated.
 *
 * Both values are `NEXT_PUBLIC_*`, so Next inlines them at build time. If they
 * are missing we don't throw at import time — that would break the marketing
 * pages and the preview build. Instead `isSupabaseConfigured` is false and the
 * auth screens render a setup notice (`<AuthNotConfigured />`).
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when both public env vars are present. */
export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/** Base URL used for auth redirects (email confirmation, OAuth callback). */
export function siteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    "http://localhost:3000"
  );
}

/**
 * Throws a readable error instead of the opaque "supabaseUrl is required".
 * Only call this from code paths that already checked `isSupabaseConfigured`.
 */
export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Copy .env.example to .env.local and set " +
        "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then " +
        "restart the dev server.",
    );
  }
}
