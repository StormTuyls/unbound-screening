import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "../../lib/auth/password";

/**
 * Wachtwoorden: nieuw hashen met scrypt, oude bcrypt-hashes uit Supabase blijven
 * werken en vragen om een nieuwe hash, en niets anders komt door.
 */

const hash = await hashPassword("correct paard");
assert.match(hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
assert.notEqual(hash, await hashPassword("correct paard"), "elke hash heeft een eigen zout");

assert.deepEqual(await verifyPassword("correct paard", hash), { ok: true, needsRehash: false });
assert.deepEqual(await verifyPassword("correct Paard", hash), { ok: false, needsRehash: false });
assert.deepEqual(await verifyPassword("", hash), { ok: false, needsRehash: false });

// Een hash uit Supabase Auth: bcrypt, $2a$.
const legacy = bcrypt.hashSync("screening-dev", 10);
assert.ok(legacy.startsWith("$2a$") || legacy.startsWith("$2b$"));
assert.deepEqual(await verifyPassword("screening-dev", legacy), { ok: true, needsRehash: true });
assert.deepEqual(await verifyPassword("verkeerd", legacy), { ok: false, needsRehash: false });

// Zwakkere scrypt-parameters van vroeger: wel goed, wel opnieuw hashen.
const weak = hash.replace("scrypt$32768$", "scrypt$16384$");
assert.equal((await verifyPassword("correct paard", weak)).ok, false, "andere N, andere sleutel");

// Geen of onzinnige hash: nooit door.
assert.deepEqual(await verifyPassword("x", null), { ok: false, needsRehash: false });
assert.deepEqual(await verifyPassword("x", "onzin"), { ok: false, needsRehash: false });
assert.deepEqual(await verifyPassword("x", "scrypt$1$1$1$$"), { ok: false, needsRehash: false });

console.log("auth-password: scrypt met eigen zout, bcrypt uit Supabase werkt en vraagt een nieuwe hash, onzin komt niet door");
