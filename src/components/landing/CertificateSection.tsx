import { Badge } from "@/components/ui/Badge";
import { CheckIcon } from "@/components/site/icons";
import { SectionHeading } from "@/components/site/SectionHeading";
import { CertificatePreview } from "@/components/landing/CertificatePreview";

const DETAILS = [
  {
    title: "Checked in and out",
    body: "Hours come from taps at the start and end of a shift, not from a form someone fills out weeks later.",
  },
  {
    title: "Signed off by the organizer",
    body: "The person who ran the event confirms the hours. If something looks wrong, a volunteer can flag it and the organizer has seven days to fix it.",
  },
  {
    title: "Ready for wherever you need it",
    body: "National Honor Society, an internship application, community service hours for court or school. Download a PDF, print it, or send a link that anyone can open.",
  },
  {
    title: "Yours to keep",
    body: "Hours stay in your account after the event ends, so a full year of Saturdays is one download.",
  },
];

export function CertificateSection() {
  return (
    <section id="certificate" className="scroll-mt-20">
      <div className="container-page grid gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Hours you can prove"
            tone="mint"
            title="A certificate that isn't just your word"
            lede="Volunteers finish a shift, hours are recorded, and the certificate is ready. No emailing an organizer for a signature three weeks later."
          />

          <dl className="mt-8 space-y-5">
            {DETAILS.map((detail) => (
              <div key={detail.title} className="flex gap-3.5">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-mint-500 text-navy-900">
                  <CheckIcon className="size-4" strokeWidth="2.6" />
                </span>
                <div>
                  <dt className="font-display font-bold text-navy-900">
                    {detail.title}
                  </dt>
                  <dd className="mt-1 text-navy-600">{detail.body}</dd>
                </div>
              </div>
            ))}
          </dl>

          <Badge tone="neutral" variant="outline" className="mt-8">
            Certificate IDs are unique and checkable
          </Badge>
        </div>

        <CertificatePreview className="mx-auto w-full max-w-md lg:max-w-none" />
      </div>
    </section>
  );
}
