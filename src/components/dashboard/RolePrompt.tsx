"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { RoleSelector } from "@/components/auth/RoleSelector";
import { setRoleAction, type AuthFormState } from "@/app/(auth)/actions";

const initialState: AuthFormState = {};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} loadingLabel="Saving">
      Save and continue
    </Button>
  );
}

/**
 * Shown when `profiles.role` is null — which is what happens for Google
 * sign-ups, since we can't ask before the redirect to Google.
 */
export function RolePrompt({ name }: { name?: string | null }) {
  const [state, formAction] = useActionState(setRoleAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <h2 className="font-display text-xl text-navy-900">
          One question{name ? `, ${name.split(" ")[0]}` : ""}
        </h2>
        <p className="mt-1.5 text-navy-600">
          Tell us how you&apos;ll mostly use ShiftShare. You can do both later,
          this just decides where we drop you first.
        </p>
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-coral-200 bg-coral-50 px-3.5 py-3 text-sm font-medium text-coral-800"
        >
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="text-sm font-medium text-mint-700">
          {state.notice}
        </p>
      )}

      <RoleSelector />

      <Submit />
    </form>
  );
}
