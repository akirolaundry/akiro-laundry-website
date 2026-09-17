// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { Geist }          from "next/font/google";
import { Analytics }      from "@vercel/analytics/next";
import { cn }             from "@/lib/utils";
import { SessionProvider } from "@/components/shared/SessionProvider";
import { Toaster }        from "@/components/ui/sonner";
import { getSeoSettings } from "@/lib/db/queries/cms.queries";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// ── Dynamic metadata from CMS ─────────────────────────────────────────────────
export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoSettings();

  const title       = seo?.siteTitle       ?? "Akiro Laundry & Perfume";
  const description = seo?.metaDescription ?? "Premium laundry service in Timor-Leste. Open every day 08:00–20:00.";
  const keywords    = seo?.metaKeywords    ?? undefined;
  const canonical   = seo?.canonicalUrl    ?? undefined;
  const ogImage     = seo?.ogImageUrl      ?? undefined;
  const robotsIndex = seo?.robotsIndex     ?? true;
  const robotsFollow= seo?.robotsFollow    ?? true;

  return {
    title: {
      default:  title,
      template: seo?.titleTemplate ?? "%s | Akiro Laundry",
    },
    description,
    keywords:    keywords ? keywords.split(",").map((k) => k.trim()) : undefined,
    metadataBase: canonical ? new URL(canonical) : undefined,
    alternates:  canonical ? { canonical } : undefined,

    openGraph: {
      type:        (seo?.ogType as "website") ?? "website",
      locale:      seo?.ogLocale ?? "pt_TL",
      siteName:    title,
      title:       seo?.ogTitle       ?? title,
      description: seo?.ogDescription ?? description,
      images:      ogImage ? [{ url: ogImage, alt: seo?.ogImageAlt ?? title, width: 1200, height: 630 }] : undefined,
    },

    twitter: {
      card:    (seo?.twitterCard as "summary_large_image") ?? "summary_large_image",
      site:    seo?.twitterSite    ?? undefined,
      creator: seo?.twitterCreator ?? undefined,
      title:   seo?.ogTitle        ?? title,
      description: seo?.ogDescription ?? description,
      images:  ogImage ? [ogImage] : undefined,
    },

    robots: {
      index:  robotsIndex,
      follow: robotsFollow,
      googleBot: { index: robotsIndex, follow: robotsFollow },
    },

    verification: seo?.googleVerification
      ? { google: seo.googleVerification }
      : undefined,

    other: seo?.fbAppId ? { "fb:app_id": seo.fbAppId } : undefined,
  };
}

// ── Layout ────────────────────────────────────────────────────────────────────
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const seo = await getSeoSettings();

  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />

        {/* JSON-LD structured data */}
        {seo?.jsonLd && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: seo.jsonLd }}
          />
        )}

        {/* Custom head scripts (analytics, tag manager, etc.) */}
        {seo?.headScripts && (
          <div dangerouslySetInnerHTML={{ __html: seo.headScripts }} />
        )}
      </head>
      <body suppressHydrationWarning>
        <SessionProvider>{children}</SessionProvider>
        <Toaster position="bottom-right" richColors />
        <Analytics />
      </body>
    </html>
  );
}