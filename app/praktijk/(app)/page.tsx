import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { listAthletesForScreening } from "@/lib/db/athletes";
import { AthleteWorkList } from "@/components/coach/AthleteWorkList";
import { PRACTICE_NAME } from "@/lib/report/branding";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athletes"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * De ingang van de app.
 *
 * Eén werklijst voor allebei de helften van het werk. De intake had er een en
 * de screening had er een, met dezelfde namen en andere kolommen; sinds beide
 * dezelfde databank gebruiken is dat één lijst die in tweeën lag.
 *
 * De tegels stonden hier en zijn naar de lijst verhuisd, want ze zijn nu
 * filters en niet alleen tellers. Dat vraagt toestand in de browser, en de
 * tegel en de tabel die hij filtert horen dan in dezelfde component.
 *
 * Wat hier blijft is de serverkant: autoriseren, ophalen, en de dag vaststellen
 * zodat de tegels en de regels dezelfde dag tellen. Een new Date() in de client
 * zou bij het hydrateren een andere dag kunnen geven dan de server net rekende.
 */
export default async function CoachHomePage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/praktijk/login?next=/praktijk");
  if (access.kind !== "coach") notFound();

  const { rows, thisMonth, lastMonth } = await listAthletesForScreening({
    id: access.coach.id,
  });

  const t = await getTranslations("athletes");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-ink-muted">
          {PRACTICE_NAME} · {t("activeFiles", { count: rows.length })} ·{" "}
          {t("monthStat", { n: thisMonth, prev: lastMonth })}
        </p>
      </header>

      <AthleteWorkList
        athletes={rows}
        today={today}
        // Nakijken gebeurt in de intake-app, op een ander domein. Zonder adres
        // geen knop; de regel blijft dan gewoon staan met zijn intakestatus.
        intakeUrl={process.env.NEXT_PUBLIC_INTAKE_URL ?? null}
      />
    </>
  );
}
