import { appDb } from "@/lib/supabase/service";
import { logAudit } from "@/lib/audit";
import { query, queryOne } from "@/lib/db/sql";

// Lege tekst is hier hetzelfde als niets. Dat is geen schoonheidsfoutje: een
// lege sport zou in population.ts als waarde meetellen, en dan matcht een
// regel die op sport filtert op de verkeerde manier.
const tekst = (waarde: unknown): string | null =>
  typeof waarde === "string" && waarde.trim() !== "" ? waarde : null;

/**
 * De atleet, zoals de screening hem nodig heeft.
 *
 * Dit is een uitgeklede kopie van hetzelfde bestand in athlete-intake. Daar
 * haalt het profiel ook de intakes, het dossier en de toestemmingen op, want
 * daar is de atleetpagina het middelpunt van de intake. Hier niet: de screening
 * heeft de naam nodig voor de kop van het scherm, en sekse, sport, discipline,
 * niveau en geboortedatum voor de populatiefilter op de regels. Zie
 * lib/screening/population.ts, waar "onbekend is geen match" de hoofdregel is.
 *
 * De naam komt hier alleen uit de kolom. In de intake valt hij terug op het
 * dossier als de kolom leeg is; die terugval kan hier niet, want het dossier
 * blijft aan de intakekant.
 */
export interface AthleteProfile {
  id: string;
  name: string | null;
  sex: string | null;
  sport: string | null;
  discipline: string | null;
  competitionLevel: string | null;
  dateOfBirth: string | null;
}

export async function getAthleteProfile(
  athleteId: string,
): Promise<AthleteProfile | null> {
  const { data, error } = await appDb()
    .from("athletes")
    .select(
      "id, full_name, sex, sport, discipline, competition_level, date_of_birth",
    )
    .eq("id", athleteId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    name: tekst(data.full_name),
    sex: tekst(data.sex),
    sport: tekst(data.sport),
    discipline: tekst(data.discipline),
    competitionLevel: tekst(data.competition_level),
    dateOfBirth: tekst(data.date_of_birth),
  };
}

/**
 * De werklijst van de praktijk: wie is er, en wanneer is hij voor het laatst
 * gemeten.
 *
 * Dit is bewust NIET listAthletesForCoach() uit athlete-intake. Die lijst telt
 * intakes, wachtenden en conflicten, en bouwt dat op uit drie queries plus een
 * samenvoeging in JS. Hier gaat het over screenings, en dan is het een query:
 * public.athletes met per atleet de laatste sessie en het aantal open vlaggen.
 * intake_server heeft select op public.athletes (zie 20260902110000_grants),
 * dus de join hoeft niet via PostgREST en terug.
 *
 * Twee kolommen uit het ontwerp staan er niet in, en die ontbreken niet per
 * ongeluk: de club heeft geen kolom op athletes, en de actieve klacht met NPRS
 * woont aan de intakekant. Ze verzinnen zou erger zijn dan ze weglaten.
 */
export interface AthleteWorkRow {
  id: string;
  name: string | null;
  dateOfBirth: string | null;
  sport: string | null;
  discipline: string | null;
  /** De laatste screening, of null als er nog geen is. */
  lastScreening: string | null;
  lastSessionId: string | null;
  openFlags: number;
  /**
   * De laatste intake van deze atleet, of null als hij er nog geen heeft.
   *
   * Komt uit public.intakes in de intake-app. Dat kan omdat beide apps op
   * dezelfde databank zitten en intake_server select heeft op die tabel; zie
   * 20260902110000_grants in athlete-intake. Alleen de status en de datum: wat
   * er IN die intake staat is medische inhoud en hoort niet op een
   * overzichtspagina.
   */
  intakeStatus: IntakeStatus | null;
  intakeAt: string | null;
  /** Om naar het nazicht in de intake-app te kunnen linken. */
  lastIntakeId: string | null;
}

/** Spiegelt public.intake_status uit de intake-app. */
export type IntakeStatus = "draft" | "submitted" | "in_review" | "approved";

const INTAKE_STATUS: readonly string[] = ["draft", "submitted", "in_review", "approved"];

/** Defensief, want dit enum woont in de andere app en kan daar groeien. */
function intakeStatus(raw: unknown): IntakeStatus | null {
  return typeof raw === "string" && INTAKE_STATUS.includes(raw)
    ? (raw as IntakeStatus)
    : null;
}

export interface AthleteWorkList {
  rows: AthleteWorkRow[];
  thisMonth: number;
  lastMonth: number;
}

export async function listAthletesForScreening(
  actor: { id: string | null },
): Promise<AthleteWorkList> {
  const [rows, counts] = await Promise.all([
    query<Record<string, unknown>>(
      `select a.id, a.full_name, a.date_of_birth, a.sport, a.discipline,
              laatste.id as last_session_id, laatste.occurred_on,
              coalesce(vlaggen.n, 0) as open_flags,
              intake.id as intake_id, intake.status as intake_status, intake.at as intake_at
         from public.athletes a
         left join lateral (
           select s.id, s.occurred_on
             from medical.screening_sessions s
            where s.athlete_id = a.id
            order by s.occurred_at desc, s.created_at desc
            limit 1
         ) laatste on true
         left join lateral (
           select count(*) as n
             from medical.screening_notes n
            where n.athlete_id = a.id and n.state = 'open'
         ) vlaggen on true
         -- De laatste intake, en niet alle. Een werklijst beantwoordt "ligt er
         -- iets", niet "hoeveel waren er". Gesorteerd op de datum die bij de
         -- status hoort, zodat een goedgekeurde intake van gisteren voorgaat
         -- op een concept van vorig jaar.
         left join lateral (
           select i.id, i.status,
                  coalesce(i.approved_at, i.submitted_at, i.started_at) as at
             from public.intakes i
            where i.athlete_id = a.id
            order by coalesce(i.approved_at, i.submitted_at, i.started_at) desc
            limit 1
         ) intake on true
        where a.deleted_at is null
        -- Wie het langst wacht staat bovenaan, en wie nog nooit gemeten is
        -- staat daar helemaal boven. Dat is de vraag die dit scherm 's ochtends
        -- beantwoordt; het ontwerp zet de nieuwste bovenaan, maar dan is de
        -- atleet die al een jaar niet langskwam precies de regel die niemand
        -- ziet.
        order by laatste.occurred_on asc nulls first, a.full_name asc`,
      [],
    ),
    queryOne<Record<string, unknown>>(
      `select count(*) filter (
                where occurred_on >= date_trunc('month', current_date)
              ) as deze_maand,
              count(*) filter (
                where occurred_on >= date_trunc('month', current_date) - interval '1 month'
                  and occurred_on <  date_trunc('month', current_date)
              ) as vorige_maand
         from medical.screening_sessions`,
      [],
    ),
  ]);

  await logAudit({
    actorId: actor.id,
    actorKind: "coach",
    action: "read",
    entitySchema: "medical",
    entityTable: "screening_sessions",
    entityId: null,
    detail: { athletes: rows.length },
  });

  return {
    rows: rows.map((row) => ({
      id: row.id as string,
      name: tekst(row.full_name),
      dateOfBirth: tekst(row.date_of_birth),
      sport: tekst(row.sport),
      discipline: tekst(row.discipline),
      lastScreening: (row.occurred_on as string | null) ?? null,
      lastSessionId: (row.last_session_id as string | null) ?? null,
      openFlags: Number(row.open_flags),
      intakeStatus: intakeStatus(row.intake_status),
      lastIntakeId: (row.intake_id as string | null) ?? null,
      intakeAt: ((row.intake_at as string | Date | null) ?? null) === null
        ? null
        : new Date(row.intake_at as string).toISOString().slice(0, 10),
    })),
    thisMonth: Number(counts?.deze_maand ?? 0),
    lastMonth: Number(counts?.vorige_maand ?? 0),
  };
}

/**
 * De intakes van één atleet, voor het dossier in deze app.
 *
 * Leest public.intakes over dezelfde databank; intake_server heeft daar select
 * op. Bewust alleen de omslag: status, de datums en wie goedkeurde. Wat er IN
 * een intake staat blijft aan de intakekant, want daar hoort het thuis en daar
 * staat het al.
 *
 * Gesorteerd op de datum die bij de status hoort, zodat een goedgekeurde
 * intake van gisteren voorgaat op een concept van vorig jaar.
 */
export interface AthleteIntake {
  id: string;
  status: IntakeStatus | null;
  at: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
}

const dag = (raw: unknown): string | null =>
  raw === null || raw === undefined
    ? null
    : new Date(raw as string).toISOString().slice(0, 10);

export async function listIntakesForAthlete(athleteId: string): Promise<AthleteIntake[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, status, started_at, submitted_at, approved_at,
            coalesce(approved_at, submitted_at, started_at) as at
       from public.intakes
      where athlete_id = $1
      order by coalesce(approved_at, submitted_at, started_at) desc`,
    [athleteId],
  );

  return rows.map((row) => ({
    id: row.id as string,
    status: intakeStatus(row.status),
    at: dag(row.at),
    startedAt: dag(row.started_at),
    submittedAt: dag(row.submitted_at),
    approvedAt: dag(row.approved_at),
  }));
}
