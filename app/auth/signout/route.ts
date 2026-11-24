import { endSession } from "@/lib/auth/session";

/**
 * Uitloggen in deze browser, en terug naar het aanmeldscherm.
 *
 * Een relatief adres en geen `request.url`: achter een proxy of tunnel is dat
 * het interne adres van de server (localhost:3020), en daar stuurde de browser
 * de bezoeker dan naartoe. 303 zodat de browser met een GET volgt en de POST
 * niet herhaalt op de aanmeldpagina.
 */
export async function POST() {
  await endSession();
  return new Response(null, { status: 303, headers: { Location: "/praktijk/login" } });
}
