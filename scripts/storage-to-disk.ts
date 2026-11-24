/**
 * De documenten uit de Supabase-bak naar de documentenmap, eenmalig bij de verhuizing.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... DOCUMENTS_DIR=... \
 *     npx tsx scripts/storage-to-disk.ts
 *
 * Per rij in medical.documents: het bestand ophalen, het sha256 vergelijken met
 * wat bij het uploaden is vastgelegd, en pas dan wegschrijven onder hetzelfde
 * pad. De databank verandert dus niet. Een bestand dat er al staat met het
 * juiste sha256 wordt overgeslagen, zodat het script opnieuw kan draaien.
 *
 * Geen Supabase-pakket maar gewone fetch naar de Storage-API: dit draait bij de
 * verhuizing, als het pakket al uit de app is maar de bak nog bestaat.
 *
 * Bestanden in de bak zonder rij (gestrande uploads) gaan niet mee. Ze worden
 * geteld, en verdwijnen met het Supabase-project.
 *
 * Stopt met exitcode 1 als er één bestand ontbreekt of een ander sha256 heeft.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnv } from "./env";

loadEnv();

const BUCKET = "intake-documents";

async function* once(bytes: Uint8Array) {
  yield bytes;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const { query } = await import("../lib/db/sql");
  const { readDocument, resolveDocumentPath, writeDocument } = await import(
    "../lib/documents/store"
  );

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY zijn nodig");
  const headers = { Authorization: `Bearer ${key}`, apikey: key };

  const rows = await query<{ storage_path: string; sha256: string }>(
    "select storage_path, sha256 from medical.documents order by uploaded_at",
  );

  const tally = { copied: 0, alreadyThere: 0, missing: [] as string[], mismatched: [] as string[] };

  for (const row of rows) {
    const full = resolveDocumentPath(row.storage_path);
    if (existsSync(full)) {
      if (sha256(await readDocument(row.storage_path)) === row.sha256) {
        tally.alreadyThere++;
        continue;
      }
      tally.mismatched.push(`${row.storage_path} (staat al op schijf, ander sha256)`);
      continue;
    }

    const response = await fetch(
      `${url}/storage/v1/object/authenticated/${BUCKET}/${row.storage_path}`,
      { headers },
    );
    if (!response.ok) {
      tally.missing.push(`${row.storage_path} (${response.status})`);
      continue;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== row.sha256) {
      tally.mismatched.push(row.storage_path);
      continue;
    }
    await writeDocument(row.storage_path, once(bytes), Number.POSITIVE_INFINITY);
    tally.copied++;
  }

  // Hoeveel er in de bak staat zonder rij. Alleen ter informatie.
  const listed = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit: 10000 }),
  });
  const prefixes = listed.ok ? ((await listed.json()) as Array<{ name: string }>).length : null;

  console.log(
    JSON.stringify(
      {
        rows: rows.length,
        copied: tally.copied,
        alreadyThere: tally.alreadyThere,
        missing: tally.missing,
        mismatched: tally.mismatched,
        intakeFoldersInBucket: prefixes,
      },
      null,
      1,
    ),
  );
  process.exit(tally.missing.length + tally.mismatched.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
