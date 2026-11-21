import { cache } from "react";
import { cookies } from "next/headers";
import { query, queryOne } from "@/lib/db/sql";
import { hashToken, newToken } from "@/lib/intake/session";

/**
 * Wie er ingelogd is.
 *
 * Het cookie draagt een willekeurig token; de databank kent alleen de sha256
 * ervan (public.sessions). Een gelekte databankdump levert dus geen bruikbare
 * sessies op, en uitloggen is een rij weghalen: het token werkt daarna nergens
 * meer, ook niet in een andere browser die het gekopieerd had.
 *
 * Dertig dagen, en zolang iemand de app gebruikt schuift dat op. Wie een maand
 * niets doet, logt opnieuw in.
 */

const COOKIE = "unbound_session";
const DAYS = 30;

export interface Account {
  id: string;
  email: string;
}

/** Een nieuwe sessie voor dit account, en het cookie erbij. Alleen in route handlers. */
export async function startSession(accountId: string): Promise<void> {
  const { token, hash } = newToken();
  await query(
    `insert into public.sessions (token_hash, account_id, expires_at)
     values ($1, $2, now() + make_interval(days => $3))`,
    [hash, accountId, DAYS],
  );
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DAYS * 24 * 60 * 60,
  });
}

/**
 * Het ingelogde account, of null.
 *
 * Eén keer per render (cache): checkCoach, currentAthlete en currentIntake
 * vragen het allemaal, en dat hoeft maar één query te zijn.
 */
export const currentAccount = cache(async (): Promise<Account | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<Account & { renew: boolean }>(
    `select a.id, a.email, s.expires_at < now() + make_interval(days => $2 - 1) as renew
       from public.sessions s
       join public.accounts a on a.id = s.account_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token), DAYS],
  );
  if (!row) return null;

  // Hoogstens één keer per dag schuiven, niet bij elke aanvraag schrijven.
  if (row.renew) {
    await query(
      "update public.sessions set expires_at = now() + make_interval(days => $2) where token_hash = $1",
      [hashToken(token), DAYS],
    );
  }
  return { id: row.id, email: row.email };
});

/** Uitloggen in deze browser. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await query("delete from public.sessions where token_hash = $1", [hashToken(token)]);
  store.delete(COOKIE);
}
