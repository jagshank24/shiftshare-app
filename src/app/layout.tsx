import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const siteOrigin =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
  "https://shiftshare.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: "ShiftShare — Community volunteer shifts and verified hours",
    template: "%s · ShiftShare",
  },
  description:
    "Describe your community event in one sentence, publish a volunteer shift signup link, verify attendance via QR check-in, and issue publicly verifiable hours certificates.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: ["/icon.svg"],
    apple: [{ url: "/icon.svg" }],
  },
  openGraph: {
    type: "website",
    siteName: "ShiftShare",
    title: "ShiftShare — Community volunteer shifts and verified hours",
    description:
      "Describe your event in one sentence, let volunteers claim shifts, and issue QR-verified hours certificates with public verification.",
    url: "/",
    images: [
      {
        url: "/og-image.svg",
        width: 1200,
        height: 630,
        alt: "ShiftShare — Staff your community event in minutes and issue verified volunteer hour certificates",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ShiftShare — Community volunteer shifts and verified hours",
    description:
      "Describe your event in one sentence, let volunteers claim shifts, and issue QR-verified hours certificates.",
    images: ["/og-image.svg"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF8F3",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="font-sans antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-xl focus:border-2 focus:border-navy focus:bg-accent focus:px-4 focus:py-2.5 focus:font-display focus:text-sm focus:font-bold focus:text-navy-900 focus:shadow-md"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
