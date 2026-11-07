"use client";

import { useTranslations } from "next-intl";

/**
 * Wat er staat als een coachpagina omvalt.
 *
 * Zonder dit bestand valt Next terug op zijn eigen foutscherm, en dat is in
 * productie een lege pagina met "Application error". De tester weet dan niet
 * of zijn meting bewaard is.
 *
 * De fout zelf komt hier niet op het scherm: een stacktrace of een pg-melding
 * kan een naam of een waarde bevatten, en dit is een scherm waar iemand over
 * de schouder meekijkt. reset() is er wel, want veel van deze fouten zijn een
 * weggevallen verbinding en dan is opnieuw proberen het hele antwoord.
 */
export default function CoachError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <div role="alert">
      <h1 className="text-2xl font-semibold tracking-tight">{t("generic")}</h1>
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex min-h-11 items-center rounded-md px-3.5 text-sm ring-1 ring-hairline ring-inset transition-colors hover:bg-canvas"
      >
        {t("retry")}
      </button>
    </div>
  );
}
