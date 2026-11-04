/**
 * Wanneer een screening achterstand wordt.
 *
 * Dit stond als constante in AthleteWorkList.tsx en werd daar door de
 * serverpagina uit geïmporteerd. Dat typecheckt, en het is stil fout: alles wat
 * een "use client"-module exporteert komt aan de serverkant binnen als een
 * clientreferentie, niet als de waarde. `dagen > OVERDUE_DAYS` vergeleek dus een
 * getal met een object, was altijd onwaar, en de tegel telde alleen de atleten
 * die nog nooit gemeten waren. Zes maanden achterstand stond er als nul.
 *
 * Vandaar een eigen module, zonder "use client" en zonder server-only import,
 * zodat beide kanten dezelfde waarde zien en dezelfde rekensom doen.
 */
export const OVERDUE_DAYS = 90;

/**
 * Hele dagen tussen twee kalenderdatums, beide "YYYY-MM-DD".
 *
 * UTC aan beide kanten. Met lokale tijd telt een zomertijdsprong als een dag,
 * en dat is precies het soort verschil dat een rij net over of net onder de
 * drempel duwt.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Nooit gemeten telt mee: dat is de grootste achterstand die er is. */
export function isOverdue(lastScreening: string | null, today: string): boolean {
  return lastScreening === null || daysBetween(lastScreening, today) > OVERDUE_DAYS;
}
