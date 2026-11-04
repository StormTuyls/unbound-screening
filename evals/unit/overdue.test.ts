import assert from "node:assert/strict";
import { OVERDUE_DAYS, daysBetween, isOverdue } from "../../lib/screening/overdue";

/**
 * De drempel van de werklijst.
 *
 * Deze constante stond eerst in AthleteWorkList.tsx, een "use client"-module,
 * en de serverpagina importeerde hem daaruit. Dat typecheckt en het is stil
 * fout: wat een clientmodule exporteert komt aan de serverkant binnen als een
 * referentie en niet als de waarde, dus `dagen > OVERDUE_DAYS` was altijd
 * onwaar en de tegel telde alleen de nooit-gemeten atleten.
 *
 * Een unittest vangt die module-grens niet. Wat hij wel vastzet is de
 * rekensom eromheen, en vooral de rand: precies 90 dagen is nog geen
 * achterstand, 91 wel. Dat soort grens verschuift geruisloos bij de eerste
 * herschrijving.
 */

assert.equal(OVERDUE_DAYS, 90);

// ── dagen tellen ─────────────────────────────────────────────────────────────
assert.equal(daysBetween("2026-11-04", "2026-11-04"), 0);
assert.equal(daysBetween("2026-11-03", "2026-11-04"), 1);
assert.equal(daysBetween("2026-11-05", "2026-11-04"), -1, "een datum in de toekomst telt negatief");

// Over een zomertijdsprong heen. In Belgie gaat de klok op 2026-03-29 vooruit
// en op 2026-10-25 terug; met lokale tijd levert dat 23- en 25-uursdagen op en
// rondt het verschil naar een dag te veel of te weinig af.
assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2, "lentesprong");
assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2, "herfstsprong");
assert.equal(daysBetween("2025-11-04", "2026-11-04"), 365);

// ── de drempel ───────────────────────────────────────────────────────────────
const vandaag = "2026-11-04";
const dagenGeleden = (n: number) => {
  const d = new Date(`${vandaag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

assert.equal(isOverdue(dagenGeleden(89), vandaag), false);
assert.equal(isOverdue(dagenGeleden(90), vandaag), false, "precies 90 is nog geen achterstand");
assert.equal(isOverdue(dagenGeleden(91), vandaag), true, "91 wel");
assert.equal(isOverdue(vandaag, vandaag), false);

// Nooit gemeten is de grootste achterstand die er is, niet de kleinste. Zou dit
// false geven, dan staat een atleet zonder enige meting als bijgewerkt op het
// scherm.
assert.equal(isOverdue(null, vandaag), true);

console.log("overdue: dagen tellen over een tijdsprong, 90 is nog geen achterstand, nooit gemeten wel");
