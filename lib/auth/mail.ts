import nodemailer from "nodemailer";

/**
 * Mail versturen: wachtwoord vergeten en uitnodigingen.
 *
 * SMTP_URL is bv. smtp://gebruiker:wachtwoord@smtp.voorbeeld.be:587, en MAIL_FROM
 * de afzender. Zonder SMTP_URL wordt er niets verstuurd en geeft dit false: een
 * uitnodiging toont dan de link op het scherm, zoals voorheen als Supabase geen
 * mail kon sturen. Lokaal vangt Mailpit alles op (zie compose.yaml).
 */
export async function sendMail(input: { to: string; subject: string; text: string }): Promise<boolean> {
  const url = process.env.SMTP_URL;
  if (!url) return false;

  await nodemailer.createTransport(url).sendMail({
    from: process.env.MAIL_FROM ?? "unbound <no-reply@localhost>",
    to: input.to,
    subject: input.subject,
    text: input.text,
  });
  return true;
}

/** Het adres van deze app, voor links in een mail. */
export function appUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}
