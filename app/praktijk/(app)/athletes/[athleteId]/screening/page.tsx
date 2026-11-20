import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { getAthleteProfile } from "@/lib/db/athletes";
import {
  getAthletePopulation,
  getLibrary,
  getTimelineEvents,
  getTrends,
  listSessions,
} from "@/lib/db/screening";
import { MetricTrend } from "@/components/coach/MetricTrend";
import { BandStrip } from "@/components/report/BandStrip";
import { shiftsOn } from "@/lib/screening/shift";
import { unitSuffix } from "@/lib/screening/units";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

/**
 * Het verloop per metriek. FR-12.
 *
 * Elke grafiek heeft een tabel als tweelingweergave: een waarde mag nooit
 * alleen uit een plaatje te halen zijn, en een lijn van drie punten is voor
 * een schermlezer niets.
 */
export default async function ScreeningTrendPage({
  params,
}: {
  params: Promise<{ athleteId: string }>;
}) {
  const { athleteId } = await params;
  if (!isUuid(athleteId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/praktijk/login?next=/praktijk/athletes/${athleteId}/screening`);
  }
  if (access.kind !== "coach") notFound();

  const today = new Date().toISOString().slice(0, 10);
  const [athlete, trends, sessions, events, population] = await Promise.all([
    getAthleteProfile(athleteId),
    getTrends(athleteId, { id: access.coach.id }),
    listSessions(athleteId, { id: access.coach.id }),
    getTimelineEvents(athleteId),
    getAthletePopulation(athleteId, today),
  ]);
  if (!athlete) notFound();

  // De banden van vandaag, net als op het invoerscherm: dit blok zegt waar een
  // meting nu staat, niet hoe ze op de meetdag beoordeeld werd. Dat laatste
  // staat in het bevroren rapport.
  const library = population ? await getLibrary(population) : [];
  const bandsByMetric = new Map(
    library.flatMap((item) =>
      item.rule?.classificationEnabled ? [[item.metricKey, item.rule.bands] as const] : [],
    ),
  );
  const latest = trends.flatMap((m) => m.points.map((p) => p.date)).sort().at(-1) ?? null;
  const shifts = latest
    ? shiftsOn(latest, trends, (key) => bandsByMetric.get(key) ?? null).slice(0, 5)
    : [];
  const trendByKey = new Map(trends.map((m) => [m.metricKey, m]));

  const t = await getTranslations("screening");
  const titles = await getTranslations("titles");
  const locale = await getLocale();

  const name = (m: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? m.testLabelNl : m.testLabelEn;

  const labels = {
    left: t("left"),
    right: t("right"),
    protocolChanged: t("protocolChanged"),
    injury: t("asymmetry"),
  };

  const byBlock = new Map<string, typeof trends>();
  for (const trend of trends) {
    const list = byBlock.get(trend.block) ?? [];
    list.push(trend);
    byBlock.set(trend.block, list);
  }
  const ordered = [...byBlock].sort(
    (a, b) => (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
  );

  return (
    <>
      {/* De naam hoort niet in een link: dit IS de pagina van deze atleet, dus
          hij is de kop. */}
      <header className="mb-8 flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {athlete.name ?? t("trend")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("trend")} · {t("sessionsCount", { count: sessions.length })}
          </p>
          <p className="mt-2 max-w-prose text-xs text-ink-faint">{t("trendIntro")}</p>
        </div>

        <Link
          href={`/praktijk/athletes/${athleteId}?tab=intakes`}
          className="flex min-h-11 shrink-0 items-center rounded-md px-3 text-xs font-medium text-ink-muted ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
        >
          {titles("intakeFile")}
        </Link>
      </header>

      {/* Eerst wat er veranderd is, dan alles. Bij vijftig metingen is de vraag
          na een screening niet "hoe staat alles", maar "wat is er bewogen". */}
      {shifts.length > 0 && latest && (
        <section className="mb-10">
          <h2 className="text-base font-semibold">{t("shiftedTitle", { date: latest })}</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-muted">{t("shiftedIntro")}</p>
          <ul className="mt-3 divide-y divide-rule border-t border-hairline">
            {shifts.map((shift) => {
              const metric = trendByKey.get(shift.metricKey)!;
              const bands = bandsByMetric.get(shift.metricKey)!;
              const letter = (side: string) =>
                side === "left" ? t("left").slice(0, 1).toUpperCase()
                  : side === "right" ? t("right").slice(0, 1).toUpperCase()
                    : "";
              return (
                <li
                  key={shift.metricKey}
                  className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center"
                >
                  <div className="min-w-0">
                    <span className="block text-sm font-medium">{name(metric)}</span>
                    {shift.sides.map((side) => (
                      <span key={side.side} className="block text-xs text-ink-muted tabular-nums">
                        {letter(side.side) && `${letter(side.side)} `}
                        {side.previous.toFixed(metric.decimals)} → {side.value.toFixed(metric.decimals)}
                        {unitSuffix(metric.unit)} ·{" "}
                        {side.band ? side.band.status.replace(/_/g, " ") : t("noBand")}
                      </span>
                    ))}
                  </div>
                  <BandStrip
                    bands={bands.map((band) => ({ ...band, score: band.score ?? null }))}
                    markers={shift.sides.map((side) => ({
                      value: side.value,
                      label: letter(side.side),
                      previous: side.previous,
                    }))}
                    className="w-full"
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {trends.length === 0 ? (
        <p className="text-sm text-ink-faint">{t("noTrend")}</p>
      ) : (
        ordered.map(([block, items]) => (
          <section key={block} className="mb-8">
            <h2 className="mb-3 text-sm font-medium">
              {t(`blocks.${block}` as "blocks.core")}
            </h2>
            <ul className="grid gap-6 sm:grid-cols-2">
              {items.map((metric) => {
                const bySide = new Map<string, typeof metric.points>();
                for (const p of metric.points) {
                  const list = bySide.get(p.side) ?? [];
                  list.push(p);
                  bySide.set(p.side, list);
                }
                const series = [...bySide].map(([side, points]) => ({
                  side: side as "left" | "right" | "bilateral" | "unknown",
                  points,
                }));
                const dates = [...new Set(metric.points.map((p) => p.date))].sort();

                return (
                  <li key={metric.metricKey} className="min-w-0">
                    <h3 className="mb-1 text-xs font-medium">{name(metric)}</h3>
                    <MetricTrend
                      series={series}
                      labels={labels}
                      events={events}
                      decimals={metric.decimals}
                    />

                    {/* De tweelingweergave. Elke waarde die in de grafiek staat
                        is hier ook te lezen, zonder kleur en zonder muis. */}
                    <details className="mt-1">
                      <summary className="min-h-11 cursor-pointer py-3.5 text-[10px] text-ink-muted">
                        {t("tableView")}
                      </summary>
                      <table className="mt-1 w-full text-[10px] tabular-nums">
                        <thead>
                          <tr className="text-ink-faint">
                            <th scope="col" className="py-0.5 text-left font-normal">
                              {t("date")}
                            </th>
                            {series.map((s) => (
                              <th key={s.side} scope="col" className="py-0.5 text-right font-normal">
                                {s.side === "left" ? t("left") : s.side === "right" ? t("right") : metric.unit}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dates.map((date) => (
                            <tr key={date} className="border-t border-hairline">
                              <th scope="row" className="py-0.5 text-left font-normal text-ink-muted">
                                {date}
                              </th>
                              {series.map((s) => {
                                const point = s.points.find((p) => p.date === date);
                                return (
                                  <td key={s.side} className="py-0.5 text-right">
                                    {point ? point.value.toFixed(metric.decimals) : "-"}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
