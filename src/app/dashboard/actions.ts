"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  generateEventRecap,
  generateVolunteerThankYous,
  type EventRecapInput,
  type EventRecapResult,
  type VolunteerThankYouInput,
  type VolunteerThankYouResult,
} from "@/lib/ai";
import { notifyStandbyPromotion } from "@/lib/email";
import {
  AI_INPUT_LIMITS,
  checkRateLimit,
  validateInputLength,
} from "@/lib/rate-limit";
import type { SignupResult } from "@/lib/supabase/database.types";

/**
 * Cancels a volunteer's upcoming shift directly from `/dashboard`.
 */
export async function cancelVolunteerShiftFromDashboardAction(
  shiftId: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = shiftId.trim();
  if (!trimmed) {
    return { ok: false, error: "Choose a shift to cancel." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Log in again to cancel your shift." };
  }

  let promoted: SignupResult["promoted"] = null;
  try {
    const { data } = await supabase.rpc("cancel_signup", {
      p_shift_id: trimmed,
    });
    const rpcResult = data as SignupResult | null;
    if (rpcResult?.promoted) {
      promoted = rpcResult.promoted;
    }
  } catch {
    // Fall back to direct update below
  }

  const { error } = await supabase
    .from("signups")
    .update({ status: "cancelled" })
    .eq("shift_id", trimmed)
    .eq("volunteer_id", user.id);

  if (error) {
    return { ok: false, error: "Couldn't cancel that shift. Try again." };
  }

  if (promoted) {
    await notifyStandbyPromotion({
      supabase,
      shiftId: trimmed,
      promoted,
    });
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Calls `generateVolunteerThankYous` in `src/lib/ai.ts` on the server,
 * with per-user rate limiting and input length checks.
 */
export async function generateVolunteerThankYousAction(
  input: VolunteerThankYouInput,
): Promise<VolunteerThankYouResult> {
  const user = await getCurrentUser();
  const rate = checkRateLimit(`thank-yous:${user?.id ?? "anon"}`);
  if (!rate.allowed) {
    return {
      ok: false,
      error: "Too many AI requests in a short time.",
      hint: `Wait ${rate.retryAfterSeconds} seconds and tap Retry.`,
    };
  }

  const titleCheck = validateInputLength(
    input.eventTitle ?? "",
    "event title",
    AI_INPUT_LIMITS.MAX_EVENT_TITLE_LENGTH,
  );
  if (!titleCheck.ok) {
    return { ok: false, error: titleCheck.error, hint: titleCheck.hint };
  }

  const cappedVolunteers = (input.volunteers ?? [])
    .slice(0, AI_INPUT_LIMITS.MAX_VOLUNTEERS_PER_BATCH)
    .map((v) => ({
      volunteerId: String(v.volunteerId ?? "").slice(0, 64),
      volunteerName: String(v.volunteerName ?? "Volunteer").slice(0, 80),
      roleName: String(v.roleName ?? "Volunteer").slice(0, 120),
      hours: Number(v.hours ?? 0),
    }));

  return generateVolunteerThankYous({
    eventTitle: input.eventTitle.trim(),
    eventDate: input.eventDate?.slice(0, 64),
    volunteers: cappedVolunteers,
  });
}

/**
 * Calls `generateEventRecap` in `src/lib/ai.ts` on the server,
 * with per-user rate limiting and input length checks.
 */
export async function generateEventRecapAction(
  input: EventRecapInput,
): Promise<EventRecapResult> {
  const user = await getCurrentUser();
  const rate = checkRateLimit(`event-recap:${user?.id ?? "anon"}`);
  if (!rate.allowed) {
    return {
      ok: false,
      error: "Too many AI requests in a short time.",
      hint: `Wait ${rate.retryAfterSeconds} seconds and tap Retry.`,
    };
  }

  const titleCheck = validateInputLength(
    input.eventTitle ?? "",
    "event title",
    AI_INPUT_LIMITS.MAX_EVENT_TITLE_LENGTH,
  );
  if (!titleCheck.ok) {
    return { ok: false, error: titleCheck.error, hint: titleCheck.hint };
  }

  return generateEventRecap({
    ...input,
    eventTitle: input.eventTitle.trim(),
    roles: (input.roles ?? []).slice(0, AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN),
  });
}
