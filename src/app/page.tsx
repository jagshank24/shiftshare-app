import type { Metadata } from "next";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { CertificateSection } from "@/components/landing/CertificateSection";
import { FinalCta } from "@/components/landing/FinalCta";

export const metadata: Metadata = {
  title: "ShiftShare — Staff your community event in minutes",
  description:
    "Describe your event in one sentence and get a staffing plan with shifts, times, and headcounts. Volunteers claim shifts from a link and keep verified hours.",
};

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main id="main-content">
        <Hero />
        <HowItWorks />
        <CertificateSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
