import { NextResponse } from "next/server";
import { getCurrentUser, createClient, getActiveDemoRole } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  checkPlanForGaps,
  clarifyEventDetails,
  editPlanWithChat,
  generatePlan,
  generatePublishCopy,
} from "@/lib/ai";
import {
  AI_INPUT_LIMITS,
  checkRateLimit,
  getClientRateLimitKey,
  validateInputLength,
} from "@/lib/rate-limit";
import { normalizePlan } from "@/lib/planner/parse";
import { loadOrganizerPastEventsSummary } from "@/lib/planner/past-events";
import { parseTime } from "@/lib/planner/time";
import type { PastEventsSummary, PlanIssue } from "@/lib/planner/types";

/**
 * POST /api/plan
 *
 * Server-side endpoint for all /events/new AI tasks via `src/lib/ai.ts`.
 * The Anthropic key lives in `ANTHROPIC_API_KEY` and never leaves this process.
 * Enforces per-client rate limiting and strict input length limits on every task.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(
  error: string,
  hint?: string,
  status = 400,
  extraHeaders?: Record<string, string>,
) {
  return NextResponse.json(
    { ok: false, error, hint },
    { status, headers: extraHeaders },
  );
}

function parseClarifications(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) {
      out[k.slice(0, 60)] = v
        .trim()
        .slice(0, AI_INPUT_LIMITS.MAX_CLARIFICATION_VALUE_LENGTH);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function POST(request: Request) {
  let rawText = "";
  try {
    rawText = await request.text();
  } catch {
    return badRequest("Expected a JSON body.");
  }

  if (rawText.length > AI_INPUT_LIMITS.MAX_BODY_BYTES) {
    return badRequest(
      "Request payload is too large.",
      `Keep request payloads under ${Math.round(AI_INPUT_LIMITS.MAX_BODY_BYTES / 1024)} KB.`,
      413,
    );
  }

  let body: {
    action?: unknown;
    sentence?: unknown;
    date?: unknown;
    start?: unknown;
    end?: unknown;
    clarifications?: unknown;
    plan?: unknown;
    instruction?: unknown;
    location?: unknown;
  };

  try {
    body = JSON.parse(rawText);
  } catch {
    return badRequest("Expected a JSON body.");
  }

  const action =
    typeof body.action === "string" && body.action.trim()
      ? body.action.trim()
      : "generate";

  let pastEventsSummary: PastEventsSummary | null = null;
  const demoRole = await getActiveDemoRole();
  const user = await getCurrentUser();

  if (isSupabaseConfigured && !demoRole) {
    if (!user) {
      return badRequest("Log in to build a plan.", undefined, 401);
    }
  }

  // Enforce rate limit for every client (authenticated user ID or IP)
  const rateStatus = checkRateLimit(
    getClientRateLimitKey(request, user?.id ?? null),
  );
  if (!rateStatus.allowed) {
    return badRequest(
      "That's a lot of requests in a short time.",
      `Wait ${rateStatus.retryAfterSeconds} seconds and try again.`,
      429,
      { "Retry-After": String(rateStatus.retryAfterSeconds) },
    );
  }

  if (user) {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.role === "volunteer") {
      return badRequest(
        "Plans are for organizers.",
        "Your account is set up as a volunteer. Switch roles from your dashboard to plan an event.",
        403,
      );
    }

    if (action === "generate") {
      pastEventsSummary = await loadOrganizerPastEventsSummary(
        supabase,
        user.id,
      );
    }
  }

  const windowStart =
    typeof body.start === "string" ? parseTime(body.start) : null;
  const windowEnd = typeof body.end === "string" ? parseTime(body.end) : null;
  const date =
    typeof body.date === "string" && body.date ? body.date.slice(0, 32) : undefined;
  const sentence =
    typeof body.sentence === "string" ? body.sentence.trim() : "";
  const location =
    typeof body.location === "string" ? body.location.trim() : "";

  if (sentence) {
    const check = validateInputLength(
      sentence,
      "description",
      AI_INPUT_LIMITS.MAX_SENTENCE_LENGTH,
    );
    if (!check.ok) return badRequest(check.error, check.hint);
  }

  if (location) {
    const check = validateInputLength(
      location,
      "location",
      AI_INPUT_LIMITS.MAX_LOCATION_LENGTH,
    );
    if (!check.ok) return badRequest(check.error, check.hint);
  }

  /* ------------------------------------------------------------------------ */
  /* 1. CLARIFYING QUESTIONS                                                  */
  /* ------------------------------------------------------------------------ */
  if (action === "clarify") {
    if (!sentence) {
      return badRequest(
        "Describe the event in a sentence first.",
        "For example: Fall carnival, 200 people, Saturday 10-4.",
      );
    }

    const result = await clarifyEventDetails(sentence);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, hint: result.hint },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      needsClarification: result.needsClarification,
      questions: result.questions,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 3. CHAT EDITING                                                          */
  /* ------------------------------------------------------------------------ */
  if (action === "edit") {
    const instruction =
      typeof body.instruction === "string" ? body.instruction.trim() : "";
    if (!instruction) {
      return badRequest(
        "Type the change you want first.",
        "For example: Add a cleanup crew at 3pm, or we only have 15 volunteers.",
      );
    }
    const check = validateInputLength(
      instruction,
      "instruction",
      AI_INPUT_LIMITS.MAX_INSTRUCTION_LENGTH,
    );
    if (!check.ok) return badRequest(check.error, check.hint);

    const plan = normalizePlan(body.plan);
    if (plan.roles.length === 0) {
      return badRequest("Build a plan before asking for edits.");
    }
    if (plan.roles.length > AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN) {
      return badRequest(
        `Plans can have at most ${AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN} roles.`,
      );
    }

    const result = await editPlanWithChat({
      plan,
      instruction,
      windowStart,
      windowEnd,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, hint: result.hint },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      plan: result.plan,
      whatChanged: result.whatChanged,
      issues: result.issues,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 4. PLAN CHECK                                                            */
  /* ------------------------------------------------------------------------ */
  if (action === "check") {
    const plan = normalizePlan(body.plan);
    if (plan.roles.length === 0) {
      return badRequest("Provide a plan with at least one role to check.");
    }
    if (plan.roles.length > AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN) {
      return badRequest(
        `Plans can have at most ${AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN} roles.`,
      );
    }

    const result = await checkPlanForGaps({
      plan,
      sentence: sentence || undefined,
      windowStart,
      windowEnd,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, hint: result.hint },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      warnings: result.warnings,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 5. PUBLISH COPY GENERATION                                               */
  /* ------------------------------------------------------------------------ */
  if (action === "publish-copy") {
    const plan = normalizePlan(body.plan);
    if (plan.roles.length === 0) {
      return badRequest("Provide a valid plan before generating publish copy.");
    }
    if (plan.roles.length > AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN) {
      return badRequest(
        `Plans can have at most ${AI_INPUT_LIMITS.MAX_ROLES_PER_PLAN} roles.`,
      );
    }

    const result = await generatePublishCopy({
      plan,
      sentence: sentence || undefined,
      date: date ?? "your event date",
      start: typeof body.start === "string" && body.start ? body.start.slice(0, 16) : "09:00",
      end: typeof body.end === "string" && body.end ? body.end.slice(0, 16) : "13:00",
      location: location || undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, hint: result.hint },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      copy: result.copy,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 2. PLAN GENERATION (default)                                             */
  /* ------------------------------------------------------------------------ */
  if (!sentence) {
    return badRequest(
      "Describe the event in a sentence first.",
      "For example: Saturday food drive at the library, 9am to 1pm, need 12 people.",
    );
  }

  const result = await generatePlan({
    sentence,
    windowStart,
    windowEnd,
    eventDate: date,
    clarifications: parseClarifications(body.clarifications),
    pastEventsSummary,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, hint: result.hint },
      { status: 502 },
    );
  }

  const issues: PlanIssue[] = result.issues;

  return NextResponse.json({
    ok: true,
    mode: result.mode,
    plan: result.plan,
    issues,
    attempts: result.attempts,
    note:
      result.note ??
      (issues.length > 0
        ? "Claude's plan needed a second pass and still has issues — check the notes below before publishing."
        : undefined),
    adjustedFromPastEvent: result.adjustedFromPastEvent,
    pastEventsSummary,
  });
}
