import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Saira_Semi_Condensed, Source_Sans_3 } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

/**
 * Drie sneden, elk met een taak.
 *
 * Overgenomen uit de bestaande performancerapporten van de praktijk; ze stonden
 * letterlijk in die PDF's. Tot nu toe laadde de app geen enkel lettertype en
 * stond alles in de systeemstapel, wat betekent dat een rapport er op een Mac
 * anders uitzag dan op Windows en op papier weer anders.
 *
 *   Saira SemiCondensed  koppen. Smal, dus een lange testnaam past op een regel.
 *   Source Sans 3        lopende tekst en bevindingen.
 *   IBM Plex Mono        tabelkoppen, cijferkolommen en de voetregel. Een
 *                        monospace is hier geen stijlkeuze: kolommen met
 *                        meetwaarden horen onder elkaar uit te lijnen.
 *
 * next/font host ze mee in de build, dus er gaat geen verzoek naar Google en
 * de afdruk hangt niet af van wat de printer toevallig heeft.
 */
const saira = Saira_Semi_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--ff-display",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--ff-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--ff-mono",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");

  return {
    title: t("title"),
    description: t("description"),
    // Geen indexering: de intake is per definitie niet publiek vindbaar.
    robots: { index: false, follow: false },
  };
}

/**
 * De schermen zijn mobile-first, dus de viewport moet kloppen.
 *
 * Geen maximum-scale en geen user-scalable=no: dat sloopt pinch-zoom, en op een
 * scherm waar iemand een diagnose of een pijnschaal moet nalezen is inzoomen
 * geen luxe. interactiveWidget zorgt dat het toetsenbord de invoerbalk omhoog
 * duwt in plaats van eroverheen te schuiven.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

/**
 * De provider staat hier en niet per pagina, omdat clientcomponenten diep in de
 * boom zitten (het chatscherm, het coachdossier) en die allemaal bij dezelfde
 * berichten moeten kunnen. `lang` volgt dezelfde taal: een schermlezer die de
 * verkeerde taal aanneemt spreekt Nederlandse namen als Engelse woorden uit.
 */
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${saira.variable} ${sourceSans.variable} ${plexMono.variable}`}
    >
      <body className="antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
