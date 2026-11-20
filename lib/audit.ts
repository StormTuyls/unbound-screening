import { query } from "@/lib/db/sql";

/**
 * Audit-spoor voor wat triggers niet kunnen zien.
 *
 * Mutaties worden door databasetriggers gelogd, dus die kan niemand vergeten.
 * Leesacties en exports kunnen triggers niet zien: die horen hier, expliciet,
 * op de plek waar de data het systeem verlaat.
 *
 * Er gaan met opzet geen waarden in het detail-veld. Een audit-log dat de
 * medische data nog eens dupliceert vergroot het probleem dat het moet oplossen.
 */

/**
 * Alleen wat public.audit_log.action toestaat, zie de check-constraint in
 * 20260902090100_public_tables.sql. 'insert' hoort erbij omdat een correctie van
 * de coach via de directe pg-verbinding gaat: die insert wordt wel door de
 * row-trigger op medical.field_proposals gezien, maar zonder auth.uid(), dus
 * landt hij als actor_kind 'system'. Zonder deze expliciete regel staat er in
 * het spoor niet wie het veld veranderde.
 */
export type AuditAction = "read" | "export" | "purge" | "insert" | "update";
export type ActorKind = "coach" | "athlete" | "admin" | "system";

export async function logAudit(input: {
  action: AuditAction;
  actorKind: ActorKind;
  actorId?: string | null;
  entitySchema: "public" | "medical";
  entityTable: string;
  entityId: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  // Een mislukte audit-registratie mag niet stil blijven: dan verliest het
  // spoor zijn waarde precies wanneer het nodig is. query gooit, en dat laten
  // we doorgaan.
  await query(
    `insert into public.audit_log
       (actor_id, actor_kind, action, entity_schema, entity_table, entity_id, detail)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.actorId ?? null,
      input.actorKind,
      input.action,
      input.entitySchema,
      input.entityTable,
      input.entityId,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}
