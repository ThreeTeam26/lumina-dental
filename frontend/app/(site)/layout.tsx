import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { SmoothScroll } from "@/components/providers/SmoothScroll";

/**
 * English/Arabic toggle for the public marketing site — scoped to this
 * route group so /booking (outside it) and /admin (its own provider
 * instance) are untouched. Layout stays LTR in both languages: the GSAP
 * scroll choreography and 3D hero aren't safe to mirror.
 *
 * Lenis smooth-scroll is scoped here too (not the root layout) — the marketing
 * pages' GSAP scroll animations rely on it, but /booking and /admin want plain
 * native scrolling, which feels far more responsive on a data-heavy dashboard.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider storageKey="lumina_site_locale" enableRtl={false}>
      <SmoothScroll>{children}</SmoothScroll>
    </LanguageProvider>
  );
}
