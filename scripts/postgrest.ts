import { createClient } from "@supabase/supabase-js";

/**
 * PostgREST als service role, alleen voor testen en seeds.
 *
 * De app praat sinds fase 5a enkel via lib/db/sql.ts met de databank. Deze
 * client staat hier en niet meer in lib/, zodat er vanuit app/ of lib/ geen weg
 * naar PostgREST meer is. De integratietesten en seed-dev.ts zetten er nog hun
 * testgegevens mee klaar.
 *
 * shortcut: verdwijnt in fase 5b/5c, wanneer dezelfde bestanden voor Storage en
 * Auth toch herschreven worden; dan gaan hun inserts in één ronde naar SQL.
 */
export function appDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
}
