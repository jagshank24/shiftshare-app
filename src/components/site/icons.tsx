/**
 * Small inline icon set. Every icon is a currentColor SVG sized by the parent
 * (or by `className`), and always decorative — the meaning is in the text next
 * to it, so they're `aria-hidden`.
 */
type IconProps = React.ComponentPropsWithoutRef<"svg">;

function Base({ className, children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4.5 10.5 8 14l7.5-8" />
    </Base>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 10h11.5M11 5.5 15.5 10 11 14.5" />
    </Base>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="7" y="7" width="9" height="9" rx="2.5" />
      <path d="M13 4.5H6.5A2 2 0 0 0 4.5 6.5V13" />
    </Base>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 1.5" />
    </Base>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="5" width="13" height="11" rx="2.5" />
      <path d="M3.5 8.5h13M7 3.5v3M13 3.5v3" />
    </Base>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 16.5s5-4.2 5-8a5 5 0 1 0-10 0c0 3.8 5 8 5 8Z" />
      <circle cx="10" cy="8.5" r="1.8" />
    </Base>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />
    </Base>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </Base>
  );
}
