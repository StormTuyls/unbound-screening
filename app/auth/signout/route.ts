import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";

/** Uitloggen in deze browser, en terug naar het aanmeldscherm. */
export async function POST(request: Request) {
  await endSession();
  return NextResponse.redirect(new URL("/praktijk/login", new URL(request.url).origin));
}
