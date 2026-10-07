# ShiftShare

**Staff your community event in minutes — and give every volunteer hours they can prove.**

ShiftShare is an end-to-end volunteer scheduling, QR check-in, and verified hours platform for school carnivals, food drives, library book fairs, and neighborhood cleanups. Organizers describe an event in one sentence to generate a gap-free shift plan, publish a shareable signup page, check volunteers in with a rotating QR code, and review Recharts analytics and AI recaps. Volunteers claim non-overlapping shifts, track hour milestones, and download a one-page PDF certificate with a public `/verify/[code]` verification link trusted by schools, colleges, and employers.

---

## What It Does

1. **One-Sentence AI Event Planner (`/events/new`)**
   - Asks up to 3 clarifying questions when details are missing.
   - Generates a complete staffing plan with roles, 30–90 minute shifts, headcounts, and a plain-English `why` per role.
   - Supports conversational chat editing with one-click **Undo**, AI gap-checking with **Apply fix**, and one-click publish copy (event description, role wear/bring notes, and SMS/WhatsApp/Slack announcement).
   - Learns from the organizer's past events (fill rates and no-shows) to right-size shift capacity automatically.
2. **Public Event Signup & Automatic Standby (`/events/[id]`)**
   - Publicly viewable without an account; volunteers log in only when claiming a shift and return straight to the same event page.
   - Prevents overlapping confirmed shifts at the database level (`claim_shift` RPC) and automatically promotes the first standby (`waitlist`) volunteer when a confirmed spot opens up (`cancel_shift` RPC).
3. **Rotating QR Check-In & Live Roster (`/checkin/[eventId]` & Organizer Dashboard)**
   - Encodes `/checkin/[eventId]?token=[signed token]` using the `qrcode` package, with **Refresh QR**, **Print poster**, **Full screen**, and a realtime **"Who's here"** roster.
   - Enforces a `[-30 min, +30 min]` check-in window around shift start, idempotent scans, server-side 2-decimal hour calculation from timestamps only, and organizer manual check-out flagged `"adjusted by organizer"`.
4. **Volunteer Dashboard, PDF Certificate & Public Verification (`/dashboard`, `/api/certificate`, `/verify/[code]`)**
   - Displays total verified hours, events volunteered at, reliability score (`shifts attended ÷ shifts signed up`), a `10 / 25 / 50 / 100` hour milestone progress bar, upcoming shifts with cancel buttons, and past events history.
   - Generates a one-page PDF certificate via `@react-pdf/renderer` (up to 15 events on 1 page) with a border, ShiftShare logo, clean serif heading, event table, total verified hours, date issued, unique verification code, and scannable QR code. Supports **Download Certificate**, **Download for one event**, and **Share Verified Profile**.
   - Public `/verify/[code]` page (no login required) shows the green **"Verified by ShiftShare"** status badge or a clear **"Invalid code"** state.
5. **Organizer Analytics Dashboard (`/dashboard`)**
   - Lists the organizer's events with fill rate, checked-in count, and no-show rate.
   - Event detail analytics powered by **Recharts**: signups over time, fill rate per role, attendance vs signups, and total volunteer hours contributed.
   - **Export CSV** of volunteers and verified hours, **Thank volunteers** (Claude-drafted personalized thank-you notes per volunteer based on role and hours, editable and copyable), and an AI **Event recap** card (3–4 sentence performance summary + 2 next-time suggestions).
6. **Instant Judge Demo Mode (`/login` → `"Try the demo"`)**
   - One-click **"Try the demo"** button on `/login` with no signup required, pre-loaded with 1 organizer (`Maya Lin`), 15 volunteers (`Carol Diaz`, `Marcus Vance`, `Priya Nair`, etc.), the 6-role / 33-shift **"Fall Carnival"** (with full shifts and standby volunteers), and completed past events with verified check-in/check-out records.

---

## Screenshots

| View | Screenshot Placeholder |
| :--- | :--- |
| **Landing Page & Certificate Preview** | `![Landing Page](./docs/screenshots/01-landing-page.png)` |
| **Login Page (`"Try the demo"`)** | `![Login & Try the Demo](./docs/screenshots/02-login-try-demo.png)` |
| **AI Event Planner (`/events/new`)** | `![AI Event Planner](./docs/screenshots/03-ai-event-planner.png)` |
| **Public Event Page — Fall Carnival (`/events/fall-carnival`)** | `![Fall Carnival Public Page](./docs/screenshots/04-fall-carnival-event.png)` |
| **Organizer Analytics & Recharts (`/dashboard`)** | `![Organizer Analytics Dashboard](./docs/screenshots/05-organizer-analytics.png)` |
| **Volunteer Dashboard & Milestones (`/dashboard`)** | `![Volunteer Dashboard](./docs/screenshots/06-volunteer-dashboard.png)` |
| **Public Certificate Verification (`/verify/[code]`)** | `![Public Verification](./docs/screenshots/07-public-verification.png)` |
| **QR Check-In Confirmation (`/checkin/[eventId]`)** | `![QR Check-In](./docs/screenshots/08-qr-checkin.png)` |

---

## Tech Stack

- **Framework:** Next.js 16.3 (App Router, Server Components, Server Actions, Route Handlers) & React 19
- **Language:** TypeScript 5.9 (strict mode)
- **Styling:** Tailwind CSS 4 with custom Carnival brand tokens (`#1B2A49` navy, `#FFC93C` accent gold, `#FF6B6B` coral, `#FAF8F3` cream, `#2EC4B6` mint) and self-hosted `Bricolage Grotesque` + `Inter` fonts
- **Database, Auth & Realtime:** Supabase (`@supabase/supabase-js`, `@supabase/ssr`) with PostgreSQL 17, Row-Level Security (RLS), atomic PL/pgSQL RPCs, and Realtime `postgres_changes` subscriptions
- **AI Integration:** Anthropic Claude (`@anthropic-ai/sdk`) isolated in a single server-side service (`src/lib/ai.ts`)
- **PDF & QR Generation:** `@react-pdf/renderer` (1-page Letter PDF certificates) and `qrcode` (SVG & PNG data URLs)
- **Analytics Charts:** `recharts` (`AreaChart` and `BarChart` in `ResponsiveContainer`)

---

## How AI Is Used

All Anthropic Claude API calls live in a single server-side service file (**`src/lib/ai.ts`**, re-exported at `lib/ai.ts`) with one dedicated function per task:

1. **`clarifyEventDetails(sentence)`** — Inspects a one-sentence event description and returns up to 3 concise clarifying questions if key staffing inputs (attendance, hours, or venue constraints) are missing.
2. **`generatePlan(options)`** — Generates a structured staffing plan (`title`, `roles` with `why`, and 30–90 minute `shifts` with `headcount`), incorporating `pastEventsSummary` so roles that historically had no-shows or 100% fill rates get buffered automatically. Runs deterministic coverage/duration validation (`validatePlan`) and self-heals via a corrective retry pass if needed.
3. **`editPlanWithChat(options)`** — Applies plain-English instructions (e.g., *"Add a cleanup crew at 3pm"* or *"We only have 15 volunteers"*) to the current plan and returns `{ plan, whatChanged }` with one-click Undo support.
4. **`checkPlanForGaps(options)`** — Audits a staffing plan for coverage gaps, bottlenecks, or missing setup/teardown buffers and returns up to 3 actionable warnings with one-click `fixPrompt` actions.
5. **`generatePublishCopy(options)`** — Drafts plain-language event descriptions, per-role wear/bring instructions, and a ready-to-paste SMS/WhatsApp/Slack group-chat announcement.
6. **`generateVolunteerThankYous(input)`** — Writes personalized thank-you messages for each volunteer on an event based on their specific role(s) and verified hours, which the organizer can edit and copy.
7. **`generateEventRecap(input)`** — Summarizes an event's real signup, check-in, no-show, and verified-hour metrics in 3–4 sentences and provides 2 concrete suggestions for next time.

**Safety, Reliability & Security Guardrails:**
- **Server-only API key:** `ANTHROPIC_API_KEY` is read exclusively on the server (`process.env.ANTHROPIC_API_KEY`) and is never exposed in client bundles or `NEXT_PUBLIC_*` variables.
- **Strict JSON parsing:** Every Claude response is parsed through `extractJson` + task-specific normalizers (`normalizePlan`, `normalizeClarifyResponse`, `normalizeChatEditResponse`, `normalizePlanCheckResponse`, `normalizePublishCopyResponse`, `normalizeThankYouMessages`, `normalizeEventRecap`) so malformed model output never crashes the UI.
- **Rate limiting & input length caps (`src/lib/rate-limit.ts`):** Sliding-window rate limiting (`checkRateLimit`, 30 req/min per user/IP returning `429 Too Many Requests` with `Retry-After`) and strict character/payload caps (`MAX_SENTENCE_LENGTH = 600`, `MAX_BODY_BYTES = 64 KB`, `MAX_VOLUNTEERS_PER_BATCH = 50`).
- **Deterministic fallback:** When `ANTHROPIC_API_KEY` is omitted in local/preview environments, all 7 functions fall back to deterministic server-side generators so every feature remains testable.

---

## Setup Steps

### 1. Clone and install dependencies
```bash
git clone <your-repo-url>
cd carnival-ui
npm install
```

### 2. Configure environment variables
```bash
cp .env.example .env.local
```
Fill in `.env.local` (see [Environment Variables](#environment-variables) below).

### 3. Apply database migrations & seed demo data
Apply the SQL migrations in `supabase/migrations/` in chronological order (`20261006120000_init.sql` through `20261006150000_verification_and_analytics.sql`), then seed the demo dataset:
```bash
# Generates supabase/seed.sql (and seeds live Supabase when SUPABASE_SERVICE_ROLE_KEY is set)
npm run seed
```
You can also paste `supabase/seed.sql` directly into the **Supabase SQL Editor** and click **Run**.

### 4. Run the development server
```bash
npm run dev
```
Open `http://localhost:3000`. Visit `http://localhost:3000/login` and click **"Try the demo"** to explore the Organizer and Volunteer dashboards immediately with no signup required.

### 5. Run tests, typecheck, and lint
```bash
npm test
npm run typecheck
npm run lint
npm run build
```

---

## Environment Variables

| Variable | Required | Scope | Description |
| :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (for live DB) | Public | Your Supabase project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (for live DB) | Public | Your Supabase `anon` public key (safe for browser; RLS enforces access) |
| `NEXT_PUBLIC_SITE_URL` | Yes (in prod) | Public | Canonical site origin (e.g., `https://your-app.vercel.app`) used for OAuth callbacks, QR check-in links, and `/verify/[code]` URLs |
| `ANTHROPIC_API_KEY` | Recommended | **Server-only** | Anthropic Claude API key (`sk-ant-...`). **Never** prefix with `NEXT_PUBLIC_`. |
| `ANTHROPIC_MODEL` | Optional | **Server-only** | Defaults to `claude-sonnet-4-20250514` |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | **Server-only** | Used only by `npm run seed` to create demo auth users via the Supabase Admin API |

---

## Step-by-Step Vercel Deployment Instructions

### 1. Push repository & import into Vercel
1. Push this project to a GitHub, GitLab, or Bitbucket repository.
2. In [Vercel](https://vercel.com/new), click **Add New… → Project** and import your repository.
3. Framework Preset will auto-detect **Next.js**. Keep the default build command (`next build`) and output directory (`.next`).

### 2. Set Environment Variables in Vercel
In **Project Settings → Environment Variables**, add the following for **Production**, **Preview**, and **Development**:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `<your-supabase-anon-key>`
- `NEXT_PUBLIC_SITE_URL` = `https://<your-vercel-domain>.vercel.app`
- `ANTHROPIC_API_KEY` = `sk-ant-...` *(keep server-only — never expose as `NEXT_PUBLIC_`)*

Click **Deploy**.

### 3. Configure Supabase Redirect URLs for Auth
In your [Supabase Dashboard](https://supabase.com/dashboard) → **Authentication → URL Configuration**:
1. Set **Site URL** to:
   ```text
   https://<your-vercel-domain>.vercel.app
   ```
2. Under **Redirect URLs**, add:
   ```text
   http://localhost:3000/auth/callback
   http://localhost:3000/**
   https://<your-vercel-domain>.vercel.app/auth/callback
   https://<your-vercel-domain>.vercel.app/**
   https://*-<your-vercel-team-slug>.vercel.app/**
   ```
3. Save changes.

### 4. Seed the Production Database
1. Open the **Supabase SQL Editor** in your project dashboard.
2. Run each migration file in `supabase/migrations/` in order (`20261006120000_init.sql` → `20261006150000_verification_and_analytics.sql`).
3. Paste the contents of `supabase/seed.sql` (or run `SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... npm run seed` locally) to populate the 1 organizer, 15 volunteers, 6-role / 33-shift **Fall Carnival**, and past completed events.
