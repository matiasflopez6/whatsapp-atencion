import { NextResponse } from "next/server";
import { z } from "zod";
import { listAppointments } from "@/lib/panel/appointments";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 62 * 24 * 3600 * 1000;
const querySchema = z.object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) });

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  const from = new Date(parsed.data.from);
  const to = new Date(parsed.data.to);
  if (to <= from || to.getTime() - from.getTime() > MAX_RANGE_MS) return NextResponse.json({ error: "Rango inválido" }, { status: 400 });
  const appointments = await listAppointments(session.organizationId, from, to);
  return NextResponse.json({ appointments });
}
