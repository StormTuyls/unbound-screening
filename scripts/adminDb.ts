import { Pool, types } from "pg";

/**
 * Een admin-verbinding met de databank, alleen voor scripts en testen.
 *
 * Testen en seeds zetten gegevens klaar die de app zelf nooit schrijft: een
 * intake die meteen "submitted" is, een atleet zonder account, rijen die ze
 * achteraf weer opruimen. Daar zijn de rechten van intake_server bewust te smal
 * voor. De app gebruikt dit nooit; die praat via lib/db/sql.ts.
 *
 * ADMIN_DATABASE_URL, of het oude SUPABASE_DB_URL, of de lokale stack.
 */

// Datums als tekst, zoals lib/db/sql.ts, zodat testen dezelfde vorm zien als de app.
types.setTypeParser(types.builtins.DATE, (value) => value);

let pool: Pool | null = null;

function getPool(): Pool {
  pool ??= new Pool({
    connectionString:
      process.env.ADMIN_DATABASE_URL ??
      process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    max: 2,
  });
  return pool;
}

export async function admin<T = any>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await getPool().query(text, values)).rows as T[];
}

/** Werk op één verbinding, samen of niet. Op een pool zou begin en commit elk op een andere verbinding kunnen landen. */
export async function adminTransaction<T>(
  work: (run: <R = any>(text: string, values?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await work(async (text, values = []) => (await client.query(text, values)).rows);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeAdmin(): Promise<void> {
  await pool?.end();
  pool = null;
}
