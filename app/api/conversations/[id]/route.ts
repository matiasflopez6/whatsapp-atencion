import { NextResponse } from "next/server";
import { z } from "zod";
import { getConversation, listMessages } from "@/lib/panel/conversations";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const idSchema = z.uuid();
const querySchema = z.object({ before: z.uuid().optional() });

/** Conversación + mensajes (los más recientes, o los anteriores a `before`). La organización sale de la sesión. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await params;
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!idSchema.safeParse(id).success || !query.success) return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });

  const conversation = await getConversation(session.organizationId, id);
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const { messages, hasMore } = await listMessages(session.organizationId, id, { before: query.data.before });
  return NextResponse.json({ conversation, messages, hasMore });
}
