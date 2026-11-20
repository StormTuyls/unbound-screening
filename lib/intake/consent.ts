import { query, queryOne, transaction } from "@/lib/db/sql";
import { retentionConfig, retentionUntil } from "@/lib/intake/retention";
import type { Locale } from "@/lib/i18n/locale";

/**
 * De consentregistratie, op twee niveaus.
 *
 * Accountniveau (intake_id null) dekt het verwerken van gezondheidsgegevens en
 * de bewaartermijn. Dat is waar de atleet bij het aanmaken van zijn account mee
 * instemt, en het geldt zolang het account bestaat. Het bij elke nieuwe intake
 * opnieuw vragen maakt het register niet sterker, alleen langer, en het leert de
 * atleet vinkjes wegklikken.
 *
 * Intakeniveau (intake_id gevuld) dekt het delen van een samenvatting met een
 * behandelaar. Dat hoort wel per intake: het gaat over dit dossier, en het is de
 * poort waar lib/notion/sync.ts op staat.
 */

export const CONSENT_VERSION = "2026-09-07";

export const ACCOUNT_PURPOSES = ["medical_processing", "retention_acknowledged"] as const;
export const INTAKE_PURPOSES = ["share_with_practitioners"] as const;

export interface ConsentContext {
  ip: string | null;
  userAgent: string | null;
  /**
   * De taal waarin de tekst op het scherm stond.
   *
   * Uit het cookie, want dat is wat rendert. Niet uit `athletes.locale` of
   * `intakes.locale`: het eerste is een voorkeur die morgen anders kan staan,
   * het tweede is de taal van het gesprek en niet van het vinkje. Eén versie
   * bestaat in twee talen, dus zonder dit kan het register niet zeggen welke
   * zin iemand gelezen heeft.
   */
  locale: Locale;
}

export function consentContext(request: Request, locale: Locale): ConsentContext {
  return {
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
    locale,
  };
}

/**
 * De accountconsent vastleggen en de bewaartermijn definitief maken.
 *
 * De termijn hoort hier omdat hij onderdeel is van waar de atleet mee instemt.
 * Tot dit moment staat er een korte einddatum op de atleet, zodat een account
 * dat nooit iets doet opruimt; hierna geldt wat er in de consenttekst stond.
 */
export async function recordAccountConsent(input: {
  athleteId: string;
  context: ConsentContext;
}): Promise<void> {
  const purposes = Object.fromEntries(ACCOUNT_PURPOSES.map((key) => [key, true]));
  const alreadyGiven = await hasAccountConsent(input.athleteId);

  // Eén bron voor de termijn, zie lib/intake/retention.ts: de tekst die de
  // atleet las en de datum die hier wordt opgeslagen moeten hetzelfde zeggen.
  const config = retentionConfig();
  const indefinite = config.mode === "indefinite";

  // Toestemming en termijn samen of niet: een toestemming zonder termijn laat
  // de voorlopige termijn van bij het aanmelden staan, en dan ruimt de
  // retentiejob een atleet op die wel instemde.
  await transaction(async (run) => {
    if (!alreadyGiven) {
      // De unieke index is partieel (where intake_id is null). Met dezelfde
      // WHERE in de ON CONFLICT vangt Postgres een gelijktijdige tweede
      // aanmelding zelf op: stond er al, dan is dat het gewenste eindresultaat.
      await run(
        `insert into public.consents
           (athlete_id, intake_id, consent_version, purposes, ip, user_agent, locale)
         values ($1, null, $2, $3::jsonb, $4::inet, $5, $6)
         on conflict (athlete_id, consent_version) where intake_id is null do nothing`,
        [
          input.athleteId,
          CONSENT_VERSION,
          JSON.stringify(purposes),
          input.context.ip,
          input.context.userAgent,
          input.context.locale,
        ],
      );
    }
    await run(
      `update public.athletes
          set retention_mode = $2, retention_until = $3, retention_basis = $4
        where id = $1`,
      [input.athleteId, config.mode, retentionUntil(), indefinite ? config.basis : null],
    );
  });
}

/** Heeft deze atleet toestemming op accountniveau gegeven? */
export async function hasAccountConsent(athleteId: string): Promise<boolean> {
  const row = await queryOne(
    `select 1 from public.consents
      where athlete_id = $1 and intake_id is null and withdrawn_at is null
      limit 1`,
    [athleteId],
  );
  return row !== null;
}

/**
 * De keuze om een samenvatting met een behandelaar te delen, voor één intake.
 *
 * Wordt gevraagd bij het indienen en niet bij het starten: dat is het moment
 * waarop het dossier naar de coach gaat, en dus het moment waarop de vraag
 * ergens over gaat. Een optionele toestemming vooraf vragen levert een vinkje
 * op waar niemand over nadenkt.
 */
export async function recordSharingChoice(input: {
  athleteId: string;
  intakeId: string;
  share: boolean;
  context: ConsentContext;
}): Promise<void> {
  await query(
    `insert into public.consents
       (athlete_id, intake_id, consent_version, purposes, ip, user_agent, locale)
     values ($1, $2, $3, $4::jsonb, $5::inet, $6, $7)`,
    [
      input.athleteId,
      input.intakeId,
      CONSENT_VERSION,
      JSON.stringify({ share_with_practitioners: input.share }),
      input.context.ip,
      input.context.userAgent,
      input.context.locale,
    ],
  );
}
