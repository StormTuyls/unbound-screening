import { type Band, type ClassifiableRule, classify } from "./bands";
import { type HistoryPoint, compare } from "./baseline";
import {
  ENGINE_VERSION,
  type NormaliseKey,
  type SessionContext,
  asymmetry,
  perBodyMass,
  perBodyWeight,
} from "./derive";
import type { Direction } from "./direction";
import { type Measured, fromNullable } from "./measured";
import type { Unit } from "./units";

/**
 * Van metingen naar uitkomsten: de lijm tussen de rekenmotor en de databank.
 *
 * Zuiver, zoals de rest van lib/screening/. Wat eruit komt is precies een rij
 * medical.derived_results, zodat de opslaglaag niets hoeft te beslissen.
 *
 * Wat deze versie WEL doet: de ruwe waarde classificeren, en voor tests die per
 * zijde gemeten worden de asymmetrie uitrekenen. Dat is spec §11's minimum:
 * "For bilateral tests, show L and R on the same scale, plus asymmetry magnitude
 * and direction."
 *
 * Daar komt normaliseren naar lichaamsmassa bij: N/kg en xBW, elk als een eigen
 * metriek met een eigen sleutel, eenheid en regel. Zie het blok onderaan.
 *
 * Wat deze versie NIET doet: LSI en ratio's. Niet omdat ze ontbreken in
 * derive.ts, maar omdat er nog geen afnemer voor is: LSI vraagt een aangedane
 * zijde die pas uit een lopende klacht komt, en de twee ratio's uit de change
 * request (Add:Abd, transfer-RSI) wachten op de heup- en sprongmetrieken.
 */

export type Side = "left" | "right" | "bilateral" | "unknown";

export interface MetricSpec {
  key: string;
  unit: Unit;
  direction: Direction;
  /** Per zijde gemeten? Bepaalt of asymmetrie betekenis heeft. Spec §7.9. */
  perSide: boolean;
  /** De geldende regel, of null als er geen is. */
  rule: (ClassifiableRule & { id: number; layer: "published" | "internal_target" }) | null;
  /**
   * Deze metriek wordt gerekend uit een andere, niet gemeten.
   *
   * Null of weggelaten voor een gewone gemeten metriek. De bron staat erbij
   * omdat "de ruwe metriek van dezelfde test" geen antwoord is zodra een test
   * er meer dan een heeft: de ankle iso-push levert piekkracht, kracht op
   * 100 ms en RFD, en alleen de eerste hoort genormaliseerd te worden.
   */
  derivedFrom?: { metricKey: string; derivedKey: NormaliseKey } | null;
}

export interface MeasurementInput {
  metricKey: string;
  side: Side;
  value: number | null;
  /** De protocolversie waaronder gemeten is. Bepaalt wat vergelijkbaar is. */
  protocolId: string;
}

/**
 * Eerdere metingen van deze atleet, per metriek EN per zijde. Spec §5 laag 1.
 *
 * De sleutel is `${metricKey}|${side}`. Dat de zijde erin zit is niet
 * cosmetisch: zonder dat vergelijkt een linkerknie met de vorige rechterknie
 * zodra die toevallig als laatste is ingevoerd, en dan staat er een
 * geloofwaardig percentage dat nergens over gaat.
 */
export type History = ReadonlyMap<string, readonly HistoryPoint[]>;

export function historyKey(metricKey: string, side: Side): string {
  return `${metricKey}|${side}`;
}

export interface ResultRow {
  metricKey: string;
  side: Side;
  /**
   * `normalised` is een absolute waarde van een eigen metriek, alleen gerekend
   * in plaats van gemeten. Hij staat apart omdat de opslaglaag hem anders
   * behandelt dan een asymmetrie: hij hoort wel bij een zijde en dus bij een
   * test_item, en zijn metriek staat niet in de ingevoerde metingen.
   */
  kind: "absolute" | "asymmetry" | "delta" | "normalised";
  /**
   * De gemeten metriek waaruit deze rij volgt, voor `normalised`. Null voor de
   * rest. De opslaglaag heeft hem nodig om het juiste test_item te vinden: de
   * metriek van de rij zelf komt in de invoer niet voor.
   */
  sourceMetricKey: string | null;
  value: number | null;
  unit: Unit;
  status: "computed" | "unavailable";
  unavailableReason: string | null;
  derivedKey: string | null;
  derivedVersion: number | null;
  engineVersion: number;
  referenceRuleId: number | null;
  referenceLayer: "published" | "internal_target" | null;
  bandStatus: string | null;
  bandScore: number | null;
  /**
   * Wat erin ging. Spec §11: "For ratios, show both numerator and denominator
   * next to the ratio. A 'good' ratio can otherwise hide two poor absolute
   * values." Bij asymmetrie is dat links en rechts, en daaruit volgt ook welke
   * zijde lager is; die hoeft er dus niet apart bij.
   */
  inputs: Record<string, number | null>;
}

function absoluteRow(
  spec: MetricSpec,
  m: MeasurementInput,
  measured: Measured,
): ResultRow {
  const band = classify(m.value, spec.rule ?? NO_RULE);
  return {
    metricKey: spec.key,
    side: m.side,
    kind: "absolute",
    sourceMetricKey: null,
    value: measured.ok ? measured.value : null,
    unit: spec.unit,
    status: measured.ok ? "computed" : "unavailable",
    unavailableReason: measured.ok ? null : measured.reason,
    derivedKey: null,
    derivedVersion: null,
    engineVersion: ENGINE_VERSION,
    // De band draagt de regel-ID, niet de rule_key: een latere versie van
    // dezelfde regel raakt deze rij niet. Spec §18.
    referenceRuleId: band.ok && spec.rule ? spec.rule.id : null,
    referenceLayer: band.ok && spec.rule ? spec.rule.layer : null,
    bandStatus: band.ok ? band.status : null,
    bandScore: band.ok ? band.score : null,
    inputs: {},
  };
}

// Geen regel is iets anders dan een regel die uit staat, maar voor classify()
// komen ze op hetzelfde neer: geen band. De reden verschilt wel, en die staat in
// de kolom unavailable_reason van de asymmetrierij, niet hier.
const NO_RULE: ClassifiableRule = {
  bands: [] as Band[],
  coverage: "total",
  classificationEnabled: false,
};

/**
 * Geen lichaamsmaten bekend.
 *
 * Elke normalisatie levert dan een rij met no_body_mass, en dat is het eerlijke
 * antwoord: de meting is er, de deling niet. Het alternatief, de rij weglaten,
 * zou "niet te normaliseren" niet te onderscheiden maken van "deze test heeft
 * geen N/kg", precies het onderscheid dat measurements.value nullable maakt.
 */
const NO_CONTEXT: SessionContext = { bodyMassKg: null, bodyHeightCm: null };

export function evaluate(
  measurements: readonly MeasurementInput[],
  specs: ReadonlyMap<string, MetricSpec>,
  history: History = new Map(),
  occurredAt: string = new Date().toISOString(),
  /** Invoermoment, alleen om gelijke stand te breken. Zie baseline.ts. */
  recordedAt: string = new Date().toISOString(),
  /**
   * De lichaamsmaten van DEZE sessie, niet uit het profiel. Spec §8 wil de
   * massa van die dag: normaliseren tegen het gewicht van vandaag zou een oud
   * rapport laten veranderen.
   */
  ctx: SessionContext = NO_CONTEXT,
): ResultRow[] {
  const rows: ResultRow[] = [];

  for (const m of measurements) {
    const spec = specs.get(m.metricKey);
    // Een meting van een metriek die niet in de bibliotheek staat hoort niet te
    // bestaan (de foreign key verbiedt hem), maar stil overslaan zou hem hier
    // alsnog laten verdwijnen.
    if (!spec) continue;
    rows.push(absoluteRow(spec, m, fromNullable(m.value, spec.unit)));

    // Laag 1 uit spec §5: de atleet tegen zichzelf. Levert een DELTA en nooit
    // een band; zie lib/screening/baseline.ts voor waarom dat onderscheid de
    // kern is.
    if (m.value === null) continue;
    const self = compare(
      { value: m.value, protocolId: m.protocolId, occurredAt, recordedAt },
      history.get(historyKey(m.metricKey, m.side)) ?? [],
      "previous",
      spec.direction,
      spec.unit,
    );

    // Een eerste meting levert GEEN deltarij op. "Nog geen baseline" is geen
    // uitkomst maar de afwezigheid ervan, en een rij per metriek die dat zegt
    // maakt het eerste screeningsrapport onleesbaar.
    //
    // protocol_mismatch wel: daar IS historie, alleen onder een andere
    // protocolversie, en dat hoort de behandelaar te zien. Spec §4.
    if (!self.change.ok && self.change.reason === "no_baseline") continue;

    rows.push({
      metricKey: spec.key,
      side: m.side,
      kind: "delta",
      sourceMetricKey: null,
      value: self.change.ok ? self.change.value : null,
      unit: "percent",
      status: self.change.ok ? "computed" : "unavailable",
      unavailableReason: self.change.ok ? null : self.change.reason,
      derivedKey: "delta_previous",
      derivedVersion: 1,
      engineVersion: ENGINE_VERSION,
      referenceRuleId: null,
      referenceLayer: null,
      bandStatus: null,
      bandScore: null,
      // De referentiewaarde reist mee, zodat "-8%" leesbaar is als "van 84 naar
      // 77". Spec §8 eist bovendien dat het label expliciet is: previous, niet
      // baseline of PB.
      inputs: {
        previous: self.reference.ok ? self.reference.value : null,
        current: m.value,
      },
    });
  }

  // ── Genormaliseerde uitkomsten ─────────────────────────────────────────────
  //
  // N/kg en xBW zijn eigen metrieken met een eigen sleutel, eenheid en regel, en
  // leveren dus een eigen rij op. Niet een tweede getal op de ruwe rij: een band
  // op 8,5 N/kg is iets anders dan een band op 746 N, en op een gedeelde rij is
  // achteraf niet te zien welke van de twee de kleur gaf.
  //
  // Geen deltarij: die wordt hierboven per GEMETEN waarde gemaakt en een
  // genormaliseerde metriek wordt niet gemeten. Het verloop ervan komt uit de
  // opgeslagen rijen, via getTrends.
  for (const spec of specs.values()) {
    const from = spec.derivedFrom;
    if (!from) continue;
    const bron = specs.get(from.metricKey);
    // validateLibrary() vangt dit bij het seeden, met de metrieksleutel erbij.
    // Hier is stil overslaan beter dan vallen: één verkeerde definitie hoort de
    // rest van de screening niet mee te nemen.
    if (!bron) continue;

    for (const m of measurements) {
      if (m.metricKey !== from.metricKey) continue;

      const source = fromNullable(m.value, bron.unit);
      const out =
        from.derivedKey === "per_body_mass"
          ? perBodyMass(source, ctx)
          : perBodyWeight(source, ctx);
      const value = out.ok ? out.value : null;
      const band = classify(value, spec.rule ?? NO_RULE);

      rows.push({
        metricKey: spec.key,
        side: m.side,
        kind: "normalised",
        sourceMetricKey: from.metricKey,
        value,
        unit: spec.unit,
        status: out.ok ? "computed" : "unavailable",
        unavailableReason: out.ok ? null : out.reason,
        derivedKey: from.derivedKey,
        derivedVersion: 1,
        engineVersion: ENGINE_VERSION,
        referenceRuleId: band.ok && spec.rule ? spec.rule.id : null,
        referenceLayer: band.ok && spec.rule ? spec.rule.layer : null,
        bandStatus: band.ok ? band.status : null,
        bandScore: band.ok ? band.score : null,
        // Teller en noemer naast de uitkomst, spec §11. Zonder de massa erbij is
        // 8,5 N/kg niet na te rekenen, en verandert hij stil mee met het gewicht
        // van de atleet zonder dat iemand ziet waarom.
        inputs: { source: m.value, bodyMassKg: ctx.bodyMassKg },
      });
    }
  }

  // Asymmetrie per metriek die links en rechts heeft.
  const bySide = new Map<string, { left?: number | null; right?: number | null }>();
  for (const m of measurements) {
    if (m.side !== "left" && m.side !== "right") continue;
    const entry = bySide.get(m.metricKey) ?? {};
    entry[m.side] = m.value;
    bySide.set(m.metricKey, entry);
  }

  for (const [metricKey, sides] of bySide) {
    const spec = specs.get(metricKey);
    if (!spec || !spec.perSide) continue;
    // Een score van 0-3 heeft geen zinvolle procentuele asymmetrie: het verschil
    // tussen 2 en 3 is geen 33%.
    if (spec.unit === "score") continue;

    const { result } = asymmetry(
      fromNullable(sides.left, spec.unit),
      fromNullable(sides.right, spec.unit),
    );

    rows.push({
      metricKey,
      // De uitkomst hoort bij geen van beide zijden.
      side: "bilateral",
      kind: "asymmetry",
      sourceMetricKey: null,
      value: result.ok ? result.value : null,
      unit: "percent",
      status: result.ok ? "computed" : "unavailable",
      unavailableReason: result.ok ? null : result.reason,
      derivedKey: "asymmetry",
      derivedVersion: 1,
      engineVersion: ENGINE_VERSION,
      referenceRuleId: null,
      // Geen band, en dat is geen omissie: asymmetrie heeft geen
      // bronafkapwaarde. De vorige versie zette de RICHTING in band_status
      // ("lower_left"), en de check constraint derived_band_needs_rule wees dat
      // terecht af: een band zonder de regel die hem gaf is een kleur zonder
      // onderbouwing. De richting volgt nu uit de invoerwaarden hieronder.
      referenceLayer: null,
      bandStatus: null,
      bandScore: null,
      inputs: { left: sides.left ?? null, right: sides.right ?? null },
    });
  }

  return rows;
}
