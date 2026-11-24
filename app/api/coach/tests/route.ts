import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, handleError } from "@/lib/http";
import { requireCoach } from "@/lib/review/access";
import { createTest, setTestRetired } from "@/lib/db/testLibrary";
import { TEST_BLOCKS } from "@/lib/screening/blocks";
import { UNITS } from "@/lib/screening/units";

/**
 * Tests toevoegen, uitfaseren en terugzetten. Zie lib/db/testLibrary.ts.
 *
 * Wie dit mag: elke behandelaar, zoals bij de referentieregels. Welke tests een
 * screening bevat is een klinische afspraak, geen beheerderstaak; elke wijziging
 * staat in het audit-log en uitfaseren is terug te draaien.
 */

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((text) => (text?.trim() ? text.trim() : null));

const create = z.object({
  action: z.literal("create"),
  labelNl: z.string().trim().min(1).max(120),
  labelEn: z.string().trim().min(1).max(120),
  block: z.enum(TEST_BLOCKS),
  laterality: z.enum(["per_side", "bilateral"]),
  unit: z.enum(UNITS),
  direction: z.enum(["higher_better", "lower_better", "target_range", "neutral"]),
  decimals: z.number().int().min(0).max(4),
  device: optionalText(80),
  protocolConfirmed: z.boolean(),
  aboutNl: optionalText(2000),
  aboutEn: optionalText(2000),
});

const retire = z.object({
  action: z.enum(["retire", "restore"]),
  testKey: z.string().min(1).max(200),
});

const bodySchema = z.discriminatedUnion("action", [create, retire]);

export async function POST(request: Request) {
  try {
    const coach = await requireCoach();
    const actor = { id: coach.id, isAdmin: coach.role === "admin" };

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Expected a test.");
    const body = parsed.data;

    if (body.action === "create") {
      const { action: _action, ...input } = body;
      const created = await createTest(input, actor);
      return NextResponse.json({ ok: true, ...created });
    }

    const changed = await setTestRetired(body.testKey, body.action === "retire", actor);
    return changed ? NextResponse.json({ ok: true }) : badRequest("Unknown test.");
  } catch (caught) {
    return handleError(caught);
  }
}
