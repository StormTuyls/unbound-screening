import { NextResponse } from "next/server";
import { apiMessages } from "@/lib/i18n/server";
import { requireEditableIntake } from "@/lib/intake/session";
import { badRequest, handleError } from "@/lib/http";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/intake/uploads";
import { DocumentTooLargeError, newDocumentPath, writeDocument } from "@/lib/documents/store";

// Een document van 50 MB over een trage verbinding duurt langer dan de standaard.
export const maxDuration = 300;

const ALLOWED = new Set<string>(ACCEPTED_MIME_TYPES);

/**
 * Eén bestand naar de documentenmap.
 *
 * De bytes komen als ruwe body binnen, het type in Content-Type en de naam in
 * X-Filename. Daarna registreert de browser het pad bij /api/intake/documents,
 * zoals voorheen na de upload naar Supabase. Bewaren vóór analyseren blijft de
 * volgorde: het ruwe bestand staat er, ook als de verwerking daarna klapt.
 *
 * Er staat geen proxy.ts voor deze app. Kwam die ooit terug, dan moet deze route
 * erbuiten: een verzoek door de proxy wordt maar tot 10 MB gebufferd en
 * daarboven stil afgekapt (experimental.proxyClientMaxBodySize).
 */
export async function POST(request: Request) {
  try {
    const t = await apiMessages();
    const session = await requireEditableIntake();
    if (!session.consentGrantedAt) return badRequest(t("consentFirst"));

    const mimeType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    const filename = decodeURIComponent(request.headers.get("x-filename") ?? "").trim();
    if (!filename || !mimeType || !request.body) return badRequest(t("filenameRequired"));
    if (!ALLOWED.has(mimeType)) return badRequest(t("unreadable"));

    // Wat de browser opgeeft is een voorcontrole, geen grens: writeDocument
    // telt zelf, en stopt ook als dit ontbreekt of liegt.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES) {
      return badRequest(t("tooLarge"));
    }

    const path = newDocumentPath(session.intakeId, filename);
    try {
      await writeDocument(path, request.body, MAX_UPLOAD_BYTES);
    } catch (error) {
      if (error instanceof DocumentTooLargeError) return badRequest(t("tooLarge"));
      throw error;
    }

    return NextResponse.json({ path });
  } catch (error) {
    return handleError(error);
  }
}
