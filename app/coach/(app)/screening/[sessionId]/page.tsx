import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach, isUuid } from "@/lib/review/access";
import { getSession } from "@/lib/db/screening";
import { listNotes } from "@/lib/db/screeningNotes";
import { ScreeningNotes } from "@/components/coach/ScreeningNotes";
import { ScreeningResults, type ResultRow } from "@/components/coach/ScreeningResults";

export async function generateMetadata() {
  const t = await getTranslations("titles");
  return { title: t("athlete"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Een screening terugkijken.
 *
 * Spec §11 in drie regels: het getal eerst en de duiding daarna, kleur als
 * tweede signaal en nooit als enige, en bij een verhouding de teller en de
 * noemer ernaast. Dat gebeurt nu in ScreeningResults, dat dezelfde tabel
 * tekent als de afdruk: een regel per test, links en rechts als kolommen, en
 * de strip die laat zien waar de meting op haar eigen schaal ligt.
 *
 * Onderaan staat waar de banden vandaan komen (FR-08). Een drempel zonder bron
 * hoort niet in een medisch dossier, en bij de tests die NIET classificeren is
 * juist die noot het antwoord op "waarom staat hier geen band".
 */

/** Zelfde volgorde als het invoerscherm: meten, bewegen, kracht. */
const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"] as const;

export default async function ScreeningSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) notFound();

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/coach/login?next=/coach/screening/${sessionId}`);
  }
  if (access.kind !== "coach") notFound();

  const session = await getSession(sessionId, { id: access.coach.id });
  if (session === null) notFound();
  const notes = await listNotes(sessionId);

  const t = await getTranslations("screening");
  // De testnamen staan in de databank in beide talen; de pagina kiest, zodat de
  // datalaag de locale niet hoeft te kennen.
  const locale = await getLocale();
  const name = (row: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? row.testLabelNl : row.testLabelEn;

  // De naam hier opgelost en niet in de component: die is een client en hoeft
  // de locale niet te kennen om een tabel te tekenen.
  const rows: ResultRow[] = session.results.map((row) => ({ ...row, label: name(row) }));

  // Ook de genormaliseerde rijen: die kunnen een band dragen, dus een band die
  // ontbreekt zegt daar hetzelfde als bij een gemeten waarde. Asymmetrie en
  // delta tellen niet mee, die hebben er per ontwerp geen.
  const unclassified = session.results.filter(
    (r) =>
      (r.kind === "absolute" || r.kind === "normalised") &&
      r.status === "computed" &&
      r.bandStatus === null,
  ).length;

  type Row = (typeof session.results)[number];

  // Een regel per test, niet per rij: links en rechts delen hun referentieregel.
  //
  // Of hij classificeert volgt uit de ABSOLUTE rijen, niet uit de laatste rij
  // die toevallig in de map landt. Een delta- of asymmetrierij heeft per
  // ontwerp geen band, dus die zou elke test als "classificeert niet" tonen,
  // ook de tests waar gewoon een band bij staat.
  const rules = new Map<string, { row: Row; classifies: boolean }>();
  for (const row of session.results) {
    if (!row.ruleNote && !row.ruleSource) continue;
    const key = name(row);
    const entry = rules.get(key);
    const classifies = (entry?.classifies ?? false) || row.bandStatus !== null;
    rules.set(key, { row: entry?.row ?? row, classifies });
  }

  return (
    <>
      <Link
        href={`/coach/athletes/${session.athleteId}/screening`}
        className="inline-flex min-h-11 items-center text-xs text-ink-muted underline"
      >
        {session.athleteName ?? t("title")}
      </Link>

      <header className="mt-1 mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")} {session.occurredOn}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {session.bodyMassKg ? `${session.bodyMassKg} kg` : t("bodyMassMissing")}
          {session.testerName ? ` · ${t("tester")}: ${session.testerName}` : ""}
        </p>
      </header>

      {/* Het besluit is het enige op deze pagina dat de behandelaar zelf
          schreef, en het draagt de hele sessie. Het stond tussen het gewicht
          en de testernaam op één regel; daar las het als nog een veld. */}
      {session.notes && (
        <section className="mb-6 flex gap-4 bg-ink px-4 py-3.5">
          <h2 className="shrink-0 pt-0.5 text-label text-brand-200 uppercase">
            {t("decision")}
          </h2>
          <p className="text-sm leading-relaxed text-[var(--color-night-ink)]">
            {session.notes}
          </p>
        </section>
      )}

      {/* Exporteren loopt altijd over een bevroren versie, nooit over de stand
          van nu: de drempels kunnen sindsdien bijgesteld zijn. */}
      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        <a
          href={`/coach/screening/${session.id}/print`}
          className="inline-flex min-h-11 items-center rounded border border-hairline px-3 transition-colors hover:bg-canvas"
        >
          {t("printReport")}
        </a>
        <a
          href={`/api/coach/screening/${session.id}/export?format=json`}
          className="inline-flex min-h-11 items-center rounded border border-hairline px-3 transition-colors hover:bg-canvas"
        >
          {t("exportJson")}
        </a>
        <a
          href={`/api/coach/screening/${session.id}/export?format=csv`}
          className="inline-flex min-h-11 items-center rounded border border-hairline px-3 transition-colors hover:bg-canvas"
        >
          {t("exportCsv")}
        </a>
      </div>

      <ScreeningResults results={rows} blockOrder={BLOCK_ORDER} />

      {/* Wat opvolging vraagt bepaalt de behandelaar. Spec §14. */}
      <ScreeningNotes
        sessionId={session.id}
        notes={notes}
        metrics={[
          ...new Map(
            session.results
              .filter((r) => r.kind === "absolute")
              .map((r) => [r.metricKey, { key: r.metricKey, label: name(r) }]),
          ).values(),
        ]}
      />

      {unclassified > 0 && (
        <p className="mb-6 border-t border-hairline pt-3 text-xs text-ink-muted">
          {t("unclassified", { count: unclassified })}
        </p>
      )}

      {/* FR-08: herkomst van de regels. Zonder dit leest een behandelaar "poor"
          zonder enige manier om te vragen waar die drempel vandaan komt. */}
      {rules.size > 0 && (
        <details className="border-t border-hairline pt-3">
          <summary className="min-h-11 cursor-pointer py-3 text-xs text-ink-muted">
            {t("provenance")} ({rules.size})
          </summary>
          <p className="mt-2 text-xs text-ink-muted">{t("provenanceIntro")}</p>
          <dl className="mt-2 divide-y divide-hairline border-t border-hairline">
            {[...rules.values()].map(({ row, classifies }) => (
              <div key={name(row)} className="py-2">
                <dt className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-medium">{name(row)}</span>
                  {row.ruleEvidence && (
                    <span className="text-ink-muted">
                      {t(
                        `evidence.${row.ruleEvidence}` as "evidence.source_sheet",
                      )}
                    </span>
                  )}
                  {!classifies && (
                    <span className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-muted">
                      {t("classificationOff")}
                    </span>
                  )}
                  {!row.protocolConfirmed && (
                    <span className="text-ink-muted">· {t("protocolNotFixed")}</span>
                  )}
                </dt>
                {row.ruleNote && (
                  <dd className="mt-0.5 text-xs text-ink-muted">{row.ruleNote}</dd>
                )}
                {row.ruleSource && (
                  <dd className="mt-0.5 text-xs text-ink-muted">{row.ruleSource}</dd>
                )}
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}
