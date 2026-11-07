import { getTranslations } from "next-intl/server";
import { LocaleToggle } from "@/components/LocaleToggle";
import { PRACTICE_NAME } from "@/lib/report/branding";

/**
 * De schil om de atleetschermen.
 *
 * Bewust niet de coachschil. Die heeft een navigatiebalk met Atleten en
 * Bibliotheek, en dat zijn plekken waar een atleet niet hoort te komen; een
 * balk die ze toont belooft hem iets wat op een 404 uitkomt. Twee audiences,
 * twee schillen, en de voordeur op / kiest welke.
 *
 * Smaller dan de praktijkkant. Een behandelaar vergelijkt kolommen over
 * regels heen en heeft breedte nodig; een atleet leest dit op een telefoon in
 * een kleedkamer en heeft een leesbreedte nodig.
 */
export default async function AthleteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tc = await getTranslations("coach");

  return (
    <>
      <header className="no-print border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
          <span className="flex items-center gap-2.5 font-semibold">
            <span aria-hidden className="inline-block h-[18px] w-[7px] bg-brand-600" />
            {PRACTICE_NAME}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <LocaleToggle />
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="flex min-h-11 items-center rounded-chip px-3.5 text-sm text-ink-muted transition-colors hover:bg-canvas"
              >
                {tc("signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto my-6 max-w-2xl rounded-card border border-hairline bg-surface px-5 py-7 sm:my-8 sm:px-7">
        {children}
      </main>
    </>
  );
}
