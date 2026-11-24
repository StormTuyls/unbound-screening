import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { AccountExistsError, createAccount } from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { startSession } from "@/lib/auth/session";

/**
 * Een account aanmaken als atleet, en meteen ingelogd zijn.
 *
 * Zonder bevestigingsmail, net als voorheen (enable_confirmations stond uit). Het
 * profiel, de atleetrij en de toestemming komen daarna uit /api/athlete/register,
 * dat het scherm direct aanroept.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
      return NextResponse.json({ error: "tooShort" }, { status: 400 });
    }

    try {
      const accountId = await createAccount(email, password);
      await startSession(accountId);
    } catch (error) {
      if (error instanceof AccountExistsError) {
        return NextResponse.json({ error: "emailTaken" }, { status: 409 });
      }
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
