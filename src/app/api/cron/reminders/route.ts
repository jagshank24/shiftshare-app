import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";
import { sendDueShiftReminders } from "@/lib/email";
import type { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return false;
  }

  const authHeader = request.headers.get("authorization")?.trim() ?? "";
  return authHeader === `Bearer ${secret}`;
}

async function handleRemindersCron(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Unauthorized. Provide Authorization: Bearer <CRON_SECRET>.",
      },
      { status: 401 },
    );
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabase =
    isSupabaseConfigured && serviceRoleKey
      ? createServiceClient<Database>(SUPABASE_URL, serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : await createClient();

  // Optional `?now=` override (only allowed when authenticated with CRON_SECRET)
  // so local testing can simulate the 24-hour window before an upcoming event.
  const nowParam = request.nextUrl.searchParams.get("now")?.trim();
  const parsedNow = nowParam ? new Date(nowParam) : new Date();
  const referenceNow = Number.isNaN(parsedNow.getTime())
    ? new Date()
    : parsedNow;

  const summary = await sendDueShiftReminders(supabase, referenceNow);
  return NextResponse.json(summary, { status: 200 });
}

export async function GET(request: NextRequest) {
  return handleRemindersCron(request);
}

export async function POST(request: NextRequest) {
  return handleRemindersCron(request);
}
