import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { currentAthlete } from "@/lib/athlete/identity";
import { getReleasedSession } from "@/lib/db/screening";
import { getScreeningReport } from "@/lib/report/screeningFreeze";
import type { SnapshotResult } from "@/lib/report/screeningSnapshot";
import { isUuid } from "@/lib/review/access";
import { unitSuffix } from "@/lib/screening/units";

export async function generateMetadata() {
  const t = await getTranslations("mine");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Eén meting, zoals de atleet hem ziet.
 *
 * Dit is NIET het rapport van de behandelaar met een andere kop erop. Twee
 * dingen staan er met opzet niet in, en dat is de hele vorm van dit scherm:
 *
 * GEEN BANDWOORDEN. "poor", "fair", "attention" zijn klinische indelingen
 * tegen een referentieregel. Losgezongen van die regel zegt "poor" een atleet
 * niets bruikbaars en wel iets angstaanjagends. De literatuur over
 * patiëntportalen noemt een uitslag met een afwijkingsvlag en zonder uitleg
 * met zoveel woorden een ontwerpfout. Zijn eigen getal en de richting staan er
 * wel: die gegevens zijn van hem, en ze achterhouden betekent alleen dat hij
 * er per e-mail om vraagt.
 *
 * GEEN SAMENVATTING VAN DE BEHANDELAAR. Die bestaat voor de praktijk, niet
 * voor de atleet; zie PRACTICE_LOCALE in lib/report/branding. Wat hij wel
 * leest is wat zijn behandelaar bewust voor hem schreef: het besluit, de
 * ontwikkelpunten met hun werkdoel, en wat goed gaat.
 *
 * De volgorde volgt wat die literatuur aanraadt: eerst de conclusie van een
 * mens, dan wat eraan gedaan wordt, dan pas de cijfers, en de uitleg erachter
 * pas als je erom vraagt.
 *
 * Rendert uitsluitend uit een bevroren versie. Dat is hier geen detail: de
 * praktijk kan een drempel bijstellen, en een meting die de atleet vorige
 * maand las hoort volgende maand hetzelfde te zeggen.
 */

/** Alleen de kant, in gewone woorden. Geen L en R, dat is tabeltaal. */
function sideWord(side: string, t: (key: "left" | "right") => string): string {
  return side === "left" ? t("left") : side === "right" ? t("right") : "";
}

export default async function MyMeasurementPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();

  const athlete = await currentAthlete();
  if (!athlete) redirect(`/praktijk/login?next=/metingen/${sessionId}`);

  // De poort is eigenaarschap en vrijgave tegelijk. Niet van hem, of nog niet
  // afgerond: allebei een 404, want een onderscheid zou vertellen welke
  // sessies bestaan.
  const released = await getReleasedSession(athlete.athleteId, sessionId);
  if (!released) notFound();

  const report = await getScreeningReport(sessionId, released.version);
  if (!report) notFound();

  const t = await getTranslations("mine");
  const locale = await getLocale();
  const s = report.snapshot;

  const name = (row: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? row.testLabelNl : row.testLabelEn;

  const observations = s.observations ?? [];
  const byKind = (kind: "strength" | "development") =>
    observations
      .filter((note) => note.kind === kind)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const developments = byKind("development");
  const strengths = byKind("strength");

  // De vorige waarde per metriek en zijde, uit de deltarijen. Dezelfde bron
  // als het rapport van de behandelaar gebruikt, zodat de twee niet uit elkaar
  // kunnen lopen.
  const previous = new Map<string, number>();
  for (const row of s.results) {
    if (row.kind === "delta" && typeof row.inputs?.previous === "number") {
      previous.set(`${row.metricKey}|${row.side}`, row.inputs.previous);
    }
  }

  const all = s.results.filter(
    (row): row is SnapshotResult =>
      row.kind === "absolute" && row.status === "computed" && row.value !== null,
  );

  /**
   * De kerncijfers, niet alles.
   *
   * Een screening levert veertig gemeten waarden op, en veertig regels leest
   * niemand; op dit scherm worden het er veertig die je niet kunt wegen. De
   * praktijk markeert zelf welke tests de kerncijfers zijn (cover_rank op de
   * metriek, dezelfde selectie als de kaft van het rapport). Welke ertoe doen
   * is een klinisch oordeel, en dat hoort niet in een renderer thuis.
   *
   * Markeert ze niets, dan alles: stilletjes weglaten wat niemand gekozen
   * heeft is erger dan een lange lijst. De regel onderaan zegt sowieso dat hij
   * recht heeft op zijn volledige gegevens.
   */
  const cover = all
    .filter((row) => row.coverRank != null)
    .sort((a, b) => (a.coverRank ?? 99) - (b.coverRank ?? 99));
  const measured = cover.length > 0 ? cover : all;

  const line = (row: SnapshotResult) => {
    const was = previous.get(`${row.metricKey}|${row.side}`);
    if (typeof was !== "number") return t("firstTime");
    const diff = (row.value as number) - was;
    // Op de precisie van de meting zelf, anders leest "0,0 cm meer" als een
    // verandering die er niet is.
    const step = Number(Math.abs(diff).toFixed(row.decimals));
    if (step === 0) return t("same");
    const amount = `${step.toFixed(row.decimals)}${unitSuffix(row.unit)}`;
    return diff > 0 ? t("moreThan", { n: amount }) : t("lessThan", { n: amount });
  };

  return (
    <>
      <Link
        href="/metingen"
        className="inline-flex min-h-11 items-center text-sm text-ink-muted underline underline-offset-2"
      >
        {t("back")}
      </Link>

      <h1 className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {released.occurredOn}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {[
          released.testerName ? t("measuredBy", { name: released.testerName }) : null,
          t("releasedOn", { date: released.releasedAt }),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {/* 1. Eerst wat een mens erover schreef. */}
      <section className="mt-6 rounded-card border border-brand-600 bg-canvas px-4 py-4">
        <h2 className="text-label text-brand-700 uppercase">{t("conclusionTitle")}</h2>
        <p className="mt-2 text-base leading-relaxed">
          {s.notes ?? <span className="text-ink-muted">{t("noConclusion")}</span>}
        </p>
      </section>

      {/* 2. Wat eraan gedaan wordt, met het werkdoel dat de behandelaar erbij
             schreef. Zonder dat is een ontwikkelpunt een verwijt. */}
      {developments.length > 0 && (
        <section className="mt-8">
          <h2 className="border-b border-hairline pb-2 text-base font-semibold">
            {t("workTitle")}
          </h2>
          <ol className="divide-y divide-rule">
            {developments.map((note, index) => (
              <li key={note.id} className="flex gap-3.5 py-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-muted tabular-nums"
                >
                  {note.rank ?? index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block leading-relaxed">{note.body}</span>
                  {note.target && (
                    <span className="mt-1 block text-sm font-medium text-brand-700">
                      {t("target")}: {note.target}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 3. En wat goed gaat. Een rapport dat alleen tekortkomingen opsomt
             klopt niet met wat er gemeten is. */}
      {strengths.length > 0 && (
        <section className="mt-8">
          <h2 className="border-b border-hairline pb-2 text-base font-semibold">
            {t("strengthsTitle")}
          </h2>
          <ul className="divide-y divide-rule">
            {strengths.map((note) => (
              <li key={note.id} className="flex gap-3 py-3 leading-relaxed">
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  className="mt-1 h-4 w-4 shrink-0"
                  fill="none"
                >
                  <path
                    d="M4 10.5 8 14.5 16 6"
                    stroke="var(--color-ok)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="min-w-0">{note.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 4. Dan pas de cijfers. Zijn eigen getal en de richting, zonder het
             bandwoord: zie de uitleg bovenaan dit bestand. */}
      {measured.length > 0 && (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
            <h2 className="text-base font-semibold">{t("numbersTitle")}</h2>
            <p className="text-sm text-ink-muted">{t("comparedTo")}</p>
          </div>
          <ul className="divide-y divide-rule">
            {measured.map((row, index) => {
              const side = sideWord(row.side, t);
              return (
                <li
                  key={`${row.metricKey}-${row.side}-${index}`}
                  className="flex items-center gap-4 py-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {name(row)}
                      {side && <span className="font-normal text-ink-muted">, {side}</span>}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-muted">{line(row)}</span>
                  </span>
                  <span className="shrink-0 text-lg font-semibold tabular-nums">
                    {(row.value as number).toFixed(row.decimals)}
                    {unitSuffix(row.unit)}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* Trapsgewijs: de uitleg pas als je erom vraagt. Zonder deze alinea
              is "9,0 cm" een getal zonder maat. */}
          <details className="mt-4 rounded-card border border-hairline bg-canvas">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 font-medium">
              {t("explainTitle")}
            </summary>
            <div className="space-y-2.5 px-4 pb-4 leading-relaxed">
              <p>{t("explainScale")}</p>
              <p>{t("explainBands")}</p>
              <p>{t("explainOne")}</p>
            </div>
          </details>
        </section>
      )}

      {/* 5. Een weg terug naar een mens. Een uitslagscherm zonder dat is waar
             patiëntportalen op stukgaan. */}
      <section className="mt-8 rounded-card border border-hairline bg-canvas px-4 py-4">
        <h2 className="text-base font-semibold">{t("askTitle")}</h2>
        <p className="mt-1.5 leading-relaxed">
          {released.testerName
            ? t("askBody", { name: released.testerName })
            : t("askBodyNoName")}
        </p>
      </section>

      <p className="mt-8 border-t border-hairline pt-3 text-xs text-ink-muted">
        {t("rightsNote")}
      </p>
    </>
  );
}
