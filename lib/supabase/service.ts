import { createClient } from "@supabase/supabase-js";

/**
 * Supabase Storage voor de server, en verder niets.
 *
 * Tabellen gaan sinds fase 5a enkel via lib/db/sql.ts. Wat hier overblijft
 * verhuist in fase 5b naar een map op schijf.
 *
 * Importeer dit nooit in een client component.
 */

function credentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL ontbreekt");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt");
  return { url, key };
}

const AUTH = { persistSession: false, autoRefreshToken: false } as const;

/**
 * Alleen voor de private bucket met ruwe documenten. De bucket heeft geen
 * policies, dus enkel de service role komt erbij; de browser krijgt per bestand
 * een kortlevende signed URL.
 */
export function storage() {
  const { url, key } = credentials();
  return createClient(url, key, { auth: AUTH }).storage;
}

export const DOCUMENTS_BUCKET = "intake-documents";
