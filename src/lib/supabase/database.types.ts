/**
 * Database types for the ShiftShare schema.
 *
 * Hand-written to match `supabase/migrations/20261006120000_init.sql`. Once
 * your project is live you can generate the real thing and this file becomes
 * redundant:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/lib/supabase/database.types.ts
 */

export type UserRole = "organizer" | "volunteer";
export type SignupStatus = "pending" | "confirmed" | "cancelled" | "waitlist";

/** What `sign_up_for_shift` / `cancel_signup` report back. */
export type SignupResult = {
  code:
    | "confirmed"
    | "waitlist"
    | "already"
    | "already_waitlist"
    | "overlap"
    | "cancelled"
    | "not_signed_up"
    | "not_found"
    | "not_published"
    | "past"
    | "unauthenticated";
  conflict?: {
    role: string;
    event_title: string;
    starts_at: string;
    ends_at: string;
    timezone: string;
  };
  taken?: number;
  capacity?: number;
  /** Standby places released because they overlapped the new signup. */
  released_standby?: number;
};
export type CheckinKind = "in" | "out";

export type ValidateCheckinTokenResult = {
  valid: boolean;
  code: "ok" | "invalid_token" | "not_found";
  event_id?: string;
  event_title?: string;
  event_slug?: string;
  timezone?: string;
};

export type RefreshCheckinTokenResult = {
  code: "refreshed" | "unauthenticated" | "forbidden" | "not_found";
  token?: string;
};

export type QrScanCheckinResult = {
  code:
    | "unauthenticated"
    | "not_found"
    | "invalid_token"
    | "not_signed_up"
    | "checked_in"
    | "checked_out"
    | "already_checked_out"
    | "outside_window";
  signup_id?: string;
  role_name?: string;
  event_id?: string;
  event_title?: string;
  event_slug?: string;
  timezone?: string;
  shift_starts_at?: string;
  shift_ends_at?: string;
  checked_in_at?: string;
  checked_out_at?: string;
  shift_hours?: number;
  total_hours?: number;
  window_opens_at?: string;
  window_closes_at?: string;
  organizer_name?: string | null;
  organizer_email?: string | null;
};

export type OrganizerSetCheckoutResult = {
  code:
    | "adjusted"
    | "unauthenticated"
    | "forbidden"
    | "not_found"
    | "not_checked_in"
    | "invalid_time";
  signup_id?: string;
  checked_in_at?: string;
  checked_out_at?: string;
  shift_hours?: number;
  adjusted_by_organizer?: boolean;
};

export type VerifyCertificateEventRow = {
  event_id: string;
  event_title: string;
  event_date: string;
  timezone: string;
  organizer_name: string;
  role_name: string;
  hours: number;
};

export type VerifyCertificateResult = {
  valid: boolean;
  code: string;
  verification_code?: string;
  volunteer_id?: string;
  volunteer_name?: string;
  total_hours?: number;
  events?: VerifyCertificateEventRow[];
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole | null;
  phone: string | null;
  verification_code?: string;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  slug: string;
  published: boolean;
  /** IANA zone the event's wall-clock times are on, e.g. "America/Los_Angeles". */
  timezone: string;
  /** Rotatable secret token encoded in the event's QR check-in code. */
  checkin_token: string;
  created_at: string;
  updated_at: string;
};

export type RoleRow = {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  capacity: number;
  /** Order the role was planned in — what the public page lists by. */
  position: number;
  created_at: string;
  updated_at: string;
};

export type Shift = {
  id: string;
  role_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  created_at: string;
  updated_at: string;
};

export type Signup = {
  id: string;
  shift_id: string;
  volunteer_id: string;
  status: SignupStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type Checkin = {
  id: string;
  signup_id: string;
  kind: CheckinKind;
  at: string;
  verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  method: string | null;
  adjusted_by_organizer: boolean;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> & { id: string };
        Update: Partial<Profile>;
        Relationships: [];
      };
      events: {
        Row: EventRow;
        Insert: Partial<EventRow> & { organizer_id: string; title: string; slug: string };
        Update: Partial<EventRow>;
        Relationships: [];
      };
      roles: {
        Row: RoleRow;
        Insert: Partial<RoleRow> & { event_id: string; name: string };
        Update: Partial<RoleRow>;
        Relationships: [];
      };
      shifts: {
        Row: Shift;
        Insert: Partial<Shift> & { role_id: string; starts_at: string; ends_at: string };
        Update: Partial<Shift>;
        Relationships: [];
      };
      signups: {
        Row: Signup;
        Insert: Partial<Signup> & { shift_id: string; volunteer_id: string };
        Update: Partial<Signup>;
        Relationships: [];
      };
      checkins: {
        Row: Checkin;
        Insert: Partial<Checkin> & { signup_id: string; kind: CheckinKind };
        Update: Partial<Checkin>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_event_organizer: { Args: { p_event_id: string }; Returns: boolean };
      can_read_event: { Args: { p_event_id: string }; Returns: boolean };
      is_role_organizer: { Args: { p_role_id: string }; Returns: boolean };
      is_shift_organizer: { Args: { p_shift_id: string }; Returns: boolean };
      is_shift_public: { Args: { p_shift_id: string }; Returns: boolean };
      is_signup_volunteer: { Args: { p_signup_id: string }; Returns: boolean };
      is_signup_event_organizer: { Args: { p_signup_id: string }; Returns: boolean };
      can_view_profile: { Args: { p_profile_id: string }; Returns: boolean };
      /** Aggregate spot counts for a published event — one row per shift. */
      shift_signup_counts: {
        Args: { p_event_id: string };
        Returns: { shift_id: string; taken: number; standing_by: number }[];
      };
      /** Claims a spot, or joins standby when the shift is full. */
      sign_up_for_shift: {
        Args: { p_shift_id: string };
        Returns: SignupResult;
      };
      cancel_signup: {
        Args: { p_shift_id: string };
        Returns: SignupResult;
      };
      shift_hours_worked: {
        Args: { p_signup_id: string };
        Returns: number;
      };
      volunteer_total_hours: {
        Args: { p_volunteer_id: string };
        Returns: number;
      };
      validate_checkin_token: {
        Args: { p_event_id: string; p_token: string };
        Returns: ValidateCheckinTokenResult;
      };
      refresh_checkin_token: {
        Args: { p_event_id: string };
        Returns: RefreshCheckinTokenResult;
      };
      qr_scan_checkin: {
        Args: { p_event_id: string; p_token: string };
        Returns: QrScanCheckinResult;
      };
      organizer_set_checkout: {
        Args: { p_signup_id: string; p_checkout_at: string };
        Returns: OrganizerSetCheckoutResult;
      };
      verify_volunteer_certificate: {
        Args: { p_code: string };
        Returns: VerifyCertificateResult;
      };
    };
    Enums: {
      user_role: UserRole;
      signup_status: SignupStatus;
      checkin_kind: CheckinKind;
    };
    CompositeTypes: Record<string, never>;
  };
};
