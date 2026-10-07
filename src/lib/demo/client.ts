import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database, UserRole } from "@/lib/supabase/database.types";
import {
  DEMO_CHECKINS,
  DEMO_EVENTS,
  DEMO_ORGANIZER_ID,
  DEMO_PROFILES,
  DEMO_ROLES,
  DEMO_SHIFTS,
  DEMO_SIGNUPS,
  DEMO_VOLUNTEER_ID,
} from "./seed-data";

/**
 * Process-level mutable copy of the demo dataset so actions like cancelling a
 * shift, signing up for a shift, refreshing a QR token, or manual check-out
 * persist across requests during a judge's demo session.
 */
const demoState = {
  profiles: structuredClone(DEMO_PROFILES),
  events: structuredClone(DEMO_EVENTS),
  roles: structuredClone(DEMO_ROLES),
  shifts: structuredClone(DEMO_SHIFTS),
  signups: structuredClone(DEMO_SIGNUPS),
  checkins: structuredClone(DEMO_CHECKINS),
};

export function getDemoUser(role: UserRole | null): User | null {
  if (!role) return null;
  const profileId = role === "organizer" ? DEMO_ORGANIZER_ID : DEMO_VOLUNTEER_ID;
  const profile =
    demoState.profiles.find((p) => p.id === profileId) ?? demoState.profiles[0];

  return {
    id: profile.id,
    app_metadata: { provider: "email" },
    user_metadata: {
      full_name: profile.full_name,
      role: profile.role,
    },
    aud: "authenticated",
    created_at: profile.created_at,
    email: profile.email ?? undefined,
    role: "authenticated",
  } as User;
}

type TableName = keyof typeof demoState;

class DemoQueryBuilder<T extends Record<string, unknown>> {
  private table: TableName;
  private filters: Array<(row: T) => boolean> = [];
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitCount: number | null = null;
  private singleMode: "none" | "single" | "maybeSingle" = "none";
  private mutation:
    | { kind: "none" }
    | { kind: "update"; patch: Partial<T> }
    | { kind: "insert"; rows: T[] }
    | { kind: "upsert"; rows: T[] }
    | { kind: "delete" } = { kind: "none" };

  constructor(table: TableName) {
    this.table = table;
  }

  select(_columns?: string) {
    void _columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => String(row[column]) === String(value));
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => String(row[column]) !== String(value));
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    const set = new Set(values.map((v) => String(v)));
    this.filters.push((row) => set.has(String(row[column])));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.orderSpec = {
      column,
      ascending: opts?.ascending !== false,
    };
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this.execute();
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  update(patch: Partial<T>) {
    this.mutation = { kind: "update", patch };
    return this;
  }

  insert(payload: T | T[]) {
    const rows = Array.isArray(payload) ? payload : [payload];
    this.mutation = { kind: "insert", rows };
    return this;
  }

  upsert(payload: T | T[], _opts?: { onConflict?: string }) {
    void _opts;
    const rows = Array.isArray(payload) ? payload : [payload];
    this.mutation = { kind: "upsert", rows };
    return this;
  }

  delete() {
    this.mutation = { kind: "delete" };
    return this;
  }

  private execute(): Promise<{ data: unknown; error: null | { message: string } }> {
    const tableArr = demoState[this.table] as unknown as T[];

    if (this.mutation.kind === "insert") {
      const created = this.mutation.rows.map((r) => ({
        id:
          (r.id as string) ||
          `de000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`,
        created_at: (r.created_at as string) || new Date().toISOString(),
        ...r,
      })) as T[];
      tableArr.push(...created);
      const out =
        this.singleMode !== "none" ? (created[0] ?? null) : created;
      return Promise.resolve({ data: out, error: null });
    }

    if (this.mutation.kind === "upsert") {
      for (const r of this.mutation.rows) {
        const idx = tableArr.findIndex((existing) => existing.id === r.id);
        if (idx !== -1) {
          tableArr[idx] = { ...tableArr[idx], ...r };
        } else {
          tableArr.push({
            created_at: new Date().toISOString(),
            ...r,
          } as T);
        }
      }
      return Promise.resolve({ data: this.mutation.rows, error: null });
    }

    const matched = tableArr.filter((row) =>
      this.filters.every((fn) => fn(row)),
    );

    if (this.mutation.kind === "update") {
      for (const row of matched) {
        Object.assign(row, this.mutation.patch);
      }
      const out =
        this.singleMode !== "none" ? (matched[0] ?? null) : matched;
      return Promise.resolve({ data: out, error: null });
    }

    if (this.mutation.kind === "delete") {
      for (const row of matched) {
        const idx = tableArr.indexOf(row);
        if (idx !== -1) tableArr.splice(idx, 1);
      }
      return Promise.resolve({ data: matched, error: null });
    }

    let result = matched.map((r) => {
      const clone: Record<string, unknown> = { ...r };
      if (this.table === "events") {
        const org = demoState.profiles.find(
          (p) => p.id === clone.organizer_id,
        );
        clone.organizer = org ? { full_name: org.full_name } : null;
      } else if (this.table === "roles") {
        clone.shifts = demoState.shifts
          .filter((s) => s.role_id === clone.id)
          .map((s) => ({ ...s }));
      } else if (this.table === "signups") {
        const sh = demoState.shifts.find((s) => s.id === clone.shift_id);
        const rl = sh
          ? demoState.roles.find((role) => role.id === sh.role_id)
          : undefined;
        const ev = rl
          ? demoState.events.find((event) => event.id === rl.event_id)
          : undefined;
        clone.shift = sh
          ? {
              starts_at: sh.starts_at,
              ends_at: sh.ends_at,
              role: rl
                ? {
                    name: rl.name,
                    event: ev
                      ? { id: ev.id, title: ev.title, timezone: ev.timezone }
                      : null,
                  }
                : null,
            }
          : null;
      }
      return clone as T;
    });

    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      result.sort((a, b) => {
        const av = String(a[column] ?? "");
        const bv = String(b[column] ?? "");
        if (av < bv) return ascending ? -1 : 1;
        if (av > bv) return ascending ? 1 : -1;
        return 0;
      });
    }

    if (this.limitCount !== null) {
      result = result.slice(0, this.limitCount);
    }

    if (this.singleMode === "single" || this.singleMode === "maybeSingle") {
      return Promise.resolve({ data: result[0] ?? null, error: null });
    }

    return Promise.resolve({ data: result, error: null });
  }

  then<TResult1 = { data: unknown; error: null | { message: string } }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null | { message: string } }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export function createDemoSupabaseClient(
  role: UserRole | null,
): SupabaseClient<Database> {
  const user = getDemoUser(role);

  const client = {
    auth: {
      async getUser() {
        return { data: { user }, error: null };
      },
      async signOut() {
        return { error: null };
      },
      async signInWithPassword() {
        return { data: { user, session: null }, error: null };
      },
      async signUp() {
        return { data: { user, session: null }, error: null };
      },
    },
    from(table: TableName) {
      return new DemoQueryBuilder(table);
    },
    async rpc(fnName: string, args: Record<string, unknown> = {}) {
      if (
        fnName === "shift_availability_for_event" ||
        fnName === "shift_signup_counts"
      ) {
        const eventId = String(args.p_event_id ?? "");
        const roleIds = new Set(
          demoState.roles
            .filter((r) => r.event_id === eventId)
            .map((r) => r.id),
        );
        const eventShifts = demoState.shifts.filter((s) =>
          roleIds.has(s.role_id),
        );
        const rows = eventShifts.map((sh) => {
          const shiftSignups = demoState.signups.filter(
            (sg) => sg.shift_id === sh.id,
          );
          const confirmed = shiftSignups.filter(
            (sg) => sg.status === "confirmed",
          ).length;
          const waitlist = shiftSignups.filter(
            (sg) => sg.status === "waitlist",
          ).length;
          return {
            shift_id: sh.id,
            confirmed_count: confirmed,
            waitlist_count: waitlist,
            taken: confirmed,
            standing_by: waitlist,
          };
        });
        return { data: rows, error: null };
      }

      if (fnName === "cancel_shift" || fnName === "cancel_signup") {
        const shiftId = String(args.p_shift_id ?? "");
        if (!user) {
          return { data: null, error: { message: "Not authenticated" } };
        }
        const idx = demoState.signups.findIndex(
          (sg) => sg.shift_id === shiftId && sg.volunteer_id === user.id,
        );
        if (idx !== -1) {
          const removed = demoState.signups.splice(idx, 1)[0];
          let promoted = false;
          if (removed.status === "confirmed") {
            const nextWaitlist = demoState.signups.find(
              (sg) => sg.shift_id === shiftId && sg.status === "waitlist",
            );
            if (nextWaitlist) {
              nextWaitlist.status = "confirmed";
              promoted = true;
            }
          }
          return { data: { cancelled: true, promoted }, error: null };
        }
        return { data: { cancelled: false, promoted: false }, error: null };
      }

      if (fnName === "claim_shift") {
        const shiftId = String(args.p_shift_id ?? "");
        if (!user) {
          return { data: { status: "unauthenticated" }, error: null };
        }
        const shift = demoState.shifts.find((s) => s.id === shiftId);
        if (!shift) {
          return { data: { status: "not_found" }, error: null };
        }
        const existing = demoState.signups.find(
          (sg) => sg.shift_id === shiftId && sg.volunteer_id === user.id,
        );
        if (existing) {
          return {
            data: { status: "already_signed_up", signup_status: existing.status },
            error: null,
          };
        }
        const confirmedCount = demoState.signups.filter(
          (sg) => sg.shift_id === shiftId && sg.status === "confirmed",
        ).length;
        const nextStatus =
          confirmedCount < shift.capacity ? "confirmed" : "waitlist";
        const nowIso = new Date().toISOString();
        const newSignup = {
          id: `a0000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`,
          shift_id: shiftId,
          volunteer_id: user.id,
          status: nextStatus as "confirmed" | "waitlist",
          note: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        demoState.signups.push(newSignup);
        return {
          data: { status: nextStatus, signup_id: newSignup.id },
          error: null,
        };
      }

      // Let service-layer fallbacks handle other RPCs via table queries
      return {
        data: null,
        error: { message: "Use table query fallback in demo client" },
      };
    },
  };

  return client as unknown as SupabaseClient<Database>;
}
