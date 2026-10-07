# Landing page checks

Automated, in headless Chromium against `next dev` on `localhost:3000`.

## Demo box

| Input                                                    | Result                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| Chip: "School carnival"                                   | input filled, plan → **Fall carnival**, 24 spots, 4 rows |
| Typed: "Bay Trail 5K on Sunday morning, 18 volunteers…"    | plan → **Bay Trail 5K**, Quarry Lakes Regional Park  |
| Typed: "Neighborhood park cleanup next month"              | no keyword match → default **Saturday food drive**   |
| Copy button (clipboard allowed)                            | clipboard = `https://shiftshare.app/e/fremont-food-drive`, label → "Link copied" |
| Copy button (clipboard blocked)                            | link text selected, label → "Copy the selected link", coral hint shown |

The keyword matcher lives in `src/lib/sample-plans.ts` (`pickPlan`) and the 700ms
delay is deliberate, so the reveal reads as work rather than a content swap.
`aria-live` announces the new plan name to screen readers, and the loading state
renders skeleton rows instead of jumping.

## Sections and navigation

| Check                       | Result                                                        |
| --------------------------- | ------------------------------------------------------------- |
| Sticky navbar               | `y = 0` after scrolling 2000px, 65px tall                      |
| `#how-it-works` anchor      | lands 160px from top, `location.hash` updates                  |
| `#certificate` anchor       | lands 160px from top (scroll-mt-20 clears the 65px navbar)      |
| `#get-started` anchor       | lands 160px from top                                           |
| Role tabs (click)           | "I'm volunteering" → first step becomes "Open the link and pick a shift" |
| Role tabs (ArrowRight)      | selection advances to the volunteer tab and focus follows       |
| Keyboard focus in navbar    | "Log in" reports `:focus-visible = true`                        |
| Console errors              | none                                                            |

## Responsive

No horizontal overflow at any breakpoint (measured `scrollWidth` vs
`clientWidth`):

```
375px ok · 390px ok · 640px ok · 768px ok · 1024px ok · 1280px ok · 1440px ok
```

The decorative `blur-3xl` glow circles extend past the viewport edge as
intended; they are `pointer-events-none` and don't create a scrollbar.

Two fixes came out of this pass:

- **Nav breakpoint moved `md` → `lg`.** At 768px the desktop links wrapped
  ("Hours you can prove" onto two lines) and crowded the logo. Tablets now get
  the hamburger menu, which has room to breathe.
- **Navbar CTAs went from `size="sm"` (36px) to default (44px)**, so the two
  most important links on the page meet the tap-target minimum. The demo chips
  went 30px → 36px and the copy button 36px → 44px for the same reason.

Known sub-44px controls, all deliberate:

- Inline text links in the CTA paragraph and footer (`copy a past event`,
  `hello@shiftshare.app`) are inline flow content, not buttons.
- The mobile "Log in" footer link is a narrow-but-44px-tall text link.
