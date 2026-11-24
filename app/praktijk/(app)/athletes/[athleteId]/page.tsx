import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { PurgeAthlete } from "@/components/coach/PurgeAthlete";
import { AssignPractitioner } from "@/components/coach/AssignPractitioner";
import { getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import {
  getAthleteProfile,
  listIntakesForAthlete,
  type AthleteIntake,
} from "@/lib/db/athletes";
import { getTimelineEvents, listSessions } from "@/lib/db/screening";
import { listDocuments } from "@/lib/db/medical";
import { listTeam } from "@/lib/db/practitioners";
import { kindLabel } from "@/lib/intake/format";
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

const TABS = ["dossier", "screening", "intakes", "documents", "consent"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL = {
  dossier: "tabDossier",
  screening: "tabScreening",
  intakes: "tabIntakes",
  documents: "tabDocuments",
  consent: "tabConsent",
} as const;

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
  const [injuries, team, documents] = await Promise.all([
    tab === "dossier" ? getTimelineEvents(athleteId) : [],
    tab === "dossier" ? listTeam() : [],
    // Documenten hangen aan een intake, niet aan de atleet. Per intake ophalen
    // en samenvoegen; meer dan een handvol intakes heeft niemand.
    tab === "documents"
      ? Promise.all(
          intakes.map(async (intake) =>
            (await listDocuments(intake.id)).map((doc) => ({ ...doc, intakeId: intake.id })),
          ),
        ).then((lists) => lists.flat().sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)))
      : [],
  ]);

  // Gearchiveerde behandelaars blijven kiesbaar, met een label: een dossier
  // terugzetten op wie het behandeld heeft is een correctie die moet kunnen.
  const assignable = team
    .filter((member) => member.kind !== null)
    .map((member) => ({
      id: member.id,
      name: member.fullName,
      kind: member.kind!,
      archived: member.archivedAt !== null,
    }));

  const t = await getTranslations("athletes");
  const ts = await getTranslations("screening");
  const tc = await getTranslations("coach");
  const tf = await getTranslations("files");

  const today = new Date().toISOString().slice(0, 10);
  const age = ageOn(athlete.dateOfBirth, today);
  const meta = [
    age === null ? null : t("years", { n: age }),
    [athlete.sport, athlete.discipline].filter(Boolean).join(", ") || null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

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
      href: `/review/${intake.id}`,
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
              {t(TAB_LABEL[name])}
              {count !== null && count > 0 && (
                <span className="text-xs text-ink-muted tabular-nums">{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === "dossier" && (
        <>
          {/* Iemand met een login hier. De atleet kiest hem op zijn profiel; de
              praktijk kan het hier corrigeren. */}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-xs text-ink-muted">{tc("assignedTo")}</span>
            <AssignPractitioner
              athleteId={athlete.id}
              current={athlete.practitionerId}
              options={assignable}
            />
          </div>

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
                  <Link
                    href={`/review/${lastIntake.id}`}
                    className="mt-3 inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                  >
                    {t("openReport")}
                  </Link>
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
                  <Link
                    href={`/review/${intake.id}`}
                    className="ml-auto inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                  >
                    {t("openReport")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "documents" && (
        <section className="mt-6">
          <h2 className="border-b border-hairline pb-2 text-sm font-semibold">
            {t("tabDocuments")}
          </h2>
          {documents.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{t("noDocuments")}</p>
          ) : (
            <ul className="divide-y divide-rule">
              {documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0 text-sm break-all">{doc.originalFilename}</span>
                  <span className="text-xs text-ink-muted">
                    {[
                      kindLabel(doc.kind, doc.mimeType, tf as (key: string) => string),
                      doc.uploadedAt.slice(0, 10),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {/* De staat als woord: een document dat niet gelezen kon worden
                      is precies wat de behandelaar moet zien. */}
                  <span
                    className={`text-xs ${doc.processingError ? "text-danger" : "text-ink-muted"}`}
                  >
                    {tf(doc.processingError ? "failed" : doc.processedAt ? "read" : "unread")}
                  </span>
                  <Link
                    href={`/review/${doc.intakeId}`}
                    className="ml-auto inline-flex min-h-11 items-center rounded-md px-3.5 text-xs ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
                  >
                    {t("openReport")}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Bewaartermijn, toestemming en verwijderen zijn eigenschappen van de
          persoon, niet van een intake. Verwijderen staat hier en niet onder een
          lijst die je aanklikt: het is de enige handeling die niet terug kan. */}
      {tab === "consent" && (
        <>
          <section className="mt-6">
            <h2 className="border-b border-hairline pb-2 text-sm font-semibold">
              {tc("dataAndConsent")}
            </h2>
            <dl className="divide-y divide-rule">
              {[
                [
                  tc("retention"),
                  athlete.retentionMode === "until_date"
                    ? tc("keptUntil", { date: athlete.retentionUntil ?? tc("unknown") })
                    : tc("keptIndefinitely"),
                ],
                [tc("retentionBasis"), athlete.retentionBasis],
                [
                  tc("consentOnFile"),
                  athlete.accountConsentAt
                    ? tc("consentGiven", { date: athlete.accountConsentAt })
                    : null,
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:gap-3">
                  <dt className="text-xs text-ink-muted sm:w-48 sm:shrink-0">{label}</dt>
                  <dd className={value ? "min-w-0" : "min-w-0 text-ink-faint"}>{value ?? "-"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <PurgeAthlete
            athleteId={athlete.id}
            athleteName={athlete.name}
            intakeCount={intakes.length}
            hasAccount={athlete.hasAccount}
          />
        </>
      )}
    </>
  );
}
