import assert from "node:assert/strict";
import { postJson } from "../../lib/postJson";

/**
 * De drie takken van lib/postJson.ts, zonder server.
 *
 * De middelste tak is de reden dat dit bestand bestaat. Vier coachschermen
 * deden hun eigen fetch zonder try/catch, en bij een worp bleef de bewaarknop
 * op slot staan. Dat is niet te zien aan de code en wel aan de tester: hij
 * herlaadt en voert opnieuw in, en dat is precies hoe een dubbele sessie
 * ontstaat.
 */

const echt = globalThis.fetch;

async function met(nep: typeof globalThis.fetch, uit: () => Promise<void>) {
  globalThis.fetch = nep;
  try {
    await uit();
  } finally {
    globalThis.fetch = echt;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// ── 1. Gelukt: het lichaam komt terug ────────────────────────────────────────
await met(async () => json({ sessionId: "abc" }), async () => {
  const result = await postJson("/api/test", { a: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.data, { sessionId: "abc" });
});

// ── 2. De verbinding valt weg: geen worp, wel een antwoord ───────────────────
//
// Zonder deze tak werpt postJson en komt de beller nooit bij zijn setBusy(false).
await met(async () => { throw new TypeError("Failed to fetch"); }, async () => {
  const result = await postJson("/api/test", {});
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, null, "de beller kiest zijn eigen tekst");
});

// ── 3. De server weigert ─────────────────────────────────────────────────────
await met(async () => json({ error: "Onbekende metriek" }, 400), async () => {
  const result = await postJson("/api/test", {});
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, "Onbekende metriek");
});

// Een foutpagina die geen json is, of een json zonder error-veld: ook dan geen
// worp, want een HTML-foutpagina van een proxy is een realistisch antwoord.
await met(async () => new Response("<html>502</html>", { status: 502 }), async () => {
  const result = await postJson("/api/test", {});
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.error, null);
});

await met(async () => json({ melding: "fout" }, 500), async () => {
  const result = await postJson("/api/test", {});
  assert.equal(result.ok === false && result.error, null, "alleen een string telt als melding");
});

console.log("post-json: gelukt, verbinding weg, geweigerd, en twee onleesbare antwoorden");
