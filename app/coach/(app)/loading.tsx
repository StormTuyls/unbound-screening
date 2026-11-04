import { getTranslations } from "next-intl/server";

/**
 * Wat er staat terwijl een coachpagina laadt.
 *
 * Met opzet geen skelet in de vorm van een meettabel. Een grijze rij op de
 * plek van een getal suggereert dat er een getal komt en hoeveel het er zijn,
 * en op een scherm met meetwaarden is dat precies de verkeerde belofte. Een
 * regel tekst zegt hetzelfde en liegt niet.
 *
 * role="status" en niet alleen de tekst: anders weet een schermlezer niet dat
 * er iets onderweg is.
 */
export default async function Loading() {
  const t = await getTranslations("errors");
  return (
    <p role="status" className="text-sm text-ink-faint">
      {t("loading")}
    </p>
  );
}
