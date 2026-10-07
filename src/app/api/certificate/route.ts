import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import { generateQrCodeDataUrl } from "@/lib/checkin/qr";
import { eventDayWithYear } from "@/lib/events/format";
import {
  buildVerifyUrl,
  deriveDefaultVerificationCode,
  formatCertificateVerificationCode,
  resolveCertificateByVerificationCode,
} from "@/lib/volunteer/verification";
import {
  renderCertificatePdfBuffer,
  type CertificateEventItem,
} from "@/lib/volunteer/certificate-pdf";
import type { Profile } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId")?.trim() || null;
  const codeParam = url.searchParams.get("code")?.trim() || null;

  const supabase = await createClient();

  let targetCode = codeParam;
  if (!targetCode) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "Log in to download your certificate." },
        { status: 401 },
      );
    }

    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, full_name, email, verification_code")
      .eq("id", user.id)
      .maybeSingle();

    const profile = profileData as Pick<
      Profile,
      "id" | "full_name" | "email" | "verification_code"
    > | null;

    const baseCode =
      profile?.verification_code || deriveDefaultVerificationCode(user.id);
    targetCode = formatCertificateVerificationCode(baseCode, eventId);
  }

  const resolved = await resolveCertificateByVerificationCode(
    supabase,
    targetCode,
  );

  if (!resolved.valid) {
    return NextResponse.json(
      { error: "Invalid verification code or no matching event." },
      { status: 404 },
    );
  }

  const origin = url.origin || siteUrl();
  const verifyUrl = buildVerifyUrl(resolved.code, origin);
  const verifyQrDataUrl = await generateQrCodeDataUrl(verifyUrl, 240);

  const events: CertificateEventItem[] = (resolved.events ?? []).map((ev) => ({
    eventId: ev.event_id,
    eventName: ev.event_title,
    dateFormatted: eventDayWithYear(ev.event_date, ev.timezone),
    organizerName: ev.organizer_name,
    roleName: ev.role_name,
    hours: Number(ev.hours ?? 0),
  }));

  const dateIssued = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date());

  const singleEventTitle =
    eventId && events.length > 0 ? events[0].eventName : null;

  const pdfBuffer = await renderCertificatePdfBuffer({
    volunteerName: resolved.volunteer_name ?? "Volunteer",
    events,
    totalVerifiedHours: Number(resolved.total_hours ?? 0),
    dateIssued,
    verificationCode: resolved.code,
    verifyUrl,
    verifyQrDataUrl,
    singleEventTitle,
  });

  const safeSlug = (resolved.volunteer_name ?? "volunteer")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = singleEventTitle
    ? `shiftshare-certificate-${safeSlug}-event.pdf`
    : `shiftshare-certificate-${safeSlug}.pdf`;

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
