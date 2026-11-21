import { transaction } from "@/lib/db/sql";
import { findAccountByEmail, issueToken, normaliseEmail } from "@/lib/auth/accounts";
import { sendMail } from "@/lib/auth/mail";
import { translator } from "@/lib/i18n/translator";
import { preConsentUntil } from "@/lib/intake/retention";
import type { Locale } from "@/lib/i18n/locale";

/**
 * Een atleet uitnodigen, vanaf de kant van de praktijk.
 *
 * Tot nu bestond een atleet alleen doordat hij zichzelf aanmeldde op /start. Dat
 * klopt voor wie een link doorgestuurd krijgt en het zelf doet, en het klopt
 * niet voor de helft van de praktijk: iemand zit voor je, je wil zijn intake
 * klaarzetten, en het enige antwoord was "typ dit adres maar over thuis".
 *
 * Wat hier NIET gebeurt is consent geven namens iemand anders. Dat is de hele
 * reden dat dit een uitnodiging is en geen aangemaakt dossier: de praktijk kan
 * een account klaarzetten, maar de grond om gezondheidsgegevens te verwerken kan
 * alleen de atleet zelf leggen. Hij tikt het vinkje bij zijn eerste keer
 * inloggen; tot dan staat er een account zonder consent en zonder termijn, en
 * dat is precies wat PRE_CONSENT_DAYS opruimt als er niets mee gebeurt.
 *
 * De uitnodiging gaat per mail én als link op het scherm. Niet uit
 * besluiteloosheid: de mail is de normale weg, en de link is er voor de keer dat
 * hij in een spamfilter hangt terwijl de atleet naast je staat. Een uitnodiging
 * die alleen per mail kan, maakt van een verkeerd ingestelde SMTP een reden dat
 * een intake niet doorgaat.
 */

export interface InviteResult {
  athleteId: string;
  userId: string;
  /** Een link waarmee hij binnenkomt, om door te geven als de mail niet aankomt. */
  link: string | null;
  /** Of de uitnodigingsmail eruit is. Bij false is de link de enige weg. */
  mailed: boolean;
}

export type InviteOutcome =
  | { ok: true; invite: InviteResult }
  | { ok: false; error: string };

/**
 * Nodigt uit, en zorgt dat er een account en een dossier klaarstaan.
 *
 * Account, profiel en atleetrij in één transactie: mislukt er één, dan staat er
 * niets, en hoeft er niets met de hand teruggedraaid te worden.
 *
 * Er wordt geen wachtwoord gezet. Hij komt binnen via de link en kiest er zelf
 * een, en zo staat er nergens een wachtwoord dat iemand anders ook kent. De link
 * werkt zeven dagen en één keer; het token zit in het fragment, zodat het niet
 * in een serverlog belandt (zie components/auth/ResetPassword.tsx).
 */
export async function inviteAthlete(input: {
  email: string;
  fullName: string | null;
  locale: Locale;
  practitionerId: string;
  origin: string;
}): Promise<InviteOutcome> {
  const email = normaliseEmail(input.email);

  if (await findAccountByEmail(email)) {
    // Geen uitnodiging bovenop een bestaand account. Dat zou een tweede dossier
    // opleveren voor iemand die er al een heeft, en dat is precies het soort
    // dubbele dat later niemand meer uit elkaar haalt.
    return { ok: false, error: "That email address already has an account here." };
  }

  const { userId, athleteId } = await transaction(async (run) => {
    const [account] = await run<{ id: string }>(
      "insert into public.accounts (email) values ($1) returning id",
      [email],
    );
    await run(
      `insert into public.profiles (id, role, full_name, locale)
       values ($1, 'athlete', $2, $3)`,
      [account.id, input.fullName, input.locale],
    );
    // Dezelfde voorlopige termijn als bij zelfaanmelding. Geeft hij nooit
    // consent, dan ruimt de retentiejob dit op: een uitnodiging die niemand
    // aanneemt hoort niet als dossier te blijven staan.
    const [athlete] = await run<{ id: string }>(
      `insert into public.athletes
         (profile_id, full_name, email, locale, practitioner_id, retention_mode, retention_until)
       values ($1, $2, $3, $4, $5, 'until_date', $6)
       returning id`,
      [account.id, input.fullName, email, input.locale, input.practitionerId, preConsentUntil()],
    );
    return { userId: account.id, athleteId: athlete.id };
  });

  const token = await issueToken(userId, "invite", 24 * 7);
  const link = `${input.origin}/auth/reset#token=${encodeURIComponent(token)}`;

  // De mail is de normale weg, de link op het scherm de uitweg. Lukt de mail
  // niet, dan is de uitnodiging niet mislukt.
  const t = translator(input.locale, "mail");
  const mailed = await sendMail({
    to: email,
    subject: t("inviteSubject"),
    text: t("inviteBody", { link }),
  }).catch((error) => {
    console.error("[auth] uitnodigingsmail mislukt", error);
    return false;
  });

  return { ok: true, invite: { athleteId, userId, link, mailed } };
}
