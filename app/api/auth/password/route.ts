import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { checkPassword, setPassword } from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { currentAccount, startSession } from "@/lib/auth/session";

/**
 * Het wachtwoord wijzigen terwijl je ingelogd bent.
 *
 * Eerst het huidige: een open laptop is anders genoeg om iemand zijn account af
 * te nemen. Daarna zijn alle andere sessies weg en krijgt deze browser een
 * nieuwe.
 */
export async function POST(request: Request) {
  try {
    const account = await currentAccount();
    if (!account) return NextResponse.json({ error: "signedOut" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as {
      current?: unknown;
      next?: unknown;
    };
    const current = typeof body.current === "string" ? body.current : "";
    const next = typeof body.next === "string" ? body.next : "";

    if (next.length < MIN_PASSWORD_LENGTH || next.length > 200) {
      return NextResponse.json({ error: "tooShort" }, { status: 400 });
    }
    if (!(await checkPassword(account.id, current))) {
      return NextResponse.json({ error: "wrongCurrent" }, { status: 400 });
    }

    await setPassword(account.id, next);
    await startSession(account.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
