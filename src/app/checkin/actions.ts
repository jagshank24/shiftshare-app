"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, siteUrl } from "@/lib/supabase/env";
import {
  buildCheckinPath,
  buildCheckinUrl,
  generateQrCodeDataUrl,
} from "@/lib/checkin/qr";
import {
  loadOrganizerEventRoster,
  processVolunteerCheckinScan,
  refreshEventQrToken,
  setOrganizerManualCheckout,
} from "@/lib/checkin/service";
import type { WhosHereEntry } from "@/lib/checkin/roster";
import type { QrScanCheckinResult } from "@/lib/supabase/database.types";

export async function refreshEventQrTokenAction(
  eventId: string,
  origin?: string,
): Promise<{
  ok: boolean;
  error?: string;
  token?: string;
  checkinPath?: string;
  checkinUrl?: string;
  qrDataUrl?: string;
}> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const res = await refreshEventQrToken(supabase, user?.id, eventId);
  if (res.code !== "refreshed" || !res.token) {
    return {
      ok: false,
      error:
        res.code === "forbidden"
          ? "Only the event organizer can refresh the QR code."
          : "Couldn't refresh the QR code. Try again.",
    };
  }

  const baseOrigin = origin?.trim() || siteUrl();
  const checkinPath = buildCheckinPath(eventId, res.token);
  const checkinUrl = buildCheckinUrl(eventId, res.token, baseOrigin);
  const qrDataUrl = await generateQrCodeDataUrl(checkinUrl, 512);

  revalidatePath("/dashboard");

  return {
    ok: true,
    token: res.token,
    checkinPath,
    checkinUrl,
    qrDataUrl,
  };
}

export async function organizerSetCheckoutAction(
  eventId: string,
  signupId: string,
  checkoutIso: string,
): Promise<{
  ok: boolean;
  error?: string;
  roster?: WhosHereEntry[];
}> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const res = await setOrganizerManualCheckout(
    supabase,
    user?.id,
    signupId,
    checkoutIso,
  );

  if (res.code !== "adjusted") {
    const messages: Record<string, string> = {
      unauthenticated: "Log in again to update check-out times.",
      forbidden: "Only the event organizer can adjust check-out times.",
      not_found: "Couldn't find that signup.",
      not_checked_in: "This volunteer hasn't checked in yet.",
      invalid_time: "Check-out time must be after the check-in time.",
    };
    return {
      ok: false,
      error: messages[res.code] ?? "Couldn't save the check-out time.",
    };
  }

  const roster = await loadOrganizerEventRoster(supabase, eventId);
  revalidatePath("/dashboard");

  return {
    ok: true,
    roster,
  };
}

export async function fetchEventRosterAction(
  eventId: string,
): Promise<{ ok: boolean; roster: WhosHereEntry[] }> {
  if (!isSupabaseConfigured) {
    return { ok: false, roster: [] };
  }

  const supabase = await createClient();
  const roster = await loadOrganizerEventRoster(supabase, eventId);
  return { ok: true, roster };
}

export async function triggerVolunteerScanAction(
  eventId: string,
  token: string,
): Promise<QrScanCheckinResult> {
  if (!isSupabaseConfigured) {
    return { code: "not_found" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const result = await processVolunteerCheckinScan(
    supabase,
    user?.id,
    eventId,
    token,
  );
  revalidatePath("/dashboard");
  return result;
}
