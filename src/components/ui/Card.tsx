import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "@/lib/focus";

export type CardVariant =
  | "default"
  | "elevated"
  | "outline"
  | "tinted"
  | "inverse"
  | "interactive";

export type CardPadding = "none" | "sm" | "md" | "lg";

const paddings: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5 sm:p-6",
  lg: "p-6 sm:p-8",
};

const variants: Record<CardVariant, string> = {
  default: "bg-surface border border-navy-100 shadow-sm",
  elevated: "bg-surface border border-navy-100/70 shadow-lg",
  outline: "bg-transparent border-2 border-navy-100",
  tinted: "bg-accent-50 border border-accent-200",
  inverse: "on-dark bg-navy-900 border border-navy-800 text-cream-200",
  // Adds hover/focus affordances — use when the whole card is clickable.
  interactive:
    "bg-surface border border-navy-100 shadow-sm cursor-pointer transition duration-150 ease-smooth hover:-translate-y-0.5 hover:shadow-md hover:border-navy-200",
};

export interface CardProps extends React.ComponentPropsWithoutRef<"div"> {
  variant?: CardVariant;
  padding?: CardPadding;
  /** Render as a different element, e.g. `as="a"` or `as="article"`. */
  as?: React.ElementType;
}

/**
 * Surface container. Children pick up inverse text colors automatically
 * because the card marks itself with `data-variant` and a named group.
 */
export function Card({
  variant = "default",
  padding = "md",
  as: Component = "div",
  className,
  ...props
}: CardProps) {
  return (
    <Component
      data-variant={variant}
      className={cn(
        "group/card rounded-2xl",
        variants[variant],
        paddings[padding],
        variant === "interactive" && focusRing,
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Places an action on the right on wider screens, stacks on mobile. */
  actions?: React.ReactNode;
}

export function CardHeader({
  actions,
  className,
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-1">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface CardTitleProps extends React.ComponentPropsWithoutRef<"h3"> {
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "div" | "span";
}

export function CardTitle({
  as: Component = "h3",
  className,
  ...props
}: CardTitleProps) {
  return (
    <Component
      className={cn(
        "font-display text-lg font-bold text-navy-900 group-data-[variant=inverse]/card:text-cream-200 sm:text-xl",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"p">) {
  return (
    <p
      className={cn(
        "text-sm leading-relaxed text-navy-600 group-data-[variant=inverse]/card:text-navy-200",
        className,
      )}
      {...props}
    />
  );
}

export type CardContentProps = React.ComponentPropsWithoutRef<"div">;

export function CardContent({ className, ...props }: CardContentProps) {
  return (
    <div
      className={cn(
        "[&:not(:first-child)]:mt-4 group-data-[variant=inverse]/card:text-cream-200",
        className,
      )}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 [&:not(:first-child)]:mt-5 sm:flex-row sm:items-center sm:gap-3",
        className,
      )}
      {...props}
    />
  );
}

export interface CardMediaProps extends React.ComponentPropsWithoutRef<"div"> {
  /** Aspect ratio for the media slot. */
  ratio?: "video" | "square" | "wide";
}

const ratios = {
  video: "aspect-video",
  square: "aspect-square",
  wide: "aspect-[3/1]",
} as const;

/**
 * Media slot for images/video. Sits inside the card's padding and clips its
 * content; pass an `<img>`/`<Image>` as the child.
 */
export const CardMedia = forwardRef<HTMLDivElement, CardMediaProps>(
  function CardMedia({ ratio = "video", className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden rounded-xl bg-cream-300",
          ratios[ratio],
          "[&>img]:size-full [&>img]:object-cover [&>video]:size-full [&>video]:object-cover",
          className,
        )}
        {...props}
      />
    );
  },
);
