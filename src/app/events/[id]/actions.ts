"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { eventTimeRange } from "@/lib/events/format";
import type { SignupResult } from "@/lib/supabase/database.types";

/**
 * Signing up and cancelling.
 *
 * Both are one-tap actions on the public event page, and both delegate the
 * actual decision to a Postgres function (`sign_up_for_shift` /
 * `cancel_signup`). Those functions hold the invariants — capacity, standby,
 * schedule clashes — inside a transaction, which is not something a
 * read-then-write from here could do safely.
 *
 * The job of these actions is therefore narrow: check there's a session, call
 * the function, and turn its code into a sentence a volunteer can act on.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

export type SignupActionResult = {
  ok: boolean;
  code: SignupResult["code"] | "not_configured" | "bad_request";
  message: string;
};

const MESSAGES: Record<string, { ok: boolean; message: string }> = {
  confirmed: {
    ok: true,
    message: "You're signed up. The organizer can see you're on the list.",
  },
  waitlist: {
    ok: true,
    message:
      "That shift is full, so you're on standby. The organizer can see you're waiting.",
  },
  already: { ok: false, message: "You're already signed up for this shift." },
  already_waitlist: {
    ok: false,
    message: "You're already on standby for this shift.",
  },
  cancelled: { ok: true, message: "Canceled — your spot is open again." },
  not_signed_up: { ok: false, message: "You weren't signed up for that shift." },
  not_found: {
    ok: false,
    message: "We couldn't find that shift. It may have been removed.",
  },
  not_published: {
    ok: false,
    message: "This event isn't published yet, so it isn't taking signups.",
  },
  unauthenticated: { ok: false, message: "Log in to sign up." },
  bad_request: {
    ok: false,
    message: "Something was wrong with that request. Reload and try again.",
  },
  not_configured: {
    ok: false,
    message: "Supabase isn't configured, so signups are switched off.",
  },
};

function reply(code: SignupActionResult["code"], message?: string): SignupActionResult {
  const known = MESSAGES[code] ?? MESSAGES.bad_request;
  return { ok: known.ok, code, message: message ?? known.message };
}

/**
 * The one message that needs data from the database: naming the shift you'd be
 * double-booked against, in that event's own timezone.
 */
function overlapMessage(conflict: NonNullable<SignupResult["conflict"]>): string {
  const when = eventTimeRange(conflict.starts_at, conflict.ends_at, conflict.timezone);
  return `That clashes with ${conflict.role} at ${conflict.event_title} (${when}).`;
}

async function run(
  shiftId: string,
  slug: string,
  kind: "signup" | "cancel",
): Promise<SignupActionResult> {
  if (!isSupabaseConfigured) return reply("not_configured");
  if (!UUID.test(shiftId)) return reply("bad_request");

  const supabase = await createClient();

  // The database functions use auth.uid() and never trust a volunteer id from
  // the client, but checking here lets us send the visitor to the login page
  // rather than showing them a database error.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply("unauthenticated");

  const { data, error } = await supabase.rpc(
    kind === "signup" ? "sign_up_for_shift" : "cancel_signup",
    { p_shift_id: shiftId },
  );

  if (error) {
    return {
      ok: false,
      code: "bad_request",
      message: "We couldn't save that just now. Try again in a moment.",
    };
  }

  const result = (data ?? { code: "bad_request" }) as SignupResult;

  // Counts and list state have both moved on.
  if (SLUG.test(slug)) revalidatePath(`/events/${slug}`);

  if (result.code === "overlap" && result.conflict) {
    return {
      ok: false,
      code: "overlap",
      message: overlapMessage(result.conflict),
    };
  }

  const answer = reply(result.code as SignupActionResult["code"]);

  // Confirming a place can take back an overlapping standby place. Say so —
  // finding out later that you'd been dropped from a queue would feel sneaky.
  if (result.code === "confirmed" && (result.released_standby ?? 0) > 0) {
    return {
      ...answer,
      message: `${answer.message} We also took you off standby for a shift that runs at the same time.`,
    };
  }

  return answer;
}

export async function signUpForShiftAction(
  shiftId: string,
  slug: string,
): Promise<SignupActionResult> {
  return run(shiftId, slug, "signup");
}

export async function cancelShiftSignupAction(
  shiftId: string,
  slug: string,
): Promise<SignupActionResult> {
  return run(shiftId, slug, "cancel");
}
