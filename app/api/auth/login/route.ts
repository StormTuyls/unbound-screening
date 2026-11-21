import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { signIn } from "@/lib/auth/accounts";

/**
 * Aanmelden met e-mail en wachtwoord.
 *
 * Geeft alleen terug óf het lukte, en zo niet of het om te veel pogingen gaat.
 * Nooit welk deel fout was: dat zou vertellen of een adres een account heeft.
 * De schermen vertalen de melding zelf.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
    };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }

    const result = await signIn(body.email, body.password);
    if (result.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { error: result.reason },
      { status: result.reason === "throttled" ? 429 : 401 },
    );
  } catch (error) {
    return handleError(error);
  }
}
