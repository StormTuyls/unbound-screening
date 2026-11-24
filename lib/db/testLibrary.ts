import { logAudit } from "@/lib/audit";
import { query, transaction } from "@/lib/db/sql";
import { slugOf, type TestBlock } from "@/lib/screening/blocks";
import type { Direction } from "@/lib/screening/direction";
import type { Unit } from "@/lib/screening/units";

/**
 * Tests toevoegen en uitfaseren vanuit de app.
 *
 * Een nieuwe test krijgt dezelfde vorm als simple() in de seed: de test,
 * protocol v1 en één gemeten metriek `<test>.value`. Een eerste referentieregel
 * en de uitleg komen daarna op de pagina van de test.
 *
 * Verwijderen bestaat niet, alleen uitfaseren. Aan een test hangen metingen,
 * bevroren rapporten en regels; die moeten hun test blijven vinden. Een
 * uitgefaseerde test verdwijnt uit het invoerscherm en de referentiewaarden,
 * en komt terug met één klik.
 */

type Actor = { id: string | null; isAdmin: boolean };

export interface NewTest {
  labelNl: string;
  labelEn: string;
  block: TestBlock;
  laterality: "per_side" | "bilateral";
  unit: Unit;
  direction: Direction;
  decimals: number;
  device: string | null;
  protocolConfirmed: boolean;
  aboutNl: string | null;
  aboutEn: string | null;
}

export async function createTest(
  input: NewTest,
  actor: Actor,
): Promise<{ testKey: string; metricKey: string }> {
  const created = await transaction(async (run) => {
    // Een vrije sleutel: dezelfde naam twee keer krijgt _2, _3, ...
    const base = `${input.block}.${slugOf(input.labelNl)}`;
    const taken = new Set(
      (
        await run<{ key: string }>(
          "select key from public.test_definitions where key = $1 or key like $1 || '\\_%'",
          [base],
        )
      ).map((row) => row.key),
    );
    let testKey = base;
    for (let n = 2; taken.has(testKey); n++) testKey = `${base}_${n}`;
    const metricKey = `${testKey}.value`;

    // Achteraan in het blok. Ook uitgefaseerde tests tellen mee: de unieke
    // index op (block, sort_order) kent geen uitzondering voor hen.
    const [{ next }] = await run<{ next: number }>(
      "select coalesce(max(sort_order), 0) + 1 as next from public.test_definitions where block = $1",
      [input.block],
    );

    await run(
      `insert into public.test_definitions
         (key, block, sort_order, label_nl, label_en, laterality, domain, about_nl, about_en)
       values ($1, $2, $3, $4, $5, $6, 'clinical', $7, $8)`,
      [testKey, input.block, next, input.labelNl, input.labelEn, input.laterality,
       input.aboutNl, input.aboutEn],
    );
    await run(
      `insert into public.test_protocols
         (test_key, version, label_nl, label_en, device, trial_count, trial_selection,
          protocol_confirmed, protocol_source)
       values ($1, 1, $2, $3, $4, 1, 'single', $5, 'Toegevoegd in de app')`,
      [testKey, `${input.labelNl} v1`, `${input.labelEn} v1`, input.device,
       input.protocolConfirmed],
    );
    await run(
      `insert into public.metric_definitions
         (key, test_key, kind, label_nl, label_en, unit, direction, is_core, decimals)
       values ($1, $2, 'raw', $3, $4, $5, $6, true, $7)`,
      [metricKey, testKey, input.labelNl, input.labelEn, input.unit, input.direction,
       input.decimals],
    );
    return { testKey, metricKey };
  });

  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "insert",
    entitySchema: "public",
    entityTable: "test_definitions",
    entityId: created.testKey,
    detail: { block: input.block, unit: input.unit },
  });
  return created;
}

/** Uitfaseren of terugzetten. False als er niets te veranderen viel. */
export async function setTestRetired(
  testKey: string,
  retired: boolean,
  actor: Actor,
): Promise<boolean> {
  const rows = await query(
    retired
      ? "update public.test_definitions set retired_at = now() where key = $1 and retired_at is null returning key"
      : "update public.test_definitions set retired_at = null where key = $1 and retired_at is not null returning key",
    [testKey],
  );
  if (rows.length === 0) return false;
  await logAudit({
    actorId: actor.id,
    actorKind: actor.isAdmin ? "admin" : "coach",
    action: "update",
    entitySchema: "public",
    entityTable: "test_definitions",
    entityId: testKey,
    detail: { retired },
  });
  return true;
}

export interface RetiredTest {
  testKey: string;
  block: string;
  labelNl: string;
  labelEn: string;
  retiredAt: string;
}

export async function listRetiredTests(): Promise<RetiredTest[]> {
  const rows = await query<Record<string, unknown>>(
    `select key, block, label_nl, label_en, retired_at
       from public.test_definitions
      where retired_at is not null
      order by retired_at desc`,
  );
  return rows.map((row) => ({
    testKey: row.key as string,
    block: row.block as string,
    labelNl: row.label_nl as string,
    labelEn: row.label_en as string,
    retiredAt: (row.retired_at as Date).toISOString(),
  }));
}
