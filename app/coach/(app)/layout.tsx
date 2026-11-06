import { getTranslations } from "next-intl/server";
import { CoachNav } from "@/components/coach/CoachNav";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * De schil om de coachschermen.
 *
 * Een routegroep en geen app/coach/layout.tsx, want twee schermen horen er
 * juist niet in te zitten. Het inlogscherm is donker en paginavullend, en een
 * navigatiebalk met "Atleten · Bibliotheek" boven een inlogformulier belooft
 * iemand die nog niet binnen is dingen die hij niet kan openen. Dat scherm
 * staat daarom buiten de groep.
 *
 * De afdrukpagina zit er wel in: op het scherm is de balk daar bruikbaar, en op
 * papier haalt no-print hem eraf. Zonder die klasse zou hij meeprinten, want
 * het printblok in globals.css spaart alles wat .report bevat, en dat is dan
 * ook deze wikkel.
 *
 * De container stond vijf keer letterlijk in de pagina's. Hier staat hij een
 * keer.
 */
export default async function CoachLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations("titles");
  const tl = await getTranslations("library");
  const tc = await getTranslations("coach");

  return (
    <>
      <CoachNav
        practice={PRACTICE_NAME}
        items={[
          { href: "/coach", label: t("athletes") },
          { href: "/coach/library", label: tl("title") },
        ]}
        intake={
          process.env.NEXT_PUBLIC_INTAKE_URL
            ? { href: `${process.env.NEXT_PUBLIC_INTAKE_URL}/coach`, label: t("intake") }
            : null
        }
        signOut={tc("signOut")}
      />
      {/* De inhoud ligt als een witte kaart op het canvas van body. Op de
          <main> zelf en niet in een div eronder: het printblok reset deze
          wikkel al via main:has(.report), en een tweede laag zou daar
          opnieuw uitgezet moeten worden. */}
      <main className="mx-auto my-6 max-w-5xl rounded-card border border-hairline bg-surface px-5 py-7 shadow-card sm:my-8 sm:px-8">
        {children}
      </main>
    </>
  );
}
