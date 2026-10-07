"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/Button";
import {
  cancelShiftSignupAction,
  signUpForShiftAction,
  type SignupActionResult,
} from "@/app/events/[id]/actions";

/**
 * The one-tap signup control on a shift.
 *
 * Which button to show is decided on the server (see `actionFor` in the page) —
 * this component only renders it and makes the call. Keeping the rules out of
 * the client means the page and the button can't disagree about whether a shift
 * is full.
 */
export type ShiftAction =
  | { kind: "login"; label: string }
  | { kind: "signup" }
  | { kind: "standby" }
  | { kind: "cancel" }
  | { kind: "leave_standby" }
  | { kind: "blocked"; reason: string };

export function ShiftActionControl({
  shiftId,
  slug,
  action,
}: {
  shiftId: string;
  slug: string;
  action: ShiftAction;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SignupActionResult | null>(null);

  const nextPath = `/events/${slug}`;
  const loginHref = `/login?next=${encodeURIComponent(nextPath)}`;

  function run(kind: "signup" | "cancel") {
    setResult(null);
    startTransition(async () => {
      const outcome =
        kind === "signup"
          ? await signUpForShiftAction(shiftId, slug)
          : await cancelShiftSignupAction(shiftId, slug);

      // A signed-out visitor gets sent to log in and straight back here.
      if (outcome.code === "unauthenticated") {
        router.push(loginHref);
        return;
      }

      setResult(outcome);
      // The list is now out of date — spots may have gone while this page sat
      // open, and someone else may have taken the one this volunteer wanted.
      router.refresh();
    });
  }

  const message = result && (
    <p
      role="status"
      aria-live="polite"
      className={
        result.ok
          ? "mt-2 text-sm font-medium text-mint-700"
          : "mt-2 text-sm font-medium text-coral-700"
      }
    >
      {result.message}
    </p>
  );

  if (action.kind === "login") {
    return (
      <div className="w-full sm:w-auto sm:text-right">
        <Link
          href={loginHref}
          className={buttonClasses({
            variant: "primary",
            className: "w-full sm:w-auto",
          })}
        >
          {action.label}
        </Link>
      </div>
    );
  }

  if (action.kind === "blocked") {
    return (
      <div className="w-full sm:w-auto sm:text-right">
        <Button variant="outline" disabled className="w-full sm:w-auto">
          Clashes with your shift
        </Button>
        {/* If they just tried and were refused, the server's answer is the more
            precise one — it knows about clashes this page couldn't see. */}
        {result ? (
          <p className="mt-2 text-sm font-medium text-coral-700">{result.message}</p>
        ) : (
          <p className="mt-2 text-sm text-navy-600">{action.reason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full sm:w-auto sm:text-right">
      {action.kind === "signup" && (
        <Button loading={pending} loadingLabel="Signing up" onClick={() => run("signup")} className="w-full sm:w-auto">
          Sign up
        </Button>
      )}

      {action.kind === "standby" && (
        <Button
          variant="secondary"
          loading={pending}
          loadingLabel="Joining standby"
          onClick={() => run("signup")}
          className="w-full sm:w-auto"
        >
          Join standby
        </Button>
      )}

      {action.kind === "cancel" && (
        <Button
          variant="outline"
          loading={pending}
          loadingLabel="Canceling"
          onClick={() => run("cancel")}
          className="w-full sm:w-auto"
        >
          Cancel my spot
        </Button>
      )}

      {action.kind === "leave_standby" && (
        <Button
          variant="outline"
          loading={pending}
          loadingLabel="Leaving standby"
          onClick={() => run("cancel")}
          className="w-full sm:w-auto"
        >
          Leave standby
        </Button>
      )}

      {message}
    </div>
  );
}
