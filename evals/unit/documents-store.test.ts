import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * De documentenmap: binnen de map blijven, de grens afdwingen terwijl de bytes
 * binnenkomen, nooit overschrijven, en bij verwijderen ook de gestrande upload
 * meenemen en nagaan dat er niets meer staat.
 */

const root = mkdtempSync(path.join(tmpdir(), "unbound-documents-"));
process.env.DOCUMENTS_DIR = root;

const {
  DocumentTooLargeError,
  newDocumentPath,
  purgeDocuments,
  readDocument,
  resolveDocumentPath,
  writeDocument,
} = await import("../../lib/documents/store");

const intake = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function* chunks(...parts: string[]) {
  for (const part of parts) yield new TextEncoder().encode(part);
}

// Paden: de extensie is invoer, en alleen letters en cijfers komen erdoor.
{
  assert.match(newDocumentPath(intake, "verslag.PDF"), new RegExp(`^${intake}/[0-9a-f-]{36}\\.pdf$`));
  assert.match(newDocumentPath(intake, "x./../../etc"), /\.bin$/);
  assert.match(newDocumentPath(intake, "zonder-extensie"), /\.bin$/);
  assert.throws(() => resolveDocumentPath("../buiten.txt"), /buiten de documentenmap/);
  assert.throws(() => resolveDocumentPath(`${intake}/../../buiten.txt`), /buiten de documentenmap/);
  assert.throws(() => resolveDocumentPath("/etc/passwd"), /buiten de documentenmap/);
}

// Schrijven en teruglezen, in stukken, met de rechten van de serverrol.
const first = newDocumentPath(intake, "a.txt");
{
  const written = await writeDocument(first, chunks("Lengte: ", "176 cm"), 1000);
  assert.equal(written, 14);
  assert.equal(new TextDecoder().decode(await readDocument(first)), "Lengte: 176 cm");
  assert.equal(statSync(resolveDocumentPath(first)).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(root, intake)).mode & 0o777, 0o700);
}

// Nooit overschrijven.
await assert.rejects(writeDocument(first, chunks("anders"), 1000));
assert.equal(new TextDecoder().decode(await readDocument(first)), "Lengte: 176 cm");

// De grens geldt op wat binnenkomt, en het halve bestand blijft niet liggen.
{
  const big = newDocumentPath(intake, "groot.pdf");
  await assert.rejects(writeDocument(big, chunks("12345", "67890", "x"), 10), DocumentTooLargeError);
  assert.equal(existsSync(resolveDocumentPath(big)), false);
  assert.equal(await writeDocument(newDocumentPath(intake, "precies.pdf"), chunks("1234567890"), 10), 10);
}

// Verwijderen: de geregistreerde paden, en ook wat in de map ligt zonder rij.
{
  writeFileSync(path.join(root, intake, "gestrand.pdf"), "upload zonder registratie");
  const kept = newDocumentPath(other, "blijft.txt");
  await writeDocument(kept, chunks("andere atleet"), 1000);

  const result = await purgeDocuments({ intakeIds: [intake], knownPaths: [first] });
  assert.equal(result.removed, 3);
  assert.equal(result.verifiedEmpty, true);
  assert.equal(existsSync(path.join(root, intake)), false);
  assert.equal(new TextDecoder().decode(await readDocument(kept)), "andere atleet");

  // Nog eens: niets meer te doen, en nog steeds leeg.
  assert.deepEqual(await purgeDocuments({ intakeIds: [intake], knownPaths: [first] }), {
    removed: 0,
    verifiedEmpty: true,
  });
}

// Een pad buiten de map wordt ook bij verwijderen geweigerd.
mkdirSync(path.join(root, "..", "buiten"), { recursive: true });
await assert.rejects(purgeDocuments({ intakeIds: [], knownPaths: ["../buiten/x"] }), /buiten/);
assert.deepEqual(readdirSync(root), [other]);

rmSync(root, { recursive: true, force: true });
rmSync(path.join(root, "..", "buiten"), { recursive: true, force: true });

console.log("documents-store: binnen de map, grens tijdens het schrijven, nooit overschrijven, gestrande upload mee weg");
