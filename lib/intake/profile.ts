import { addProposals, getFieldDefinitions } from "@/lib/db/dossier";
import { enumLabel } from "@/lib/dossier/enumLabels";
import { isDeprecatedSport } from "@/lib/intake/sports";
import { PROFILE_COLUMNS, PROFILE_FIELDS } from "@/lib/intake/profileFields";
import { z } from "zod";
import { query, queryOne, transaction } from "@/lib/db/sql";

/**
 * Het profiel van de atleet: zijn eigen gegevens, en bij wie hij hoort.
 *
 * Twee dingen die geen intake-eigenschap zijn. Een adres verandert niet per
 * dossier, en de behandelaar die je toegewezen krijgt ook niet. Ze horen dus bij
 * de persoon in `public.athletes`, naast naam en telefoon, en niet in de
 * taxonomie.
 *
 * De keuzelijst met behandelaars wordt hier server-side opgehaald en niet via
 * een endpoint. Dat is dezelfde afweging als op het thuisscherm: de
 * RLS-policy `profiles_select_self` laat een atleet alleen zijn eigen profiel
 * lezen, en dat hoort zo te blijven. Een lijst met namen van de praktijk is
 * geen geheim, maar de tabel eromheen wel: daar staan e-mailadressen en rollen
 * in. Vandaar een expliciete projectie van drie velden in plaats van een
 * policy die de hele tabel opentrekt.
 */

export interface PractitionerOption {
  id: string;
  name: string;
  kind: "physio" | "coach";
  initials: string;
}

export interface AthleteProfileValues {
  fullName: string | null;
  /** YYYY-MM-DD. */
  dateOfBirth: string | null;
  phone: string | null;
  /** Een sleutel uit enum_options van identity.sport in de taxonomie. */
  sport: string | null;
  discipline: string | null;
  club: string | null;
  federation: string | null;
  /** De eigen trainer. Niet de behandelaar in deze praktijk, zie practitionerId. */
  coachName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2, hoofdletters. */
  country: string | null;
  practitionerId: string | null;
}

export interface ProfileData {
  email: string | null;
  values: AthleteProfileValues;
  practitioners: PractitionerOption[];
  /**
   * De sportenlijst, uit enum_options van identity.sport in de taxonomie.
   *
   * Niet hardgeschreven in het scherm: er hoort precies een lijst met sporten
   * te bestaan, en dat is field_definitions. Zet de praktijk er morgen "judo"
   * bij, dan staat hij hier zonder dat iemand dit bestand opent.
   */
  sportOptions: Array<{ value: string; label: string }>;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

/**
 * Iedereen met een vakgebied, op naam gesorteerd.
 *
 * Twee voorwaarden: een vakgebied (dat maakt iemand een behandelaar) en niet
 * gearchiveerd (dat maakt hem beschikbaar). Die stonden eerst in één kolom,
 * met het argument dat twee schakelaars voor één beslissing uit de pas gaan
 * lopen. Ze zijn geen één beslissing: wie vertrekt moet uit deze lijst
 * verdwijnen zonder zijn discipline te verliezen op de dossiers die hij al
 * behandeld heeft. Zie 20260910140000_practitioner_archive.sql.
 */
export async function listPractitioners(): Promise<PractitionerOption[]> {
  const data = await query<{ id: string; full_name: string | null; practitioner_kind: string }>(
    `select id, full_name, practitioner_kind from public.profiles
      where practitioner_kind is not null and archived_at is null
      order by full_name`,
  );

  return data
    .map((row) => {
      // Een behandelaar zonder naam is voor de atleet niet te kiezen: "?" in
      // een lijstje is geen keuze. create-coach.ts zet de naam, dus dit is een
      // half aangemaakt account en dat hoort hier niet te verschijnen.
      const name = (row.full_name as string | null)?.trim();
      if (!name) return null;

      return {
        id: row.id as string,
        name,
        kind: row.practitioner_kind as PractitionerOption["kind"],
        initials: initialsOf(name),
      };
    })
    .filter((option): option is PractitionerOption => option !== null);
}

export async function loadProfile(input: {
  athleteId: string;
  email: string | null;
  /** De taal van de sportlabels. De waarden zelf zijn taalonafhankelijke sleutels. */
  locale?: "nl" | "en";
}): Promise<ProfileData> {
  const locale = input.locale ?? "nl";
  const [row, practitioners, definitions] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `select full_name, email, phone, date_of_birth, sport, discipline, club, federation,
              coach_name, street, postal_code, city, country, practitioner_id
         from public.athletes where id = $1 and deleted_at is null`,
      [input.athleteId],
    ),
    listPractitioners(),
    getFieldDefinitions(),
  ]);

  return {
    email: (row?.email as string | null) ?? input.email,
    values: {
      fullName: (row?.full_name as string | null) ?? null,
      dateOfBirth: (row?.date_of_birth as string | null) ?? null,
      phone: (row?.phone as string | null) ?? null,
      sport: (row?.sport as string | null) ?? null,
      discipline: (row?.discipline as string | null) ?? null,
      club: (row?.club as string | null) ?? null,
      federation: (row?.federation as string | null) ?? null,
      coachName: (row?.coach_name as string | null) ?? null,
      street: (row?.street as string | null) ?? null,
      postalCode: (row?.postal_code as string | null) ?? null,
      city: (row?.city as string | null) ?? null,
      country: (row?.country as string | null) ?? null,
      practitionerId: (row?.practitioner_id as string | null) ?? null,
    },
    practitioners,
    sportOptions: (
      definitions.find((definition) => definition.key === "identity.sport")
        ?.enumOptions ?? []
    )
      // Afgedankte sleutels verdwijnen uit de keuzelijst, maar niet als deze
      // atleet er een heeft staan. Een <select> met een waarde die niet in zijn
      // opties zit rendert leeg, en dan wist de eerstvolgende opslag stil een
      // sport die de atleet nooit gewijzigd heeft.
      .filter(
        (option) =>
          !isDeprecatedSport(option) || option === (row?.sport as string | null),
      )
      .map((option) => ({ value: option, label: enumLabel("identity.sport", option, locale) })),
  };
}

/**
 * Het adres als één regel, of null als er niets staat.
 *
 * Voor schermen die het adres tonen en niet bewerken. Half ingevulde adressen
 * zijn de regel en niet de uitzondering (iemand vult een gemeente in en de rest
 * niet), dus lege delen vallen weg in plaats van een komma achter te laten.
 */
export function formatAddress(values: {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}): string | null {
  const locality = [values.postalCode, values.city]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");

  const parts = [values.street?.trim(), locality, values.country?.trim()].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Wat de atleet mag insturen.
 *
 * Leeg is hier niet hetzelfde als weggelaten, en dat is de reden dat dit een
 * eigen schema heeft in plaats van een handvol `?? null`. Wie een veld leegmaakt
 * en opslaat, bedoelt "dit weet ik niet meer": dat wordt null in de kolom, en
 * niet een lege string die in een rapport als een lege regel doorkomt.
 *
 * Het land gaat naar hoofdletters voordat de check-constraint eraan te pas komt.
 * "be" intypen is geen fout van de atleet.
 */
const inputSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  // Datums komen als YYYY-MM-DD uit een <input type="date">. Een andere notatie
  // weigeren we hier in plaats van hem te raden: 03/04 is in Belgie 3 april en
  // elders 4 maart, en een geboortedatum die er een maand naast zit is erger
  // dan een geweigerd formulier.
  dateOfBirth: z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: "date of birth must be YYYY-MM-DD",
    })
    .optional(),
  phone: z.string().trim().max(40).optional(),
  sport: z.string().trim().max(60).optional(),
  discipline: z.string().trim().max(120).optional(),
  club: z.string().trim().max(120).optional(),
  federation: z.string().trim().max(120).optional(),
  coachName: z.string().trim().max(120).optional(),
  street: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine((value) => value === "" || /^[A-Z]{2}$/.test(value), {
      message: "country must be a two-letter country code",
    })
    .optional(),
  // Null en de lege string betekenen allebei "geen behandelaar gekozen". De
  // radiogroep stuurt "" terug, JSON-clients eerder null.
  practitionerId: z.union([z.string().uuid(), z.literal(""), z.null()]).optional(),
});

export type ProfileInput = z.input<typeof inputSchema>;

export type ParseResult =
  | { ok: true; values: AthleteProfileValues }
  | { ok: false; error: string };

const blankToNull = (value: string | undefined): string | null =>
  value === undefined || value === "" ? null : value;

/**
 * Body omzetten naar kolomwaarden, of een leesbare weigering.
 *
 * `known` is de verzameling id's uit de keuzelijst. De databank kan niet
 * afdwingen dat `practitioner_id` naar staf wijst (een foreign key kan niet op
 * een gefilterde verzameling wijzen), dus dat gebeurt hier, tegen precies
 * dezelfde lijst die de atleet te zien kreeg.
 */
export function parseProfileInput(body: unknown, known: Set<string>): ParseResult {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid input" };
  }

  const value = parsed.data;
  const practitionerId =
    value.practitionerId === undefined || value.practitionerId === null || value.practitionerId === ""
      ? null
      : value.practitionerId;

  if (practitionerId !== null && !known.has(practitionerId)) {
    return { ok: false, error: "unknown practitioner" };
  }

  return {
    ok: true,
    values: {
      fullName: blankToNull(value.fullName),
      dateOfBirth: blankToNull(value.dateOfBirth),
      phone: blankToNull(value.phone),
      sport: blankToNull(value.sport),
      discipline: blankToNull(value.discipline),
      club: blankToNull(value.club),
      federation: blankToNull(value.federation),
      coachName: blankToNull(value.coachName),
      street: blankToNull(value.street),
      postalCode: blankToNull(value.postalCode),
      city: blankToNull(value.city),
      country: blankToNull(value.country),
      practitionerId,
    },
  };
}

/**
 * Opslaan, met de service role.
 *
 * `athletes_write` is alleen voor staf, dus een atleet kan zijn eigen rij niet
 * bijwerken vanuit de browser. Dat blijft zo: het filter op id doet hier het
 * werk dat RLS anders zou doen, en het id komt uit de sessie en niet uit de
 * body.
 *
 * De naam gaat ook naar `profiles`. Twee kolommen met dezelfde naam is niet
 * mooi, maar ze bestaan allebei al en ze worden allebei gelezen (het profiel bij
 * het inloggen, de atleet in het coachscherm). Eentje bijwerken en de andere
 * laten staan levert een atleet op die onder twee namen door het systeem loopt.
 */
export async function saveProfile(input: {
  athleteId: string;
  userId: string;
  values: AthleteProfileValues;
}): Promise<void> {
  // Atleetrij en profielnaam samen: dezelfde naam op twee plekken, en half
  // bewaard staat er een andere naam boven het dossier dan in de kop.
  await transaction(async (run) => {
    await run(
      `update public.athletes
          set full_name = $2, date_of_birth = $3, phone = $4, sport = $5, discipline = $6,
              club = $7, federation = $8, coach_name = $9, street = $10, postal_code = $11,
              city = $12, country = $13, practitioner_id = $14
        where id = $1 and deleted_at is null`,
      [
        input.athleteId,
        input.values.fullName,
        input.values.dateOfBirth,
        input.values.phone,
        input.values.sport,
        input.values.discipline,
        input.values.club,
        input.values.federation,
        input.values.coachName,
        input.values.street,
        input.values.postalCode,
        input.values.city,
        input.values.country,
        input.values.practitionerId,
      ],
    );
    await run("update public.profiles set full_name = $2 where id = $1", [
      input.userId,
      input.values.fullName,
    ]);
  });
}

/**
 * De profielwaarden als dossiervoorstellen wegschrijven.
 *
 * Dit is de brug: het profiel is de bron, het dossier is wat de behandelaar
 * leest en wat in het rapport belandt. Zonder deze stap staat identiteit wel in
 * het profiel maar nergens in het dossier, en dan is een intake een dossier
 * zonder naam.
 *
 * `proposedBy: 'athlete'`, want dat is waar: de atleet heeft het zelf ingevuld.
 * Niet 'model', dus de constraint die herkomst eist voor modelvoorstellen komt
 * er niet aan te pas, en de voorrangsregel in lib/dossier/merge.ts klopt
 * vanzelf: een correctie van de coach wint hier nog steeds van.
 *
 * Idempotent in effect, niet in rijen. field_proposals is append-only, dus twee
 * keer synchroniseren levert twee voorstellen met dezelfde waarde op en het
 * dossier verandert niet. Alleen schrijven wat er echt staat scheelt die ruis,
 * vandaar de filter op lege waarden.
 */
export async function syncProfileToDossier(input: {
  intakeId: string;
  athleteId: string;
}): Promise<number> {
  // De kolomnamen komen uit PROFILE_FIELDS in de code, niet uit invoer.
  const data = await queryOne(
    `select ${PROFILE_COLUMNS.join(", ")} from public.athletes
      where id = $1 and deleted_at is null`,
    [input.athleteId],
  );
  if (!data) return 0;

  const row = data as unknown as Record<string, unknown>;

  const proposals = Object.entries(PROFILE_FIELDS)
    .map(([fieldKey, column]) => ({ fieldKey, value: row[column] }))
    .filter(
      (entry) =>
        entry.value !== null &&
        entry.value !== undefined &&
        String(entry.value).trim() !== "",
    )
    .map((entry) => ({
      fieldKey: entry.fieldKey,
      value: entry.value,
      proposedBy: "athlete" as const,
    }));

  if (proposals.length === 0) return 0;

  await addProposals(input.intakeId, proposals);
  return proposals.length;
}

/**
 * Elk lopend concept van deze atleet bijwerken na een profielwijziging.
 *
 * Wie zijn club corrigeert terwijl er een concept openstaat, hoort dat terug te
 * zien in het dossier dat straks naar de behandelaar gaat. Een ingediende of
 * goedgekeurde intake blijft staan zoals ze was: die is een momentopname, en
 * een rapportversie die achteraf verschuift is geen rapportversie.
 */
export async function syncProfileToOpenIntakes(athleteId: string): Promise<void> {
  const data = await query<{ id: string }>(
    "select id from public.intakes where athlete_id = $1 and status = 'draft'",
    [athleteId],
  );

  for (const intake of data) {
    await syncProfileToDossier({ intakeId: intake.id, athleteId });
  }
}
