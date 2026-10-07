import { Badge } from "@/components/ui/Badge";
import { CheckIcon } from "@/components/site/icons";
import { cn } from "@/lib/utils";

/**
 * A preview of the hours certificate a volunteer can download after an event.
 * Real markup, no screenshot — it stays sharp at any size and prints cleanly.
 */
export function CertificatePreview({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div
        className="relative overflow-hidden rounded-3xl border-2 border-navy-900 bg-surface p-5 shadow-lg sm:p-8"
        role="img"
        aria-label="Sample certificate: Maya Chen volunteered 12 hours with Harbor Cleanup Day on March 14, 2026, verified by Jordan Ellis, event organizer, certificate SH-2291."
      >
        {/* Ticket notches */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 -left-3 size-6 -translate-y-1/2 rounded-full border-2 border-navy-900 bg-cream-200"
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 -right-3 size-6 -translate-y-1/2 rounded-full border-2 border-navy-900 bg-cream-200"
        />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-navy-900">
              <span className="font-display text-sm font-bold text-accent-500">
                SS
              </span>
            </span>
            <span className="font-display text-sm font-bold tracking-wide text-navy-600 uppercase">
              ShiftShare
            </span>
          </div>
          <Badge tone="mint" variant="soft" dot>
            Hours verified
          </Badge>
        </div>

        <hr className="my-5 border-dashed border-navy-200 sm:my-6" />

        <p className="font-display text-xs font-bold tracking-[0.18em] text-navy-600 uppercase">
          Certificate of service
        </p>

        <p className="mt-3 text-sm text-navy-600">This certifies that</p>
        <p className="font-display text-3xl font-bold text-navy-900 sm:text-4xl">
          Maya Chen
        </p>
        <p className="mt-2 max-w-sm text-sm text-navy-600">
          completed <strong className="text-navy-900">12 volunteer hours</strong>{" "}
          with Harbor Cleanup Day on March 14, 2026, checked in and out by the
          event organizer and signed off by Maya.
        </p>

        <dl className="mt-6 grid gap-4 border-t border-navy-100 pt-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              Verified by
            </dt>
            <dd className="mt-1 font-display text-lg font-bold text-navy-900">
              Jordan Ellis
            </dd>
            <dd className="text-sm text-navy-600">
              Event organizer · Harbor Cleanup Day
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              Signed off
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-navy-900">
              <span className="grid size-5 place-items-center rounded-full bg-mint-500 text-navy-900">
                <CheckIcon className="size-3.5" strokeWidth="2.6" />
              </span>
              Maya Chen · Mar 15, 2026
            </dd>
            <dd className="mt-1 text-sm text-navy-600">
              Certificate ID SH-2291
            </dd>
          </div>
        </dl>
      </div>

      <p className="mt-3 text-center text-sm text-navy-600 sm:text-left">
        Sample certificate. Yours carries the same details, with your event and
        your hours.
      </p>
    </div>
  );
}
