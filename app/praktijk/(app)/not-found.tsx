import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Een coachpagina die er niet is.
 *
 * Ook de uitkomst van notFound() bij "ingelogd maar geen behandelaar": zie
 * lib/review/access.ts, waar dat bewust een 404 is en geen inlogscherm.
 */
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFound")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("notFoundNote")}</p>
      <Link
        href="/praktijk"
        className="mt-4 inline-flex min-h-11 items-center text-sm underline"
      >
        {t("backToAthletes")}
      </Link>
    </>
  );
}
