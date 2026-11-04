import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { apiMessages } from "@/lib/i18n/server";
import { badRequest, handleError } from "@/lib/http";
import { appDb } from "@/lib/supabase/service";
import { currentCoach } from "@/lib/review/access";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from "@/lib/i18n/locale";

/**
 * De taalkeuze.
 *
 * Deze route ontbrak. LocaleToggle stond er wel, op het inlogscherm, en poste
 * naar een adres dat in deze repo nooit is meeverhuisd: een 404, zonder
 * melding, dus de knop deed niets en de taal bleef staan. De hele codebase
 * houdt nl en en in pariteit en de enige schakelaar was stuk.
 *
 * Twee schrijfacties, elk met een eigen reden:
 *
 * 1. Het cookie. Daar leest i18n/request.ts uit, bij elke render, zonder query.
 * 2. profiles.locale. Nodig omdat een cookie op een ander toestel niet bestaat;
 *    bij inloggen wordt het cookie daaruit gevuld.
 *
 * In athlete-intake schrijft dezelfde route ook athletes.locale en de locale
 * van een lopende intake. Die derde laag hoort daar: intake.locale zit in de
 * gehashte inhoud van een rapportsnapshot. Hier is geen intake en geen atleet,
 * dus blijven er twee over.
 *
 * Geen coach ingelogd is geen fout: het inlogscherm zelf heeft de knop ook, en
 * dan is het cookie het hele antwoord.
 */
export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const body = (await request.json().catch(() => ({}))) as { locale?: string };

    if (!isLocale(body.locale)) return badRequest(t("unknownLocale"));

    const locale: Locale = body.locale;
    const store = await cookies();

    store.set(LOCALE_COOKIE, locale, {
      // Niets in de browser hoeft dit te lezen: de knop stuurt een POST en
      // vraagt daarna een verse render op.
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
    });

    const coach = await currentCoach();
    if (coach) await appDb().from("profiles").update({ locale }).eq("id", coach.id);

    return NextResponse.json({ locale });
  } catch (error) {
    return handleError(error);
  }
}
