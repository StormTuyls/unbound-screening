import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Zet `lib/screening/afkapwaarden.ts` klaar voordat er gebouwd wordt.
 *
 * De echte afkapwaarden staan met opzet niet in git: het zijn de klinische
 * grenswaarden van de praktijk. Daardoor viel elke build vanaf git om op
 * `Cannot find module './afkapwaarden'`, want `library.ts` importeert hem en
 * tsc eist dat de module bestaat. De CLI stuurde het bestand wel mee omdat die
 * de map uploadt zoals hij op schijf staat, dus deployen werkte alleen vanaf
 * deze laptop. Dat is geen houdbare opzet voor een app die in productie draait.
 *
 * Vandaar deze stap, die npm zelf voor `build` draait. Drie gevallen, in deze
 * volgorde:
 *
 *   1. Het bestand staat er al. Dat is een ontwikkelmachine. Niets doen, want
 *      overschrijven met een oudere versie uit de omgeving is erger dan niets.
 *   2. AFKAPWAARDEN_B64 staat in de omgeving. Dat is Vercel. Decoderen en
 *      wegschrijven.
 *   3. Geen van beide. Het voorbeeld kopiëren, met een waarschuwing. De build
 *      slaagt dan, en `ECHT` staat op false zodat library.ts, de tests en de
 *      seed weten dat ze naar verzonnen getallen kijken.
 *
 * Geval 3 is bewust geen fout. Een preview of een verse kloon moet kunnen
 * bouwen zonder de klinische data, en het is de seed die ze in de databank zet,
 * niet de build. Wie per ongeluk zonder secret naar productie bouwt, ziet het
 * aan AFKAPWAARDEN_AANWEZIG en niet aan een stille verkeerde classificatie.
 */

const here = dirname(fileURLToPath(import.meta.url));
const doel = join(here, "..", "lib", "screening", "afkapwaarden.ts");
const voorbeeld = join(here, "..", "lib", "screening", "afkapwaarden.voorbeeld.ts");

if (existsSync(doel)) {
  console.log("afkapwaarden: het bestand staat er al, niets gedaan");
} else if (process.env.AFKAPWAARDEN_B64) {
  const inhoud = Buffer.from(process.env.AFKAPWAARDEN_B64, "base64").toString("utf8");

  // Een lege of afgekapte variabele levert anders een bestand op dat niet
  // compileert, en dan wijst de foutmelding naar de verkeerde oorzaak.
  if (!inhoud.includes("export const PARTS")) {
    throw new Error("AFKAPWAARDEN_B64 bevat geen bruikbaar afkapwaardenbestand");
  }

  writeFileSync(doel, inhoud);
  console.log(`afkapwaarden: uit AFKAPWAARDEN_B64 geschreven, ${inhoud.length} tekens`);
} else {
  writeFileSync(doel, readFileSync(voorbeeld));
  console.warn(
    "afkapwaarden: geen AFKAPWAARDEN_B64, het voorbeeld gekopieerd. " +
      "Deze build draait op verzonnen getallen.",
  );
}
