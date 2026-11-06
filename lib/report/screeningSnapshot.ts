import { createHash } from "node:crypto";

/**
 * Het bevroren screeningrapport.
 *
 * Zelfde belofte als lib/report/snapshot.ts voor de intake: wat je exporteert
 * is een opgeslagen versie, niet de stand van nu. Voor een screening weegt dat
 * zwaarder dan voor een dossier, en om een reden die uniek is voor dit domein:
 *
 *   DE DREMPELS VERANDEREN.
 *
 * De praktijk kan op /coach/library een referentieregel bijstellen of aanzetten.
 * Zou een rapport bij het printen opnieuw classificeren, dan vertelt een afdruk
 * van vorig jaar een ander verhaal dan toen hij getekend werd. Daarom draagt
 * dit snapshot niet alleen de waarde en de band, maar ook de REGEL die hem gaf,
 * met zijn versie en zijn citatie.
 *
 * En zelfdragend, net als het intakerapport: labels in beide talen, testnamen
 * opgelost, zodat een renderer nergens hoeft terug te joinen. Een rapport dat
 * een query nodig heeft om zichzelf te tonen is geen vastlegging.
 */

/**
 * 3 sinds de kaft van het rapport.
 *
 * Een snapshot van versie 1 of 2 blijft geldig en leesbaar: er is niets uit
 * weg. Andersom niet, en daar gaat dit nummer over. Een rij met kind
 * "normalised" of met inputs {source, bodyMassKg} bestond in versie 1 niet,
 * dus een renderer die alleen versie 1 kent hoort te weigeren in plaats van de
 * rij als een delta te tonen.
 *
 * Versie 4 voegt bands toe: de drempels zelf, niet alleen het woord dat eruit
 * kwam. Daarmee kan het rapport TEKENEN waar een waarde op de schaal van zijn
 * regel staat, en dat is precies wat een afkapwaarde betekent. Ze horen in het
 * snapshot en niet in een query, om dezelfde reden als de rest: de praktijk
 * kan een drempel bijstellen, en een afdruk van toen moet de schaal van toen
 * tonen. Een snapshot van versie 3 of ouder heeft ze niet en krijgt dus geen
 * strip; het getal en het bandwoord staan er nog gewoon.
 *
 * Versie 3 voegt coverRank en notes toe. Die laatste staan hier en niet in een
 * query omdat het rapport uitsluitend uit een bevroren versie rendert: zonder
 * de opmerkingen in het snapshot zou pagina 1 ofwel leeg zijn, ofwel de stand
 * van vandaag tonen onder de datum van toen. Een rapport van versie 2 heeft
 * geen notes en krijgt dus geen sterktes en ontwikkelpunten; dat is juist,
 * want die waren er toen niet.
 */
export const SCREENING_SNAPSHOT_VERSION = 4;

export interface SnapshotBand {
  status: string;
  score: number | null;
  gte?: number;
  lt?: number;
}

export interface SnapshotResult {
  metricKey: string;
  testLabelNl: string;
  testLabelEn: string;
  block: string;
  side: string;
  kind: "absolute" | "asymmetry" | "delta" | "normalised";
  value: number | null;
  unit: string;
  decimals: number;
  status: string;
  unavailableReason: string | null;
  bandStatus: string | null;
  bandScore: number | null;
  /**
   * De banden van de regel die deze waarde indeelde, of null als de regel niet
   * indeelt. Sinds schemaVersion 4; daarvoor ontbreekt hij.
   */
  bands?: SnapshotBand[] | null;
  /** Welke regel deze band gaf, opgelost. Leeg als er niet ingedeeld is. */
  ruleVersion: number | null;
  ruleCitation: string | null;
  ruleNote: string | null;
  ruleEvidence: string | null;
  protocolConfirmed: boolean;
  inputs: Record<string, number | null> | null;
  /** Plek op pagina 1, of null. Sinds schemaVersion 3; daarvoor ontbreekt hij. */
  coverRank?: number | null;
}

/**
 * Een opmerking zoals hij in het rapport staat.
 *
 * Meereizend en niet opnieuw op te vragen, om dezelfde reden als de regels: de
 * behandelaar kan een vlag sluiten of een werkdoel bijstellen, en een afdruk
 * van toen hoort te zeggen wat er toen stond. Het metriekenlabel staat er in
 * beide talen bij, zodat de renderer nergens terug hoeft te joinen.
 */
export interface SnapshotNote {
  id: number;
  kind: "strength" | "development" | null;
  rank: number | null;
  severity: string;
  state: string;
  body: string;
  action: string | null;
  target: string | null;
  metricKey: string | null;
  metricLabelNl: string | null;
  metricLabelEn: string | null;
}

export interface ScreeningSnapshot {
  schemaVersion: number;
  contentHash: string;
  generatedAt: string;
  sessionId: string;
  athleteId: string;
  athleteName: string | null;
  occurredOn: string;
  bodyMassKg: number | null;
  notes: string | null;
  testerName: string | null;
  results: SnapshotResult[];
  /** Hoeveel metingen geen band kregen, en dus niet beoordeeld zijn. */
  unclassified: number;
  /**
   * Sterktes, ontwikkelpunten en losse vlaggen. Sinds schemaVersion 3.
   *
   * Niet "notes": dat veld hierboven is de contextregel van de sessie, één
   * string die de tester bij het invoeren typt. Dit zijn de oordelen van de
   * behandelaar, uit medical.screening_notes.
   */
  observations?: SnapshotNote[];
}

const frozen = Symbol("frozenScreening");
export type FrozenScreeningSnapshot = ScreeningSnapshot & { readonly [frozen]: true };

/**
 * De hash gaat over de INHOUD, niet over het moment.
 *
 * generatedAt blijft er met opzet buiten: twee keer exporteren zonder dat er
 * iets veranderd is hoort dezelfde versie op te leveren. Verandert een meting,
 * of stelt de praktijk een drempel bij waardoor de band anders uitvalt, dan
 * verandert de hash wel en komt er een nieuwe, benoemde versie bij.
 */
export function contentHashOf(snapshot: Omit<ScreeningSnapshot, "contentHash" | "generatedAt">): string {
  const canonical = {
    schemaVersion: snapshot.schemaVersion,
    sessionId: snapshot.sessionId,
    occurredOn: snapshot.occurredOn,
    bodyMassKg: snapshot.bodyMassKg,
    notes: snapshot.notes,
    results: snapshot.results.map((r) => [
      r.metricKey, r.side, r.kind, r.value, r.unit, r.status,
      r.unavailableReason, r.bandStatus, r.bandScore, r.ruleVersion,
      r.coverRank ?? null, r.bands ?? null,
    ]),
    // De opmerkingen tellen mee: een werkdoel bijstellen of een vlag sluiten
    // verandert wat er op pagina 1 staat, en dus hoort er een nieuwe versie te
    // komen. createdAt blijft erbuiten, net als generatedAt hierboven.
    observations: (snapshot.observations ?? []).map((n) => [
      n.id, n.kind, n.rank, n.severity, n.state, n.body, n.action, n.target,
      n.metricKey,
    ]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
