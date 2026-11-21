import { loadEnv } from "./env";
loadEnv();

import { randomBytes } from "node:crypto";
import { adminTransaction, closeAdmin } from "./adminDb";

/**
 * Maakt een behandelaar aan.
 *
 * Er is geen zelfregistratie, en dat is de bedoeling: wie het dossier van een
 * atleet mag lezen, wordt door de praktijk aangewezen en niet door wie het
 * formulier vindt. Daarom is dit een script en geen pagina.
 *
 * Account en profiel samen, in één transactie: zonder profiel kan iemand
 * inloggen en ziet hij niets, want requireCoach() leest de rol uit profiles.
 *
 * Het wachtwoord wordt hier gezet en één keer afgedrukt. Bestaat het account al,
 * dan zet dit script het wachtwoord opnieuw: de herstelmail vraagt een werkende
 * SMTP, en dit is de weg voor wie er helemaal niet meer in komt.
 *
 * Het vakgebied bepaalt of deze behandelaar in de keuzelijst van een atleet
 * verschijnt (public.profiles.practitioner_kind). Het staat los van de rol: de
 * rol zegt wat iemand mag, het vakgebied wat hij doet. Laat je het weg, dan
 * kan hij wel inloggen en dossiers nakijken, maar kiest niemand hem.
 *
 * Sinds er een teamscherm is (/praktijk/team) is dit script niet meer de enige
 * weg: een admin maakt daar collega's aan. Het blijft bestaan voor twee dingen
 * die geen scherm horen te hebben. Het eerste is de bootstrap, want het
 * teamscherm vraagt een admin en die moet ergens vandaan komen; een pagina die
 * zichzelf bootstrapt maakt van de eerste bezoeker een beheerder. Het tweede is
 * een wachtwoord opnieuw zetten voor wie er helemaal niet meer in komt.
 *
 * Gebruik: npm run coach:create -- naam@praktijk.be "Volledige Naam" physio|coach [wachtwoord] [--admin]
 */
function generatePassword(): string {
  // Leesbaar genoeg om over te typen, lang genoeg om niet te raden. Geen
  // tekens die in een terminal of een mail verminkt raken.
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function main() {
  const args = process.argv.slice(2);
  const asAdmin = args.includes("--admin");
  const [email, fullName, kind, given] = args.filter((arg) => arg !== "--admin");
  if (!email) {
    throw new Error(
      'gebruik: npm run coach:create -- e-mail "Volledige Naam" physio|coach [wachtwoord]',
    );
  }

  if (kind !== undefined && kind !== "physio" && kind !== "coach") {
    throw new Error(`onbekend vakgebied '${kind}': kies physio of coach`);
  }

  const password = given ?? generatePassword();
  if (password.length < 12) {
    throw new Error("wachtwoord moet minstens 12 tekens zijn");
  }

  // Zelfde hash als de app, zodat dit wachtwoord meteen werkt.
  const { hashPassword } = await import("../lib/auth/password");
  const passwordHash = await hashPassword(password);
  const address = email.trim().toLowerCase();

  const userId = await adminTransaction(async (run) => {
    const [account] = await run<{ id: string; created: boolean }>(
      `insert into public.accounts (email, password_hash) values ($1, $2)
       on conflict (email) do update set password_hash = excluded.password_hash
       returning id, (xmax = 0) as created`,
      [address, passwordHash],
    );
    if (!account.created) console.log("account bestond al: rol en wachtwoord bijgewerkt");

    await run(
      `insert into public.profiles (id, role, full_name, locale, practitioner_kind)
       values ($1, $2, $3, 'nl', $4)
       on conflict (id) do update
         set role = excluded.role, full_name = excluded.full_name,
             practitioner_kind = excluded.practitioner_kind`,
      [account.id, asAdmin ? "admin" : "coach", fullName ?? null, kind ?? null],
    );
    // Wie hier een nieuw wachtwoord krijgt, ligt er overal elders uit.
    await run("delete from public.sessions where account_id = $1", [account.id]);
    return account.id;
  });

  console.log(`${asAdmin ? "admin" : "coach"} klaar: ${email} (${userId})`);
  console.log(
    kind
      ? `vakgebied: ${kind}, dus kiesbaar op het profiel van een atleet`
      : "geen vakgebied meegegeven: verschijnt niet in de keuzelijst van een atleet",
  );
  console.log(`wachtwoord: ${password}`);
  console.log(
    asAdmin
      ? "inloggen via /praktijk/login. Deze mag het team beheren op /praktijk/team."
      : "inloggen via /praktijk/login. Dit wachtwoord staat hier één keer.",
  );
  await closeAdmin();
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
