"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, siteUrl } from "@/lib/supabase/env";
import { DEMO_COOKIE_NAME } from "@/lib/demo/seed-data";
import type { UserRole } from "@/lib/supabase/database.types";

export type AuthFormState = {
  error?: string;
  notice?: string;
  /** Echoed back so the form can keep what the person typed. */
  values?: { email?: string; fullName?: string; role?: string };
};

const NOT_CONFIGURED =
  "Supabase isn't configured yet. Click 'Try the demo' above to explore ShiftShare right away, or copy .env.example to .env.local and add your project URL and anon key.";

function isRole(value: unknown): value is UserRole {
  return value === "organizer" || value === "volunteer";
}

/** Only allow same-origin relative paths back out of the `next` parameter. */
function safeNext(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
}

/**
 * Instant one-click demo login for judges ("Try the demo") with no signup needed.
 */
export async function demoLoginAction(formData: FormData) {
  const rawRole = formData.get("role");
  const role: UserRole = isRole(rawRole) ? rawRole : "organizer";
  const next = safeNext(formData.get("next"));

  const cookieStore = await cookies();
  cookieStore.set(DEMO_COOKIE_NAME, role, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
  });

  revalidatePath("/dashboard");
  redirect(next);
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password.", values: { email } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "That email and password don't match. Try again."
          : error.message,
      values: { email },
    };
  }

  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE_NAME);

  redirect(next);
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();
  const role = formData.get("role");
  const next = safeNext(formData.get("next"));

  const values = { email, fullName, role: typeof role === "string" ? role : "" };

  if (!fullName) {
    return { error: "Tell us your name so organizers know who's coming.", values };
  }
  if (!email) {
    return { error: "We need an email address to send your confirmation link.", values };
  }
  if (password.length < 8) {
    return { error: "Use at least 8 characters for your password.", values };
  }
  if (!isRole(role)) {
    return { error: "Choose whether you're organizing or volunteering.", values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, role },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return {
      error:
        error.message.includes("already registered")
          ? "That email already has an account. Log in instead."
          : error.message,
      values,
    };
  }

  if (data.session) {
    redirect(next);
  }

  return {
    notice: `Almost there. We sent a confirmation link to ${email} — click it to finish setting up your account.`,
    values: { email },
  };
}

export async function setRoleAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  if (!isSupabaseConfigured) return { error: NOT_CONFIGURED };

  const role = formData.get("role");
  if (!isRole(role)) return { error: "Pick organizer or volunteer." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Your session expired. Log in again." };

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      full_name:
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
      role,
    },
    { onConflict: "id" },
  );

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { notice: `Saved. You're set up as a ${role}.` };
}

export async function signOutAction() {
  const cookieStore = await cookies();
  cookieStore.delete(DEMO_COOKIE_NAME);

  if (!isSupabaseConfigured) redirect("/");

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
