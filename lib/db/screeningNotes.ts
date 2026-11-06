import { logAudit } from "@/lib/audit";
import { query, queryOne } from "@/lib/db/sql";

/**
 * Opmerkingen en vlaggen van de staf. FR-13, spec §4.
 *
 * Spec §14 is de reden dat dit bestaat en niet een alarmregel: "The system
 * should not create an alarm for every red cell." Wat opvolging vraagt bepaalt
 * de behandelaar, niet een drempel. Een vlag blijft open tot iemand hem sluit.
 *
 * De auteursnaam staat op de rij en wordt niet uit profiles gejoind; zie de
 * kolomopmerking in 20261011100000.
 */

export type NoteSeverity = "info" | "watch" | "action";

/**
 * Sterkte of ontwikkelpunt, voor de twee genummerde tabellen op pagina 1 van
 * het rapport. Null is een gewone vlag: wel in het dossier, niet op de kaft.
 * Los van severity, want dat zegt hoe dringend iets is en niet of het een plus
 * of een min is.
 */
export type NoteKind = "strength" | "development";

export interface ScreeningNote {
  id: number;
  metricKey: string | null;
  severity: NoteSeverity;
  kind: NoteKind | null;
  rank: number | null;
  state: "open" | "resolved";
  body: string;
  action: string | null;
  /** Het werkdoel voor de volgende test. Zie de kolomopmerking. */
  target: string | null;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export async function listNotes(sessionId: string): Promise<ScreeningNote[]> {
  const rows = await query<Record<string, unknown>>(
    // Genummerd eerst, in hun eigen volgorde; de rest daarachter zoals
    // voorheen. Zo leest de lijst op het scherm in dezelfde volgorde als de
    // tabellen op pagina 1.
    `select id, metric_key, severity, kind, rank, state, body, action, target,
            author_name, created_at, resolved_at
       from medical.screening_notes
      where session_id = $1
      order by rank nulls last, state, severity desc, created_at`,
    [sessionId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    metricKey: (row.metric_key as string | null) ?? null,
    severity: row.severity as NoteSeverity,
    kind: (row.kind as NoteKind | null) ?? null,
    rank: row.rank === null ? null : Number(row.rank),
    state: row.state as "open" | "resolved",
    body: row.body as string,
    action: (row.action as string | null) ?? null,
    target: (row.target as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    resolvedAt: row.resolved_at ? (row.resolved_at as Date).toISOString() : null,
  }));
}

export async function addNote(
  input: {
    sessionId: string;
    athleteId: string;
    metricKey: string | null;
    severity: NoteSeverity;
    kind: NoteKind | null;
    rank: number | null;
    body: string;
    action: string | null;
    target: string | null;
  },
  actor: { id: string | null; name: string | null; isAdmin: boolean },
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `insert into medical.screening_notes
       (athlete_id, session_id, metric_key, severity, kind, rank, body, action,
        target, author_profile_id, author_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id`,
    [input.athleteId, input.sessionId, input.metricKey, input.severity,
     input.kind, input.rank, input.body, input.action, input.target,
     actor.id, actor.name],
  );
  if (!row) throw new Error("opmerking kon niet worden opgeslagen");

  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "insert",
    entitySchema: "medical",
    entityTable: "screening_notes",
    entityId: String(row.id),
    detail: { severity: input.severity, kind: input.kind, metricKey: input.metricKey },
  });
  return Number(row.id);
}

/**
 * Een vlag sluiten of heropenen.
 *
 * De check screening_notes_resolution_complete eist dat state, resolved_at en
 * resolved_by samen kloppen, dus elke overgang gaat in één statement.
 *
 * Heropenen kon eerst niet, met het argument dat een vlag die weer open kan een
 * schakelaar is en geen spoor. Dat argument raakt de verkeerde helft: wat een
 * spoor kapotmaakt is een sluiting die zonder bericht verdwijnt, niet een
 * sluiting die zichtbaar wordt teruggedraaid. Beide overgangen schrijven een
 * auditregel, dus de geschiedenis blijft volledig. Zonder weg terug was de
 * enige uitweg voor een verkeerde klik een tweede opmerking die de eerste
 * tegenspreekt, en dat leest slechter in een dossier.
 */
export async function resolveNote(
  noteId: number,
  actor: { id: string | null; isAdmin: boolean },
): Promise<void> {
  await query(
    `update medical.screening_notes
        set state = 'resolved', resolved_at = now(), resolved_by = $2
      where id = $1 and state = 'open'`,
    [noteId, actor.id],
  );
  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "update",
    entitySchema: "medical",
    entityTable: "screening_notes",
    entityId: String(noteId),
    detail: { state: "resolved" },
  });
}

export async function reopenNote(
  noteId: number,
  actor: { id: string | null; isAdmin: boolean },
): Promise<void> {
  await query(
    `update medical.screening_notes
        set state = 'open', resolved_at = null, resolved_by = null
      where id = $1 and state = 'resolved'`,
    [noteId],
  );
  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "update",
    entitySchema: "medical",
    entityTable: "screening_notes",
    entityId: String(noteId),
    detail: { state: "open" },
  });
}

/** Hoeveel vlaggen er nog openstaan, per sessie. Voor de tijdlijn. */
export async function openNoteCounts(
  athleteId: string,
): Promise<Map<string, number>> {
  const rows = await query<Record<string, unknown>>(
    `select session_id, count(*) as n
       from medical.screening_notes
      where athlete_id = $1 and state = 'open' and session_id is not null
      group by session_id`,
    [athleteId],
  );
  return new Map(rows.map((r) => [r.session_id as string, Number(r.n)]));
}
