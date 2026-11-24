import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { checkCoach } from "@/lib/review/access";
import { listRules, listTestsWithoutRule } from "@/lib/db/referenceRules";
import { listRetiredTests } from "@/lib/db/testLibrary";
import { RetireTest } from "@/components/coach/RetireTest";
import { BandScale } from "@/components/coach/BandScale";
import { TestInfo } from "@/components/coach/TestInfo";
import { unitLabel } from "@/lib/screening/units";

export async function generateMetadata() {
  const t = await getTranslations("library");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

const EVIDENCE: Record<string, "evidenceSourceSheet" | "evidencePublished" | "evidenceInternal"> = {
  source_sheet: "evidenceSourceSheet",
  published: "evidencePublished",
  internal: "evidenceInternal",
};

const BLOCK_ORDER = ["anthropometry", "mobility_ll", "mobility_ul", "core",
                     "movement_ll", "forcedecks", "strength_ul"];

/** Welke drempels er gelden, en welke daarvan mogen indelen. FR-02. */
export default async function LibraryPage() {
  const access = await checkCoach();
  if (access.kind === "anonymous") redirect("/praktijk/login?next=/praktijk/library");
  if (access.kind !== "coach") notFound();

  const [rules, withoutRule, retired] = await Promise.all([
    listRules(),
    listTestsWithoutRule(),
    listRetiredTests(),
  ]);
  const t = await getTranslations("library");
  const ts = await getTranslations("screening");
  const titles = await getTranslations("titles");
  const locale = await getLocale();
  const name = (r: { testLabelNl: string; testLabelEn: string }) =>
    locale === "nl" ? r.testLabelNl : r.testLabelEn;

  const byBlock = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = byBlock.get(rule.block) ?? [];
    list.push(rule);
    byBlock.set(rule.block, list);
  }
  const ordered = [...byBlock].sort(
    (a, b) => (BLOCK_ORDER.indexOf(a[0]) + 1 || 99) - (BLOCK_ORDER.indexOf(b[0]) + 1 || 99),
  );

  const grading = rules.filter((r) => r.classificationEnabled).length;

  return (
    <>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {grading}/{rules.length} {t("classifies")}
          </p>
          <p className="mt-2 max-w-prose text-xs text-ink-faint">{t("intro")}</p>
        </div>
        <Link
          href="/praktijk/library/new"
          className="inline-flex min-h-11 shrink-0 items-center rounded bg-brand-700 px-4 text-sm text-white transition-colors hover:bg-brand-800 active:scale-[0.98]"
        >
          {t("addTest")}
        </Link>
      </header>

      {rules.length === 0 ? (
        <p className="text-sm text-ink-faint">{t("noRules")}</p>
      ) : (
        ordered.map(([block, items]) => (
          <section key={block} className="mb-8">
            <h2 className="mb-1 text-sm font-medium">
              {ts(`blocks.${block}` as "blocks.core")}
            </h2>
            <ul className="divide-y divide-hairline border-t border-hairline">
              {items.map((rule) => (
                <li key={rule.id} className="flex items-start gap-1">
                  {/* Buiten de link: een knop in een <a> is geen geldige HTML,
                      en een tik op de uitleg hoort niet naar de regel te gaan. */}
                  <span className="pt-3">
                    <TestInfo
                      name={name(rule)}
                      about={locale === "nl" ? rule.testAboutNl : rule.testAboutEn}
                      unit={rule.unit}
                      direction={rule.direction}
                      laterality={rule.laterality}
                      bands={rule.classificationEnabled ? rule.bands : null}
                      protocolConfirmed={rule.protocolConfirmed}
                    />
                  </span>
                  <Link
                    href={`/praktijk/library/${encodeURIComponent(rule.metricKey)}`}
                    className="grid min-h-11 min-w-0 flex-1 gap-x-6 gap-y-2 py-3 transition-colors hover:bg-canvas sm:grid-cols-[minmax(0,1fr)_minmax(0,26rem)_7rem] sm:items-center"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{name(rule)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        {/* Kleur is niet het enige signaal: er staat tekst bij. */}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            rule.classificationEnabled
                              ? "bg-ok/10 text-ok"
                              : "bg-canvas text-ink-muted"
                          }`}
                        >
                          {rule.classificationEnabled ? t("classifies") : t("notClassifying")}
                        </span>
                        {!rule.protocolConfirmed && (
                          <span className="text-ink-faint">{t("protocolNotFixed")}</span>
                        )}
                      </span>
                      {/* Waar de drempel vandaan komt hoort naast de drempel. */}
                      <span className="mt-1 block text-xs text-ink-muted">
                        {rule.sourceCitation ?? t(EVIDENCE[rule.evidence] ?? "evidenceInternal")}
                      </span>
                    </span>
                    {/* De banden zijn hier het onderwerp, dus als figuur en niet
                        als "4 banden". Een regel die niet indeelt toont ze
                        gedempt: ze bestaan, maar gelden nog niet. */}
                    <BandScale
                      bands={rule.bands}
                      decimals={rule.decimals}
                      label={`${name(rule)}: ${rule.bands.map((b) => b.status).join(", ")}`}
                      className={`w-full ${rule.classificationEnabled ? "" : "opacity-50"}`}
                    />
                    <span className="shrink-0 text-xs text-ink-muted tabular-nums sm:text-right">
                      {unitLabel(rule.unit, ts("handLengths"))} · {t("version", { n: rule.version })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Zonder deze lijst was een test zonder regel nergens te openen, en kon
          niemand hem een uitleg of een eerste regel geven. */}
      {withoutRule.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">{t("withoutRule")}</h2>
          <p className="mb-2 max-w-prose text-xs text-ink-faint">{t("withoutRuleIntro")}</p>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {withoutRule.map((test) => {
              const testName = locale === "nl" ? test.labelNl : test.labelEn;
              return (
                <li key={test.testKey} className="flex items-start gap-1">
                  <span className="pt-1.5">
                    <TestInfo
                      name={testName}
                      about={locale === "nl" ? test.aboutNl : test.aboutEn}
                      unit={test.unit}
                      direction={test.direction}
                      laterality={test.laterality}
                      bands={null}
                      protocolConfirmed={test.protocolConfirmed}
                    />
                  </span>
                  <Link
                    href={`/praktijk/library/${encodeURIComponent(test.metricKey)}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-4 py-2 text-sm transition-colors hover:bg-canvas"
                  >
                    <span>{testName}</span>
                    <span className="text-xs text-ink-muted">
                      {ts(`blocks.${test.block}` as "blocks.core")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {retired.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium">{t("retiredTitle")}</h2>
          <p className="mb-2 max-w-prose text-xs text-ink-faint">{t("retiredIntro")}</p>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {retired.map((test) => (
              <li key={test.testKey} className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span className="text-ink-muted">
                  {locale === "nl" ? test.labelNl : test.labelEn}
                  <span className="ml-2 text-xs">
                    {ts(`blocks.${test.block}` as "blocks.core")} ·{" "}
                    {t("retiredOn", { date: test.retiredAt.slice(0, 10) })}
                  </span>
                </span>
                <RetireTest testKey={test.testKey} mode="restore" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
