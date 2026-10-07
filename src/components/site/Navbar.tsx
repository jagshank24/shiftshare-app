"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/site/Logo";
import { CloseIcon, MenuIcon } from "@/components/site/icons";
import { buttonClasses } from "@/components/ui/Button";

const LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#certificate", label: "Hours you can prove" },
  { href: "/about", label: "About" },
  { href: "/#get-started", label: "Get started" },
];

/**
 * Sticky top bar. Solid (not translucent) so text stays readable over any
 * section, with a thin border that only appears once the page scrolls.
 */
export function Navbar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-navy-100 bg-cream-200/95 backdrop-blur supports-[backdrop-filter]:bg-cream-200/85">
      <div className="container-page">
        <div className="flex h-16 items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex min-h-tap items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            <Logo />
            <span className="sr-only">ShiftShare home</span>
          </Link>

          {/* Desktop nav */}
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="inline-flex min-h-tap items-center rounded-full px-3.5 text-sm font-medium text-navy-700 transition-colors duration-150 ease-smooth hover:bg-navy-900/5 hover:text-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <Link href="/login" className={buttonClasses({ variant: "ghost" })}>
              Log in
            </Link>
            <Link href="/signup" className={buttonClasses({ variant: "primary" })}>
              Sign up
            </Link>
          </div>

          {/* Mobile trigger */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            className="inline-flex size-11 items-center justify-center rounded-xl border-2 border-navy-200 text-navy-900 transition-colors duration-150 ease-smooth hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream lg:hidden"
          >
            {open ? <CloseIcon className="size-6" /> : <MenuIcon className="size-6" />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        hidden={!open}
        className="border-t border-navy-100 bg-cream-200 lg:hidden"
      >
        <nav aria-label="Mobile" className="container-page py-4">
          <ul className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block min-h-tap rounded-xl px-3 py-3 font-display text-base font-semibold text-navy-900 hover:bg-navy-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col gap-2 border-t border-navy-100 pt-4">
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className={buttonClasses({ variant: "outline", fullWidth: true })}
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => setOpen(false)}
              className={buttonClasses({ variant: "primary", fullWidth: true })}
            >
              Sign up
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
