import Link from "next/link";
import { BandScale } from "@/components/coach/BandScale";
import { unitLabel } from "@/lib/screening/units";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { getRule, getRuleHistory, getTestByMetric } from "@/lib/db/referenceRules";
import { AboutEditor } from "@/components/coach/AboutEditor";
import { RetireTest } from "@/components/coach/RetireTest";
import { RuleEditor } from "@/components/coach/RuleEditor";
import { ClassificationToggle } from "@/components/coach/ClassificationToggle";

export async function generateMetadata() {
  const t = await getTranslations("library");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

function describe(band: { gte?: number; lt?: number }): string {
  if (band.gte === undefined) return `< ${band.lt}`;
  if (band.lt === undefined) return `>= ${band.gte}`;
  return `${band.gte} - ${band.lt}`;
}

/**
 * Eén referentieregel: wat er nu geldt, wat er eerder gold, en een formulier
 * voor de volgende versie.
 */
export default async function RulePage({
  params,
}: {
  params: Promise<{ metricKey: string }>;
}) {
  const { metricKey } = await params;
  const key = decodeURIComponent(metricKey);

  const access = await checkCoach();
  if (access.kind === "anonymous") {
    redirect(`/praktijk/login?next=/praktijk/library/${metricKey}`);
  }
  if (access.kind !== "coach") notFound();

  // Ook een test zonder regel heeft deze pagina: daar komt zijn eerste regel en
  // zijn uitleg. Zonder test bestaat de metriek niet, en dat is een 404.
  const test = await getTestByMetric(key);
  if (!test) notFound();
  const rule = await getRule(key);

  const history = rule ? await getRuleHistory(rule.ruleKey) : [];
  const t = await getTranslations("library");
  const unit = unitLabel(test.unit, (await getTranslations("screening"))("handLengths"));
  const locale = await getLocale();
  const name = locale === "nl" ? test.labelNl : test.labelEn;

  return (
    <>
      <Link href="/praktijk/library" className="inline-flex min-h-11 items-center text-xs text-ink-muted underline">
        {t("title")}
      </Link>

      <header className="mt-1 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {rule ? (
            <>
              <span>{t("version", { n: rule.version })}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  rule.classificationEnabled ? "bg-ok/10 text-ok" : "bg-canvas text-ink-muted"
                }`}
              >
                {rule.classificationEnabled ? t("classifies") : t("notClassifying")}
              </span>
            </>
          ) : (
            <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted">
              {t("noRuleYet")}
            </span>
          )}
          {!test.protocolConfirmed && (
            <span className="text-xs text-ink-faint">{t("protocolNotFixed")}</span>
          )}
        </p>
      </header>

      {/* De uitleg bij het ⓘ naast de testnaam. Hier en niet in een bestand,
          zodat wie de test afneemt hem ook kan bijschaven. */}
      <section className="mb-6">
        <h2 className="text-sm font-medium">{t("aboutTitle")}</h2>
        <p className="mt-0.5 mb-2 max-w-prose text-xs text-ink-faint">{t("aboutIntro")}</p>
        <AboutEditor testKey={test.testKey} initial={{ nl: test.aboutNl, en: test.aboutEn }} />
      </section>

      {/* Wat er nu geldt, als platte tekst. Het formulier eronder maakt de
          volgende versie; dit is wat een meting vandaag te horen krijgt. */}
      {rule && (
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-medium">{t("current")}</h2>
        <BandScale
          bands={rule.bands}
          decimals={rule.decimals}
          label={`${name}: ${rule.bands.map((b) => b.status).join(", ")}`}
          className="mb-3 w-full max-w-xl"
        />
        <ul className="divide-y divide-hairline border-t border-hairline text-sm">
          {rule.bands.map((band) => (
            <li key={band.status} className="flex justify-between gap-4 py-1.5">
              <span>{band.status}</span>
              <span className="text-ink-muted tabular-nums">
                {describe(band)} {unit}
                {band.score !== null && band.score !== undefined && (
                  <span className="ml-2 text-ink-faint">{t("score")} {band.score}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {rule.sourceCitation && (
          <p className="mt-2 text-xs text-ink-faint">{rule.sourceCitation}</p>
        )}
        {rule.sourceNote && <p className="mt-1 text-xs text-ink-faint">{rule.sourceNote}</p>}

        <div className="mt-3">
          <ClassificationToggle
            ruleId={rule.id}
            enabled={rule.classificationEnabled}
            canEnable={rule.coverage === "total"}
          />
        </div>
      </section>
      )}

      <section className="mb-6 border-t border-hairline pt-4">
        <h2 className="mb-2 text-sm font-medium">{rule ? t("saveVersion") : t("firstRule")}</h2>
        <RuleEditor
          metricKey={test.metricKey}
          unit={unit}
          initial={
            rule
              ? {
                  bands: rule.bands,
                  coverage: rule.coverage,
                  classificationEnabled: rule.classificationEnabled,
                  evidence: rule.evidence,
                  sourceCitation: rule.sourceCitation,
                  sourceNote: rule.sourceNote,
                }
              : {
                  // Een eerste regel deelt nog niet in: dat zet je pas aan als
                  // de banden kloppen.
                  bands: [],
                  coverage: "total",
                  classificationEnabled: false,
                  evidence: "internal",
                  sourceCitation: null,
                  sourceNote: null,
                }
          }
        />
      </section>

      {rule && history.length > 1 && (
        <section className="border-t border-hairline pt-4">
          <h2 className="mb-2 text-sm font-medium">{t("history")}</h2>
          <ul className="divide-y divide-hairline border-t border-hairline text-xs">
            {history.map((v) => (
              <li key={v.version} className="flex justify-between gap-4 py-1.5">
                <span>
                  {t("version", { n: v.version })}{" "}
                  <span className="text-ink-faint">
                    {v.retiredAt ? t("retired") : t("current")}
                  </span>
                </span>
                <span className="text-right text-ink-muted tabular-nums">
                  {v.bands.map(describe).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 border-t border-hairline pt-4">
        <h2 className="text-sm font-medium">{t("retireTest")}</h2>
        <p className="mt-0.5 mb-2 max-w-prose text-xs text-ink-faint">{t("retireIntro")}</p>
        <RetireTest testKey={test.testKey} mode="retire" />
      </section>
    </>
  );
}
