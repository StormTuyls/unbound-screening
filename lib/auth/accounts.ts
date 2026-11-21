import { query, queryOne } from "@/lib/db/sql";
import { hashToken, newToken } from "@/lib/intake/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { startSession } from "@/lib/auth/session";

/**
 * Accounts: aanmelden, aanmaken, wachtwoorden en eenmalige links.
 *
 * Wat Supabase Auth hiervoor deed en wat hier dus expliciet staat:
 *   - Raden afremmen: na 10 mislukte pogingen in 15 minuten voor hetzelfde
 *     adres weigert aanmelden tot het venster voorbij is.
 *   - Niet verklappen of een adres bestaat: een onbekend adres kost even lang
 *     als een fout wachtwoord, en krijgt dezelfde melding.
 *   - Eenmalige links echt eenmalig: verzilveren is één update met used_at,
 *     dus twee gelijktijdige klikken leveren hooguit één sessie op.
 */

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MINUTES = 15;

export class AccountExistsError extends Error {
  constructor() {
    super("er bestaat al een account met dit adres");
  }
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/** Een hash om tegen te controleren als het adres niet bestaat, zodat dat even lang duurt. */
let decoy: Promise<string> | null = null;

export type SignInResult =
  | { ok: true; accountId: string }
  | { ok: false; reason: "invalid" | "throttled" };

/** Aanmelden met e-mail en wachtwoord. Zet bij succes de sessie. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const address = normaliseEmail(email);

  const recent = await queryOne<{ n: number }>(
    `select count(*)::int as n from public.login_failures
      where email = $1 and at > now() - make_interval(mins => $2)`,
    [address, FAILURE_WINDOW_MINUTES],
  );
  if ((recent?.n ?? 0) >= MAX_FAILURES) return { ok: false, reason: "throttled" };

  const account = await queryOne<{ id: string; password_hash: string | null }>(
    "select id, password_hash from public.accounts where email = $1",
    [address],
  );

  decoy ??= hashPassword("niet-bestaand-account");
  const check = await verifyPassword(password, account?.password_hash ?? (await decoy));

  if (!account || !check.ok) {
    // Oude mislukkingen opruimen bij het schrijven van een nieuwe: de tabel
    // groeit niet harder dan één venster aan pogingen.
    await query("delete from public.login_failures where at < now() - interval '1 day'");
    await query("insert into public.login_failures (email) values ($1)", [address]);
    return { ok: false, reason: "invalid" };
  }

  await query("delete from public.login_failures where email = $1", [address]);
  if (check.needsRehash) {
    await query("update public.accounts set password_hash = $2 where id = $1", [
      account.id,
      await hashPassword(password),
    ]);
  }
  await startSession(account.id);
  return { ok: true, accountId: account.id };
}

/** Een nieuw account. Zonder wachtwoord: uitgenodigd, kiest het zelf via een link. */
export async function createAccount(email: string, password: string | null): Promise<string> {
  try {
    const row = await queryOne<{ id: string }>(
      "insert into public.accounts (email, password_hash) values ($1, $2) returning id",
      [normaliseEmail(email), password === null ? null : await hashPassword(password)],
    );
    return row!.id;
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new AccountExistsError();
    throw error;
  }
}

export async function findAccountByEmail(email: string): Promise<{ id: string } | null> {
  return queryOne<{ id: string }>("select id from public.accounts where email = $1", [
    normaliseEmail(email),
  ]);
}

/**
 * Een nieuw wachtwoord, en alle sessies van dit account weg.
 *
 * Wie zijn wachtwoord wijzigt omdat het gelekt is, wil dat een andere browser
 * die nog binnen was eruit ligt. De aanroeper start daarna zelf een nieuwe
 * sessie voor de browser waarin het gebeurde.
 */
export async function setPassword(accountId: string, password: string): Promise<void> {
  await query("update public.accounts set password_hash = $2 where id = $1", [
    accountId,
    await hashPassword(password),
  ]);
  await query("delete from public.sessions where account_id = $1", [accountId]);
}

export async function checkPassword(accountId: string, password: string): Promise<boolean> {
  const row = await queryOne<{ password_hash: string | null }>(
    "select password_hash from public.accounts where id = $1",
    [accountId],
  );
  return (await verifyPassword(password, row?.password_hash ?? null)).ok;
}

export type TokenPurpose = "reset" | "invite";

/** Een eenmalige link-token. Alleen de hash wordt bewaard. */
export async function issueToken(
  accountId: string,
  purpose: TokenPurpose,
  hours: number,
): Promise<string> {
  const { token, hash } = newToken();
  await query(
    `insert into public.account_tokens (token_hash, account_id, purpose, expires_at)
     values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [hash, accountId, purpose, hours],
  );
  return token;
}

/** De token inwisselen: geldig, ongebruikt, niet verlopen, en daarna nooit meer. */
export async function redeemToken(
  token: string,
): Promise<{ accountId: string; purpose: TokenPurpose } | null> {
  return queryOne<{ accountId: string; purpose: TokenPurpose }>(
    `update public.account_tokens set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning account_id as "accountId", purpose`,
    [hashToken(token)],
  );
}

/** Een account weg, met zijn profiel (cascade). Geeft terug of er iets was. */
export async function deleteAccount(accountId: string): Promise<boolean> {
  const rows = await query("delete from public.accounts where id = $1 returning id", [accountId]);
  return rows.length > 0;
}
