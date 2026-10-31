import { NextResponse } from "next/server";
import { z } from "zod";
import { listConversations } from "@/lib/panel/conversations";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  filter: z.enum(["all", "attention", "bot"]).default("all"),
});

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
  const conversations = await listConversations(session.organizationId, { query: parsed.data.q, filter: parsed.data.filter });
  return NextResponse.json({ conversations });
}
