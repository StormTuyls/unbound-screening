import { NextResponse } from "next/server";
import { handleError } from "@/lib/http";
import { redeemToken, setPassword } from "@/lib/auth/accounts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { startSession } from "@/lib/auth/session";

/**
 * Een wachtwoord kiezen via een eenmalige link: wachtwoord vergeten, of een
 * uitnodiging. Daarna ben je ingelogd, en elke andere sessie van dit account is
 * weg.
 *
 * De lengte eerst, de token pas daarna: een te kort wachtwoord mag de link niet
 * opgebruiken.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: unknown;
      password?: unknown;
    };
    const token = typeof body.token === "string" ? body.token : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
      return NextResponse.json({ error: "tooShort" }, { status: 400 });
    }

    const redeemed = token ? await redeemToken(token) : null;
    if (!redeemed) return NextResponse.json({ error: "expired" }, { status: 410 });

    await setPassword(redeemed.accountId, password);
    await startSession(redeemed.accountId);

    // Een uitgenodigde atleet gaat naar zijn thuisscherm, waar de
    // toestemmingspoort staat; wie zijn wachtwoord vergat naar de voordeur.
    return NextResponse.json({ next: redeemed.purpose === "invite" ? "/home" : "/" });
  } catch (error) {
    return handleError(error);
  }
}
