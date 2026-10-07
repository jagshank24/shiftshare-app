import Link from "next/link";
import { Logo } from "@/components/site/Logo";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#certificate", label: "Hours you can prove" },
      { href: "/about", label: "About ShiftShare" },
      { href: "/signup", label: "Sign up" },
      { href: "/login", label: "Log in" },
    ],
  },
  {
    heading: "For organizers",
    links: [
      { href: "#how-it-works", label: "Post an event" },
      { href: "/signup", label: "Fill your shifts" },
      { href: "#certificate", label: "Verify hours" },
    ],
  },
  {
    heading: "For volunteers",
    links: [
      { href: "#how-it-works", label: "Find an event" },
      { href: "#how-it-works", label: "Pick a shift" },
      { href: "#certificate", label: "Download your certificate" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="on-dark bg-navy-900 text-cream-200">
      <div className="container-page py-12 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo inverse />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-navy-200">
              ShiftShare is a scheduling tool for food drives, races, festivals
              and school events. You write one sentence, volunteers claim
              shifts, everyone gets hours they can point to.
            </p>
          </div>

          <div className="grid gap-8 sm:grid-cols-3">
            {COLUMNS.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className="font-display text-sm font-bold tracking-wide text-accent-500 uppercase">
                  {column.heading}
                </h2>
                <ul className="mt-3 space-y-1">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="inline-flex min-h-tap items-center text-sm text-navy-200 underline-offset-4 transition-colors duration-150 ease-smooth hover:text-cream-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-navy-800 pt-6 text-sm text-navy-200 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 ShiftShare. Built in Fremont, California.</p>
          <p>
            Questions?{" "}
            <a
              href="mailto:hello@shiftshare.app"
              className="rounded text-cream-200 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
            >
              hello@shiftshare.app
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
