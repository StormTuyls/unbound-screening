import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import {
  getAthleteProfile,
  listIntakesForAthlete,
  type AthleteIntake,
} from "@/lib/db/athletes";
import { getTimelineEvents, listSessions } from "@/lib/db/screening";
import { ageOn } from "@/lib/screening/population";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Het dossier van één atleet.
 *
 * Deze pagina bestond niet. De werklijst sprong rechtstreeks naar het verloop
 * per metriek, en daarmee was er geen plek waar je ziet wat er over deze
 * atleet bekend is voordat je in de cijfers duikt. De intake had zo'n plek wel,
 * op bijna hetzelfde pad, en dat was precies de tweede botsing tussen de twee
 * apps.
 *
 * Tabbladen als zoekparameter en niet als toestand in de browser. Drie redenen:
 * elk tabblad haalt alleen zijn eigen gegevens op, een tabblad is te linken en
 * te bookmarken, en de pagina blijft een servercomponent, dus de autorisatie
 * staat op één plek.
 *
 * De tijdlijn is de reden dat deze pagina hier hoort en niet in een van de twee
 * apps apart: de blessures komen uit de intake, de metingen uit de screening,
 * en pas naast elkaar zie je dat een knik in de cijfers op een blessure volgt.
 */

const TABS = ["dossier", "screening", "intakes"] as const;
type Tab = (typeof TABS)[number];

function toTab(raw: string | undefined): Tab {
  return TABS.includes(raw as Tab) ? (raw as Tab) : "dossier";
}

/** De datum die bij de status van een intake hoort, met het woord erbij. */
function intakeWhen(
  intake: AthleteIntake,
  t: Awaited<ReturnType<typeof getTranslations<"athletes">>>,
): string | null {
  if (intake.approvedAt) return t("approvedOn", { date: intake.approvedAt });
  if (intake.submittedAt) return t("submittedOn", { date: intake.submittedAt });
  if (intake.startedAt) return t("startedOn", { date: intake.startedAt });
  return null;
}

export default async function AthleteHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ athleteId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { athleteId } = await params;
  if (!isUuid(athleteId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/praktijk/login?next=/praktijk/athletes/${athleteId}`);
  }
  if (access.kind !== "coach") notFound();

  const tab = toTab((await searchParams).tab);

  const [athlete, sessions, intakes] = await Promise.all([
    getAthleteProfile(athleteId),
    listSessions(athleteId, { id: access.coach.id }),
    listIntakesForAthlete(athleteId),
  ]);
  if (!athlete) notFound();

  // Alleen waar hij getekend wordt: een blessurelijst ophalen voor een tabblad
  // dat hem niet toont is een query die niemand leest.
  const injuries = tab === "dossier" ? await getTimelineEvents(athleteId) : [];

  const t = await getTranslations("athletes");
  const ts = await getTranslations("screening");
  const titles = await getTranslations("titles");

  const today = new Date().toISOString().slice(0, 10);
  const age = ageOn(athlete.dateOfBirth, today);
  const meta = [
    age === null ? null : t("years", { n: age }),
    [athlete.sport, athlete.discipline].filter(Boolean).join(", ") || null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  const intakeUrl = process.env.NEXT_PUBLIC_INTAKE_URL;
  const lastIntake = intakes[0] ?? null;
  const lastSession = sessions[0] ?? null;

  const statusWord = (status: AthleteIntake["status"]) =>
    status === null
      ? t("intakeStatus.none")
      : t(`intakeStatus.${status}` as "intakeStatus.approved");

  // Drie bronnen, één lijst, nieuwste eerst. De soort staat er als woord bij,
  // want een stip in een kleur is op een afdruk en in grijswaarden niets.
  const timeline = [
    ...sessions.map((session) => ({
      date: session.occurredOn,
      kind: t("kindScreening"),
      title: ts("title"),
      sub: t("measurementsCount", { n: session.measurements }),
      href: `/praktijk/screening/${session.id}`,
      ink: "bg-brand-600",
    })),
    ...intakes.map((intake) => ({
      date: intake.at ?? "",
      kind: t("kindIntake"),
      title: statusWord(intake.status),
      sub: intakeWhen(intake, t) ?? "",
      href: intakeUrl ? `${intakeUrl}/review/${intake.id}` : null,
      ink: "bg-ok",
    })),
    ...injuries.map((injury) => ({
      date: injury.date,
      kind: t("kindInjury"),
      title: injury.label,
      sub: "",
      href: null,
      ink: "bg-danger",
    })),
  ]
    .filter((entry) => entry.date !== "")
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <>
      <Link
        href="/praktijk"
        className="inline-flex min-h-11 items-center text-xs text-ink-muted underline"
      >
        {t("title")}
      </Link>

      <header className="mt-1 flex flex-wrap items-start justify-between gap-5 border-b-2 border-brand-600 pb-3.5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            {athlete.name ?? t("nameUnknown")}
          </h1>
          {meta && <p className="mt-1 text-sm text-ink-muted">{meta}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Het intakedossier woont in de andere app, op dezelfde id uit
              dezelfde tabel. Zonder adres geen knop. */}
          {intakeUrl && (
            <a
              href={`${intakeUrl}/coach/athletes/${athleteId}`}
              className="inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
            >
              {titles("intakeFile")}
            </a>
          )}
          <Link
            href={`/praktijk/athletes/${athleteId}/screening/new`}
            className="inline-flex min-h-11 items-center rounded-md bg-brand-700 px-3.5 text-xs text-surface ring-1 ring-brand-700 ring-inset transition-colors hover:bg-brand-800"
          >
            {t("enter")}
          </Link>
        </div>
      </header>

      {/* Links en geen knoppen: een tabblad is hier een adres. */}
      <nav className="mt-4 flex flex-wrap gap-0.5 border-b border-hairline">
        {TABS.map((name) => {
          const current = name === tab;
          const count =
            name === "screening" ? sessions.length : name === "intakes" ? intakes.length : null;
          return (
            <Link
              key={name}
              href={`/praktijk/athletes/${athleteId}?tab=${name}`}
              aria-current={current ? "page" : undefined}
              className={`-mb-px flex min-h-11 items-center gap-1.5 border-b-2 px-3.5 text-sm transition-colors ${
                current
                  ? "border-brand-600 font-semibold text-ink"
                  : "border-transparent text-ink-muted hover:bg-canvas"
              }`}
            >
              {t(
                name === "dossier"
                  ? "tabDossier"
                  : name === "screening"
                    ? "tabScreening"
                    : "tabIntakes",
              )}
              {count !== null && count > 0 && (
                <span className="text-xs text-ink-muted tabular-nums">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === "dossier" && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <section className="rounded-card border border-hairline px-4 py-3.5">
              <h2 className="text-label text-ink-muted uppercase">{t("lastIntakeTitle")}</h2>
              {lastIntake === null ? (
                <p className="mt-2 text-sm text-ink-muted">{t("noIntakeYet")}</p>
              ) : (
                <>
                  <p className="mt-1.5 font-display text-lg font-semibold">
                    {statusWord(lastIntake.status)}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">{intakeWhen(lastIntake, t)}</p>
                  {intakeUrl && (
                    <a
                      href={`${intakeUrl}/review/${lastIntake.id}`}
                      className="mt-3 inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                    >
                      {t("openReport")}
                    </a>
                  )}
                </>
              )}
            </section>

            <section className="rounded-card border border-hairline px-4 py-3.5">
              <h2 className="text-label text-ink-muted uppercase">{t("lastScreeningTitle")}</h2>
              {lastSession === null ? (
                <p className="mt-2 text-sm text-ink-muted">{t("noScreeningYet")}</p>
              ) : (
                <>
                  <p className="mt-1.5 font-display text-lg font-semibold tabular-nums">
                    {lastSession.occurredOn}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {t("measurementsCount", { n: lastSession.measurements })}
                  </p>
                  <Link
                    href={`/praktijk/screening/${lastSession.id}`}
                    className="mt-3 inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                  >
                    {t("openReport")}
                  </Link>
                </>
              )}
            </section>
          </div>

          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
              <h2 className="text-sm font-semibold">{t("timelineTitle")}</h2>
              <p className="text-xs text-ink-muted">{t("timelineNote")}</p>
            </div>
            {timeline.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">{t("timelineEmpty")}</p>
            ) : (
              <ol className="divide-y divide-rule">
                {timeline.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${entry.date}-${index}`}
                    className="flex items-start gap-4 py-2.5"
                  >
                    <span className="w-24 shrink-0 text-xs text-ink-muted tabular-nums">
                      {entry.date}
                    </span>
                    <span aria-hidden className="shrink-0 pt-1.5">
                      <span className={`block h-2 w-2 rounded-full ${entry.ink}`} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      {entry.href ? (
                        <a href={entry.href} className="font-medium underline-offset-2 hover:underline">
                          {entry.title}
                        </a>
                      ) : (
                        <span className="font-medium">{entry.title}</span>
                      )}
                      {entry.sub && (
                        <span className="mt-0.5 block text-xs text-ink-muted">{entry.sub}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-label text-ink-muted uppercase">
                      {entry.kind}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {tab === "screening" && (
        <section className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2">
            <h2 className="text-sm font-semibold">{ts("sessionsCount", { count: sessions.length })}</h2>
            <Link
              href={`/praktijk/athletes/${athleteId}/screening`}
              className="text-xs text-brand-700 underline underline-offset-2"
            >
              {t("toTrend")}
            </Link>
          </div>
          {sessions.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{t("noScreeningYet")}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {sessions.map((session) => (
                <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="text-sm tabular-nums">{session.occurredOn}</span>
                  <span className="text-xs text-ink-muted">
                    {t("measurementsCount", { n: session.measurements })}
                  </span>
                  <Link
                    href={`/praktijk/screening/${session.id}`}
                    className="ml-auto inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                  >
                    {t("report")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "intakes" && (
        <section className="mt-6">
          <h2 className="border-b border-hairline pb-2 text-sm font-semibold">
            {t("tabIntakes")}
          </h2>
          {intakes.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{t("noIntakeYet")}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {intakes.map((intake) => (
                <li key={intake.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="text-sm">{statusWord(intake.status)}</span>
                  <span className="text-xs text-ink-muted">{intakeWhen(intake, t)}</span>
                  {/* Nakijken en goedkeuren gebeurt in de intake-app: daar
                      staat de inhoud, en daar hoort het oordeel erover. */}
                  {intakeUrl && (
                    <a
                      href={`${intakeUrl}/review/${intake.id}`}
                      className="ml-auto inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                    >
                      {t("openReport")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
