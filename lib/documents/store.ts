import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Aangeleverde documenten op schijf.
 *
 * Eén map, met per intake een submap: `<intakeId>/<uuid>.<ext>`. Dat relatieve
 * pad is wat in medical.documents.storage_path staat, precies zoals het in de
 * Supabase-bak heette, zodat de databank bij de verhuizing niet verandert.
 *
 * Wat Supabase Storage voor ons deed en wat hier dus zelf moet:
 *   - De grootte afdwingen terwijl de bytes binnenkomen. De browser geeft een
 *     grootte op, maar die telt niet: dit telt zelf en stopt.
 *   - Binnen de map blijven. Een sleutel in een bak kon niets buiten de bak
 *     raken; een pad op schijf wel. Elk pad gaat door resolveDocumentPath.
 *   - Niets overschrijven. Elk bestand krijgt een nieuw uuid, en schrijven
 *     weigert als het pad al bestaat.
 *
 * Bestanden zijn alleen voor de serverrol leesbaar (0600, mappen 0700). Wie de
 * map op een server zet, zet hem op een versleutelde schijf: dit zijn
 * artikel 9-gegevens.
 */

export class DocumentTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`document groter dan ${limit} bytes`);
  }
}

/** De documentenmap. Lokaal ./data/documents, op een server DOCUMENTS_DIR. */
export function documentsRoot(): string {
  return path.resolve(process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), "data", "documents"));
}

/** Een opgeslagen pad naar een absoluut pad, of een fout als het buiten de map valt. */
export function resolveDocumentPath(relative: string): string {
  const root = documentsRoot();
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) {
    throw new Error("documentpad valt buiten de documentenmap");
  }
  return full;
}

/**
 * Een nieuw pad voor een document van deze intake.
 *
 * De extensie komt uit de bestandsnaam van de atleet en is dus invoer: alleen
 * letters en cijfers, anders "bin". Ze is een etiket, niet waar het bestandstype
 * vandaan komt; dat beslist het mimetype bij het registreren.
 */
export function newDocumentPath(intakeId: string, filename: string): string {
  const raw = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const extension = /^[a-z0-9]{1,8}$/.test(raw) ? raw : "bin";
  return `${intakeId}/${randomUUID()}.${extension}`;
}

/**
 * Een document wegschrijven en de bytes tellen terwijl ze binnenkomen.
 *
 * Gaat het over de grens, dan stopt het schrijven, gaat het halve bestand weg
 * en volgt DocumentTooLargeError. Geeft het aantal geschreven bytes terug.
 */
export async function writeDocument(
  relative: string,
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<number> {
  const full = resolveDocumentPath(relative);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });

  // "wx": faalt als het bestand al bestaat, dus nooit een ander document overschrijven.
  const file = await open(full, "wx", 0o600);
  let written = 0;
  try {
    for await (const chunk of body) {
      written += chunk.byteLength;
      if (written > maxBytes) throw new DocumentTooLargeError(maxBytes);
      await file.write(chunk);
    }
  } catch (error) {
    await file.close();
    await unlink(full).catch(() => {});
    throw error;
  }
  await file.close();
  return written;
}

export async function readDocument(relative: string): Promise<Uint8Array> {
  return readFile(resolveDocumentPath(relative));
}

export interface DocumentPurgeResult {
  removed: number;
  /** Waar als na het verwijderen geen enkel bestand of intakemap meer bestaat. */
  verifiedEmpty: boolean;
}

async function exists(full: string): Promise<boolean> {
  return stat(full).then(
    () => true,
    () => false,
  );
}

async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name));
}

/**
 * Alle documenten van deze intakes weg, en nagaan dat er echt niets meer staat.
 *
 * Twee bronnen, zoals in Storage: de paden uit de administratie EN alles in de
 * intakemap. Een upload die strandde voor hij geregistreerd werd laat een
 * bestand achter dat nergens genoemd wordt, en juist dat is een medisch
 * document dat zou blijven liggen.
 */
export async function purgeDocuments(input: {
  intakeIds: string[];
  knownPaths: string[];
}): Promise<DocumentPurgeResult> {
  const files = new Set<string>();
  for (const relative of input.knownPaths) {
    const full = resolveDocumentPath(relative);
    if (await exists(full)) files.add(full);
  }
  const dirs = input.intakeIds.map((id) => resolveDocumentPath(id));
  for (const dir of dirs) for (const file of await filesIn(dir)) files.add(file);

  for (const file of files) await rm(file, { force: true });
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });

  let verifiedEmpty = true;
  for (const full of [...files, ...dirs]) {
    if (await exists(full)) verifiedEmpty = false;
  }

  return { removed: files.size, verifiedEmpty };
}
