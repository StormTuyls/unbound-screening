import assert from "node:assert/strict";
import {
  asymDirection,
  groupByMetric,
  ratioOf,
  type ResultRow,
} from "../../lib/screening/group";

/**
 * De groepering achter het rapportscherm.
 *
 * Alle getallen hieronder zijn verzonnen. De echte afkapwaarden staan niet in
 * git en horen ook niet in een testfixture; wat hier getest wordt is de vorm
 * van de groepering, niet een drempel van de praktijk.
 */

/** Een rij met alles ingevuld, zodat een test alleen zegt wat hij bedoelt. */
function row(over: Partial<ResultRow> & { metricKey: string }): ResultRow {
  return {
    testLabelNl: "Test", testLabelEn: "Test", metricLabelNl: "Test",
    metricLabelEn: "Test", label: "Test", block: "core", side: "bilateral",
    kind: "absolute", value: 10, unit: "cm", decimals: 1, status: "computed",
    unavailableReason: null, bandStatus: null, bandScore: null, bands: null,
    inputs: null, protocolConfirmed: true, coverRank: null, ruleNote: null,
    ruleSource: null, ruleEvidence: null, ruleVersion: null,
    ...over,
  };
}

/** Twee banden: 0 is de slechtste, 1 de beste. */
const TWO = [
  { status: "attention", score: 0, lt: 10 },
  { status: "normal", score: 1, gte: 10 },
];

/** Vier banden. Score 1 is hier de op een na slechtste, niet de beste. */
const FOUR = [
  { status: "poor", score: 0, lt: 10 },
  { status: "fair", score: 1, gte: 10, lt: 20 },
  { status: "good", score: 2, gte: 20, lt: 30 },
  { status: "excellent", score: 3, gte: 30 },
];

// ── 1. Vijf rijen over een test worden één regel ────────────────────────────
//
// Dit is de hele reden dat dit bestand bestaat: links, rechts, de asymmetrie
// en twee delta's gingen als vijf regels het scherm op.
{
  const groups = groupByMetric([
    row({ metricKey: "m", side: "right", value: 12 }),
    row({ metricKey: "m", side: "left", value: 15 }),
    row({ metricKey: "m", side: "left", kind: "delta", inputs: { previous: 13 } }),
    row({ metricKey: "m", side: "right", kind: "delta", inputs: { previous: 14 } }),
    row({ metricKey: "m", side: "bilateral", kind: "asymmetry", value: 20,
          inputs: { left: 15, right: 12 } }),
  ]);

  assert.equal(groups.length, 1, "één groep per metriek");
  const [g] = groups;
  assert.deepEqual(g.sides.map((s) => s.side), ["left", "right"],
    "links voor rechts, ongeacht de volgorde van de motor");
  assert.equal(g.asymmetry?.value, 20, "de asymmetrie hangt aan de groep");
  assert.equal(g.previous.get("left"), 13);
  assert.equal(g.previous.get("right"), 14);
  assert.equal(g.markers.length, 2, "een stip per gemeten zijde, niet per rij");
  assert.deepEqual(g.markers.map((m) => m.label), ["L", "R"]);
  assert.equal(g.markers[0].previous, 13, "de vorige waarde reist mee als open stip");
}

// ── 2. De band naar zijn plek op de schaal, niet naar de score ──────────────
//
// Score 1 is bij twee banden de beste uitkomst en bij vier de op een na
// slechtste. Dit was de fout die eerder letterlijk op het sessiescherm stond.
{
  assert.equal(ratioOf(row({ metricKey: "a", bands: TWO, bandScore: 1 })), 1,
    "score 1 van 1 is de top");
  assert.equal(ratioOf(row({ metricKey: "b", bands: FOUR, bandScore: 1 })), 1 / 3,
    "score 1 van 3 is bijna onderaan");
  assert.equal(ratioOf(row({ metricKey: "c", bandScore: 1 })), null,
    "zonder banden valt er niets te normaliseren");
  assert.equal(ratioOf(row({ metricKey: "d", bands: TWO })), null,
    "zonder score ook niet");
}

// ── 3. De slechtste kant bepaalt of een test opvalt ─────────────────────────
{
  const worst = (sides: Array<Partial<ResultRow>>) =>
    groupByMetric(sides.map((s, i) =>
      row({ metricKey: "m", side: i === 0 ? "left" : "right", ...s })))[0].attention;

  assert.equal(
    worst([{ bands: FOUR, bandScore: 3 }, { bands: FOUR, bandScore: 1 }]), "warn",
    "een goede linkerkant maskeert geen zwakke rechter");
  assert.equal(
    worst([{ bands: FOUR, bandScore: 3 }, { bands: FOUR, bandScore: 0 }]), "danger",
    "de onderste band weegt zwaarder dan de aandachtsband");
  assert.equal(
    worst([{ bands: FOUR, bandScore: 2 }, { bands: FOUR, bandScore: 3 }]), null,
    "vanaf twee derde van de schaal is er niets aan de hand");
  assert.equal(
    worst([{ bands: TWO, bandScore: 1 }, { bands: TWO, bandScore: 1 }]), null,
    "de top van een regel met twee banden is ook de top");
}

// ── 4. Niet beoordeeld is geen oordeel ──────────────────────────────────────
//
// Een meting zonder band is vastgelegd maar niet ingedeeld. Die mag geen
// streep krijgen, want dan leest "protocol staat nog niet vast" als "te laag".
{
  const [g] = groupByMetric([
    row({ metricKey: "m", side: "left", bands: FOUR, bandScore: 3 }),
    row({ metricKey: "m", side: "right" }),
  ]);
  assert.equal(g.attention, null, "een rij zonder band telt niet mee");

  const [none] = groupByMetric([row({ metricKey: "m" })]);
  assert.equal(none.attention, null, "een test zonder enige band evenmin");
}

// ── 5. Een lege of niet-gemeten rij krijgt geen stip ────────────────────────
{
  const [g] = groupByMetric([
    row({ metricKey: "m", side: "left", value: 15 }),
    row({ metricKey: "m", side: "right", value: null, status: "unavailable",
          unavailableReason: "missing_input" }),
  ]);
  assert.equal(g.sides.length, 2, "de rij blijft staan, zodat de kolom niet leeg oogt");
  assert.equal(g.markers.length, 1, "maar er staat geen stip op nul");
  assert.equal(g.markers[0].label, "L");
}

// ── 6. Banden en kaftplek: eerst gevonden wint ──────────────────────────────
//
// Een latere rij zonder banden mag ze niet wissen. Anders hangt het van de
// volgorde van de query af of een test een strip krijgt.
{
  const [g] = groupByMetric([
    row({ metricKey: "m", side: "left", bands: FOUR, bandScore: 2, coverRank: 1 }),
    row({ metricKey: "m", side: "right", bands: null, coverRank: null }),
  ]);
  assert.equal(g.bands?.length, 4);
  assert.equal(g.coverRank, 1);
}

// ── 7. De richting van een asymmetrie ───────────────────────────────────────
{
  const dir = (left: number | null, right: number | null) =>
    asymDirection(row({ metricKey: "m", kind: "asymmetry", inputs: { left, right } }));

  assert.equal(dir(12, 15), "left", "de laagste kant is de kant die achterblijft");
  assert.equal(dir(15, 12), "right");
  assert.equal(dir(15, 15), null, "gelijk heeft geen richting");
  assert.equal(dir(15, null), null, "en één kant ook niet");
}

console.log("screening-group: vijf rijen worden één regel, de band naar zijn plek op de schaal, niet beoordeeld is geen oordeel");
