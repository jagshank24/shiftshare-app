import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { focusRing, focusRingDanger } from "@/lib/focus";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "success"
  | "outline"
  | "ghost";

export type ButtonSize = "sm" | "md" | "lg" | "icon";

const base =
  "inline-flex items-center justify-center gap-2 font-display font-semibold whitespace-nowrap select-none " +
  "rounded-full transition-[transform,background-color,box-shadow,border-color,color] duration-150 ease-smooth " +
  "active:translate-y-px disabled:pointer-events-none " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

const sizes: Record<ButtonSize, string> = {
  // Mobile-first: `md` is the default and hits the 44px tap-target minimum.
  sm: "min-h-tap px-3.5 text-sm gap-1.5",
  md: "min-h-tap h-11 px-5 text-base",
  lg: "h-13 px-7 text-lg",
  icon: "h-11 w-11 p-0",
};

const variants: Record<ButtonVariant, string> = {
  // Warm yellow ticket — the main call to action. Navy ink = 8.8:1 contrast.
  primary: "bg-accent-500 text-navy-900 shadow-pop hover:bg-accent-400",
  // Deep navy — strong secondary action.
  secondary: "bg-navy-900 text-cream-200 shadow-sm hover:bg-navy-800 hover:shadow-md",
  // Coral red for destructive actions. Uses the darker coral-700 so white
  // text clears AA (5.0:1); coral-500 is reserved for tints and alerts.
  danger: "bg-coral-700 text-cream-50 shadow-sm hover:bg-coral-800",
  // Mint for confirmations.
  success: "bg-mint-500 text-navy-900 shadow-sm hover:bg-mint-400",
  // Quiet but tappable.
  outline: "border-2 border-navy-900 bg-transparent text-navy-900 hover:bg-navy-900/5",
  ghost: "bg-transparent text-navy-900 hover:bg-navy-900/8",
};

const focusByVariant: Record<ButtonVariant, string> = {
  primary: focusRing,
  secondary: focusRing,
  danger: focusRingDanger,
  success: focusRing,
  outline: focusRing,
  ghost: focusRing,
};

export interface ButtonProps
  extends React.ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the width of the parent — handy on mobile. */
  fullWidth?: boolean;
  /** Shows a spinner, disables the button, and announces the busy state. */
  loading?: boolean;
  /** Screen-reader label while loading. */
  loadingLabel?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

/**
 * Compose the button's classes outside of React, e.g. to style a `<Link>`
 * that should look identical to a `<Button>`.
 */
export function buttonClasses(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}) {
  const { variant = "primary", size = "md", fullWidth, className } = options;
  return cn(
    base,
    sizes[size],
    variants[variant],
    focusByVariant[variant],
    fullWidth && "w-full",
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      fullWidth = false,
      loading = false,
      loadingLabel = "Loading",
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      type = "button",
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    // A busy button stays fully legible and announces itself; it is blocked
    // with pointer-events rather than the dimmed "disabled" look. A genuinely
    // disabled button does dim. (Literals, so Tailwind's scanner sees them.)
    const stateClasses = loading
      ? "pointer-events-none"
      : "disabled:opacity-50 disabled:shadow-none";

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={buttonClasses({
          variant,
          size,
          fullWidth,
          className: cn(stateClasses, className),
        })}
        {...props}
      >
        {loading ? (
          <Spinner className="size-4 shrink-0" />
        ) : (
          leftIcon && (
            <span className="shrink-0 [&>svg]:size-4" aria-hidden="true">
              {leftIcon}
            </span>
          )
        )}

        {children}

        {!loading && rightIcon && (
          <span className="shrink-0 [&>svg]:size-4" aria-hidden="true">
            {rightIcon}
          </span>
        )}

        {loading && <span className="sr-only">{loadingLabel}</span>}
      </button>
    );
  },
);

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
