/**
 * Shared focus treatments.
 *
 * Every interactive component must be reachable and obviously visible by
 * keyboard. Components that render their own ring use `outline-none` to
 * suppress the global fallback in globals.css, so these strings are the
 * single place where the ring look is defined.
 */

/** Default ring: navy ring with a cream offset — works on light surfaces. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

/** For components sitting on navy / dark surfaces. */
export const focusRingInverse =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900";

/** For destructive actions, so the ring agrees with the button color. */
export const focusRingDanger =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral-700 focus-visible:ring-offset-2 focus-visible:ring-offset-cream";

export const focusRingSuccess =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint-600 focus-visible:ring-offset-2 focus-visible:ring-offset-cream";
