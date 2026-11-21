import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { cookies } from "next/headers";
import { handleError } from "@/lib/http";
import { queryOne } from "@/lib/db/sql";
import { currentAccount } from "@/lib/auth/session";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  toLocale,
} from "@/lib/i18n/locale";

/**
 * Het taalcookie vullen uit het profiel, na het inloggen.
 *
 * De derde laag uit lib/i18n/locale.ts. Nodig omdat een cookie aan een browser
 * hangt en een voorkeur aan een persoon: wie op een nieuw toestel inlogt heeft
 * geen cookie, en zou dan de standaardtaal krijgen terwijl zijn keuze in de
 * databank staat.
 *
 * Waarom een aparte aanroep en niet in proxy.ts: dat bestand doet met opzet bijna
 * niets en draait bij elke aanvraag. Een query per pageview om een cookie te
 * vullen dat na één keer al goed staat, is werk op de verkeerde plek. Dit loopt
 * één keer per aanmelding.
 *
 * Server components kunnen geen cookies zetten, dus het moet een route zijn.
 */
export async function POST() {
  try {
    const t = await apiMessages();
    const account = await currentAccount();

    if (!account) {
      return NextResponse.json({ error: t("noSession") }, { status: 401 });
    }

    const profile = await queryOne<{ locale: string | null }>(
      "select locale from public.profiles where id = $1",
      [account.id],
    );

    const locale = toLocale(profile?.locale ?? DEFAULT_LOCALE);
    const store = await cookies();

    store.set(LOCALE_COOKIE, locale, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });

    return NextResponse.json({ locale });
  } catch (error) {
    return handleError(error);
  }
}
