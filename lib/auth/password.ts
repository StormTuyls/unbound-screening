import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import bcrypt from "bcryptjs";

/**
 * Wachtwoorden hashen en controleren.
 *
 * scrypt uit de standaardbibliotheek, met de parameters in de hash zelf, zodat
 * ze later omhoog kunnen zonder bestaande wachtwoorden te breken. N = 2^15 kost
 * ongeveer 32 MB en een twintigste seconde per poging: onmerkbaar bij aanmelden,
 * duur genoeg om raden op schaal onbetaalbaar te maken.
 *
 * bcrypt alleen om de hashes te controleren die uit Supabase Auth meekwamen.
 * Wie daarmee aanmeldt, krijgt meteen een scrypt-hash (needsRehash); daarna
 * heeft dat account bcrypt niet meer nodig.
 */

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const MAXMEM = 64 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (!stored) return { ok: false, needsRehash: false };

  if (stored.startsWith("$2")) {
    const ok = await bcrypt.compare(password, stored);
    return { ok, needsRehash: ok };
  }

  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return { ok: false, needsRehash: false };

  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  return { ok, needsRehash: ok && (Number(n) !== N || Number(r) !== R || Number(p) !== P) };
}
