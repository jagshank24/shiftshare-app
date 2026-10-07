import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

export type InputSize = "sm" | "md" | "lg";

const wrapperSizes: Record<InputSize, string> = {
  sm: "h-10 gap-2 rounded-lg px-3 text-sm",
  md: "min-h-tap h-11 gap-2.5 rounded-xl px-3.5 text-base",
  lg: "h-13 gap-3 rounded-2xl px-4 text-lg",
};

export interface InputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "size"> {
  label?: React.ReactNode;
  /** Helper text shown under the field. Hidden while an error is present. */
  hint?: React.ReactNode;
  /** Error message. Also switches the field to its alert styling. */
  error?: string;
  size?: InputSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** Classes for the outer wrapper (not the input itself). */
  containerClassName?: string;
}

/**
 * Text input with label, hint and error states.
 *
 * The wrapper owns the border and the focus ring so icons align cleanly and
 * keyboard focus is unmistakable, while the inner `<input>` is transparent.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    size = "md",
    leftIcon,
    rightIcon,
    className,
    containerClassName,
    id,
    required,
    disabled,
    "aria-describedby": ariaDescribedBy,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const hasError = Boolean(error);

  const describedBy =
    [ariaDescribedBy, hasError ? errorId : hintId].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex w-full flex-col gap-1.5", containerClassName)}>
      {label && (
        <label
          htmlFor={inputId}
          className="font-display text-sm font-semibold text-navy-900"
        >
          {label}
          {required && (
            <span className="ml-1 text-coral-600" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div
        className={cn(
          // Border + focus treatment live on the wrapper.
          "flex w-full items-center border-2 bg-surface transition-colors duration-150 ease-smooth",
          "focus-within:ring-4",
          hasError
            ? "border-coral-500 bg-coral-50 focus-within:border-coral-600 focus-within:ring-coral-500/30"
            : "border-navy-100 focus-within:border-navy-900 focus-within:ring-navy-900/20",
          disabled && "cursor-not-allowed bg-cream-300 opacity-70",
          wrapperSizes[size],
        )}
      >
        {leftIcon && (
          <span
            className={cn(
              "shrink-0 [&>svg]:size-5",
              hasError ? "text-coral-700" : "text-navy-600",
            )}
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}

        <input
          ref={ref}
          id={inputId}
          required={required}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={cn(
            // `focus-visible:outline-none` hands focus styling to the wrapper.
            "w-full min-w-0 bg-transparent py-2 text-navy-900 outline-none",
            "focus-visible:outline-none",
            "placeholder:text-navy-500 disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        />

        {rightIcon && (
          <span
            className={cn(
              "shrink-0 [&>svg]:size-5",
              hasError ? "text-coral-700" : "text-navy-600",
            )}
            aria-hidden="true"
          >
            {rightIcon}
          </span>
        )}
      </div>

      {hasError ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1.5 text-sm font-medium text-coral-700"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-4 shrink-0"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-11.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6.5Zm0 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              clipRule="evenodd"
            />
          </svg>
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="text-sm text-navy-600">
            {hint}
          </p>
        )
      )}
    </div>
  );
});
