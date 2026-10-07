"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { RoleSelector } from "@/components/auth/RoleSelector";
import { signInAction, signUpAction, type AuthFormState } from "@/app/(auth)/actions";
import type { UserRole } from "@/lib/supabase/database.types";

const initialState: AuthFormState = {};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} loadingLabel="Sending">
      {label}
    </Button>
  );
}

function FormMessage({ state }: { state: AuthFormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-xl border-2 border-coral-200 bg-coral-50 px-3.5 py-3 text-sm font-medium text-coral-800"
      >
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p
        role="status"
        className="rounded-xl border-2 border-mint-200 bg-mint-50 px-3.5 py-3 text-sm font-medium text-mint-800"
      >
        {state.notice}
      </p>
    );
  }
  return null;
}

export function SignInForm({ next = "/dashboard" }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      <FormMessage state={state} />

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        placeholder="you@example.com"
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Your password"
      />

      <SubmitButton label="Log in" />
    </form>
  );
}

export function SignUpForm({
  next = "/dashboard",
  defaultRole,
}: {
  next?: string;
  defaultRole?: UserRole;
}) {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="next" value={next} />

      <FormMessage state={state} />

      <RoleSelector defaultRole={defaultRole} />

      <Input
        label="Your name"
        name="fullName"
        autoComplete="name"
        required
        defaultValue={state.values?.fullName}
        placeholder="Maya Chen"
        hint="Organizers see this on their shift rosters."
      />

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.values?.email}
        placeholder="you@example.com"
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        placeholder="At least 8 characters"
        hint="Eight characters minimum. Longer is better than complicated."
      />

      <SubmitButton label="Create account" />
    </form>
  );
}
