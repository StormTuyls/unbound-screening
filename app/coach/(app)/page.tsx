import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { listAthletesForScreening } from "@/lib/db/athletes";
import { AthleteWorkList } from "@/components/coach/AthleteWorkList";
import { OVERDUE_DAYS, isOverdue } from "@/lib/screening/overdue";
import { PRACTICE_NAME } from "@/lib/report/branding";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athletes"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * De ingang van de app.
 *
 * Die was er niet: er was geen app/page.tsx en geen /coach, dus wie inlogde
 * kwam op een route die niet bestond en een atleet openen vroeg dat je zijn
 * uuid kende.
 *
 * Drie tegels en geen vier. Het ontwerp heeft er een vierde, "Nog niet in de
 * motor · asymmetrie, N/kg, ratio", en dat is onze eigen bouwstatus. Die hoort
 * niet op het scherm van de praktijk.
 */
export default async function CoachHomePage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/coach/login?next=/coach");
  if (access.kind !== "coach") notFound();

  const { rows, thisMonth, lastMonth } = await listAthletesForScreening({
    id: access.coach.id,
  });

  const t = await getTranslations("athletes");

  // De dag komt van de server en gaat als tekst mee naar de lijst, zodat de
  // tegels en de regels dezelfde dag tellen. Een new Date() in de client zou
  // bij het hydrateren een andere dag kunnen geven dan de server net rekende.
  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows.filter((row) => isOverdue(row.lastScreening, today)).length;

  const flagged = rows.filter((row) => row.openFlags > 0);
  const openFlags = flagged.reduce((sum, row) => sum + row.openFlags, 0);

  const tiles = [
    {
      label: t("thisMonth"),
      value: thisMonth,
      note: t("thisMonthNote", { n: lastMonth }),
      alert: false,
    },
    {
      label: t("overdue", { days: OVERDUE_DAYS }),
      value: overdue,
      note: t("overdueNote"),
      alert: overdue > 0,
    },
    {
      label: t("openFlags"),
      value: openFlags,
      note: t("openFlagsNote", { count: flagged.length }),
      alert: openFlags > 0,
    },
  ];

  return (
    <>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-muted">
          {PRACTICE_NAME} · {t("activeFiles", { count: rows.length })}
        </p>
      </header>

      <div className="mb-8 grid gap-2.5 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="border border-hairline bg-surface px-3.5 py-3">
            <p className="text-label text-ink-muted uppercase">{tile.label}</p>
            <p
              className={`mt-1.5 text-2xl font-medium tabular-nums ${
                tile.alert ? "text-warn" : ""
              }`}
            >
              {tile.value}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">{tile.note}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
          <h2 className="text-sm font-semibold">{t("lastScreened")}</h2>
          <p className="text-xs text-ink-muted">{t("sortNote")}</p>
        </div>
        <AthleteWorkList athletes={rows} today={today} />
      </section>
    </>
  );
}
