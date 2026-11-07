import { redirect } from "next/navigation";
import { currentCoach } from "@/lib/review/access";
import { currentAthlete } from "@/lib/athlete/identity";

export const dynamic = "force-dynamic";

/**
 * De voordeur.
 *
 * Stuurt door op wie er is en niet op wat iemand intypt: een behandelaar naar
 * de werklijst, een atleet naar zijn eigen metingen, en wie niemand is naar het
 * aanmeldscherm. Dezelfde volgorde als app/page.tsx in athlete-intake, en om
 * dezelfde reden: eerst de behandelaar, want die heeft geen `athletes`-rij en
 * zou anders op het atleetpad belanden.
 *
 * Hier stond `redirect("/praktijk")`. Dat klopte zolang alleen behandelaars
 * binnenkwamen. Sinds een atleet zijn eigen metingen kan openen is een vaste
 * bestemming hier precies de deur die voor de helft van de bezoekers op slot
 * zit, met een 404 erachter.
 *
 * Wie niet is ingelogd komt op het praktijkscherm uit, en dat is geen
 * vergissing: aanmelden als atleet gebeurt in de intake, en dat scherm wijst
 * daar al naartoe.
 */
export default async function RootPage() {
  const coach = await currentCoach();
  if (coach) redirect("/praktijk");

  const athlete = await currentAthlete();
  if (athlete) redirect("/metingen");

  redirect("/praktijk/login");
}
