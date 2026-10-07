import { cn } from "@/lib/utils";

export type BadgeTone = "accent" | "mint" | "coral" | "navy" | "neutral";
export type BadgeVariant = "soft" | "solid" | "outline";
export type BadgeSize = "sm" | "md";

/** Soft tint: light fill + dark same-hue text (AA on both ends). */
const soft: Record<BadgeTone, string> = {
  accent: "bg-accent-100 text-accent-900",
  mint: "bg-mint-100 text-mint-800",
  coral: "bg-coral-100 text-coral-800",
  navy: "bg-navy-100 text-navy-800",
  neutral: "bg-cream-300 text-navy-700",
};

/** Solid fill: bright colors keep navy ink, dark colors take cream ink. */
const solid: Record<BadgeTone, string> = {
  accent: "bg-accent-500 text-navy-900",
  mint: "bg-mint-500 text-navy-900",
  coral: "bg-coral-700 text-cream-50",
  navy: "bg-navy-900 text-cream-200",
  neutral: "bg-navy-100 text-navy-900",
};

const outline: Record<BadgeTone, string> = {
  accent: "border-accent-700 text-accent-900",
  mint: "border-mint-700 text-mint-800",
  coral: "border-coral-700 text-coral-800",
  navy: "border-navy-400 text-navy-800",
  neutral: "border-navy-300 text-navy-600",
};

const dotColor: Record<BadgeTone, string> = {
  accent: "bg-accent-500",
  mint: "bg-mint-600",
  coral: "bg-coral-600",
  navy: "bg-navy-900",
  neutral: "bg-navy-400",
};

const variants: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft,
  solid,
  outline,
};

const sizes: Record<BadgeSize, string> = {
  sm: "gap-1 px-2.5 py-0.5 text-xs",
  md: "gap-1.5 px-2.5 py-1 text-xs",
};

export interface BadgeProps extends React.ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Small leading dot — good for statuses like "live" or "sold out". */
  dot?: boolean;
}

/**
 * Compact status / label pill. Purely decorative by default; add a
 * visually-hidden prefix if the color carries meaning.
 */
export function Badge({
  tone = "accent",
  variant = "soft",
  size = "md",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full font-display font-semibold tracking-wide",
        variant === "outline" && "border-2 bg-transparent",
        variants[variant][tone],
        sizes[size],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", dotColor[tone])}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
