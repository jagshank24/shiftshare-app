"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/supabase/database.types";

const OPTIONS: {
  value: UserRole;
  title: string;
  body: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "organizer",
    title: "I'm organizing",
    body: "I have an event to staff and volunteers to schedule.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
        <path d="M8 15h3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    value: "volunteer",
    title: "I'm volunteering",
    body: "I want to find shifts and keep track of my hours.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
      </svg>
    ),
  },
];

/**
 * Organizer / volunteer picker. Native radios under the hood, so it works
 * before hydration, is reachable by keyboard, and submits with the form.
 */
export function RoleSelector({
  name = "role",
  defaultRole,
  className,
}: {
  name?: string;
  defaultRole?: UserRole;
  className?: string;
}) {
  const [selected, setSelected] = useState<UserRole | undefined>(defaultRole);

  return (
    <fieldset className={cn("space-y-2", className)}>
      <legend className="font-display text-sm font-semibold text-navy-900">
        What brings you here?
      </legend>

      <div className="grid gap-2.5">
        {OPTIONS.map((option) => {
          const isSelected = selected === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "relative flex cursor-pointer gap-3 rounded-2xl border-2 p-3.5 transition-colors duration-150 ease-smooth",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-navy has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-cream",
                isSelected
                  ? "border-navy-900 bg-accent-50"
                  : "border-navy-100 bg-surface hover:border-navy-200",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={isSelected}
                onChange={() => setSelected(option.value)}
                className="sr-only"
              />
              <span
                className={cn(
                  "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl [&>svg]:size-5",
                  isSelected
                    ? "bg-navy-900 text-accent-500"
                    : "bg-cream-300 text-navy-600",
                )}
              >
                {option.icon}
              </span>
              <span className="min-w-0">
                <span className="block font-display font-bold text-navy-900">
                  {option.title}
                </span>
                <span className="mt-0.5 block text-sm text-navy-600">
                  {option.body}
                </span>
              </span>
              {isSelected && (
                <span className="absolute top-3 right-3 grid size-5 place-items-center rounded-full bg-navy-900 text-accent-500">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M4.5 10.5 8 14l7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
