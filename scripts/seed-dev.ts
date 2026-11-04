import { loadEnv } from "./env";
loadEnv();

import { randomUUID } from "node:crypto";
import { appDb } from "../lib/supabase/service";
import { query } from "../lib/db/sql";
import { createSession, getHistory, getLibrary, toSpecs } from "../lib/db/screening";
import { evaluate } from "../lib/screening/evaluate";
import type { Band } from "../lib/screening/bands";

/**
 * Een praktijk om in rond te klikken: één coach, zes atleten, echte sessies.
 *
 * Alleen voor de ontwikkelmachine. Draait tegen de lokale stack en weigert
 * elders, want dit maakt een account met een wachtwoord dat in dit bestand
 * staat.
 *
 * Waarom niet een paar inserts: de sessies gaan door createSession heen, dus
 * door dezelfde evaluatie en dezelfde afgeleide rijen als het invoerscherm.
 * Een seed die de tabellen rechtstreeks vult laat precies de schermen heel die
 * je wilde bekijken en breekt pas bij de eerste echte invoer.
 *
 * Herhaalbaar: de zes atleten gaan er eerst uit, de coach wordt bijgewerkt.
 */

const COACH_EMAIL = "coach@unbound.test";
const COACH_PASSWORD = "screening-dev";
const MERK = "seed-dev";

const LOKAAL = /^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/;

/** Zes atleten; de laatste is nooit gescreend, want die regel moet het scherm ook aankunnen. */
const ATLETEN = [
  { naam: "Bram Coppens",    geboren: "2003-04-02", sport: "atletiek", discipline: "110 m horden", sex: "male",   massa: 78.4, dagen: 12,   vlaggen: 2 },
  { naam: "Noor De Smet",    geboren: "2007-01-20", sport: "atletiek", discipline: "400 m",        sex: "female", massa: 58.1, dagen: 17,   vlaggen: 0 },
  { naam: "Jarne Vandewalle",geboren: "2000-08-11", sport: "atletiek", discipline: "verspringen",  sex: "male",   massa: 74.9, dagen: 28,   vlaggen: 1 },
  { naam: "Lotte Maes",      geboren: "2004-02-27", sport: "roeien",   discipline: "skiff",        sex: "female", massa: 69.2, dagen: 54,   vlaggen: 0 },
  { naam: "Senne Dierckx",   geboren: "2002-11-05", sport: "voetbal",  discipline: "middenvelder", sex: "male",   massa: 81.0, dagen: 137,  vlaggen: 3 },
  { naam: "Fien Vermeulen",  geboren: "2009-06-14", sport: "atletiek", discipline: "zevenkamp",    sex: "female", massa: 54.3, dagen: null, vlaggen: 0 },
] as const;

function dagenGeleden(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Een waarde binnen een band, zodat de kleuren op het scherm ergens op slaan.
 *
 * `keuze` schuift per sessie op, dus dezelfde atleet krijgt bij een tweede
 * meting een andere band en het verloop loopt echt ergens heen.
 */
function waardeIn(bands: Band[] | null, decimals: number, keuze: number): number {
  if (!bands || bands.length === 0) return Number((10 + keuze).toFixed(decimals));
  const band = bands[keuze % bands.length];
  const stap = Math.max(10 ** -decimals, 1);
  if (band.gte !== undefined && band.lt !== undefined) {
    return Number(((band.gte + band.lt) / 2).toFixed(decimals));
  }
  if (band.lt !== undefined) return Number((band.lt - stap).toFixed(decimals));
  return Number(((band.gte as number) + stap).toFixed(decimals));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!LOKAAL.test(url)) {
    console.error(`weigert te draaien tegen ${url || "(geen URL)"}: alleen de lokale stack`);
    process.exit(1);
  }

  const db = appDb();

  // ── de coach ───────────────────────────────────────────────────────────────
  const { data: bestaande } = await db.auth.admin.listUsers({ perPage: 200 });
  const alAanwezig = bestaande?.users.find((u) => u.email === COACH_EMAIL);

  let coachId: string;
  if (alAanwezig) {
    coachId = alAanwezig.id;
    await db.auth.admin.updateUserById(coachId, { password: COACH_PASSWORD });
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: COACH_EMAIL,
      password: COACH_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`coach maken mislukt: ${error?.message}`);
    coachId = data.user.id;
  }

  const { error: profielFout } = await db
    .from("profiles")
    .upsert({ id: coachId, role: "coach", full_name: "Fre Vanderstukken", locale: "nl" });
  if (profielFout) throw new Error(`profiel mislukt: ${profielFout.message}`);

  // ── schoon beginnen ────────────────────────────────────────────────────────
  // medical.purge_athlete() is het nette pad maar vraagt een verzoekregel en een
  // grond; voor wegwerpdata uit deze seed is de cascade genoeg. Alleen rijen met
  // ons eigen merk, zodat een handmatig aangemaakte atleet blijft staan.
  const { data: oud } = await db
    .from("athletes")
    .select("id")
    .eq("retention_basis", MERK);
  for (const rij of oud ?? []) {
    await query("delete from medical.screening_notes where athlete_id = $1", [rij.id]);
    await query(
      `delete from medical.measurements
        where test_item_id in (
          select ti.id from medical.test_items ti
            join medical.screening_sessions s on s.id = ti.session_id
           where s.athlete_id = $1)`,
      [rij.id],
    );
    await query(
      `delete from medical.derived_results
        where session_id in (select id from medical.screening_sessions where athlete_id = $1)`,
      [rij.id],
    );
    await query(
      `delete from medical.test_items
        where session_id in (select id from medical.screening_sessions where athlete_id = $1)`,
      [rij.id],
    );
    await query("delete from medical.screening_reports where athlete_id = $1", [rij.id]);
    await query("delete from medical.screening_sessions where athlete_id = $1", [rij.id]);
    await db.from("athletes").delete().eq("id", rij.id);
  }

  // ── de bibliotheek ─────────────────────────────────────────────────────────
  const library = await getLibrary();
  if (library.length === 0) {
    console.error("de bibliotheek is leeg; draai eerst npm run seed:screening");
    process.exit(1);
  }
  const specs = toSpecs(library);
  // Afgeleide metrieken worden gerekend, niet ingevoerd. Net als het invoerscherm.
  const meetbaar = library.filter((t) => t.derivedFrom === null);

  const actor = { id: coachId };
  let sessies = 0;

  for (const [index, a] of ATLETEN.entries()) {
    const { data: rij, error } = await db
      .from("athletes")
      .insert({
        full_name: a.naam,
        email: `${a.naam.toLowerCase().replace(/[^a-z]+/g, ".")}@example.invalid`,
        date_of_birth: a.geboren,
        sport: a.sport,
        discipline: a.discipline,
        sex: a.sex,
        retention_basis: MERK,
      })
      .select("id")
      .single();
    if (error || !rij) throw new Error(`atleet ${a.naam}: ${error?.message}`);
    const athleteId = rij.id as string;

    if (a.dagen === null) continue;

    // Altijd twee metingen, zodat het verloop een lijn heeft en de sessiepagina
    // een delta kan tonen. Een seed met één punt per atleet laat precies de
    // schermen leeg die je wilde bekijken.
    const data = [a.dagen + 95, a.dagen];
    let laatsteSessie: string | null = null;

    for (const [ronde, dagen] of data.entries()) {
      const occurredOn = dagenGeleden(dagen);
      const entries = meetbaar.flatMap((t) => {
        const zijden = t.laterality === "per_side" ? (["left", "right"] as const) : (["bilateral"] as const);
        return zijden.map((side, z) => ({
          protocolId: t.protocolId,
          metricKey: t.metricKey,
          side,
          value: waardeIn(t.rule?.bands ?? null, t.decimals, index + ronde * 2 + z),
        }));
      });

      const history = await getHistory(athleteId, entries.map((e) => e.metricKey));
      laatsteSessie = await createSession(
        {
          athleteId,
          occurredOn,
          clientToken: randomUUID(),
          testerProfileId: coachId,
          testerName: "Fre Vanderstukken",
          bodyMassKg: a.massa,
          notes:
            ronde === data.length - 1
              ? "Mobiliteit links blijft achter op rechts. Opbouw voortzetten, hertest over zes weken."
              : null,
          entries,
        },
        evaluate(entries, specs, history, `${occurredOn}T09:00:00Z`),
        actor,
      );
      sessies += 1;
    }

    // ── vlaggen ──────────────────────────────────────────────────────────────
    for (let v = 0; v < a.vlaggen; v += 1) {
      await query(
        `insert into medical.screening_notes
           (athlete_id, session_id, metric_key, severity, body, action,
            author_profile_id, author_name)
         values ($1, $2, null, $3, $4, $5, $6, 'Fre Vanderstukken')`,
        [
          athleteId,
          laatsteSessie,
          (["action", "watch", "info"] as const)[v % 3],
          [
            "Asymmetrie heup abductie boven 10%. Navragen bij de trainer.",
            "Enkel dorsiflexie links onder de drempel; opvolgen bij de volgende test.",
            "Atleet meldt stijfheid na belasting, nog geen pijn.",
          ][v % 3],
          v === 0 ? "Hertest over zes weken" : null,
          coachId,
        ],
      );
    }

    // Eén gesloten vlag bij de eerste atleet, zodat de teller bewijsbaar alleen
    // open vlaggen telt en het sessiescherm beide toestanden laat zien.
    if (index === 0) {
      await query(
        `insert into medical.screening_notes
           (athlete_id, session_id, metric_key, severity, state, body,
            author_profile_id, author_name, resolved_at, resolved_by)
         values ($1, $2, null, 'watch', 'resolved',
                 'Liesklacht rechts opgevolgd, geen beperking meer.',
                 $3, 'Fre Vanderstukken', now(), $3)`,
        [athleteId, laatsteSessie, coachId],
      );
    }
  }

  console.log(
    `seed-dev: ${ATLETEN.length} atleten, ${sessies} sessies, ` +
      `inloggen met ${COACH_EMAIL} / ${COACH_PASSWORD}`,
  );
}

await main();
process.exit(0);
