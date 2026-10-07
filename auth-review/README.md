# Auth screens review

Screenshots of `/login` and `/signup`, captured against a dev server running
with **dummy** Supabase credentials. That's why the error strip reads
`fetch failed`: the forms talk to `https://dummy-project-ref.supabase.co`, which
doesn't exist. It's a useful failure to look at — it shows validation passing
and the request path actually running.

| File                  | What it shows                                                  |
| --------------------- | -------------------------------------------------------------- |
| `signup.png`          | Signup with everything filled and the volunteer role selected. |
| `login.png`           | Login: Google button, divider, email form.                     |
| `role-focus.png`      | Keyboard focus on the organizer/volunteer radio card.          |

## What was checked

| Check                            | Result                                                     |
| -------------------------------- | ---------------------------------------------------------- |
| `/dashboard` while signed out     | `307` → `/login?next=%2Fdashboard`                          |
| `/dashboard` without credentials  | `200`, renders the "Not connected yet" setup steps          |
| `/login`, `/signup`               | `200`, forms render in both states                          |
| Submit with nothing filled in     | "Tell us your name so organizers know who's coming."        |
| Password too short                | "Use at least 8 characters for your password."              |
| No role selected                  | "Choose whether you're organizing or volunteering."         |
| Valid data                        | validation passes → Supabase call attempted → error shown   |
| Values after a failed submit      | email and name are preserved in the fields                  |
| Password field                    | `autocomplete="new-password"` on signup, `current-password` on login |
| Role radios                       | 2 native radios, keyboard focus visible, submits with the form |
| Hydration warnings across pages   | none                                                        |
| `pageerror` during the run        | none                                                        |
