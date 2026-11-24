import { deleteAccount } from "@/lib/auth/accounts";

/**
 * Het inlogaccount van de atleet verwijderen.
 *
 * Als laatste stap, en met het profiel-id uit het manifest. De richting doet
 * ertoe: `athletes.profile_id` is `on delete set null` en `profiles.id` is
 * `on delete cascade` naar public.accounts. Wie eerst het account verwijdert,
 * verliest de koppeling naar de atleet die daarna nog opgeruimd moet worden.
 *
 * Blijft dit achterwege, dan houdt iemand een inlog die naar een leeg huis
 * leidt: hij kan aanmelden, en er is geen dossier, geen intake en geen
 * toestemming meer. Dat is geen verwijdering maar een half verwijderde persoon.
 * Sessies en eenmalige links gaan mee (cascade).
 */
export async function purgeAuthUser(profileId: string | null): Promise<{
  userDeleted: boolean;
}> {
  if (!profileId) return { userDeleted: false };
  return { userDeleted: await deleteAccount(profileId) };
}
