import { Badge } from "@/components/ui/Badge";

const STEPS = [
  {
    text: "Create a project at supabase.com and copy its URL and anon key.",
    code: null,
  },
  {
    text: "Add them to your environment:",
    code: "cp .env.example .env.local",
  },
  {
    text: "Run the migration (SQL editor, or `supabase db push`):",
    code: "supabase/migrations/20261006120000_init.sql",
  },
  {
    text: "Restart the dev server — NEXT_PUBLIC_ values are baked in at build time.",
    code: null,
  },
];

/**
 * Shown in place of the auth screens when the Supabase env vars are missing.
 * The alternative would be a stack trace, which tells you nothing.
 */
export function AuthNotConfigured() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-navy-200 bg-cream-100 p-5">
      <Badge tone="coral" variant="soft">
        Not connected yet
      </Badge>
      <h2 className="mt-3 font-display text-lg font-bold text-navy-900">
        Supabase isn&apos;t configured
      </h2>
      <p className="mt-1.5 text-sm text-navy-600">
        This screen is ready to go — it just needs a database behind it.
      </p>

      <ol className="mt-4 space-y-3">
        {STEPS.map((step, index) => (
          <li key={step.text} className="flex gap-3">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-navy-900 font-display text-xs font-bold text-accent-500">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-navy-700">{step.text}</p>
              {step.code && (
                <code className="mt-1.5 block truncate rounded-lg bg-cream-300 px-2.5 py-1.5 text-xs text-navy-800">
                  {step.code}
                </code>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
