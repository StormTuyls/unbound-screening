/**
 * De bibliotheek, samengesteld uit de afkapwaarden van de praktijk.
 *
 * De tests, banden en notities staan in afkapwaarden.ts en dat bestand zit niet
 * in git. Een verse kloon kopieert afkapwaarden.voorbeeld.ts ernaartoe en krijgt
 * drie verzonnen tests, genoeg om te bouwen en de validator te draaien.
 */

import { ECHT, PARTS } from "./afkapwaarden";
import { validateBands } from "./bands";
import type { Library } from "./libraryShape";

export type {
  Library,
  TestDef,
  ProtocolDef,
  MetricDef,
  RuleDef,
} from "./libraryShape";
export type { NormaliseKey } from "./derive";

/** Staan de echte afkapwaarden erin, of het voorbeeld? */
export const AFKAPWAARDEN_AANWEZIG = ECHT;

export const LIBRARY: Library = {
  tests: PARTS.flatMap((p) => p.tests),
  protocols: PARTS.flatMap((p) => p.protocols),
  metrics: PARTS.flatMap((p) => p.metrics),
  rules: PARTS.flatMap((p) => p.rules),
};

/**
 * Controleert de bibliotheek. Draait bij het seeden en in CI, zonder databank.
 *
 * Dezelfde opzet als validateConditions() in lib/dossier/askWhen.ts, met
 * dezelfde motivatie: de faalwijzen hier zijn stil. Een regel die naar een
 * metriek verwijst die niet bestaat levert geen foutmelding op, alleen een test
 * die nooit een band krijgt. Overlappende banden leveren gewoon de eerste op die
 * past.
 *
 * Let op het onderscheid dat deze functie NIET afdwingt: protocolConfirmed en
 * classificationEnabled beantwoorden twee verschillende vragen.
 *
 *   protocolConfirmed=false  -> longitudinaal vergelijken is niet gedekt, want
 *                               positie, hoek of hefboom ligt niet vast.
 *   classificationEnabled=false -> indelen is niet veilig, want de
 *                               tekenconventie of de bandindeling klopt niet.
 *
 * Knee-to-wall heeft het eerste probleem en niet het tweede: de banden zijn
 * sluitend en meer is duidelijk beter, alleen ontbreken de teen-muurcriteria.
 * De 90-90 heeft het tweede. Ze aan elkaar koppelen zou de helft van de
 * bruikbare afkapwaarden uitzetten op grond van een andere vraag.
 */
export function validateLibrary(library: Library = LIBRARY): string[] {
  const errors: string[] = [];
  const dupes = (what: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) errors.push(`${what}: dubbele sleutel '${k}'`);
      seen.add(k);
    }
  };

  dupes("test_definitions", library.tests.map((t) => t.key));
  dupes("metric_definitions", library.metrics.map((m) => m.key));
  dupes(
    "test_protocols",
    library.protocols.map((p) => `${p.testKey}@${p.version}`),
  );
  dupes("reference_rules", library.rules.map((r) => `${r.ruleKey}@${r.version}`));

  // (block, sort_order) is uniek in de databank; een botsing hier is daar een
  // mislukte insert halverwege de seed.
  dupes(
    "test_definitions (block, sort_order)",
    library.tests.map((t) => `${t.block}#${t.sortOrder}`),
  );

  const testKeys = new Set(library.tests.map((t) => t.key));
  const metrics = new Map(library.metrics.map((m) => [m.key, m]));

  for (const p of library.protocols) {
    if (!testKeys.has(p.testKey)) {
      errors.push(`protocol '${p.testKey}@${p.version}' verwijst naar een onbekende test`);
    }
  }
  for (const t of library.tests) {
    if (!library.protocols.some((p) => p.testKey === t.key)) {
      errors.push(`test '${t.key}' heeft geen protocol`);
    }
  }
  for (const m of library.metrics) {
    if (!testKeys.has(m.testKey)) {
      errors.push(`metriek '${m.key}' verwijst naar een onbekende test '${m.testKey}'`);
    }
    // Een 0-3-score waarvan minder beter zou zijn bestaat niet in deze bron, en
    // zou elke band omdraaien.
    if (m.unit === "score" && m.direction !== "higher_better") {
      errors.push(`metriek '${m.key}': een score hoort higher_better te zijn`);
    }

    // Een genormaliseerde metriek met een verkeerde bron of eenheid faalt niet,
    // hij levert een rij op die altijd op unavailable staat. Dat leest als een
    // ontbrekende meting terwijl het een ontbrekende definitie is, en daarom
    // hoort het hier en niet pas in de motor.
    if (m.derivedFrom) {
      const bron = metrics.get(m.derivedFrom.metricKey);
      if (!bron) {
        errors.push(
          `metriek '${m.key}': afgeleid van een onbekende metriek '${m.derivedFrom.metricKey}'`,
        );
      } else if (bron.unit !== "n") {
        // perBodyMass en perBodyWeight eisen allebei newton. Dit vangt ook een
        // keten: een bron die zelf genormaliseerd is staat in n_per_kg of xbw.
        errors.push(
          `metriek '${m.key}': de bron '${bron.key}' staat in ${bron.unit}, normaliseren vraagt n`,
        );
      }
      const verwacht = m.derivedFrom.derivedKey === "per_body_mass" ? "n_per_kg" : "xbw";
      if (m.unit !== verwacht) {
        errors.push(
          `metriek '${m.key}': ${m.derivedFrom.derivedKey} levert ${verwacht}, niet ${m.unit}`,
        );
      }
    }
  }

  for (const r of library.rules) {
    const metric = metrics.get(r.metricKey);
    if (!metric) {
      errors.push(`regel '${r.ruleKey}' verwijst naar een onbekende metriek '${r.metricKey}'`);
      continue;
    }
    // Spiegelt reference_rules_gapped_cannot_classify. Hier gevangen levert een
    // regelnaam op; daar levert het een mislukte migratie op.
    if (r.coverage === "gapped" && r.classificationEnabled) {
      errors.push(`regel '${r.ruleKey}': een reeks met gaten mag niet classificeren`);
    }
    if (r.evidence === "published" && !r.sourceCitation) {
      errors.push(`regel '${r.ruleKey}': een gepubliceerde norm heeft een citatie nodig`);
    }
    // Een streefbereik is aan twee kanten slechter en heeft dus minstens drie
    // banden; met twee is het gewoon een drempel en klopt de richting niet.
    if (metric.direction === "target_range" && r.bands.length < 3) {
      errors.push(`regel '${r.ruleKey}': target_range heeft minstens drie banden nodig`);
    }
    for (const problem of validateBands(r.bands, r.coverage)) {
      errors.push(`regel '${r.ruleKey}': ${problem}`);
    }
  }

  return errors;
}
