import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Medische data: geen bronmaps in productiebundels.
  productionBrowserSourceMaps: false,

  // De dev-indicator is een overlay in een hoek, en op een scherm van 375 breed
  // zit in elke hoek een knop: linksonder document toevoegen, rechtsonder
  // versturen, boven de terugknop en de voortgangsring. Verplaatsen schuift het
  // probleem dus alleen op. Uit betekent niet blind: compile- en runtimefouten
  // komen nog steeds in de terminal en de console.
  devIndicators: false,

  /**
   * De oude /coach-paden.
   *
   * Dit pad botste met de intake: beide apps hadden /coach, /coach/login en
   * een pagina onder /coach/athletes/<id>. Op twee domeinen merkt niemand dat,
   * achter één domein kan er maar één winnen. Deze helft heet daarom /praktijk,
   * en dat is ook wat de code al zei: overal "behandelaar", alleen de route
   * zei "coach".
   *
   * 307 en geen 308, dus omkeerbaar. De intake linkt hierheen met
   * NEXT_PUBLIC_SCREENING_URL + /coach/library, en zolang die link niet mee
   * verhuisd is houdt deze regel hem heel. Een blijvende redirect zou de
   * browser het oude pad laten onthouden, en deze pagina's staan toch op
   * noindex, dus er valt geen vindbaarheid mee te winnen.
   */
  async redirects() {
    return [
      { source: "/coach", destination: "/praktijk", permanent: false },
      { source: "/coach/:path*", destination: "/praktijk/:path*", permanent: false },
    ];
  },
};

/**
 * next-intl zonder [locale]-segment.
 *
 * De plugin doet één ding dat we nodig hebben: hij legt de alias
 * `next-intl/config` naar ./i18n/request.ts, zodat getTranslations en
 * NextIntlClientProvider weten waar de berichten staan. Geen middleware, geen
 * routing: de taal is hier een kolom en geen URL. Zie lib/i18n/locale.ts.
 */
export default createNextIntlPlugin()(nextConfig);
