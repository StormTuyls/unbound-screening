import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentAthlete } from "@/lib/athlete/identity";
import { listReleasedSessions } from "@/lib/db/screening";

export async function generateMetadata() {
  const t = await getTranslations("mine");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * De metingen van de atleet zelf.
 *
 * Tot nu toe kon een atleet niets van zijn screening zien: die woonde in een
 * app waar alleen behandelaars in konden. Zijn intakerapport kon hij wel al
 * inzien, aan de andere kant, en dat verschil was willekeurig.
 *
 * Alleen afgeronde metingen. listReleasedSessions() geeft alleen sessies met
 * een bevroren rapport terug, dus wat hier staat is wat de behandelaar heeft
 * afgesloten en niet wat er halverwege in het invoerscherm stond.
 */
export default async function MyMeasurementsPage() {
  const athlete = await currentAthlete();
  if (!athlete) redirect("/praktijk/login?next=/metingen");

  const sessions = await listReleasedSessions(athlete.athleteId);
  const t = await getTranslations("mine");

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="mt-1 max-w-prose text-sm text-ink-muted">{t("intro")}</p>

      {sessions.length === 0 ? (
        <div className="mt-8 rounded-card border border-hairline bg-canvas px-4 py-4">
          <p className="text-sm font-medium">{t("none")}</p>
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">{t("noneNote")}</p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-t border-hairline">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link
                href={`/metingen/${session.id}`}
                className="flex min-h-11 items-center gap-4 py-3.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium tabular-nums">{session.occurredOn}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {[
                      session.testerName
                        ? t("measuredBy", { name: session.testerName })
                        : null,
                      t("releasedOn", { date: session.releasedAt }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-sm text-brand-700 underline underline-offset-2">
                  {t("open")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 border-t border-hairline pt-3 text-xs text-ink-muted">
        {t("rightsNote")}
      </p>
    </>
  );
}
