import { type Band, validateBands } from "./bands";
import type { Direction } from "./direction";
import type { TrialSelection } from "./selection";
import type { Unit } from "./units";

/**
 * De screeningsbibliotheek, als getypeerde data.
 *
 * Dit is de inhoud van spec §6: de bronafkapwaarden uit de Screening
 * 2025-bestanden. Spec §6 zegt er zelf bij hoe ze hier horen te landen: "They
 * should be imported as versioned reference rules, not hard-coded permanently
 * into the UI."
 *
 * Wat hier NIET staat: de volledige testbibliotheek uit spec §7. Die is drie
 * keer zo groot en bestaat voor een groot deel uit tests die §7 zelf als
 * "protocol required" markeert. Een test zonder protocol levert getallen op die
 * niemand kan duiden, en vroeg seeden garandeert een protocolherziening later.
 * Ze komen erbij zodra de praktijk het protocol vastlegt.
 *
 * classificationEnabled staat op false waar spec §10 en §18 zeggen dat het niet
 * veilig is. Dat zijn geen meningen maar de noten in de brontabel zelf:
 * "VERIFY PROTOCOL" bij 90-90 en Thomas, "GAPS exist between categories" bij
 * ASH, en "VERIFY system weight" bij de Iso Push-testen. Die tests worden wel
 * gemeten en getrend, alleen niet ingedeeld.
 */

export interface TestDef {
  key: string;
  block: string;
  sortOrder: number;
  labelNl: string;
  labelEn: string;
  laterality: "bilateral" | "per_side" | "either";
  bodyRegion?: string;
  sourceNote?: string;
}

export interface ProtocolDef {
  testKey: string;
  version: number;
  labelNl: string;
  labelEn: string;
  device?: string;
  bodyPosition?: string;
  trialCount?: number;
  trialSelection: TrialSelection;
  /** False zolang positie, hoek of hefboom niet vastligt. Spec §10, §18. */
  protocolConfirmed: boolean;
  protocolSource?: string;
}

export interface MetricDef {
  key: string;
  testKey: string;
  labelNl: string;
  labelEn: string;
  unit: Unit;
  direction: Direction;
  isCore: boolean;
  decimals: number;
}

export interface RuleDef {
  ruleKey: string;
  version: number;
  metricKey: string;
  layer: "published" | "internal_target";
  bands: Band[];
  coverage: "total" | "gapped";
  classificationEnabled: boolean;
  evidence: "source_sheet" | "published" | "internal";
  sourceCitation?: string;
  sourceNote?: string;
}

export interface Library {
  tests: TestDef[];
  protocols: ProtocolDef[];
  metrics: MetricDef[];
  rules: RuleDef[];
}

export const SOURCE = "Screening 2025 (XLSX/PDF), via UNBOUND-specificatie §6";

// Verkorte opbouw: de meeste tests zijn een enkele meting met een enkele regel.
// Zonder deze helper is dit bestand vier losse arrays waarin dezelfde sleutel
// vier keer met de hand overgetypt wordt.
export function simple(input: {
  key: string;
  block: string;
  sortOrder: number;
  nl: string;
  en: string;
  laterality: TestDef["laterality"];
  unit: Unit;
  direction: Direction;
  decimals?: number;
  device?: string;
  bodyPosition?: string;
  protocolConfirmed: boolean;
  bands?: Band[];
  coverage?: "total" | "gapped";
  classificationEnabled?: boolean;
  note?: string;
}): Library {
  const metricKey = `${input.key}.value`;
  return {
    tests: [
      {
        key: input.key,
        block: input.block,
        sortOrder: input.sortOrder,
        labelNl: input.nl,
        labelEn: input.en,
        laterality: input.laterality,
      },
    ],
    protocols: [
      {
        testKey: input.key,
        version: 1,
        labelNl: `${input.nl} v1`,
        labelEn: `${input.en} v1`,
        device: input.device,
        bodyPosition: input.bodyPosition,
        trialCount: 1,
        trialSelection: "single",
        protocolConfirmed: input.protocolConfirmed,
        protocolSource: SOURCE,
      },
    ],
    metrics: [
      {
        key: metricKey,
        testKey: input.key,
        labelNl: input.nl,
        labelEn: input.en,
        unit: input.unit,
        direction: input.direction,
        isCore: true,
        decimals: input.decimals ?? (input.unit === "score" ? 0 : 1),
      },
    ],
    rules: input.bands
      ? [
          {
            ruleKey: `screening2025.${input.key}`,
            version: 1,
            metricKey,
            layer: "published",
            bands: input.bands,
            coverage: input.coverage ?? "total",
            classificationEnabled: input.classificationEnabled ?? true,
            evidence: "source_sheet",
            sourceCitation: SOURCE,
            sourceNote: input.note,
          },
        ]
      : [],
  };
}

export const BOUNDARY =
  "Grenzen zijn halfopen [ondergrens, bovengrens). Spec §6 laat de randwaarde " +
  "open; deze conventie beantwoordt dat voor alle regels tegelijk.";

