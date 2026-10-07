import { cn } from "@/lib/utils";

/** The ShiftShare mark: a navy tile with two shifting arrows. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8 shrink-0", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" className="fill-navy-900" />
      <path
        d="M9 12.5h11.5l-3.2-3.2"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-accent-500"
      />
      <path
        d="M23 19.5H11.5l3.2 3.2"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-accent-500"
      />
    </svg>
  );
}

export function Logo({
  className,
  wordmarkClassName,
  inverse = false,
}: {
  className?: string;
  wordmarkClassName?: string;
  inverse?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span
        className={cn(
          "font-display text-lg font-bold tracking-tight",
          inverse ? "text-cream-200" : "text-navy-900",
          wordmarkClassName,
        )}
      >
        ShiftShare
      </span>
    </span>
  );
}
