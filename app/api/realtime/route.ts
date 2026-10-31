import { realtimeListener, type RealtimeMessage } from "@/lib/realtime/listener";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 20_000;
/** Cierra el stream periódicamente: EventSource reconecta solo y así se revalida la sesión. */
const MAX_STREAM_MS = 10 * 60_000;

/**
 * Server-Sent Events del panel. La organización sale SIEMPRE de la sesión; el cliente no puede
 * elegir a qué organización se suscribe. Los eventos solo llevan IDs (ver lib/realtime/types.ts).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("No autenticado", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const send = (event: RealtimeMessage) => write(`data: ${JSON.stringify(event)}\n\n`);

      const unsubscribe = realtimeListener.subscribe(session.organizationId, send);
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const expire = setTimeout(() => cleanup(), MAX_STREAM_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(expire);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado por el cliente
        }
      };
      request.signal.addEventListener("abort", cleanup);
      // `retry` indica al navegador cuánto esperar antes de reconectar.
      write("retry: 3000\n: connected\n\n");
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
