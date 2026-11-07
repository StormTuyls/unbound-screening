import { redirect } from "next/navigation";

/**
 * De wortel.
 *
 * Er stond hier niets, en daardoor gaf het adres van de app een 404. /praktijk
 * beslist zelf of je naar het inlogscherm moet, dus deze pagina hoeft niet te
 * weten wie er aanbelt. Dat is ook de bedoeling: autoriseren gebeurt op de
 * pagina, niet in een doorverwijzing (zie proxy.ts).
 */
export default function RootPage() {
  redirect("/praktijk");
}
