import type { Metadata } from "next";
import localFont from "next/font/local";
import { Alexandria } from "next/font/google";
import "./globals.css";
import { CLINIC, REVIEW_SUMMARY } from "@/lib/constants";

const playfair = localFont({
  src: "./fonts/PlayfairDisplay-Variable.woff2",
  variable: "--font-playfair",
  display: "swap",
  weight: "400 700",
});

const inter = localFont({
  src: "./fonts/Inter-Variable.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "400 700",
});

// Arabic typography — Alexandria for everything, swapped in via CSS (see
// globals.css `html[lang="ar"]`) once Arabic is the active language,
// alongside the Playfair/Inter pair above used for English.
const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  variable: "--font-alexandria",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://elanstudio.example.com"),
  title: {
    default: "Èlan Studio | Modern Dentistry",
    template: "%s | Èlan Studio",
  },
  description:
    "Modern, personalized dental care designed around your comfort and confidence.",
  keywords: [
    "dental clinic",
    "modern dentistry",
    "cosmetic dentistry",
    "luxury dental care",
    "Èlan Studio",
  ],
  openGraph: {
    title: "Èlan Studio | Modern Dentistry",
    description:
      "Modern, personalized dental care designed around your comfort and confidence.",
    siteName: "Èlan Studio",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Èlan Studio | Modern Dentistry",
    description:
      "Modern, personalized dental care designed around your comfort and confidence.",
  },
};

/** Dentist structured data (demo). Helps search engines understand the clinic. */
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Dentist",
  name: CLINIC.name,
  description:
    "Modern, personalized dental care designed around your comfort and confidence.",
  url: "https://elanstudio.example.com",
  telephone: CLINIC.phone,
  email: CLINIC.email,
  priceRange: "$$",
  address: {
    "@type": "PostalAddress",
    addressLocality: "New Cairo",
    addressCountry: "EG",
  },
  openingHoursSpecification: [
    {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [
        "Saturday",
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
      ],
      opens: "10:00",
      closes: "21:00",
    },
  ],
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: REVIEW_SUMMARY.rating,
    reviewCount: 300,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable} ${alexandria.variable}`}>
      <head>
        {/*
         * Preload critical 3D model and above-the-fold image assets
         */}
        <link
          rel="preload"
          as="fetch"
          href="/models/tooth.glb"
          crossOrigin="anonymous"
        />
        <link rel="preload" as="image" href="/images/doctor.png" />
        <link rel="preload" as="image" href="/images/featured_makeover.png" />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes onto <body> before hydration — this only silences that
          body-level attribute mismatch, not real mismatches in the tree. */}
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
