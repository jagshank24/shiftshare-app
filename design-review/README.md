# Design review artifacts

Evidence that the tokens and components behave as documented. These files are
not part of the app — delete the folder whenever you like.

| File                   | What it is                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `contrast-report.txt`  | WCAG contrast audit of every color pairing used in the components.          |
| `contrast.py`          | The audit script (stdlib only — `python3 design-review/contrast.py`).       |
| `preview-desktop.png`  | Full-page render at 1440px.                                                |
| `preview-mobile.png`   | Full-page render at 390×844 (mobile-first check).                          |
| `focus-ring.png`       | Keyboard focus ring on the primary button, cropped close-up.               |
| `after-fixes.png`      | Full-page 1100px render after the loading-state and focus fixes.            |
| `buttons-row.png`      | Crop of the button row: default / loading / disabled states side by side.  |

## How the renders were produced

They come from a throwaway route (`src/app/preview-harness/page.tsx`) that
exercised every variant, then screenshotted with Playwright's CLI:

```bash
npx playwright@latest screenshot --full-page --viewport-size="390,844" \
  --wait-for-timeout=3000 http://localhost:3000/<route> out.png
```

That route has been deleted, which is why the app now renders only the branded
404. Re-create it whenever you want a visual smoke test — it's ~150 lines of
component usage and costs nothing at runtime.

## What was checked

**Contrast** — 16 required pairings all pass (see `contrast-report.txt`).
The three "FAIL" lines at the bottom are informational: those are the raw
brand chroma values (`#FFC93C`, `#FF6B6B`, `#2EC4B6`) measured against the cream
background. They are never used as text-on-cream — they're fills, and they're
always paired with navy ink or a darker shade of their own hue.

**Focus** — with the browser in keyboard modality, `:focus-visible` matched and
produced a real ring on all five button variants and both input states:

```
Primary button    focus-visible=true  → cream 0 0 0 2px + navy 0 0 0 4px
Secondary button  focus-visible=true  → cream 0 0 0 2px + navy 0 0 0 4px
Danger button     focus-visible=true  → cream 0 0 0 2px + coral-700 0 0 0 4px
Outline button    focus-visible=true  → cream 0 0 0 2px + navy 0 0 0 4px
Ghost button      focus-visible=true  → cream 0 0 0 2px + navy 0 0 0 4px
Text input        focus-visible=true  → wrapper border navy-900 + 4px navy/20 ring
Error input       focus-visible=true  → wrapper border coral-600 + 4px coral/30 ring
```

A mouse click produces `focus-visible=false`, so tapping a button never flashes
a ring — but every keyboard interaction does.

**States & sizing**

```
Get tickets button   height 44px   (min tap target ✅)
Medium button        height 44px
Large button         height 52px
Icon button          44 × 44px
Small button         height 36px   (desktop-only size, by design)
Disabled button      disabled=true, no ring, 50% opacity
Loading button       aria-busy="true", spinner visible, opacity 1 (stays legible,
                     blocked via pointer-events instead of disabled styling)
```

**Fonts** — the production CSS contains
`font-family: var(--font-display), var(--font-sans), …` and
`font-family: var(--font-sans), …`, resolving to Bricolage Grotesque and Inter;
the `<html>` element carries both `next/font` variable classes. Both faces are
self-hosted in the build output — no runtime request to Google Fonts.

**Build health**

```
npx tsc --noEmit   → clean
npm run lint       → clean (eslint-config-next flat config, no FlatCompat shim)
npm run build      → compiled successfully
npm ci && build    → reproduces from the lockfile
```
