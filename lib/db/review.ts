import { query, queryOne } from "@/lib/db/sql";
import { getFieldDefinitions, syncDossier } from "@/lib/db/dossier";
import { listDocuments, readLatestReport, type DocumentSummary } from "@/lib/db/medical";
import { logAudit } from "@/lib/audit";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { resolveInjuryTimeline, type TimelineEntry } from "@/lib/dossier/timeline";
import type { Proposal, ResolvedField } from "@/lib/types";

/**
 * Het volledige dossier voor het reviewscherm van de coach.
 *
 * Hier komt wel alles langs, inclusief herkomstcitaten. Dat is precies waarom
 * elke aanroep een audit-entry schrijft: leesacties op medische velden kunnen
 * databasetriggers niet zien.
 */

export interface InjuryRow {
  id: string;
  intakeId: string | null;
  recordedAt: string | null;
  bodyRegion: string;
  side: string;
  diagnosis: string | null;
  onsetDate: string | null;
  endDate: string | null;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  quoteVerified: boolean;
}

/**
 * De ruwe vermeldingen. Elk document dat een blessure noemt staat hier apart,
 * met zijn eigen herkomst.
 */
/**
 * De blessurevermeldingen die bij deze intake horen te staan.
 *
 * Over de ATLEET en niet over de intake: een blessure uit een eerdere intake is
 * nog steeds voorgeschiedenis, en meestal precies wat de coach zoekt. Zonder
 * dit begon elke nieuwe intake met een lege tijdlijn terwijl het dossier de
 * historie had.
 *
 * Wel chronologisch begrensd, en dat is niet optioneel: zou dit alles van de
 * atleet teruggeven, dan verschijnt een blessure van september in het rapport
 * van maart. Een bevroren rapport hoort te tonen wat er toen bekend was, dus
 * alleen vermeldingen uit intakes die niet later begonnen dan deze.
 *
 * Losse vermeldingen zonder intake (een import op atleetniveau) gaan altijd
 * mee: die hebben geen datum om op af te wijzen.
 */
export async function getInjuryEntries(intakeId: string): Promise<InjuryRow[]> {
  const rows = await query<{
    id: string;
    intake_id: string | null;
    recorded_at: Date | null;
    body_region: string;
    side: string;
    diagnosis: string | null;
    // Kalenderdatums komen als tekst binnen, zie de typeparser in lib/db/sql.ts.
    onset_date: string | null;
    end_date: string | null;
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
  }>(
    `with scope as (
       select athlete_id, started_at
         from public.intakes
        where id = $1
     )
     select e.id, e.intake_id, source.started_at as recorded_at,
            e.body_region, e.side, e.diagnosis, e.onset_date, e.end_date,
            e.source_document_id, e.source_page, e.source_quote, e.quote_verified
       from medical.injury_events e
       cross join scope
       left join public.intakes source on source.id = e.intake_id
      where e.athlete_id = scope.athlete_id
        and (e.intake_id is null or source.started_at <= scope.started_at)
      order by e.onset_date nulls last, e.id`,
    [intakeId],
  );

  return rows.map((row) => ({
    id: row.id,
    intakeId: row.intake_id,
    recordedAt: row.recorded_at ? row.recorded_at.toISOString().slice(0, 10) : null,
    bodyRegion: row.body_region,
    side: row.side,
    diagnosis: row.diagnosis,
    onsetDate: row.onset_date,
    endDate: row.end_date,
    sourceDocumentId: row.source_document_id,
    sourcePage: row.source_page,
    sourceQuote: row.source_quote,
    quoteVerified: row.quote_verified,
  }));
}

/**
 * De tijdlijn zoals de coach hem ziet: vermeldingen van dezelfde blessure
 * samengevoegd. Zie lib/dossier/timeline.ts voor de regel.
 */
export async function getInjuries(intakeId: string): Promise<TimelineEntry[]> {
  return resolveInjuryTimeline(await getInjuryEntries(intakeId), intakeId);
}

/** Alle voorstellen per veld, zodat de coach ziet wat in welk document stond. */
export async function getProposalsByField(
  intakeId: string,
): Promise<Map<string, Proposal[]>> {
  const rows = await query<{
    id: string;
    field_key: string;
    value: unknown;
    proposed_by: Proposal["proposedBy"];
    source_document_id: string | null;
    source_page: number | null;
    source_quote: string | null;
    quote_verified: boolean;
    model_id: string | null;
    created_at: Date;
  }>(
    `select id, field_key, value, proposed_by, source_document_id, source_page,
            source_quote, quote_verified, model_id, created_at
     from medical.field_proposals where intake_id = $1 order by id desc`,
    [intakeId],
  );

  const byField = new Map<string, Proposal[]>();
  for (const row of rows) {
    const proposal: Proposal = {
      id: Number(row.id),
      fieldKey: row.field_key,
      value: row.value,
      proposedBy: row.proposed_by,
      sourceDocumentId: row.source_document_id,
      sourcePage: row.source_page,
      sourceQuote: row.source_quote,
      quoteVerified: row.quote_verified,
      modelId: row.model_id,
      createdAt: row.created_at.toISOString(),
    };
    const list = byField.get(row.field_key);
    if (list) list.push(proposal);
    else byField.set(row.field_key, [proposal]);
  }
  return byField;
}

export interface ReviewData {
  intakeId: string;
  /** Voor de weg terug naar het atleetprofiel. */
  athleteId: string;
  athleteName: string | null;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  /** De naam van de coach die aftekende, niet zijn id: dit gaat naar het scherm. */
  approvedBy: string | null;
  /** Nieuwste vastgelegde rapportversie, of null als er nog geen is. */
  reportVersion: number | null;
  sections: Array<{
    section: string;
    fields: Array<{
      key: string;
      label: string;
      dataType: string;
      required: boolean;
      isMedical: boolean;
      enumOptions: string[] | null;
      value: unknown;
      status: ResolvedField["status"];
      confidence: ResolvedField["confidence"];
      proposedBy: ResolvedField["proposedBy"];
      conflicts: ResolvedField["conflicts"];
      proposals: Proposal[];
    }>;
  }>;
  injuries: TimelineEntry[];
  documents: DocumentSummary[];
  /** Velden waar niet naar gevraagd is: overgeslagen, of voor de behandelaar. */
  notAsked: Array<{
    fieldKey: string;
    section: string;
    label: string;
    required: boolean;
    reason: "skipped" | "practitioner";
    /** Alleen bij een skip: wist hij het niet, of wilde hij het niet zeggen. */
    skipReason: "unknown" | "declined" | null;
  }>;
  completeness: {
    total: number;
    filled: number;
    requiredTotal: number;
    requiredFilled: number;
    conflicts: number;
    readyToSubmit: boolean;
  };
}

/**
 * De naam die de coach hoort te zien.
 *
 * public.athletes.full_name wordt alleen bij het aanmaken van een account
 * gevuld, uit wat de atleet daar zelf invulde. Een intake die uit documenten
 * komt heeft dat vaak niet, en dan stond er "Naam onbekend" boven een dossier
 * dat twee secties lager "Jonas Peeters" zegt, met citaat. Dat is geen ontbrekende
 * gegeven maar een niet-gelegde verbinding.
 *
 * Terugval en geen terugschrijven naar public.athletes: dossier_fields is een
 * afgeleide en athletes is de administratie. Terugschrijven maakt er een tweede
 * waarheid van die kan gaan schuiven, laat een modelgok een accountnaam
 * overschrijven, en zet bij elke herberekening een audit-regel.
 */
function dossierName(resolved: Map<string, ResolvedField>): string | null {
  const field = resolved.get("identity.full_name");
  if (!field || field.status === "conflicting" || field.status === "missing") return null;
  return typeof field.value === "string" && field.value.trim() !== "" ? field.value : null;
}

export async function getReviewData(
  intakeId: string,
  /** Wie het dossier opvraagt. Gaat mee in het spoor; zonder actor is een
   *  leesregel alleen "iemand heeft gekeken", en dat is te weinig. */
  actorId?: string,
  /**
   * De taal van de COACH, niet die van de intake.
   *
   * Wie tien dossiers per week nakijkt wil niet dat de veldlabels van taal
   * wisselen bij het openen van een dossier van een Engelstalige atleet.
   * `intake.locale` blijft wel de taal van de gaten en de vragen hieronder: die
   * gaan naar de atleet.
   */
  coachLocale: Locale = DEFAULT_LOCALE,
): Promise<ReviewData | null> {
  // Tijdstippen als de JSON-tekst van PostgREST, zodat het scherm en de export
  // dezelfde notatie houden als voor fase 5a.
  const intake = await queryOne<{
    id: string;
    status: string;
    submitted_at: string | null;
    approved_at: string | null;
    locale: string;
    athlete_id: string;
    athlete_name: string | null;
    approver_name: string | null;
  }>(
    `select i.id, i.status, i.locale, i.athlete_id,
            to_json(i.submitted_at) #>> '{}' as submitted_at,
            to_json(i.approved_at) #>> '{}' as approved_at,
            a.full_name as athlete_name,
            p.full_name as approver_name
       from public.intakes i
       join public.athletes a on a.id = i.athlete_id
       left join public.profiles p on p.id = i.approved_by
      where i.id = $1`,
    [intakeId],
  );
  if (!intake) return null;

  const [state, injuries, documents, proposals, report] = await Promise.all([
    syncDossier(intakeId, intake.locale as "nl" | "en"),
    getInjuries(intakeId),
    listDocuments(intakeId),
    getProposalsByField(intakeId),
    readLatestReport(intakeId),
  ]);

  await logAudit({
    action: "read",
    actorKind: "coach",
    actorId: actorId ?? null,
    entitySchema: "medical",
    entityTable: "dossier_fields",
    entityId: intakeId,
    detail: { screen: "review", fields: state.definitions.length },
  });

  const bySection = new Map<string, ReviewData["sections"][number]["fields"]>();
  for (const definition of state.definitions) {
    const field = state.resolved.get(definition.key);
    const entry = {
      key: definition.key,
      label: coachLocale === "nl" ? definition.labelNl : definition.labelEn,
      dataType: definition.dataType,
      required: definition.required,
      isMedical: definition.isMedical,
      // Waar de waarde vandaan komt hoort bij de waarde. "Door atleet
      // opgegeven" en "uit het profiel" zijn allebei waar, maar het tweede is
      // preciezer: het eerste is vandaag gezegd, het tweede staat er misschien
      // al een jaar en is sindsdien niet meer bekeken.
      fromProfile: definition.fromProfile,
      enumOptions: definition.enumOptions,
      value: field?.value ?? null,
      status: field?.status ?? ("missing" as const),
      confidence: field?.confidence ?? ("low" as const),
      proposedBy: field?.proposedBy ?? null,
      conflicts: field?.conflicts ?? [],
      proposals: proposals.get(definition.key) ?? [],
    };
    const list = bySection.get(definition.section);
    if (list) list.push(entry);
    else bySection.set(definition.section, [entry]);
  }

  return {
    intakeId,
    athleteId: intake.athlete_id,
    // Een many-to-one embed komt als object terug, een one-to-many als array.
    // Beide vormen afhandelen is goedkoper dan erop vertrouwen.
    athleteName: intake.athlete_name ?? dossierName(state.resolved),
    status: intake.status,
    submittedAt: intake.submitted_at,
    approvedAt: intake.approved_at,
    approvedBy: intake.approver_name,
    reportVersion: report?.version ?? null,
    sections: [...bySection.entries()].map(([section, fields]) => ({ section, fields })),
    injuries,
    documents,
    // Wat de bot NIET gevraagd heeft, en waarom.
    //
    // Zonder dit leest een leeg veld op dit scherm als "niet van toepassing",
    // terwijl het net zo goed "de atleet wist het niet" kan betekenen. Dat zijn
    // twee verschillende dingen in een medisch dossier, en het verschil is
    // precies wat de behandelaar moet weten voor hij aftekent.
    //
    // Alleen wat een mens kan gebruiken: velden die de voorwaarde nog niet
    // geopend had zijn ruis (die staan er bij honderden), overgeslagen velden
    // en vragen voor de behandelaar zijn dat niet.
    notAsked: state.outOfScope
      .filter(
        (entry): entry is typeof entry & { reason: "skipped" | "practitioner" } =>
          entry.reason === "skipped" || entry.reason === "practitioner",
      )
      .map((entry) => {
        const definition = state.definitions.find((d) => d.key === entry.fieldKey);
        return {
          fieldKey: entry.fieldKey,
          section: entry.section,
          label:
            (intake.locale === "nl" ? definition?.labelNl : definition?.labelEn) ??
            entry.fieldKey,
          required: definition?.required ?? false,
          reason: entry.reason,
          skipReason: entry.skipReason ?? null,
        };
      }),
    completeness: state.completeness,
  };
}

export { getFieldDefinitions };
