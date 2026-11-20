import { createServerSupabase } from "@/lib/supabase/server";
import { queryOne } from "@/lib/db/sql";
import { preConsentUntil } from "@/lib/intake/retention";

/**
 * Wie de atleet is, los van welke intake hij open heeft staan.
 *
 * Tot nu toe was een atleet niets meer dan een cookie: een capability-token van
 * dertig dagen, geldig voor precies één intake. Dat werkt voor één invulsessie,
 * maar het thuisscherm uit het ontwerp toont eerdere intakes, en dan moet er
 * iets zijn dat zegt dat die drie dossiers van dezelfde persoon zijn. Een lijst
 * met medische dossiers achter een cookie is geen lijst die je wil bouwen.
 *
 * De koppeling bestond al in het schema: `athletes.profile_id` verwijst naar
 * `public.profiles`, en de RLS-policies athletes_select en intakes_select
 * gebruiken hem al. Er was alleen nog niets dat hem vulde.
 *
 * Een nieuwe aanmelding krijgt de rol 'athlete'. Dat is niet hetzelfde als de
 * coach-rol, en requireCoach() laat er dus niets door: dezelfde inlogmachinerie,
 * twee verschillende autorisaties.
 *
 * Wat de rol NIET doet is bepalen of iemand een atleet is. Dat zegt public.
 * athletes, via profile_id. Een behandelaar die zelf bij deze praktijk in
 * behandeling is, is allebei: staf in zijn rol, atleet in zijn dossier. Zie
 * roleAfterSignup() voor waarom een aanmelding die rol niet mag platwalsen.
 */

export interface AthleteIdentity {
  /** auth.users.id, tevens profiles.id. */
  userId: string;
  /** public.athletes.id. De medische kant hangt hieraan, niet aan de user. */
  athleteId: string;
  email: string | null;
  fullName: string | null;
  locale: "nl" | "en";
}

export async function currentAthlete(): Promise<AthleteIdentity | null> {
  const supabase = await createServerSupabase();

  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) return null;

  // Het filter op profile_id doet hier het werk dat RLS anders zou doen.
  const athlete = await queryOne<{
    id: string;
    full_name: string | null;
    email: string | null;
    locale: string | null;
  }>(
    `select id, full_name, email, locale from public.athletes
      where profile_id = $1 and deleted_at is null`,
    [auth.user.id],
  );

  if (!athlete) return null;

  return {
    userId: auth.user.id,
    athleteId: athlete.id,
    email: athlete.email ?? auth.user.email ?? null,
    fullName: athlete.full_name,
    locale: (athlete.locale as "nl" | "en" | null) ?? "en",
  };
}

/**
 * Zorgt dat er een profiel en een atleetrij bestaan voor de ingelogde gebruiker.
 *
 * Wordt aangeroepen na signUp. De client kan dit niet zelf: er is geen
 * insert-policy op `profiles` en `athletes_write` is alleen voor staf, dus dit
 * moet met de service role. Dat is ook waar het hoort, want de rol wordt hier
 * bepaald en niet door de client meegegeven.
 *
 * Idempotent: twee keer aanroepen levert geen tweede atleet op.
 */
export async function ensureAthleteForUser(input: {
  userId: string;
  email: string | null;
  fullName: string | null;
  locale: "nl" | "en";
}): Promise<AthleteIdentity> {
  // De rol staat alleen in de insert. Bestaat het profiel al, dan blijft de rol
  // wat hij was: een behandelaar die zelf in behandeling is, is allebei, en een
  // vaste 'athlete' zou hem stil zijn rechten afnemen, zonder fout en zonder
  // spoor buiten het audit-log. De atleetkant heeft die rol niet nodig:
  // currentAthlete() zoekt op profile_id.
  await queryOne(
    `insert into public.profiles (id, role, full_name, locale)
     values ($1, 'athlete', $2, $3)
     on conflict (id) do update set full_name = excluded.full_name, locale = excluded.locale`,
    [input.userId, input.fullName, input.locale],
  );

  const existing = await queryOne<{ id: string }>(
    "select id from public.athletes where profile_id = $1 and deleted_at is null",
    [input.userId],
  );

  if (existing) {
    return {
      userId: input.userId,
      athleteId: existing.id,
      email: input.email,
      fullName: input.fullName,
      locale: input.locale,
    };
  }

  // Retentie blijft hier bewust leeg. De databank staat dat alleen toe tussen
  // aanmaken en het geven van consent, en consent is de plek waar de termijn
  // wordt vastgelegd omdat het onderdeel is van waar iemand mee instemt.
  //
  // Voorlopige termijn, zie PRE_CONSENT_DAYS. recordAccountConsent overschrijft
  // hem in dezelfde aanvraag; blijft hij staan, dan is de aanmelding halverwege
  // gestrand en ruimt de retentiejob hem op.
  const created = await queryOne<{ id: string }>(
    `insert into public.athletes
       (profile_id, full_name, email, locale, retention_mode, retention_until)
     values ($1, $2, $3, $4, 'until_date', $5) returning id`,
    [input.userId, input.fullName, input.email, input.locale, preConsentUntil()],
  );
  if (!created) throw new Error("atleet aanmaken mislukt");

  return {
    userId: input.userId,
    athleteId: created.id,
    email: input.email,
    fullName: input.fullName,
    locale: input.locale,
  };
}
