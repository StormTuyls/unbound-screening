/**
 * Een POST vanaf de client, met de fout als tekst terug in plaats van als worp.
 *
 * De vier coachschermen deden dit alle vier zelf, en alle vier zonder
 * try/catch. Dat is geen schoonheidsfoutje: een netwerkfout is geen HTTP-fout
 * maar een echte worp, en die sloeg de regel over die `saving` of `busy`
 * terugzet. De knop bleef op slot staan zonder melding, en de enige uitweg was
 * herladen en opnieuw invoeren. Juist dat tweede invoeren maakte een tweede
 * sessie, want de route kent geen idempotentie.
 *
 * Vandaar dat dit nooit werpt. Wie hem aanroept krijgt altijd een antwoord en
 * kan zijn knop altijd terugzetten.
 *
 * Een mislukte verbinding en een server die niets zinnigs zei komen allebei
 * terug als `error: null`. Dat is met opzet: de beller heeft al een eigen
 * "bewaren mislukt" in zijn eigen taal, en voor wat de gebruiker vervolgens
 * doet maakt het verschil niet uit.
 */
export type PostResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string | null };

export async function postJson(url: string, payload: unknown): Promise<PostResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: null };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = (body as { error?: unknown } | null)?.error;
    return { ok: false, error: typeof message === "string" ? message : null };
  }

  return { ok: true, data: await response.json().catch(() => null) };
}
