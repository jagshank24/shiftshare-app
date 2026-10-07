import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/Badge";

/** Consistent section heading: optional eyebrow badge, title, one-line lede. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = "center",
  tone = "accent",
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: "center" | "left";
  tone?: "accent" | "mint" | "navy" | "coral";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      {eyebrow && (
        <Badge tone={tone} variant="soft">
          {eyebrow}
        </Badge>
      )}
      <h2 className="mt-4 text-display-sm text-navy-900 sm:text-display">
        {title}
      </h2>
      {lede && (
        <p className="mt-3 text-base text-navy-600 sm:text-lg">{lede}</p>
      )}
    </div>
  );
}
