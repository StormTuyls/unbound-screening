"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LocaleToggle } from "@/components/LocaleToggle";

/**
 * De navigatiebalk van de praktijk.
 *
 * Twee bestemmingen, en dat is minder dan het ontwerp toont. Daar staan er
 * vier: Atleten, Invoeren, Rapport en Bibliotheek. Invoeren en Rapport zijn
 * geen plekken maar handelingen aan EEN atleet: /coach/athletes/<id>/screening/new
 * en /coach/screening/<id>. Zonder die id wijzen ze nergens heen, en de
 * artboards zijn het er zelf ook niet over eens waar "Rapport" uitkomt. Ze
 * staan daarom waar ze horen, als knop op de regel van de atleet, precies zoals
 * dezelfde tabel in het ontwerp ze ook al toont.
 *
 * Clientcomponent om één reden: aria-current. Een balk die de huidige pagina
 * alleen met een grijsje aanduidt zegt een schermlezer niets.
 */
export function CoachNav({
  practice,
  items,
  intake,
  signOut,
}: {
  practice: string;
  items: Array<{ href: string; label: string }>;
  intake: { href: string; label: string } | null;
  signOut: string;
}) {
  const pathname = usePathname();

  return (
    <header className="no-print border-b border-hairline bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2.5">
        <span className="flex items-center gap-2.5 font-semibold">
          <span aria-hidden className="inline-block h-[18px] w-[7px] bg-brand-600" />
          {practice}
        </span>

        <nav className="ml-auto flex flex-wrap items-center gap-1">
          {items.map((item) => {
            // StartsWith zou /coach op elke coachpagina laten oplichten, want
            // elk pad begint ermee. Alleen /coach/library mag zijn subpagina's
            // meenemen.
            const current =
              item.href === "/coach"
                ? pathname === "/coach"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-chip px-3.5 text-sm transition-colors ${
                  current
                    ? "bg-canvas text-ink ring-1 ring-hairline ring-inset"
                    : "text-ink-muted hover:bg-canvas"
                }`}
              >
                {item.label}
              </Link>
            );
          })}

          {/* De intake is een andere app op een ander domein. Vandaar een
              gewone <a>: er valt niets te prefetchen, aria-current slaat
              nergens op, en de coach logt daar apart in zolang de twee geen
              gedeeld domein hebben. Zonder adres geen knop. */}
          {intake && (
            <a
              href={intake.href}
              className="flex min-h-11 items-center rounded-chip px-3.5 text-sm text-ink-muted transition-colors hover:bg-canvas"
            >
              {intake.label}
            </a>
          )}

          {/* Hoort hier en niet alleen op het inlogscherm: wie binnen is kon de
              taal niet meer wisselen. */}
          <LocaleToggle />

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="flex min-h-11 items-center rounded-chip px-3.5 text-sm text-ink-muted transition-colors hover:bg-canvas"
            >
              {signOut}
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
