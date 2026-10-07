/**
 * Sample staffing plans for the landing-page demo.
 *
 * These are hardcoded placeholders — the real product builds a plan from the
 * event sentence. Swap this file for an API call and `DemoBox` keeps working.
 */

export type PlanShift = {
  role: string;
  time: string;
  spots: number;
  /** Short, specific flag like "early start" or "fills fast". */
  note?: string;
};

export type SamplePlan = {
  id: string;
  title: string;
  where: string;
  when: string;
  total: number;
  /** Vanity path shown for the signup link. */
  slug: string;
  shifts: PlanShift[];
};

export const SAMPLE_PLANS: SamplePlan[] = [
  {
    id: "food-drive",
    title: "Saturday food drive",
    where: "Fremont Community Kitchen",
    when: "Sat, Oct 10 · 9:00am – 1:00pm",
    total: 12,
    slug: "fremont-food-drive",
    shifts: [
      { role: "Setup: tables and signs", time: "8:00 – 9:30am", spots: 3, note: "early start" },
      { role: "Check-in table", time: "9:00 – 11:00am", spots: 3 },
      { role: "Packing line", time: "9:30am – 1:00pm", spots: 4, note: "fills fast" },
      { role: "Cleanup", time: "12:30 – 1:30pm", spots: 2 },
    ],
  },
  {
    id: "5k",
    title: "Bay Trail 5K",
    where: "Quarry Lakes Regional Park",
    when: "Sun, Nov 2 · 7:30 – 11:30am",
    total: 18,
    slug: "bay-trail-5k",
    shifts: [
      { role: "Course setup", time: "6:30 – 8:00am", spots: 4, note: "early start" },
      { role: "Registration tent", time: "7:00 – 9:30am", spots: 5 },
      { role: "Water station, mile 2", time: "7:30 – 10:30am", spots: 6 },
      { role: "Finish line and timing", time: "9:00 – 11:30am", spots: 3 },
    ],
  },
  {
    id: "carnival",
    title: "Fall carnival",
    where: "Centerville Elementary",
    when: "Fri, Oct 24 · 3:00 – 8:00pm",
    total: 24,
    slug: "centerville-fall-carnival",
    shifts: [
      { role: "Booth setup", time: "1:30 – 3:30pm", spots: 6 },
      { role: "Ticket booth", time: "3:00 – 6:00pm", spots: 4, note: "needs cash box" },
      { role: "Game booths", time: "3:30 – 7:30pm", spots: 10, note: "fills fast" },
      { role: "Teardown", time: "7:30 – 9:00pm", spots: 4 },
    ],
  },
];

export const DEFAULT_PLAN = SAMPLE_PLANS[0];

/** Example sentences shown as one-tap chips under the input. */
export const EXAMPLE_SENTENCES = [
  {
    label: "Food drive",
    text: "Saturday food drive at the Fremont library, 9am to 1pm, need 12 people.",
    planId: "food-drive",
  },
  {
    label: "5K race",
    text: "Bay Trail 5K on Sunday morning, 18 volunteers from 6:30 to 11:30am.",
    planId: "5k",
  },
  {
    label: "School carnival",
    text: "Fall carnival at Centerville Elementary on Friday, 3pm to 8pm, 24 helpers.",
    planId: "carnival",
  },
] as const;

/** Pick a sample plan from whatever the person typed. Defaults to the food drive. */
export function pickPlan(text: string): SamplePlan {
  const t = text.toLowerCase();

  if (/\b5k\b|\brace\b|\brun\b|\bmarathon\b|\bwalk\b|\bwater station\b/.test(t)) {
    return SAMPLE_PLANS[1];
  }
  if (/\bcarnival\b|\bfair\b|\bfestival\b|\bbooth\b|\bfundraiser\b|\bhalloween\b/.test(t)) {
    return SAMPLE_PLANS[2];
  }
  return DEFAULT_PLAN;
}
