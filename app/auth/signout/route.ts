import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Uitloggen. POST en niet GET, zodat een afbeelding of een prefetch iemand niet
 * ongevraagd uitlogt.
 *
 * Eén bestemming, en dat is hier terecht. In athlete-intake splitst dit op rol,
 * want daar is een atleet die zich afmeldt op zijn thuisscherm iets anders dan
 * een coach. Deze repo heeft geen atleetkant: /start bestaat er niet, en wie
 * hier uitlogt komt op het inlogscherm van de praktijk.
 *
 * Geen `next`-parameter uit het formulier: dat is een open redirect die je dan
 * weer moet dichttimmeren, en de server weet dit zelf.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/coach/login", new URL(request.url).origin));
}
