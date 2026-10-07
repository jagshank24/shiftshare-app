/**
 * Server-side sliding-window rate limiter and input length validators for
 * ShiftShare AI routes (`/api/plan` and dashboard AI server actions).
 */

export const AI_INPUT_LIMITS = {
  MAX_SENTENCE_LENGTH: 600,
  MAX_INSTRUCTION_LENGTH: 600,
  MAX_EVENT_TITLE_LENGTH: 150,
  MAX_LOCATION_LENGTH: 200,
  MAX_CLARIFICATION_VALUE_LENGTH: 200,
  MAX_VOLUNTEERS_PER_BATCH: 50,
  MAX_ROLES_PER_PLAN: 25,
  MAX_BODY_BYTES: 64 * 1024,
} as const;

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  max: 30,
  windowMs: 60 * 1000, // 30 AI requests per minute per user/IP
};

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
  now = Date.now(),
): RateLimitStatus {
  const safeKey = key.trim() || "anonymous";
  const windowStart = now - config.windowMs;
  const previous = (buckets.get(safeKey) ?? []).filter(
    (ts) => ts > windowStart,
  );

  if (previous.length >= config.max) {
    const oldestInWindow = previous[0] ?? now;
    const retryAfterMs = Math.max(1000, oldestInWindow + config.windowMs - now);
    buckets.set(safeKey, previous);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  previous.push(now);
  buckets.set(safeKey, previous);

  return {
    allowed: true,
    remaining: Math.max(0, config.max - previous.length),
    retryAfterSeconds: 0,
  };
}

export function resetRateLimiterForTests() {
  buckets.clear();
}

export function getClientRateLimitKey(
  request: Request,
  userId?: string | null,
): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) return `ip:${firstIp}`;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${realIp}`;
  return "ip:local";
}

export function validateInputLength(
  value: string,
  label: string,
  maxLength: number,
): { ok: true } | { ok: false; error: string; hint: string } {
  if (value.length > maxLength) {
    return {
      ok: false,
      error: `That ${label} is ${value.length} characters. Keep it under ${maxLength}.`,
      hint: `Shorten the ${label} to ${maxLength} characters or fewer and try again.`,
    };
  }
  return { ok: true };
}
