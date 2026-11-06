import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { apiMessages } from "@/lib/i18n/server";
import { isUuid, requireCoach } from "@/lib/review/access";
import { getSession } from "@/lib/db/screening";
import { addNote, resolveNote } from "@/lib/db/screeningNotes";

export const maxDuration = 60;

/**
 * Opmerkingen en vlaggen op een screening. FR-13.
 *
 * Twee handelingen onder een route: schrijven en sluiten. Heropenen zit er niet
 * bij, met opzet; zie resolveNote().
 */

const add = z.object({
  action: z.literal("add"),
  metricKey: z.string().min(1).nullable(),
  severity: z.enum(["info", "watch", "action"]),
  // Sterkte of ontwikkelpunt zet de opmerking op pagina 1 van het rapport;
  // zonder soort blijft het een gewone vlag. Een nummer zonder soort weigert de
  // databank, dus weigeren we hem hier al.
  kind: z.enum(["strength", "development"]).nullable().default(null),
  rank: z.number().int().positive().max(99).nullable().default(null),
  body: z.string().trim().min(1).max(2000),
  note: z.string().max(500).nullable(),
  target: z.string().trim().max(500).nullable().default(null),
}).refine((v) => v.rank === null || v.kind !== null, { path: ["rank"] });

const resolve = z.object({
  action: z.literal("resolve"),
  noteId: z.number().int().positive(),
});

const bodySchema = z.discriminatedUnion("action", [add, resolve]);

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const t = await apiMessages();
    const { sessionId } = await context.params;
    if (!isUuid(sessionId)) {
      return NextResponse.json({ error: t("notFound") }, { status: 404 });
    }

    const coach = await requireCoach();
    const actor = {
      id: coach.id,
      name: coach.fullName,
      isAdmin: coach.role === "admin",
    };

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest(t("noteInvalid"));
    const body = parsed.data;

    if (body.action === "resolve") {
      await resolveNote(body.noteId, actor);
      return NextResponse.json({ ok: true });
    }

    // De sessie moet bestaan voor we eraan schrijven, en we hebben het
    // athlete_id nodig: een opmerking hangt aan de atleet, zodat hij ook na het
    // verwijderen van een sessie meegaat in het verwijderpad.
    const session = await getSession(sessionId, { id: coach.id });
    if (!session) return NextResponse.json({ error: t("notFound") }, { status: 404 });

    const id = await addNote(
      {
        sessionId,
        athleteId: session.athleteId,
        metricKey: body.metricKey,
        severity: body.severity,
        kind: body.kind,
        rank: body.rank,
        body: body.body,
        action: body.note,
        target: body.target,
      },
      actor,
    );

    return NextResponse.json({ ok: true, id });
  } catch (caught) {
    return handleError(caught);
  }
}
