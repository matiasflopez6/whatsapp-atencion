import { after, NextResponse, type NextRequest } from "next/server";
import { verifyTokenExists } from "@/lib/db/system";
import { errorMessage, log } from "@/lib/logger";
import { ingestWebhook } from "@/lib/whatsapp/ingest";
import { processWebhookEvent } from "@/lib/whatsapp/process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verificación de la suscripción: Meta llama con hub.mode / hub.verify_token / hub.challenge. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (params.get("hub.mode") === "subscribe" && token && challenge && (await verifyTokenExists(token))) {
    return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  log.warn("verificación de webhook rechazada");
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Eventos de Meta. Se valida la firma y se persiste el evento (inbox), se responde 200 de inmediato y
 * el procesamiento corre en after(). Si el proceso muere antes, el cron de reproceso lo recoge.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const result = await ingestWebhook(rawBody, request.headers.get("x-hub-signature-256"));
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });

    if (result.events.length) {
      after(async () => {
        for (const event of result.events) {
          await processWebhookEvent(event).catch((error) =>
            log.error("after(): error inesperado", { eventId: event.id, error: errorMessage(error) }),
          );
        }
      });
    }
    return NextResponse.json({ received: result.events.length });
  } catch (error) {
    log.error("webhook: no se pudo guardar el evento", { error: errorMessage(error) });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
